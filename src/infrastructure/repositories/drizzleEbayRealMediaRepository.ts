import { randomUUID } from "node:crypto";
import { and, eq, isNull, isNotNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { validEbayScopes } from "../../application/ebayConnection";
import { ownerIdSchema } from "../../application/owner";
import { PRIVATE_IMAGE_REVIEW_MS } from "../../application/ebayPrivateImages";
import { CLEANUP_GRACE_MS } from "../../application/imageStorage";
import { REAL_MEDIA_LEASE_MS, RealMediaError, realMediaDigest, realMediaContextSchema, realMediaContentSchema,
  mediaHash, mediaId, safeRealMediaFailure, type RealMediaContext, type RealMediaContent, type RealMediaClaim, type RealMediaSummary, type RealMediaState } from "../../application/ebayRealMedia";
import { admittedMediaReceipt } from "../ebay/realMediaEvidence";
import * as schema from "../db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const attempts = schema.ebayRealMediaAttempts, receipts = schema.ebayRealMediaReceipts, associations = schema.ebayRealMediaAssociations;
type Attempt = typeof attempts.$inferSelect;
type Receipt = typeof receipts.$inferSelect;
const claimSchema = z.strictObject({ id: mediaId, ownerId: ownerIdSchema, listingId: mediaId, imageId: mediaId, token: z.uuid(),
  revision: z.number().int().nonnegative(), sessionHash: mediaHash, actionHash: mediaHash });

// Global lock order: owned listing, connection, image, attempt, association.
async function context(tx: Transaction, owner: string, listingId: string, imageId: string, now: Date) {
  const [listing] = await tx.select().from(schema.listings).where(and(eq(schema.listings.id, listingId), eq(schema.listings.ownerId, owner))).for("update");
  const [connection] = await tx.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner)).for("update");
  const [image] = listing ? await tx.select({ id: schema.listingImages.id, order: schema.listingImages.order,
    kind: schema.listingImages.storageProvider, type: schema.listingImages.contentType,
    sourceVersion: sql<string>`public.real_media_source_version(${schema.listingImages.id})` })
    .from(schema.listingImages).where(and(eq(schema.listingImages.id, imageId), eq(schema.listingImages.listingId, listingId))).for("update") : [];
  if (!listing || !connection || !image || image.kind !== "vercel-blob" || !["image/jpeg", "image/png"].includes(image.type ?? "") ||
    connection.environment !== "sandbox" || connection.status !== "connected" || !mediaHash.safeParse(connection.sellerId).success ||
    !connection.access || !connection.refresh || !connection.connectedAt || !connection.refreshExpiresAt ||
    Date.parse(connection.refreshExpiresAt) <= now.getTime() || !validEbayScopes(connection.scopes)) return null;
  const result = await tx.execute(sql`SELECT public.real_media_grant_version(${sql.param(connection.scopes)}::text[]) AS hash`);
  return { listingVersion: new Date(listing.updatedAt).toISOString(), connectionId: connection.id, connectionVersion: connection.version,
    configHash: connection.configHash, grantHash: String(result.rows[0]?.hash), sellerKey: connection.sellerId!,
    sourceVersion: image.sourceVersion, imageOrder: image.order, sourceType: image.type };
}
function matches(current: Awaited<ReturnType<typeof context>>, row: Attempt) {
  return current && current.listingVersion === new Date(row.listingVersion).toISOString() && current.connectionId === row.connectionId &&
    current.connectionVersion === row.connectionVersion && current.configHash === row.configHash && current.grantHash === row.grantHash &&
    current.sellerKey === row.sellerKey && current.sourceVersion === row.sourceVersion && current.imageOrder === row.imageOrder;
}
function ownsClaim(row: Attempt | undefined, claim: RealMediaClaim) {
  return row && row.ownerId === claim.ownerId && row.listingId === claim.listingId && row.imageId === claim.imageId &&
    row.claimHash === realMediaDigest(claim.token) && row.sessionHash === claim.sessionHash && row.actionHash === claim.actionHash;
}
const evidenceKeys = ["resourceId", "location", "imageUrl", "maximumUrl", "expiresAt", "responseStatus"] as const;
function contradictory(rows: Receipt[]) {
  return rows.some(row => row.level === "conflict") || evidenceKeys.some(key => new Set(rows.flatMap(row => row[key] === null ? [] : [key === "expiresAt" ? String(Date.parse(row.expiresAt!)) : String(row[key])])).size > 1);
}

export class DrizzleEbayRealMediaRepository {
  constructor(private readonly db: Database, private readonly clock = () => new Date()) {}
  private async protect<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) { throw safeRealMediaFailure(error); }
  }
  async claim(input: RealMediaContext): Promise<RealMediaClaim> {
    return this.protect(async () => {
      const value = realMediaContextSchema.parse(input), now = this.clock(), token = randomUUID();
      return this.db.transaction(async tx => {
        const current = await context(tx, value.ownerId, value.listingId, value.imageId, now);
        if (!current || current.listingVersion !== value.listingVersion || current.configHash !== value.configHash) throw new RealMediaError("stale");
        const [fenced] = await tx.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.ownerId, value.ownerId),
          eq(attempts.listingId, value.listingId), eq(attempts.imageId, value.imageId), isNotNull(attempts.postIntentAt))).limit(1);
        if (fenced) throw new RealMediaError("blocked");
        const [previous] = await tx.select().from(attempts).where(and(eq(attempts.ownerId, value.ownerId),
          or(eq(attempts.actionHash, value.actionHash), and(eq(attempts.listingId, value.listingId), eq(attempts.imageId, value.imageId), eq(attempts.state, "preparing"))))).for("update");
        if (previous && (previous.listingId !== value.listingId || previous.imageId !== value.imageId || previous.postIntentAt || previous.state !== "preparing" || !previous.leaseUntil || Date.parse(previous.leaseUntil) > now.getTime())) throw new RealMediaError("blocked");
        const values = { ...value, listingVersion: current.listingVersion, connectionId: current.connectionId, connectionVersion: current.connectionVersion,
          configHash: current.configHash, grantHash: current.grantHash, sellerKey: current.sellerKey, sourceVersion: current.sourceVersion, imageOrder: current.imageOrder,
          id: previous?.id ?? randomUUID(), environment: "sandbox", state: "preparing",
          revision: previous ? previous.revision + 1 : 0, claimHash: realMediaDigest(token),
          leaseUntil: new Date(now.getTime() + REAL_MEDIA_LEASE_MS).toISOString(), updatedAt: now.toISOString() };
        let row: Attempt;
        if (previous) {
          const [changed] = await tx.update(attempts).set(values).where(and(eq(attempts.id, previous.id), eq(attempts.revision, previous.revision),
            eq(attempts.claimHash, previous.claimHash), isNull(attempts.postIntentAt))).returning();
          if (!changed) throw new RealMediaError("blocked"); row = changed;
        } else [row] = await tx.insert(attempts).values({ ...values, createdAt: now.toISOString() }).returning();
        await tx.update(schema.listingImages).set({ providerRetainUntil: sql`greatest(${schema.listingImages.providerRetainUntil}, ${new Date(now.getTime() + PRIVATE_IMAGE_REVIEW_MS + CLEANUP_GRACE_MS).toISOString()}::timestamptz)` }).where(eq(schema.listingImages.id, value.imageId));
        return { id: row.id, ownerId: row.ownerId, listingId: row.listingId, imageId: row.imageId, token, revision: row.revision, sessionHash: row.sessionHash, actionHash: row.actionHash };
      });
    });
  }
  async fence(input: RealMediaClaim, content: RealMediaContent): Promise<RealMediaClaim> {
    return this.protect(async () => {
      const claim = claimSchema.parse(input), data = realMediaContentSchema.parse(content), now = this.clock();
      return this.db.transaction(async tx => {
        const current = await context(tx, claim.ownerId, claim.listingId, claim.imageId, now);
        const [row] = await tx.select().from(attempts).where(and(eq(attempts.id, claim.id), eq(attempts.ownerId, claim.ownerId))).for("update");
        if (!ownsClaim(row, claim) || !matches(current, row) || current?.sourceType !== data.contentType || row.revision !== claim.revision || row.recipe !== data.recipe ||
          row.state !== "preparing" || row.postIntentAt || !row.leaseUntil || Date.parse(row.leaseUntil) <= now.getTime()) throw new RealMediaError("stale");
        const [changed] = await tx.update(attempts).set({ sourceDigest: data.sourceDigest, derivativeDigest: data.derivativeDigest, contentType: data.contentType,
          encodedSize: data.size, width: data.width, height: data.height, state: "unknown", postIntentAt: now.toISOString(),
          revision: row.revision + 1, updatedAt: now.toISOString() }).where(and(eq(attempts.id, row.id), eq(attempts.revision, claim.revision))).returning({ id: attempts.id });
        if (!changed) throw new RealMediaError("stale");
        return { ...claim, revision: row.revision + 1 };
      });
    });
  }
  async notSent(input: RealMediaClaim): Promise<RealMediaSummary> {
    return this.protect(async () => {
      const claim = claimSchema.parse(input);
      const [row] = await this.db.update(attempts).set({ state: "not-sent", reason: "preparation", leaseUntil: null,
        revision: claim.revision + 1, updatedAt: this.clock().toISOString() }).where(and(eq(attempts.id, claim.id), eq(attempts.ownerId, claim.ownerId),
        eq(attempts.claimHash, realMediaDigest(claim.token)), eq(attempts.sessionHash, claim.sessionHash), eq(attempts.actionHash, claim.actionHash),
        eq(attempts.revision, claim.revision), eq(attempts.state, "preparing"), isNull(attempts.postIntentAt))).returning();
      if (!row) throw new RealMediaError("stale"); return { state: "not-sent", associated: false };
    });
  }
  async acknowledge(input: RealMediaClaim, proof: unknown): Promise<RealMediaSummary> {
    return this.protect(async () => {
      const claim = claimSchema.parse(input), now = this.clock();
      return this.db.transaction(async tx => {
        const current = await context(tx, claim.ownerId, claim.listingId, claim.imageId, now);
        const [row] = await tx.select().from(attempts).where(and(eq(attempts.id, claim.id), eq(attempts.ownerId, claim.ownerId))).for("update");
        if (!ownsClaim(row, claim) || !row.postIntentAt || claim.revision < 1 || claim.revision > row.revision) throw new RealMediaError("stale");
        const database = await tx.execute(sql`SELECT current_database() AS name`);
        const evidence = admittedMediaReceipt(proof, String(database.rows[0]?.name), claim.ownerId, claim.id);
        const previous = await tx.select().from(receipts).where(eq(receipts.attemptId, row.id));
        if (!previous.some(r => r.fingerprint === evidence.fingerprint)) {
          const [receipt] = await tx.insert(receipts).values({ id: randomUUID(), attemptId: row.id, ...evidence, createdAt: now.toISOString() }).returning();
          previous.push(receipt);
        }
        const conflict = contradictory(previous);
        const complete = previous.find(r => r.level === "complete" && r.expiresAt && Date.parse(r.expiresAt) > now.getTime() + 60000);
        const [existing] = await tx.select().from(associations).where(eq(associations.imageId, row.imageId)).for("update");
        const fresh = matches(current, row) && row.operation === "normal" && (!existing || existing.attemptId === row.id);
        const state: RealMediaState = conflict ? "unknown" : complete ? fresh ? "confirmed" : "residual" : row.state === "confirmed" || row.state === "residual" ? "residual" : "unknown";
        const reason = conflict ? "conflict" : complete ? fresh ? "response" : "changed" : previous.some(r => r.expiresAt && Date.parse(r.expiresAt) <= now.getTime() + 60000) ? "expired" : "response";
        await tx.update(attempts).set({ state, reason, leaseUntil: null, revision: row.revision + 1, updatedAt: now.toISOString() }).where(eq(attempts.id, row.id));
        if (state === "confirmed" && complete) {
          await tx.insert(associations).values({ imageId: row.imageId, ownerId: row.ownerId, listingId: row.listingId, connectionId: row.connectionId,
            attemptId: row.id, receiptId: complete.id, createdAt: now.toISOString() }).onConflictDoNothing();
        } else await tx.delete(associations).where(eq(associations.attemptId, row.id));
        return { state, associated: state === "confirmed" };
      });
    });
  }
  async status(owner: string, id: string): Promise<RealMediaSummary> {
    return this.protect(async () => {
      ownerIdSchema.parse(owner); mediaId.parse(id); const now = this.clock();
      return this.db.transaction(async tx => {
        const [initial] = await tx.select().from(attempts).where(and(eq(attempts.id, id), eq(attempts.ownerId, owner)));
        if (!initial) throw new RealMediaError("stale");
        const current = await context(tx, owner, initial.listingId, initial.imageId, now);
        const [row] = await tx.select().from(attempts).where(and(eq(attempts.id, id), eq(attempts.ownerId, owner))).for("update");
        const [association] = await tx.select({ expiresAt: receipts.expiresAt }).from(associations).innerJoin(receipts, eq(receipts.id, associations.receiptId)).where(eq(associations.attemptId, row.id));
        const associated = row.state === "confirmed" && !!matches(current, row) && !!association?.expiresAt && Date.parse(association.expiresAt) > now.getTime() + 60000;
        if (row.state === "confirmed" && !associated) {
          await tx.delete(associations).where(eq(associations.attemptId, row.id));
          await tx.update(attempts).set({ state: "residual", reason: "changed", revision: row.revision + 1, updatedAt: now.toISOString() }).where(eq(attempts.id, row.id));
          return { state: "residual", associated: false };
        }
        return { state: row.state as RealMediaState, associated };
      });
    });
  }
}
