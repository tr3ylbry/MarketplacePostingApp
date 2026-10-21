import { z } from "zod";
import { moneySchema } from "./money";

export const marketplaceSchema = z.enum([
  "ebay", "craigslist", "reverb", "offerup", "facebook-marketplace",
]);
export type Marketplace = z.infer<typeof marketplaceSchema>;
export const publicationStatusSchema = z.enum([
  "draft", "ready", "published", "sold", "error", "needs-renewal",
]);
export const marketplaceListingSchema = z.object({
  id: z.string().min(1),
  listingId: z.string().min(1),
  marketplace: marketplaceSchema,
  status: publicationStatusSchema,
  externalListingId: z.string().optional(),
  externalUrl: z.string().optional(),
  priceOverride: moneySchema.optional(),
  publishedAt: z.iso.datetime().optional(),
  lastSyncedAt: z.iso.datetime().optional(),
});
export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>;

export function createMarketplaceListing(
  listingId: string,
  marketplace: Marketplace,
): MarketplaceListing {
  return marketplaceListingSchema.parse({
    id: crypto.randomUUID(), listingId, marketplace, status: "draft",
  });
}
