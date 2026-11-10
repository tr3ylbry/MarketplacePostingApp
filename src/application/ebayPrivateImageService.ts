import { z } from "zod";
import type { ListingRepository } from "./listingRepository";
import type { ImageRepository } from "./imageRepository";
import type { EbayConnectionRepository } from "./ebayConnection";
import { validEbayScopes } from "./ebayConnection";
import { blobImageSourceSchema, MAX_IMAGE_BYTES } from "../domain/listingImage";
import { CLEANUP_GRACE_MS } from "./imageStorage";
import { ownerIdSchema } from "./owner";
import { PRIVATE_IMAGE_READ_MS, PRIVATE_IMAGE_REVIEW_MS, PrivateImagePreparationError, type ExportImageValidator, type PrivateImageReader } from "./ebayPrivateImages";

// Bound concurrent decoder/input allocations per process, with no waiting queue.
let activeValidations = 0;
const id = z.string().min(1).max(200);
export function createEbayPrivateImageService(listings: Pick<ListingRepository, "getById">,
  images: Pick<ImageRepository, "get" | "retainForProvider">, connections: Pick<EbayConnectionRepository, "connection">,
  reader: PrivateImageReader, validator: ExportImageValidator, configHash: string, clock = () => new Date()) {
  return {
    async prepare(owner: string, listingId: string, version: string, imageId: string) {
      ownerIdSchema.parse(owner); id.parse(listingId); id.parse(imageId); z.iso.datetime().parse(version);
      if (activeValidations >= 2) throw new PrivateImagePreparationError("busy");
      activeValidations++;
      try {
        const listing = await listings.getById(owner, listingId);
        if (!listing || listing.updatedAt !== version) throw new PrivateImagePreparationError("stale");
        const connection = await connections.connection(owner), start = clock();
        if (!connection || connection.ownerId !== owner || connection.environment !== "sandbox" || connection.status !== "connected" ||
          connection.configHash !== configHash || !connection.sellerId || !connection.access || !connection.refresh || !connection.connectedAt || !connection.refreshExpiresAt || connection.refreshExpiresAt <= start.toISOString() || !validEbayScopes(connection.scopes)) throw new PrivateImagePreparationError("unavailable");
        const image = await images.get(owner, listingId, imageId);
        if (!image || image.id !== imageId || image.listingId !== listingId) throw new PrivateImagePreparationError("stale");
        if (image.source.kind !== "vercel-blob" || !["image/jpeg", "image/png"].includes(image.source.contentType)) throw new PrivateImagePreparationError("unsupported");
        const source = blobImageSourceSchema.parse(image.source), expiresAt = new Date(start.getTime() + PRIVATE_IMAGE_REVIEW_MS).toISOString();
        // Same short parent lock as deletion. Commit retention before Blob I/O.
        const pathname = await images.retainForProvider(owner, listingId, imageId, new Date(Date.parse(expiresAt) + CLEANUP_GRACE_MS).toISOString());
        if (pathname !== source.pathname || clock().toISOString() >= expiresAt) throw new PrivateImagePreparationError("stale");
        const signal = AbortSignal.timeout(PRIVATE_IMAGE_READ_MS);
        const bytes = await reader.readPrivateImage(source, signal);
        signal.throwIfAborted();
        if (bytes.length !== source.size || bytes.length > MAX_IMAGE_BYTES) throw new PrivateImagePreparationError("invalid");
        const verified = await validator.validate(bytes, source.contentType, signal);
        signal.throwIfAborted();
        const [current, currentImage, currentConnection] = await Promise.all([
          listings.getById(owner, listingId), images.get(owner, listingId, imageId), connections.connection(owner),
        ]);
        const currentSource = blobImageSourceSchema.safeParse(currentImage?.source);
        if (!current || current.updatedAt !== version || !currentImage || currentImage.id !== imageId || currentImage.listingId !== listingId || !currentSource.success || JSON.stringify(currentSource.data) !== JSON.stringify(source) ||
          !currentConnection || currentConnection.ownerId !== owner || currentConnection.environment !== "sandbox" || currentConnection.status !== "connected" ||
          currentConnection.id !== connection.id || currentConnection.version !== connection.version || currentConnection.sellerId !== connection.sellerId || currentConnection.configHash !== configHash || JSON.stringify(currentConnection.scopes) !== JSON.stringify(connection.scopes) ||
          clock().toISOString() >= expiresAt) throw new PrivateImagePreparationError("stale");
        // An explicit DTO, not an upload permission or provider association.
        return { imageId, order: currentImage.order, width: verified.width, height: verified.height,
          contentType: verified.contentType, size: verified.size, checkedAt: clock().toISOString(), expiresAt,
          exportStatus: "not-attempted" as const, exportEnabled: false as const };
      } catch (error) {
        if (error instanceof PrivateImagePreparationError) throw error;
        throw new PrivateImagePreparationError("invalid");
      } finally { activeValidations--; }
    },
  };
}
export type PrivateImageReview = Awaited<ReturnType<ReturnType<typeof createEbayPrivateImageService>["prepare"]>>;
