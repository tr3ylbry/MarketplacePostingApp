import { z } from "zod";
import { MAX_IMAGE_COUNT } from "../domain/listingImage";
import type { ImageRepository } from "./imageRepository";
import { ImageOperationError, uploadInputSchema, type ImageStorage } from "./imageStorage";
import { ownerIdSchema } from "./owner";

const id = z.string().min(1).max(200);
export async function cleanupObjects(storage: ImageStorage, paths: string[]) {
  for (const path of paths) {
    try { await storage.deleteObject(path); }
    catch { console.warn("Image cleanup deferred; retry ledger retained."); }
  }
}
export function createImageService(repository: ImageRepository, storage: ImageStorage) {
  function validate(owner: string, listingId: string, imageId?: string) {
    ownerIdSchema.parse(owner); id.parse(listingId); if (imageId !== undefined) id.parse(imageId);
  }
  return {
    async prepare(owner: string, listingId: string, input: unknown) {
      validate(owner, listingId);
      const upload = await repository.reserve(owner, listingId, uploadInputSchema.parse(input));
      try { return { imageId: upload.id, url: await storage.prepareUpload(upload) }; }
      catch (error) {
        await cleanupObjects(storage, await repository.cancel(owner, listingId, upload.id));
        throw error;
      }
    },
    async finalize(owner: string, listingId: string, imageId: string) {
      validate(owner, listingId, imageId);
      try { await repository.finalize(owner, listingId, imageId, upload => storage.verifyUpload(upload)); }
      catch (error) {
        // cancel checks committed state under the parent lock. Never compensate a
        // successfully committed image after an ambiguous database response.
        try { await cleanupObjects(storage, await repository.cancel(owner, listingId, imageId)); }
        catch { console.warn("Image finalization cleanup deferred; retry ledger retained."); }
        throw error;
      }
    },
    async read(owner: string, listingId: string, imageId: string) {
      validate(owner, listingId, imageId);
      const image = await repository.get(owner, listingId, imageId);
      if (!image || image.source.kind !== "vercel-blob") throw new ImageOperationError("Image not found.");
      return storage.createReadAccess(image.source.pathname);
    },
    async remove(owner: string, listingId: string, imageId: string) {
      validate(owner, listingId, imageId);
      await cleanupObjects(storage, await repository.remove(owner, listingId, imageId));
    },
    async reorder(owner: string, listingId: string, input: unknown) {
      validate(owner, listingId);
      const ids = z.array(id).max(MAX_IMAGE_COUNT).parse(input);
      if (new Set(ids).size !== ids.length) throw new ImageOperationError("Provide each image exactly once.");
      await repository.reorder(owner, listingId, ids);
    },
  };
}
