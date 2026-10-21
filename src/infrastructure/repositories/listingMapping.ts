import { listingSchema, type Listing } from "../../domain/listing";
import { listings, listingImages, marketplaceListings } from "../db/schema";

export function listingToRows(value: Listing) {
  const listing = listingSchema.parse(value);
  const row: typeof listings.$inferInsert = {
    id: listing.id, title: listing.title, description: listing.description,
    askingPriceAmount: String(listing.askingPrice.amount), currency: listing.askingPrice.currency,
    acquisitionCostAmount: listing.acquisitionCost ? String(listing.acquisitionCost.amount) : null,
    shippingRateAmount: listing.shippingRate ? String(listing.shippingRate.amount) : null,
    condition: listing.condition, category: listing.category, status: listing.status,
    attributes: listing.attributes, marketplaceDetails: listing.marketplaceDetails,
    selectedPlatforms: listing.selectedPlatforms, createdAt: listing.createdAt, updatedAt: listing.updatedAt,
  };
  const images: (typeof listingImages.$inferInsert)[] = listing.images.map(image => ({ ...image, altText: image.altText ?? null }));
  const publications: (typeof marketplaceListings.$inferInsert)[] = listing.marketplaceListings.map(publication => ({
    id: publication.id, listingId: publication.listingId, marketplace: publication.marketplace, status: publication.status,
    externalListingId: publication.externalListingId ?? null, externalUrl: publication.externalUrl ?? null,
    priceOverrideAmount: publication.priceOverride ? String(publication.priceOverride.amount) : null,
    priceOverrideCurrency: publication.priceOverride?.currency ?? null,
    publishedAt: publication.publishedAt ?? null, lastSyncedAt: publication.lastSyncedAt ?? null,
  }));
  return { row, images, publications };
}

const money = (amount: string | null, currency: string = "USD") => amount === null ? undefined : { amount: Number(amount), currency };
const date = (value: string) => new Date(value).toISOString();

export function listingFromRows(
  row: typeof listings.$inferSelect,
  images: (typeof listingImages.$inferSelect)[],
  publications: (typeof marketplaceListings.$inferSelect)[],
): Listing {
  return listingSchema.parse({
    ...row, askingPrice: money(row.askingPriceAmount, row.currency),
    acquisitionCost: money(row.acquisitionCostAmount), shippingRate: money(row.shippingRateAmount),
    createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
    images: [...images].sort((a, b) => a.order - b.order).map(image => ({ ...image, altText: image.altText ?? undefined })),
    marketplaceListings: publications.map(publication => ({
      ...publication, externalListingId: publication.externalListingId ?? undefined,
      externalUrl: publication.externalUrl ?? undefined,
      priceOverride: money(publication.priceOverrideAmount, publication.priceOverrideCurrency ?? "USD"),
      publishedAt: publication.publishedAt ? date(publication.publishedAt) : undefined,
      lastSyncedAt: publication.lastSyncedAt ? date(publication.lastSyncedAt) : undefined,
    })),
  });
}
