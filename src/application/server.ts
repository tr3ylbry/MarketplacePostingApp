import "server-only";
import { createListingService } from "./listingService";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../infrastructure/repositories/drizzleImageRepository";
import { createImageService } from "./imageService";
import { imageStorage } from "@image-storage";

export function listingService() {
  return createListingService(new DrizzleListingRepository(getDatabase()), imageStorage);
}

export function imageService() { return createImageService(new DrizzleImageRepository(getDatabase()), imageStorage); }
