import { z } from "zod";
import type { ListingRepository } from "./listingRepository";
import type { ImageRepository } from "./imageRepository";
import type { EbayConnectionRepository } from "./ebayConnection";
import { validPhotoPreparationScopes } from "./ebayMediaGrant";
import { acquirePhotoCapacity, borrowPhotoCapacity, releasePhotoCapacity, type PhotoCapacity } from "./photoCapacity";
import { blobImageSourceSchema, MAX_IMAGE_BYTES } from "../domain/listingImage";
import { ownerIdSchema } from "./owner";
import { CLEANUP_GRACE_MS } from "./imageStorage";
import { PRIVATE_IMAGE_REVIEW_MS, type PrivateImageReader } from "./ebayPrivateImages";
import { PHOTO_DERIVATIVE_MS, PhotoDerivativeError, type PhotoTransformer } from "./photoDerivative";

const id = z.string().min(1).max(200);
export function createPhotoDerivativeService(listings: Pick<ListingRepository, "getById">,
  images: Pick<ImageRepository, "get" | "retainForProvider">, connections: Pick<EbayConnectionRepository, "connection">,
  reader: PrivateImageReader, transformer: PhotoTransformer, configHash: string, clock = () => new Date()) {
  return {
    async derive(owner: string, listingId: string, version: string, imageId: string, callerSignal?: AbortSignal, capacity?: PhotoCapacity) {
      const lease = capacity ?? acquirePhotoCapacity();
      let settled: (() => void) | undefined;
      // A deadline governs eligibility, not native termination. No timeout race
      // releases this slot: all started reads/native work must settle first.
      const deadline = performance.now() + PHOTO_DERIVATIVE_MS;
      let signal: AbortSignal | undefined;
      const check = () => { if (signal?.aborted || performance.now() >= deadline) throw new PhotoDerivativeError("aborted"); };
      try {
        settled = borrowPhotoCapacity(lease);
        signal = AbortSignal.any([AbortSignal.timeout(PHOTO_DERIVATIVE_MS), ...(callerSignal ? [callerSignal] : [])]);
        check(); ownerIdSchema.parse(owner); id.parse(listingId); id.parse(imageId); z.iso.datetime().parse(version);
        const listing = await listings.getById(owner, listingId); check();
        if (!listing || listing.updatedAt !== version) throw new PhotoDerivativeError("stale");
        const connection = await connections.connection(owner), start = clock(); check();
        if (!connection || connection.ownerId !== owner || connection.environment !== "sandbox" || connection.status !== "connected" ||
          connection.configHash !== configHash || !connection.sellerId || !connection.access || !connection.refresh || !connection.connectedAt ||
          !connection.refreshExpiresAt || connection.refreshExpiresAt <= start.toISOString() || !validPhotoPreparationScopes(connection.scopes)) throw new PhotoDerivativeError("unavailable");
        const image = await images.get(owner, listingId, imageId); check();
        if (!image || image.id !== imageId || image.listingId !== listingId) throw new PhotoDerivativeError("stale");
        const source = blobImageSourceSchema.safeParse(image.source);
        if (!source.success || !["image/jpeg", "image/png"].includes(source.data.contentType)) throw new PhotoDerivativeError("invalid");
        const retainedUntil = new Date(start.getTime() + PRIVATE_IMAGE_REVIEW_MS + CLEANUP_GRACE_MS).toISOString();
        // Existing repository commits the owner/parent lock and max-retention
        // extension before any byte access. No transaction spans native or I/O.
        if (await images.retainForProvider(owner, listingId, imageId, retainedUntil) !== source.data.pathname) throw new PhotoDerivativeError("stale");
        check();
        const bytes = await reader.readPrivateImage(source.data, signal); check();
        if (bytes.length !== source.data.size || bytes.length > MAX_IMAGE_BYTES) throw new PhotoDerivativeError("invalid");
        const derivative = await transformer.transform(bytes, source.data.contentType, signal, deadline); check();
        const [listingCheck, imageCheck, connectionCheck] = await Promise.allSettled([
          listings.getById(owner, listingId), images.get(owner, listingId, imageId), connections.connection(owner),
        ] as const); check();
        if (listingCheck.status === "rejected" || imageCheck.status === "rejected" || connectionCheck.status === "rejected") throw new PhotoDerivativeError("invalid");
        const current = listingCheck.value, currentImage = imageCheck.value, currentConnection = connectionCheck.value;
        const currentSource = blobImageSourceSchema.safeParse(currentImage?.source);
        if (!current || current.updatedAt !== version || !currentImage || currentImage.id !== imageId || currentImage.listingId !== listingId ||
          !currentSource.success || JSON.stringify(currentSource.data) !== JSON.stringify(source.data) ||
          !currentConnection || currentConnection.ownerId !== owner || currentConnection.environment !== "sandbox" || currentConnection.status !== "connected" ||
          currentConnection.id !== connection.id || currentConnection.version !== connection.version || currentConnection.sellerId !== connection.sellerId ||
          currentConnection.configHash !== configHash || JSON.stringify(currentConnection.scopes) !== JSON.stringify(connection.scopes) ||
          !currentConnection.refreshExpiresAt || currentConnection.refreshExpiresAt <= clock().toISOString()) throw new PhotoDerivativeError("stale");
        return derivative;
      } catch (error) {
        if (error instanceof PhotoDerivativeError) throw error;
        throw new PhotoDerivativeError(signal?.aborted ? "aborted" : "invalid");
      } finally { settled?.(); if (!capacity) releasePhotoCapacity(lease); }
    },
  };
}
