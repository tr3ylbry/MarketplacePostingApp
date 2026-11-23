import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../src/infrastructure/db/schema";
import { lockOwnedListing, queueCleanup } from "../src/infrastructure/repositories/drizzleImageRepository";
import { VerificationOperatorError, verificationFixtureTitle } from "./image-verification-context";
import type { VerificationPins } from "./image-verification-options";

export interface VerificationCleanup { status: "retained" | "queued"; notBefore: string; remoteErasureProven: false }

// Local, explicit cleanup only. No Blob client/global cleanup and no history
// deletion. Listing -> image -> session -> attempt is the existing lock order
// with the unused connection step omitted. No I/O crosses this transaction.
export async function queueVerificationFixtureCleanup(db: NodePgDatabase<typeof schema>,
  actor: { ownerId: string; id: string }, pins: VerificationPins, signal: AbortSignal): Promise<VerificationCleanup> {
  return db.transaction(async tx => {
    signal.throwIfAborted();
    const listing = await lockOwnedListing(tx,actor.ownerId,pins.listing);
    const [parent] = await tx.select({ title:schema.listings.title }).from(schema.listings).where(eq(schema.listings.id,pins.listing));
    const images = await tx.select({ id:schema.listingImages.id,pathname:schema.listingImages.pathname,
      retainUntil:schema.listingImages.providerRetainUntil,kind:schema.listingImages.storageProvider,
      sourceVersion:sql<string>`public.real_media_source_version(${schema.listingImages.id})` })
      .from(schema.listingImages).where(eq(schema.listingImages.listingId,pins.listing)).for("update");
    const pending = await tx.select({ id:schema.imageUploads.id }).from(schema.imageUploads).where(eq(schema.imageUploads.listingId,pins.listing));
    const [session] = await tx.select({ expiry:schema.sessions.expiresAt }).from(schema.sessions)
      .where(and(eq(schema.sessions.id,actor.id),eq(schema.sessions.userId,actor.ownerId))).for("share");
    const attempts = await tx.select({ id:schema.ebayRealMediaAttempts.id,sourceVersion:schema.ebayRealMediaAttempts.sourceVersion })
      .from(schema.ebayRealMediaAttempts).where(and(eq(schema.ebayRealMediaAttempts.ownerId,actor.ownerId),
        eq(schema.ebayRealMediaAttempts.environment,"sandbox"),eq(schema.ebayRealMediaAttempts.sellerKey,pins.seller),
        eq(schema.ebayRealMediaAttempts.connectionVersion,pins.connectionVersion),eq(schema.ebayRealMediaAttempts.listingId,pins.listing),
        eq(schema.ebayRealMediaAttempts.listingVersion,pins.listingVersion),eq(schema.ebayRealMediaAttempts.imageId,pins.image),
        eq(schema.ebayRealMediaAttempts.sourceDigest,pins.sourceDigest),eq(schema.ebayRealMediaAttempts.derivativeDigest,pins.derivativeDigest),
        isNotNull(schema.ebayRealMediaAttempts.postIntentAt))).limit(2).for("share");
    const remote = await tx.select({ id:schema.marketplaceListings.id }).from(schema.marketplaceListings)
      .where(and(eq(schema.marketplaceListings.listingId,pins.listing),or(isNotNull(schema.marketplaceListings.externalListingId),
        isNotNull(schema.marketplaceListings.externalUrl),isNotNull(schema.marketplaceListings.publishedAt)))).limit(1);
    const image = images[0];
    if (signal.aborted || !session || new Date(listing.updatedAt).toISOString() !== pins.listingVersion ||
      parent?.title !== verificationFixtureTitle(pins.sourceDigest) || images.length !== 1 || pending.length || remote.length ||
      image?.id !== pins.image || image.kind !== "vercel-blob" || !image.pathname || !image.retainUntil ||
      attempts.length !== 1 || attempts[0].sourceVersion !== image.sourceVersion) throw new VerificationOperatorError("context");
    // Compare in PostgreSQL after blocking reads; no rounded historical JS
    // timestamp can extend a session or shorten the persisted retention.
    const time = await tx.execute(sql`SELECT clock_timestamp()<${session.expiry.toISOString()}::timestamptz AS live,
      clock_timestamp()<${image.retainUntil}::timestamptz AS retained`);
    if (time.rows[0]?.live !== true) throw new VerificationOperatorError("context");
    if (time.rows[0]?.retained === true) return { status:"retained",notBefore:new Date(image.retainUntil).toISOString(),remoteErasureProven:false };
    await queueCleanup(tx,[{pathname:image.pathname,providerRetainUntil:image.retainUntil}]);
    signal.throwIfAborted();
    await tx.delete(schema.listings).where(and(eq(schema.listings.id,pins.listing),eq(schema.listings.ownerId,actor.ownerId)));
    const [queued] = await tx.select({ at:schema.imageCleanup.notBefore }).from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname,image.pathname));
    const final = await tx.execute(sql`SELECT clock_timestamp()<${session.expiry.toISOString()}::timestamptz AS live`);
    if (!queued || signal.aborted || final.rows[0]?.live !== true) throw new VerificationOperatorError("unavailable");
    return { status:"queued",notBefore:new Date(queued.at).toISOString(),remoteErasureProven:false };
  });
}
