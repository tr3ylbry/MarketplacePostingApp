import { z } from "zod";
import { createListing, listingSchema, type Listing } from "../domain/listing";
import { createMoney, moneySchema, type Money } from "../domain/money";
import { imagesFromNames } from "../domain/listingImage";
import { marketplaceSchema, createMarketplaceListing, type MarketplaceListing } from "../domain/marketplaceListing";
import { normalizeLegacyListing } from "./legacyListing";

const legacyIdentity = z.object({
  id: z.string().min(1), title: z.string().trim().min(4),
  description: z.string().trim().min(20), price: z.number().finite().positive(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime().optional(),
});

function optionalLegacyMoney(value: string): Money | undefined {
  const text = value.trim();
  // Only unambiguous decimal amounts: do not infer currency symbols or "Free".
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return undefined;
  return moneySchema.safeParse({ amount: Number(text), currency: "USD" }).data;
}

function legacyMarketplace(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const canonical = normalized === "facebookmarketplace" ? "facebook-marketplace" : normalized;
  return marketplaceSchema.safeParse(canonical).data;
}

// One compatibility conversion for V1 (including its earlier category field names).
export function migrateListing(raw: unknown): Listing | null {
  const identity = legacyIdentity.safeParse(raw);
  if (!identity.success) return null;
  const old = normalizeLegacyListing(raw);
  if (!old) return null;
  try {
    const listing = createListing({
      title: old.title, description: old.description, condition: old.condition,
      category: old.type, askingPrice: createMoney(old.price),
      acquisitionCost: optionalLegacyMoney(old.purchasePrice),
      shippingRate: optionalLegacyMoney(old.shippingRate),
      attributes: { ...old, videoUrl: old.youtubeLink },
      selectedPlatforms: old.selectedPlatforms, marketplaceDetails: old,
    });
    const marketplaceListings: MarketplaceListing[] = old.postingRecords.flatMap((record, index) => {
      const marketplace = legacyMarketplace(record.platform);
      if (!marketplace) return [];
      return [{
        ...createMarketplaceListing(old.id, marketplace),
        id: `${old.id}:publication:${index}`,
        status: old.status === "needs-renewal" ? "needs-renewal" as const : "published" as const,
        externalUrl: record.url, publishedAt: z.iso.datetime().safeParse(record.datePosted).data,
      }];
    });
    if (old.status === "needs-renewal" && marketplaceListings.length === 0) {
      marketplaceListings.push(...old.selectedPlatforms.map(marketplace => ({
        ...createMarketplaceListing(old.id, marketplace), status: "needs-renewal" as const,
        id: `${old.id}:publication:${marketplace}`,
      })));
    }
    return listingSchema.parse({
      ...listing, id: old.id, createdAt: old.createdAt, updatedAt: identity.data.updatedAt ?? old.createdAt,
      status: old.status === "needs-renewal" ? "active" : old.status,
      images: imagesFromNames(old.id, old.imageNames).map((image, index) => ({ ...image, id: `${old.id}:image:${index}` })), marketplaceListings,
    });
  } catch {
    return null;
  }
}
