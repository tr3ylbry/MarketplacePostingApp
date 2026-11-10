import "server-only";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../infrastructure/repositories/drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "../infrastructure/repositories/drizzleEbayConnectionRepository";
import { imageStorage } from "@image-storage";
import { ebayRuntime } from "@ebay-runtime";
import { exportImageValidator } from "../infrastructure/storage/validateExportImage";
import { createEbayPrivateImageService } from "./ebayPrivateImageService";

export function ebayPrivateImages() {
  const db = getDatabase(), { config } = ebayRuntime();
  return createEbayPrivateImageService(new DrizzleListingRepository(db), new DrizzleImageRepository(db),
    new DrizzleEbayConnectionRepository(db), imageStorage, exportImageValidator, config.fingerprint);
}
