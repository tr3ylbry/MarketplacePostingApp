import { z } from "zod";
import type { ImageRepository } from "./imageRepository";
import { CLEANUP_GRACE_MS, PROVIDER_READ_TTL_MS, type ProviderImageAccess, type ProviderImageSigner } from "./imageStorage";
import { ownerIdSchema } from "./owner";

const id = z.string().min(1).max(200);
export function createProviderImageAccess(repository: Pick<ImageRepository, "retainForProvider">, signer: ProviderImageSigner): ProviderImageAccess {
  return {
    async createProviderReadAccess(owner, listingId, imageId) {
      ownerIdSchema.parse(owner); id.parse(listingId); id.parse(imageId);
      const validUntil = Date.now() + PROVIDER_READ_TTL_MS;
      // Commit ownership-checked retention before remote signing. An absolute
      // expiry prevents DB/signing latency from extending the capability past it.
      const pathname = await repository.retainForProvider(owner, listingId, imageId,
        new Date(validUntil + CLEANUP_GRACE_MS).toISOString());
      return signer.signProviderReadAccess(pathname, validUntil);
    },
  };
}
