import "server-only";
import { createListingService } from "./listingService";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";

export function listingService() {
  return createListingService(new DrizzleListingRepository(getDatabase()));
}
