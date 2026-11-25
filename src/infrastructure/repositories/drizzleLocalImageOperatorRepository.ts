import { and, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LocalOperatorError } from "../../application/localImageOperator";
import { EBAY_DISCOVERY_SCOPES, sameEbayScopes, type ConnectedValues } from "../../application/ebayConnection";
import { mediaSessionHash, realMediaDigest } from "../../application/ebayRealMedia";
import { ownerIdSchema } from "../../application/owner";
import * as schema from "../db/schema";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const table = schema.localImageOperatorActivations;
export type LocalImageOperatorActivation = typeof table.$inferSelect;
export type LocalOperatorActor = { ownerId: string; id: string; expiresAt: string };
export type LocalOperatorApproval = Pick<LocalImageOperatorActivation, "id" | "ownerId" | "reviewedHead" | "reviewedTree" | "configHash" | "sellerKey" | "connectionId" | "initialConnectionVersion" | "derivativeRecipe" | "comparisonRecipe" | "expiresAt">;
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().refine(v => Number.isFinite(Date.parse(v)));
const actorSchema = z.object({ ownerId: ownerIdSchema, id, expiresAt: instant }).strict();
const revisionSchema = z.number().int().min(0).max(2_147_483_646);
type Changes = { [K in keyof typeof table.$inferInsert]?: (typeof table.$inferInsert)[K] | SQL };
const now = sql<string>`clock_timestamp()`;
const owned = (activation: string, owner: string) => and(eq(table.id, activation), eq(table.ownerId, owner));

// Local diagnostic authority only. No methods call providers, storage or native
// work. Permanent markers consume the one consent/fixture/run even after restart.
export class DrizzleLocalImageOperatorRepository {
  constructor(private readonly db: Database) {}
  private async protect<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { if (error instanceof LocalOperatorError) throw error; throw new LocalOperatorError("conflict"); }
  }
  async activation(activation: string, owner?: string): Promise<LocalImageOperatorActivation | null> {
    return this.protect(async () => {
      id.parse(activation); if (owner !== undefined) ownerIdSchema.parse(owner);
      const [row] = await this.db.select().from(table).where(owner === undefined ? eq(table.id, activation) : owned(activation, owner));
      return row ?? null;
    });
  }
  async fixtureRetentionUntil(activation: string, owner: string): Promise<string | null> {
    return this.protect(async () => {
      id.parse(activation); ownerIdSchema.parse(owner);
      const [row] = await this.db.select({ deadline: schema.listingImages.providerRetainUntil }).from(table)
        .innerJoin(schema.listings, and(eq(schema.listings.id, table.listingId), eq(schema.listings.ownerId, table.ownerId)))
        .innerJoin(schema.listingImages, and(eq(schema.listingImages.id, table.imageId), eq(schema.listingImages.listingId, table.listingId)))
        .where(owned(activation, owner));
      return row?.deadline ?? null;
    });
  }
  async byStateHash(stateHash: string): Promise<LocalImageOperatorActivation | null> {
    return this.protect(async () => { hash.parse(stateHash); const [row] = await this.db.select().from(table).where(eq(table.consentStateHash, stateHash)); return row ?? null; });
  }
  async arm(approval: LocalOperatorApproval): Promise<LocalImageOperatorActivation> {
    return this.protect(async () => {
      id.parse(approval.id); ownerIdSchema.parse(approval.ownerId); id.parse(approval.connectionId); id.parse(approval.initialConnectionVersion);
      hash.parse(approval.configHash); hash.parse(approval.sellerKey); instant.parse(approval.expiresAt);
      z.string().regex(/^[a-f0-9]{40}$/).parse(approval.reviewedHead); z.string().regex(/^[a-f0-9]{40}$/).parse(approval.reviewedTree);
      z.string().min(1).max(1024).regex(/^[ -~]+$/).parse(approval.derivativeRecipe); z.string().min(1).max(1024).regex(/^[ -~]+$/).parse(approval.comparisonRecipe);
      return this.db.transaction(async tx => {
        await tx.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, approval.ownerId)).for("update");
        const [row] = await tx.insert(table).values({ ...approval, createdAt: now, updatedAt: now, reviewDueAt: now, dispositionDueAt: now }).returning();
        return row;
      });
    });
  }
  // Lock order: owned listing/image when required, live session, connection,
  // activation. Trigger context reads use NOWAIT, never reverse blocking waits.
  private async lock(tx: Transaction, activation: string, actor: LocalOperatorActor, revision?: number, fixture = false, cleanup = false) {
    id.parse(activation); actorSchema.parse(actor); if (revision !== undefined) revisionSchema.parse(revision);
    const [peek] = await tx.select().from(table).where(owned(activation, actor.ownerId));
    if (!peek) throw new LocalOperatorError("context");
    if (fixture && peek.listingId) {
      await tx.select().from(schema.listings).where(and(eq(schema.listings.id, peek.listingId), eq(schema.listings.ownerId, actor.ownerId))).for("update");
      if (peek.imageId) await tx.select().from(schema.listingImages).where(and(eq(schema.listingImages.id, peek.imageId), eq(schema.listingImages.listingId, peek.listingId))).for("update");
    }
    const [session] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.userId, actor.ownerId), eq(schema.sessions.id, actor.id))).for("share");
    await tx.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, actor.ownerId)).for("update");
    const [row] = await tx.select().from(table).where(owned(activation, actor.ownerId)).for("update");
    const time = await tx.execute(sql`SELECT ${session?.expiresAt.toISOString() ?? null}::timestamptz > clock_timestamp() AS live`);
    if (!row || time.rows[0]?.live !== true || (revision !== undefined && row.revision !== revision) || (!cleanup && row.sessionHash !== null && row.sessionHash !== mediaSessionHash(actor.ownerId, actor.id))) throw new LocalOperatorError("context");
    return row;
  }
  private async update(tx: Transaction, row: LocalImageOperatorActivation, values: Changes) {
    const [changed] = await tx.update(table).set({ ...values, revision: row.revision + 1, updatedAt: now }).where(and(owned(row.id, row.ownerId), eq(table.revision, row.revision))).returning();
    if (!changed) throw new LocalOperatorError("conflict"); return changed;
  }
  consentRepository(activation: string, actor: LocalOperatorActor, revision: number): DrizzleEbayConnectionRepository {
    const operator = { db: this.db, protect: this.protect.bind(this), lock: this.lock.bind(this), update: this.update.bind(this) };
    return new class extends DrizzleEbayConnectionRepository {
      constructor() { super(operator.db); }
      override async begin(owner: string, sessionHash: string, configHash: string, stateHash: string, _at: string, expiresAt: string, scopes: readonly string[] = EBAY_DISCOVERY_SCOPES) {
        await operator.protect(async () => {
          hash.parse(stateHash); instant.parse(expiresAt);
          if (owner !== actor.ownerId || sessionHash !== realMediaDigest(actor.id) || !sameEbayScopes(scopes, EBAY_DISCOVERY_SCOPES)) throw new LocalOperatorError("context");
          await operator.db.transaction(async tx => {
            const row = await operator.lock(tx, activation, actor, revision), version = randomUUID();
            if (row.configHash !== configHash || row.phase !== "armed") throw new LocalOperatorError("context");
            await operator.update(tx, row, { phase: "consent-pending", sessionHash: mediaSessionHash(owner, actor.id), consentStateHash: stateHash, consentVersion: version, consentStartedAt: now });
            await tx.update(schema.ebayConnections).set({ version, leaseToken: null, leaseUntil: null }).where(eq(schema.ebayConnections.ownerId, owner));
            // Only this owner's old pending states are invalidated. No unrelated
            // expired-state maintenance is part of the diagnostic authority.
            await tx.delete(schema.ebayOauthStates).where(eq(schema.ebayOauthStates.ownerId, owner));
            await tx.insert(schema.ebayOauthStates).values({ hash: stateHash, ownerId: owner, sessionHash, configHash, connectionVersion: version,
              requestedScopes: [...scopes], expiresAt: sql`least(${expiresAt}::timestamptz,${row.expiresAt}::timestamptz)` });
          });
        });
      }
      override async connect(owner: string, version: string, values: ConnectedValues, _at: string) {
        void _at;
        await operator.protect(async () => {
          if (owner !== actor.ownerId || !sameEbayScopes(values.scopes, EBAY_DISCOVERY_SCOPES)) throw new LocalOperatorError("context");
          await operator.db.transaction(async tx => {
            const row = await operator.lock(tx, activation, actor);
            if (row.phase !== "consent-pending" || row.consentVersion !== version || !row.identityIntentAt || values.sellerId !== row.sellerKey) throw new LocalOperatorError("context");
            const connectedVersion = randomUUID();
            const rows = await tx.update(schema.ebayConnections).set({ ...values, status: "connected", version: connectedVersion, connectedAt: now, leaseToken: null, leaseUntil: null })
              .where(and(eq(schema.ebayConnections.ownerId, owner), eq(schema.ebayConnections.version, version), eq(schema.ebayConnections.sellerId, row.sellerKey))).returning();
            if (!rows.length) throw new LocalOperatorError("context");
            await operator.update(tx, row, { phase: "connected", connectedVersion });
          });
        });
      }
    }();
  }
  async consumeCallbackIntent(activation: string, actor: LocalOperatorActor, stateHash: string, kind: "exchange" | "identity") {
    return this.protect(() => this.db.transaction(async tx => {
      hash.parse(stateHash); const row = await this.lock(tx, activation, actor);
      if (row.consentStateHash !== stateHash || row.phase !== "consent-pending" || (kind !== "exchange" && kind !== "identity")) throw new LocalOperatorError("context");
      return this.update(tx, row, kind === "exchange" ? { exchangeIntentAt: now } : { identityIntentAt: now });
    }));
  }
  async beginFixture(activation: string, actor: LocalOperatorActor, revision: number, listingId: string) {
    return this.protect(() => this.db.transaction(async tx => {
      z.uuid().parse(listingId); const row = await this.lock(tx, activation, actor, revision);
      const existing = await tx.select({ id: schema.listings.id }).from(schema.listings).where(eq(schema.listings.id, listingId));
      if (existing.length) throw new LocalOperatorError("context");
      return this.update(tx, row, { phase: "fixture-preparing", listingId, fixtureStartedAt: now });
    }));
  }
  async authorizeFixture(activation: string, actor: LocalOperatorActor) {
    return this.protect(() => this.db.transaction(async tx => {
      const row = await this.lock(tx, activation, actor, undefined, true);
      if (row.phase !== "fixture-preparing" || !row.listingId || !row.sourceDigest || !row.derivativeDigest) throw new LocalOperatorError("context");
      const [listing] = await tx.select().from(schema.listings).where(and(eq(schema.listings.id, row.listingId), eq(schema.listings.ownerId, actor.ownerId)));
      if (!listing || listing.title !== "SANDBOX M3 Generated " + row.sourceDigest.slice(0, 12)) throw new LocalOperatorError("context");
      // A fresh database wall clock after the final blocking context locks.
      // This read grants no new fixture attempt or network request slot.
      await tx.execute(sql`SELECT public.local_image_operator_context(a,'fixture') FROM public.local_image_operator_activations a WHERE a.id=${activation} AND a.owner_id=${actor.ownerId}`);
      return row;
    }));
  }
  async pinFixtureContent(activation: string, actor: LocalOperatorActor, revision: number, pins: { sourceDigest: string; derivativeDigest: string }) {
    return this.protect(() => this.db.transaction(async tx => { hash.parse(pins.sourceDigest); hash.parse(pins.derivativeDigest);
      const row = await this.lock(tx, activation, actor, revision); return this.update(tx, row, pins); }));
  }
  async finalizeFixture(activation: string, actor: LocalOperatorActor, revision: number, pins: { imageId: string; listingVersion: string }) {
    return this.protect(() => this.db.transaction(async tx => {
      z.uuid().parse(pins.imageId); instant.parse(pins.listingVersion); const row = await this.lock(tx, activation, actor, revision, true);
      // The selected image may not yet be attached to the activation. Acquire
      // it without reverse waiting; the trigger rechecks all context afterward.
      await tx.select().from(schema.listingImages).where(eq(schema.listingImages.id, pins.imageId)).for("update", { noWait: true });
      return this.update(tx, row, { phase: "ready", ...pins });
    }));
  }
  async claimRun(activation: string, actor: LocalOperatorActor, revision: number, runnerId: string) {
    return this.protect(() => this.db.transaction(async tx => { z.uuid().parse(runnerId); const row = await this.lock(tx, activation, actor, revision, true);
      return this.update(tx, row, { phase: "running", runStartedAt: now, runnerId }); }));
  }
  async requestCancel(activation: string, actor: LocalOperatorActor, revision: number) {
    return this.protect(() => this.db.transaction(async tx => { const row = await this.lock(tx, activation, actor, revision); return this.update(tx, row, { cancelRequestedAt: now }); }));
  }
  async settle(activation: string, owner: string, runnerId: string) {
    return this.protect(() => this.db.transaction(async tx => {
      const [row] = await tx.select().from(table).where(owned(id.parse(activation), ownerIdSchema.parse(owner))).for("update");
      if (!row || row.runnerId !== z.uuid().parse(runnerId) || !row.runStartedAt) throw new LocalOperatorError("context");
      if (row.settledAt) return row;
      return this.update(tx, row, { phase: row.stoppedAt ? "stopped" : "settled", settledAt: now });
    }));
  }
  async stop(activation: string, owner: string) {
    return this.protect(() => this.db.transaction(async tx => {
      const [row] = await tx.select().from(table).where(owned(id.parse(activation), ownerIdSchema.parse(owner))).for("update");
      if (!row) throw new LocalOperatorError("context"); if (row.stoppedAt || row.phase === "cleanup-queued") return row;
      return this.update(tx, row, { phase: "stopped", stoppedAt: now });
    }));
  }
  async beginCleanup(activation: string, actor: LocalOperatorActor, revision: number) {
    return this.protect(() => this.db.transaction(async tx => {
      const row = await this.lock(tx, activation, actor, revision, true, true);
      return this.update(tx, row, { cleanupStartedAt: now, cleanupSessionHash: mediaSessionHash(actor.ownerId, actor.id) });
    }));
  }
  async recordCleanup(activation: string, owner: string, notBefore: string) {
    return this.protect(() => this.db.transaction(async tx => {
      instant.parse(notBefore); const [row] = await tx.select().from(table).where(owned(id.parse(activation), ownerIdSchema.parse(owner))).for("update");
      if (!row) throw new LocalOperatorError("context");
      if (row.cleanupNotBefore) { if (Date.parse(row.cleanupNotBefore) !== Date.parse(notBefore)) throw new LocalOperatorError("conflict"); return row; }
      return this.update(tx, row, { phase: "cleanup-queued", cleanupNotBefore: notBefore });
    }));
  }
}
