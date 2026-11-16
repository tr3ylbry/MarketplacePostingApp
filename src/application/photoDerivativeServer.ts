import "server-only";
import { requireUser } from "../auth/session";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../infrastructure/repositories/drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "../infrastructure/repositories/drizzleEbayConnectionRepository";
import { imageStorage } from "@image-storage";
import { ebayRuntime } from "@ebay-runtime";
import { photoTransformer } from "../infrastructure/storage/photoDerivative/transformPhoto";
import { createPhotoDerivativeService } from "./photoDerivativeService";

// Internal server function only: no route, server action, download or provider
// consumer is introduced. The caller cannot supply owner identity or a pathname.
export async function deriveOwnedPhoto(listingId: string, version: string, imageId: string, signal?: AbortSignal) {
  const user = await requireUser(), db = getDatabase(), { config } = ebayRuntime();
  return createPhotoDerivativeService(new DrizzleListingRepository(db), new DrizzleImageRepository(db),
    new DrizzleEbayConnectionRepository(db), imageStorage, photoTransformer, config.fingerprint)
    .derive(user.id, listingId, version, imageId, signal);
}
