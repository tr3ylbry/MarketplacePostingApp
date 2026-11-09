import { z } from "zod";
import type { ListingRepository } from "./listingRepository";
import { ownerIdSchema } from "./owner";
import type { EbayConnectionRepository } from "./ebayConnection";
import type { createEbayConnectionService } from "./ebayConnectionService";
import { EbayReadinessError, type EbayReadinessGateway } from "./ebayReadiness";

type ConnectionAccess = Pick<ReturnType<typeof createEbayConnectionService>, "accessContext">;
export function createEbayReadinessService(listings: ListingRepository, connections: EbayConnectionRepository,
  authorization: ConnectionAccess, gateway: EbayReadinessGateway, clock = () => new Date()) {
  return {
    async check(owner: string, listingId: string, expectedVersion: string) {
      ownerIdSchema.parse(owner);
      if (!z.string().min(1).max(200).safeParse(listingId).success || !z.iso.datetime().safeParse(expectedVersion).success) throw new EbayReadinessError("stale");
      const listing = await listings.getById(owner, listingId);
      if (!listing || listing.updatedAt !== expectedVersion) throw new EbayReadinessError("stale");
      // The access context is from the cached row or the successful refresh CAS,
      // not a later read which could accidentally bind an old token to a new seller.
      const access = await authorization.accessContext(owner, "readiness");
      const before = await connections.connection(owner);
      if (!before || before.ownerId !== owner || before.environment !== "sandbox" || before.id !== access.connectionId || before.version !== access.version || before.sellerId !== access.sellerId || before.status !== "connected") throw new EbayReadinessError("stale");
      const result = await gateway.inspect(access.token);
      const [current, connection] = await Promise.all([listings.getById(owner, listingId), connections.connection(owner)]);
      if (!current || current.updatedAt !== expectedVersion || !connection || connection.ownerId !== owner || connection.environment !== "sandbox" ||
          connection.status !== "connected" || connection.id !== access.connectionId || connection.version !== access.version || connection.sellerId !== access.sellerId) throw new EbayReadinessError("stale");
      return { environment: "sandbox" as const, marketplace: "EBAY_US" as const, checkedAt: clock().toISOString(),
        registrationComplete: result.registrationComplete, zeroMonthlyQuantityLimit: result.zeroMonthlyQuantityLimit,
        businessPoliciesEnrolled: result.businessPoliciesEnrolled, policies: result.policies, locations: result.locations,
        inventoryEligibility: "unverified" as const, categoryCompatibility: "not-verified" as const,
        // This report cannot authorize resource creation, even if prerequisites exist.
        canStage: false as const, canCreateOffer: false as const, canPublish: false as const };
    },
  };
}
export type EbayReadinessReport = Awaited<ReturnType<ReturnType<typeof createEbayReadinessService>["check"]>>;
