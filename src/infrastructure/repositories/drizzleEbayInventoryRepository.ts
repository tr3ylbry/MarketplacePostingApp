import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ownerIdSchema } from "../../application/owner";
import { ebaySku } from "../../application/ebayPreparationMapping";
import { inventoryClaimInput, inventoryClaimSchema, inventoryDigest, inventoryId, inventoryIntentSchema,
  INVENTORY_LEASE_MS, InventoryPersistenceError, normalizeInventoryEvidence,
  type InventoryClaim, type InventoryClaimInput, type InventoryIntent, type InventoryProjection } from "../../application/ebayInventoryPersistence";
import * as schema from "../db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const resources = schema.ebayInventoryResources, attempts = schema.ebayInventoryAttempts, evidence = schema.ebayInventoryEvidence;
type Resource = typeof resources.$inferSelect;
type Attempt = typeof attempts.$inferSelect;
async function sellerGuard(tx: Transaction, seller: string) {
  // Stable across owners, connection versions and local epochs. A hash collision
  // only over-serializes. No remote reservation is implied by this local lock.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('inventory:sandbox:' || ${seller}, 0))`);
}
async function context(tx: Transaction, input: InventoryClaimInput, now: Date) {
  // Existing repositories acquire listing -> connection. Take the new seller
  // guard only after those locks, then resource -> attempt -> session.
  const [listing] = await tx.select().from(schema.listings).where(and(eq(schema.listings.id, input.listingId), eq(schema.listings.ownerId, input.ownerId))).for("update");
  const [connection] = await tx.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, input.ownerId)).for("update");
  if (!listing || !connection || new Date(listing.updatedAt).toISOString() !== input.listingVersion ||
    connection.id !== input.connectionId || connection.version !== input.connectionVersion || connection.configHash !== input.configHash ||
    connection.environment !== "sandbox" || connection.status !== "connected" || !connection.sellerId || !/^[a-f0-9]{64}$/.test(connection.sellerId) ||
    !connection.refresh || !connection.access || !connection.refreshExpiresAt || Date.parse(connection.refreshExpiresAt) <= now.getTime()) throw new InventoryPersistenceError("stale");
  const grant = await tx.execute(sql`SELECT public.real_media_grant_version(${sql.param(connection.scopes)}::text[]) AS hash`);
  if (grant.rows[0]?.hash !== input.grantHash) throw new InventoryPersistenceError("stale");
  return connection.sellerId;
}
async function liveSession(tx: Transaction, owner: string, session: string, now: Date) {
  const [row] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.id, session), eq(schema.sessions.userId, owner))).for("share");
  if (!row || row.expiresAt.getTime() <= now.getTime()) throw new InventoryPersistenceError("stale");
}
async function sessionHash(tx: Transaction, owner: string, session: string) {
  const result = await tx.execute(sql`SELECT public.inventory_session_hash(${owner},${session}) AS hash`);
  return String(result.rows[0].hash);
}
function owns(row: Attempt | undefined, claim: InventoryClaim) {
  return row && row.ownerId === claim.ownerId && row.resourceId === claim.resourceId && row.actionHash === claim.actionHash &&
    row.sessionHash === claim.sessionHash && row.claimHash === inventoryDigest(claim.token);
}
const claimValue = (row: Attempt, token: string): InventoryClaim => ({ id: row.id, resourceId: row.resourceId, ownerId: row.ownerId,
  revision: row.revision, token, sessionHash: row.sessionHash, actionHash: row.actionHash });

// Internal persistence only. No runtime factory, provider client, transport or
// ownership admission. The authenticated server must supply owner/session IDs.
export class DrizzleEbayInventoryRepository {
  constructor(private readonly db: Database, private readonly clock = () => new Date()) {}
  private async protect<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof InventoryPersistenceError) throw error;
      if (error && typeof error === "object" && "issues" in error) throw new InventoryPersistenceError("invalid");
      let value: unknown = error;
      for (let n = 0; n < 5 && value && typeof value === "object"; n++) {
        const e = value as { code?: string; cause?: unknown };
        if (["23505", "23503", "P0001", "40P01", "40001"].includes(e.code ?? "")) throw new InventoryPersistenceError("blocked");
        value = e.cause;
      }
      throw new InventoryPersistenceError("unavailable");
    }
  }
  async claim(input: InventoryClaimInput): Promise<InventoryClaim> {
    return this.protect(async () => {
      const value = inventoryClaimInput.parse(input), now = this.clock(), token = randomUUID();
      return this.db.transaction(async tx => {
        const seller = await context(tx, value, now); await sellerGuard(tx, seller);
        let [resource] = await tx.select().from(resources).where(and(eq(resources.environment, "sandbox"), eq(resources.sellerKey, seller), eq(resources.sku, ebaySku(value.listingId)))).for("update");
        if (resource && (resource.ownerId !== value.ownerId || resource.historicalListingId !== value.listingId || resource.retiredAt || !resource.currentListingId || !resource.currentConnectionId)) throw new InventoryPersistenceError("blocked");
        if (!resource) {
          [resource] = await tx.insert(resources).values({ id: randomUUID(), ownerId: value.ownerId, sellerKey: seller, sku: ebaySku(value.listingId),
            historicalListingId: value.listingId, currentListingId: value.listingId, currentConnectionId: value.connectionId,
            createdAt: now.toISOString(), reviewDueAt: now.toISOString() }).returning(); // SQL computes calendar review dates.
        }
        if (value.operation !== "inspect") {
          const [held] = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.sellerKey, seller), eq(resources.hold, "seller"))).limit(1);
          if (held || resource.hold !== "none") throw new InventoryPersistenceError("blocked");
        }
        const [consumed] = await tx.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.ownerId, value.ownerId), eq(attempts.actionHash, value.actionHash))).limit(1);
        if (consumed) throw new InventoryPersistenceError("blocked");
        const [old] = await tx.select().from(attempts).where(and(eq(attempts.resourceId, resource.id), eq(attempts.state, "preparing"))).for("update");
        if (old) {
          if (old.intentAt || Date.parse(old.leaseUntil) > now.getTime()) throw new InventoryPersistenceError("blocked");
          await tx.update(attempts).set({ state: "retired", revision: old.revision + 1, updatedAt: now.toISOString() })
            .where(and(eq(attempts.id, old.id), eq(attempts.revision, old.revision)));
        }
        await liveSession(tx, value.ownerId, value.sessionId, now);
        const { sessionId, ...binding } = value;
        const [row] = await tx.insert(attempts).values({ ...binding, id: randomUUID(), resourceId: resource.id,
          sessionHash: await sessionHash(tx, value.ownerId, sessionId), claimHash: inventoryDigest(token),
          leaseUntil: new Date(now.getTime() + INVENTORY_LEASE_MS).toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() }).returning();
        return claimValue(row, token);
      });
    });
  }
  private async locked(tx: Transaction, claim: InventoryClaim): Promise<{ resource: Resource; row: Attempt }> {
    // Owner filter precedes any seller lookup or exposed result.
    const [known] = await tx.select().from(resources).where(and(eq(resources.id, claim.resourceId), eq(resources.ownerId, claim.ownerId)));
    if (!known) throw new InventoryPersistenceError("stale");
    await sellerGuard(tx, known.sellerKey);
    const [resource] = await tx.select().from(resources).where(and(eq(resources.id, known.id), eq(resources.ownerId, claim.ownerId))).for("update");
    const [row] = await tx.select().from(attempts).where(and(eq(attempts.id, claim.id), eq(attempts.ownerId, claim.ownerId))).for("update");
    if (!owns(row, claim)) throw new InventoryPersistenceError("stale");
    return { resource, row };
  }
  async recordIntent(input: InventoryClaim, intent: InventoryIntent, current: InventoryClaimInput): Promise<InventoryClaim> {
    return this.protect(async () => {
      const claim = inventoryClaimSchema.parse(input), data = inventoryIntentSchema.parse(intent), guard = inventoryClaimInput.parse(current), now = this.clock();
      if (guard.ownerId !== claim.ownerId || guard.actionHash !== claim.actionHash) throw new InventoryPersistenceError("stale");
      return this.db.transaction(async tx => {
        await context(tx, guard, now);
        if (await sessionHash(tx, guard.ownerId, guard.sessionId) !== claim.sessionHash) throw new InventoryPersistenceError("stale");
        const { row, resource } = await this.locked(tx, claim);
        if (row.listingId !== guard.listingId || new Date(row.listingVersion).toISOString() !== guard.listingVersion || row.connectionId !== guard.connectionId ||
          row.connectionVersion !== guard.connectionVersion || row.configHash !== guard.configHash || row.grantHash !== guard.grantHash ||
          row.operation !== guard.operation || row.operation === "inspect" || row.revision !== claim.revision || row.state !== "preparing" ||
          Date.parse(row.leaseUntil) <= now.getTime() || resource.retiredAt) throw new InventoryPersistenceError("stale");
        await liveSession(tx, claim.ownerId, guard.sessionId, now);
        const [changed] = await tx.update(attempts).set({ ...data, intentAt: now.toISOString(), state: "fenced", revision: row.revision + 1,
          updatedAt: now.toISOString() }).where(and(eq(attempts.id, row.id), eq(attempts.revision, claim.revision))).returning();
        return claimValue(changed, claim.token);
      });
    });
  }
  async acknowledge(input: InventoryClaim, raw: unknown): Promise<{ evidenceId: string; late: boolean; revision: number; canStage: false; canDelete: false }> {
    return this.protect(async () => {
      const claim = inventoryClaimSchema.parse(input), envelope = normalizeInventoryEvidence(raw), now = this.clock();
      if (Date.parse(envelope.finishedAt) > now.getTime()) throw new InventoryPersistenceError("invalid");
      return this.db.transaction(async tx => {
        const { row } = await this.locked(tx, claim);
        // SQL owns canonical fingerprinting, budget enforcement, late detection,
        // append-only acknowledgement and monotonic hold/state transitions.
        const [inserted] = await tx.insert(evidence).values({ id: randomUUID(), ownerId: claim.ownerId, resourceId: claim.resourceId, attemptId: claim.id,
          envelope, fingerprint: inventoryDigest("pending"), expectedRevision: claim.revision, late: false, createdAt: now.toISOString() })
          .onConflictDoNothing({ target: [evidence.attemptId, evidence.fingerprint] }).returning();
        const [saved] = inserted ? [inserted] : await tx.select().from(evidence).where(and(eq(evidence.attemptId, row.id),
          eq(evidence.fingerprint, sql`public.inventory_evidence_fingerprint(${JSON.stringify(envelope)}::jsonb)`)));
        if (!saved) throw new InventoryPersistenceError("blocked");
        const [updated] = await tx.select().from(attempts).where(eq(attempts.id, row.id));
        return { evidenceId: saved.id, late: saved.late, revision: updated.revision, canStage: false, canDelete: false };
      });
    });
  }
  async retireUnfenced(input: InventoryClaim): Promise<void> {
    return this.protect(async () => {
      const claim = inventoryClaimSchema.parse(input), now = this.clock();
      await this.db.transaction(async tx => {
        const { row } = await this.locked(tx, claim);
        if (row.revision !== claim.revision || row.intentAt || row.state !== "preparing" || Date.parse(row.leaseUntil) > now.getTime()) throw new InventoryPersistenceError("stale");
        await tx.update(attempts).set({ state: "retired", revision: row.revision + 1, updatedAt: now.toISOString() }).where(and(eq(attempts.id, row.id), eq(attempts.revision, row.revision)));
      });
    });
  }
  async retireResource(owner: string, resourceId: string, revision: number): Promise<void> {
    return this.protect(async () => {
      ownerIdSchema.parse(owner); inventoryId.parse(resourceId);
      if (!Number.isSafeInteger(revision) || revision < 0) throw new InventoryPersistenceError("invalid");
      await this.db.transaction(async tx => {
        const [known] = await tx.select().from(resources).where(and(eq(resources.id, resourceId), eq(resources.ownerId, owner)));
        if (!known) throw new InventoryPersistenceError("stale");
        await sellerGuard(tx, known.sellerKey);
        const [changed] = await tx.update(resources).set({ retiredAt: this.clock().toISOString(), hold: "seller", revision: revision + 1,
          currentListingId: null, currentConnectionId: null }).where(and(eq(resources.id, resourceId), eq(resources.ownerId, owner), eq(resources.revision, revision), isNull(resources.retiredAt))).returning();
        if (!changed) throw new InventoryPersistenceError("stale");
      });
    });
  }
  async projection(owner: string, listingId: string): Promise<InventoryProjection | null> {
    return this.protect(async () => {
      ownerIdSchema.parse(owner); inventoryId.parse(listingId);
      // A single SELECT snapshot; no locks, provider traffic or retained secrets.
      const result = await this.db.execute(sql`
        SELECT r.id AS resource_id, a.id AS attempt_id, a.state,
          CASE WHEN EXISTS(SELECT 1 FROM public.ebay_inventory_resources h WHERE h.seller_key=r.seller_key AND h.environment=r.environment AND h.hold='seller') THEN 'seller' ELSE r.hold END AS hold
        FROM public.ebay_inventory_resources r
        JOIN LATERAL (SELECT * FROM public.ebay_inventory_attempts x WHERE x.resource_id=r.id ORDER BY x.ordinal DESC LIMIT 1) a ON true
        JOIN public.listings l ON l.id=r.current_listing_id AND l.id=a.listing_id AND l.owner_id=r.owner_id AND l.updated_at=a.listing_version
        JOIN public.ebay_connections c ON c.id=r.current_connection_id AND c.id=a.connection_id AND c.owner_id=r.owner_id
          AND c.version=a.connection_version AND c.config_hash=a.config_hash AND c.seller_id=r.seller_key AND c.status='connected'
          AND c.environment='sandbox' AND public.real_media_grant_version(c.scopes)=a.grant_hash
        WHERE r.owner_id=${owner} AND r.current_listing_id=${listingId} AND r.retired_at IS NULL
      `);
      const row = result.rows[0];
      return row ? { resourceId: String(row.resource_id), attemptId: String(row.attempt_id), state: String(row.state),
        hold: row.hold as InventoryProjection["hold"], ownership: "unproven", canStage: false, canDelete: false } : null;
    });
  }
}
