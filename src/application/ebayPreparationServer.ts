import "server-only";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";
import { DrizzleEbayConnectionRepository } from "../infrastructure/repositories/drizzleEbayConnectionRepository";
import { ebayRuntime } from "@ebay-runtime";
import { ebayMetadataGateway } from "@ebay-metadata";
import { createEbayPreparationService } from "./ebayPreparationService";

export function ebayPreparationService() {
  const db = getDatabase(), { config } = ebayRuntime();
  return createEbayPreparationService(new DrizzleListingRepository(db), new DrizzleEbayConnectionRepository(db), ebayMetadataGateway(config), config.fingerprint);
}
