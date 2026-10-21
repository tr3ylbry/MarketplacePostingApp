import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ImageRepository } from "../../application/imageRepository";
import { CLEANUP_GRACE_MS, ImageOperationError, imagePathname, UPLOAD_TTL_MS, uploadInputSchema, type ImageUpload, type UploadInput } from "../../application/imageStorage";
import { ListingUnavailableError } from "../../application/listingRepository";
import { ownerIdSchema } from "../../application/owner";
import { blobImageSourceSchema, MAX_IMAGE_COUNT, type BlobImageSource } from "../../domain/listingImage";
import * as schema from "../db/schema";
import { imageFromRow, imageToRow } from "./imageMapping";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const { listings, listingImages, imageUploads, imageCleanup } = schema;

export async function lockOwnedListing(tx: Transaction, owner: string, listingId: string) {
  ownerIdSchema.parse(owner);
  const [listing] = await tx.select({ id: listings.id }).from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.ownerId, owner))).for("update");
  if (!listing) throw new ListingUnavailableError();
}
async function touch(tx: Transaction, listingId: string) {
  await tx.update(listings).set({ updatedAt: sql`greatest(clock_timestamp(), ${listings.updatedAt} + interval '1 millisecond')` }).where(eq(listings.id, listingId));
}
export async function queueCleanup(tx: Transaction, paths: string[]) {
  if (paths.length) await tx.insert(imageCleanup).values(paths.map(pathname => ({ pathname,
    notBefore: new Date(Date.now() + UPLOAD_TTL_MS + CLEANUP_GRACE_MS).toISOString() })))
    .onConflictDoUpdate({ target: imageCleanup.pathname, set: { notBefore: sql`greatest(${imageCleanup.notBefore}, excluded.not_before)` } });
}

export class DrizzleImageRepository implements ImageRepository {
  constructor(private readonly db: Database) {}

  async reserve(owner: string, listingId: string, input: UploadInput): Promise<ImageUpload> {
    const values = uploadInputSchema.parse(input);
    return this.db.transaction(async tx => {
      await lockOwnedListing(tx, owner, listingId);
      const images = await tx.select({ id: listingImages.id }).from(listingImages).where(eq(listingImages.listingId, listingId));
      const pending = await tx.select({ id: imageUploads.id }).from(imageUploads)
        .where(and(eq(imageUploads.listingId, listingId), gt(imageUploads.expiresAt, new Date().toISOString())));
      if (images.length + pending.length >= MAX_IMAGE_COUNT) throw new ImageOperationError(`A listing can have at most ${MAX_IMAGE_COUNT} images, including pending uploads.`);
      const id = crypto.randomUUID();
      const upload = { ...values, id, listingId, pathname: imagePathname(id, values), expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString() };
      await tx.insert(imageUploads).values(upload);
      await queueCleanup(tx, [upload.pathname]);
      return upload;
    });
  }

  async get(owner: string, listingId: string, imageId: string) {
    ownerIdSchema.parse(owner);
    const [row] = await this.db.select({ image: listingImages }).from(listingImages)
      .innerJoin(listings, eq(listings.id, listingImages.listingId))
      .where(and(eq(listings.ownerId, owner), eq(listings.id, listingId), eq(listingImages.id, imageId)));
    return row ? imageFromRow(row.image) : null;
  }

  async resolveUpload(owner: string, listingId: string, imageId: string): Promise<ImageUpload | null> {
    return this.db.transaction(async tx => {
      await lockOwnedListing(tx, owner, listingId);
      const [saved] = await tx.select({ id: listingImages.id }).from(listingImages)
        .where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId)));
      if (saved) return null;
      const [pending] = await tx.select().from(imageUploads).where(and(eq(imageUploads.id, imageId), eq(imageUploads.listingId, listingId)));
      if (!pending || Date.parse(pending.expiresAt) <= Date.now()) throw new ImageOperationError("Upload expired or was not found. Select the file again.");
      return { ...pending, ...uploadInputSchema.parse({ filename: pending.filename, contentType: pending.contentType, size: pending.size }), expiresAt: new Date(pending.expiresAt).toISOString() };
    });
  }

  async finalize(owner: string, listingId: string, imageId: string, verifiedSource: BlobImageSource) {
    await this.db.transaction(async tx => {
      await lockOwnedListing(tx, owner, listingId);
      const images = await tx.select().from(listingImages).where(eq(listingImages.listingId, listingId));
      if (images.some(image => image.id === imageId)) return;
      const [pending] = await tx.select().from(imageUploads).where(and(eq(imageUploads.id, imageId), eq(imageUploads.listingId, listingId)));
      if (!pending || Date.parse(pending.expiresAt) <= Date.now()) throw new ImageOperationError("Upload expired or was not found. Select the file again.");
      const [cleanup] = await tx.select().from(imageCleanup).where(eq(imageCleanup.pathname, pending.pathname)).for("update");
      if (!cleanup || Date.parse(pending.expiresAt) <= Date.now()) throw new ImageOperationError("Upload expired. Select the file again.");
      const source = blobImageSourceSchema.parse(verifiedSource);
      if (source.pathname !== pending.pathname || source.size !== pending.size || source.contentType !== pending.contentType || source.originalFilename !== pending.filename) {
        throw new ImageOperationError("Uploaded image metadata does not match the reservation.");
      }
      const order = Math.max(-1, ...images.map(image => image.order)) + 1;
      await tx.insert(listingImages).values(imageToRow({ id: imageId, listingId, source, order }));
      await tx.delete(imageUploads).where(eq(imageUploads.id, imageId));
      await tx.delete(imageCleanup).where(eq(imageCleanup.pathname, pending.pathname));
      await touch(tx, listingId);
    });
  }

  async cancel(owner: string, listingId: string, imageId: string) {
    return this.db.transaction(async tx => {
      await lockOwnedListing(tx, owner, listingId);
      const [saved] = await tx.select().from(listingImages).where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId)));
      if (saved) return []; // A retry/ambiguous commit must never delete a saved image.
      const [pending] = await tx.delete(imageUploads).where(and(eq(imageUploads.id, imageId), eq(imageUploads.listingId, listingId))).returning();
      return pending ? [pending.pathname] : [];
    });
  }

  async remove(owner: string, listingId: string, imageId: string) {
    return this.db.transaction(async tx => {
      await lockOwnedListing(tx, owner, listingId);
      const rows = await tx.select().from(listingImages).where(eq(listingImages.listingId, listingId)).orderBy(asc(listingImages.order));
      const removed = rows.find(row => row.id === imageId);
      if (!removed) return [];
      const paths = removed.pathname ? [removed.pathname] : [];
      await queueCleanup(tx, paths);
      await tx.delete(listingImages).where(eq(listingImages.listingId, listingId));
      const kept = rows.filter(row => row.id !== imageId).map((row, order) => ({ ...row, order }));
      if (kept.length) await tx.insert(listingImages).values(kept);
      await touch(tx, listingId);
      return paths;
    });
  }

  async reorder(owner: string, listingId: string, ids: string[]) {
    await this.db.transaction(async tx => {
      await lockOwnedListing(tx, owner, listingId);
      const rows = await tx.select().from(listingImages).where(eq(listingImages.listingId, listingId));
      const indexed = new Map(rows.map(row => [row.id, row]));
      if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some(id => !indexed.has(id))) {
        throw new ImageOperationError("Images changed. Reload before reordering.");
      }
      // Delete/reinsert metadata in one transaction avoids transient unique-order collisions.
      await tx.delete(listingImages).where(eq(listingImages.listingId, listingId));
      if (ids.length) await tx.insert(listingImages).values(ids.map((id, order) => ({ ...indexed.get(id)!, order })));
      await touch(tx, listingId);
    });
  }
}
