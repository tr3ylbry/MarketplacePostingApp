import { randomUUID } from "node:crypto";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ownerIdSchema } from "../../application/owner";
import { validEbayScopes } from "../../application/ebayConnection";
import { CLEANUP_GRACE_MS } from "../../application/imageStorage";
import { PRIVATE_IMAGE_REVIEW_MS } from "../../application/ebayPrivateImages";
import { MEDIA_FIXTURE_RECIPE, MEDIA_LEASE_MS, MediaAttemptError, sourceMetadataDigest, type MediaAttemptRepository,
  type MediaAttemptState, type MediaAttemptSummary, type MediaClaim, type MediaOutcome } from "../../application/ebayMediaAttempt";
import { blobImageSourceSchema } from "../../domain/listingImage";
import { imageFromRow } from "./imageMapping";
import * as schema from "../db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = typeof schema.ebayMediaAttempts.$inferSelect;
const attempts = schema.ebayMediaAttempts;
const inputId = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const summary = (row: Row): MediaAttemptSummary => ({ state: row.state as MediaAttemptState, simulation: true });

// Same lock order for claim, pre-send check and settle: parent, connection,
// attempt. Missing/deleted parents produce residuals, never cascade the journal.
async function context(tx: Transaction, owner: string, listingId: string, imageId: string, now: Date) {
  const [listing] = await tx.select().from(schema.listings).where(and(eq(schema.listings.ownerId, owner), eq(schema.listings.id, listingId))).for("update");
  const [connection] = await tx.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner)).for("update");
  const [image] = listing ? await tx.select().from(schema.listingImages).where(and(eq(schema.listingImages.listingId, listingId), eq(schema.listingImages.id, imageId))) : [];
  if (!listing || !connection || !image || connection.environment !== "sandbox" || connection.status !== "connected" || !connection.sellerId ||
    !/^[a-f0-9]{64}$/.test(connection.sellerId) || !connection.access || !connection.refresh || !connection.connectedAt || !connection.refreshExpiresAt ||
    Date.parse(connection.refreshExpiresAt) <= now.getTime() || !validEbayScopes(connection.scopes)) return null;
  const source = blobImageSourceSchema.safeParse(imageFromRow(image).source);
  if (!source.success || !["image/jpeg", "image/png"].includes(source.data.contentType)) return null;
  return { listingVersion: new Date(listing.updatedAt).toISOString(), connectionId: connection.id, connectionVersion: connection.version,
    configHash: connection.configHash, sellerId: connection.sellerId, source: source.data, sourceMetadataHash: sourceMetadataDigest(source.data) };
}
function matches(value: NonNullable<Awaited<ReturnType<typeof context>>>, claim: Pick<MediaClaim, "listingVersion" | "connectionId" | "connectionVersion" | "configHash" | "sellerId" | "sourceMetadataHash">) {
  return value.listingVersion === new Date(claim.listingVersion).toISOString() && value.connectionId === claim.connectionId && value.connectionVersion === claim.connectionVersion &&
    value.configHash === claim.configHash && value.sellerId === claim.sellerId && value.sourceMetadataHash === claim.sourceMetadataHash;
}
export class DrizzleEbayMediaRepository implements MediaAttemptRepository {
  constructor(private readonly db: Database) {}
  async claim(owner: string, listingId: string, version: string, imageId: string, configHash: string, now: Date) {
    ownerIdSchema.parse(owner); inputId.parse(listingId); inputId.parse(imageId); z.iso.datetime().parse(version);
    return this.db.transaction(async tx => {
      const current = await context(tx, owner, listingId, imageId, now);
      if (!current || current.listingVersion !== version || current.configHash !== configHash) throw new MediaAttemptError("stale");
      const values = { id: randomUUID(), ownerId: owner, environment: "sandbox", simulation: true, listingId, imageId,
        listingVersion: version, connectionId: current.connectionId, connectionVersion: current.connectionVersion, configHash,
        sellerId: current.sellerId, sourceMetadataHash: current.sourceMetadataHash, transformationVersion: MEDIA_FIXTURE_RECIPE,
        state: "preparing", leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + MEDIA_LEASE_MS).toISOString(),
        createdAt: now.toISOString(), updatedAt: now.toISOString() };
      const inserted = await tx.insert(attempts).values(values).onConflictDoNothing().returning();
      let row = inserted[0] ?? (await tx.select().from(attempts).where(and(eq(attempts.ownerId, owner), eq(attempts.environment, "sandbox"),
        eq(attempts.sellerId, current.sellerId), eq(attempts.imageId, imageId))).for("update"))[0];
      if (!row) throw new MediaAttemptError("busy");
      if (row.postAttemptedAt) {
        if (row.state === "confirmed" && (!matches(current, row) || !row.expiresAt || Date.parse(row.expiresAt) <= now.getTime())) {
          [row] = await tx.update(attempts).set({ state: "residual", reason: "changed", updatedAt: now.toISOString() }).where(eq(attempts.id, row.id)).returning();
        }
        return { kind: "recorded" as const, summary: summary(row) };
      }
      if (!inserted.length) {
        if (row.leaseUntil && Date.parse(row.leaseUntil) > now.getTime()) throw new MediaAttemptError("busy");
        [row] = await tx.update(attempts).set({ ...values, id: row.id, createdAt: row.createdAt }).where(eq(attempts.id, row.id)).returning();
      }
      await tx.update(schema.listingImages).set({ providerRetainUntil: sql`greatest(${schema.listingImages.providerRetainUntil}, ${new Date(now.getTime() + PRIVATE_IMAGE_REVIEW_MS + CLEANUP_GRACE_MS).toISOString()}::timestamptz)` })
        .where(eq(schema.listingImages.id, imageId));
      return { kind: "claimed" as const, claim: { id: row.id, leaseToken: row.leaseToken, ownerId: owner, listingId, imageId, ...current } };
    });
  }
  async markSending(claim: MediaClaim, content: { sourceDigest: string; exportDigest: string; size: number }, now: Date) {
    digest.parse(content.sourceDigest); digest.parse(content.exportDigest); z.number().int().min(1).max(1048576).parse(content.size);
    await this.db.transaction(async tx => {
      const current = await context(tx, claim.ownerId, claim.listingId, claim.imageId, now);
      const [row] = await tx.select().from(attempts).where(and(eq(attempts.id, claim.id), eq(attempts.ownerId, claim.ownerId))).for("update");
      if (!current || !matches(current, claim) || !row || row.leaseToken !== claim.leaseToken || row.state !== "preparing" || row.postAttemptedAt ||
        !row.leaseUntil || Date.parse(row.leaseUntil) <= now.getTime()) throw new MediaAttemptError("stale");
      // context holds this owner's single connection row lock. This serializes
      // content checks even across different listings/images: re-uploading the
      // same bytes under a new image ID cannot bypass a prior send fence.
      const [previous] = await tx.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.ownerId, claim.ownerId),
        eq(attempts.sellerId, claim.sellerId), eq(attempts.environment, "sandbox"), eq(attempts.sourceDigest, content.sourceDigest),
        eq(attempts.exportDigest, content.exportDigest), eq(attempts.transformationVersion, MEDIA_FIXTURE_RECIPE), isNotNull(attempts.postAttemptedAt))).limit(1);
      if (previous) throw new MediaAttemptError("unknown");
      await tx.update(attempts).set({ state: "unknown", sourceDigest: content.sourceDigest, exportDigest: content.exportDigest, exportSize: content.size,
        postAttemptedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(attempts.id, row.id));
    });
  }
  async notSent(claim: MediaClaim) {
    await this.db.update(attempts).set({ state: "not-sent", leaseUntil: null, reason: "preparation" }).where(and(eq(attempts.id, claim.id),
      eq(attempts.ownerId, claim.ownerId), eq(attempts.leaseToken, claim.leaseToken), isNull(attempts.postAttemptedAt)));
  }
  async settle(claim: MediaClaim, outcome: MediaOutcome, now: Date) {
    return this.db.transaction(async tx => {
      const current = await context(tx, claim.ownerId, claim.listingId, claim.imageId, now);
      const [row] = await tx.select().from(attempts).where(and(eq(attempts.id, claim.id), eq(attempts.ownerId, claim.ownerId))).for("update");
      if (!row || row.leaseToken !== claim.leaseToken || !row.postAttemptedAt) throw new MediaAttemptError("unknown");
      if (row.state !== "unknown") return summary(row); // Idempotent local acknowledgement; never erase a recorded response.
      const complete = outcome.complete && !!outcome.imageId && !!outcome.imageUrl && !!outcome.expiresAt && Date.parse(outcome.expiresAt) > now.getTime();
      const state = complete ? current && matches(current, claim) ? "confirmed" : "residual" : "unknown";
      const [changed] = await tx.update(attempts).set({ state, returnedImageId: outcome.imageId, imageUrl: outcome.imageUrl,
        expiresAt: outcome.expiresAt, responseStatus: outcome.responseStatus, reason: state === "residual" ? "changed" : outcome.reason,
        leaseUntil: null, updatedAt: now.toISOString() }).where(eq(attempts.id, row.id)).returning();
      return summary(changed);
    });
  }
}
