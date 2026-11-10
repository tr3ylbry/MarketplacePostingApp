import "server-only";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";
import { DrizzleEbayConnectionRepository } from "../infrastructure/repositories/drizzleEbayConnectionRepository";
import { ebayReadinessGateway } from "@ebay-readiness";
import { ebayService } from "./ebayServer";
import { createEbayReadinessService } from "./ebayReadinessService";

export function ebaySellerReadiness() {
  const db = getDatabase();
  return createEbayReadinessService(new DrizzleListingRepository(db), new DrizzleEbayConnectionRepository(db), ebayService(), ebayReadinessGateway());
}
