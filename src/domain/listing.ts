import { z } from "zod";
import { moneySchema } from "./money";
import { listingImageSchema } from "./listingImage";
import { marketplaceListingSchema, marketplaceSchema } from "./marketplaceListing";

export type { Marketplace as PlatformSiteKey } from "./marketplaceListing";
const text = z.string().trim();
const optionalText = text.default("");
export const attributesSchema = z.object({
  brand: optionalText, model: optionalText, type: optionalText,
  year: optionalText, finish: optionalText, manufacturerCountry: optionalText,
  videoUrl: optionalText,
});
// Marketplace preferences are separate from publication state.
export const marketplaceDetailsSchema = z.object({
  ebayCategory: optionalText, offerupCategory: optionalText,
  offerupSubcategory: optionalText, facebookCategory: optionalText,
  craigslistCategory: optionalText, reverbCategory: optionalText,
  reverbSubcategory: optionalText, reverbAdditionalSubcategory: optionalText,
  craigslistCity: optionalText, craigslistZipCode: optionalText,
  craigslistSizeDimensions: optionalText, craigslistPhoneNumber: optionalText,
  craigslistContactName: optionalText, craigslistStreet: optionalText,
  craigslistCrossStreet: optionalText,
});
export const listingInputSchema = z.object({
  title: text.min(4, "Title must be at least 4 characters."),
  description: text.min(20, "Description must be at least 20 characters."),
  askingPrice: moneySchema.refine(money => money.amount > 0, "Price must be greater than 0."),
  acquisitionCost: moneySchema.optional(),
  shippingRate: moneySchema.optional(),
  condition: optionalText, category: optionalText,
  attributes: attributesSchema.prefault({}),
  selectedPlatforms: z.array(marketplaceSchema).default([]).transform(values => [...new Set(values)]),
  marketplaceDetails: marketplaceDetailsSchema.prefault({}),
});
export type CreateListingInput = z.input<typeof listingInputSchema>;
export const listingSchema = listingInputSchema.extend({
  id: z.string().min(1),
  status: z.enum(["draft", "active", "sold", "archived"]),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  images: z.array(listingImageSchema).max(40),
  marketplaceListings: z.array(marketplaceListingSchema),
}).superRefine((listing, ctx) => {
  for (const records of [listing.images, listing.marketplaceListings]) {
    if (records.some(record => record.listingId !== listing.id) ||
        new Set(records.map(record => record.id)).size !== records.length) {
      ctx.addIssue({ code: "custom", message: "Invalid related listing records." });
    }
  }
  if (new Set(listing.images.map(image => image.order)).size !== listing.images.length) {
    ctx.addIssue({ code: "custom", message: "Image order must be unique." });
  }
});
export type Listing = z.infer<typeof listingSchema>;
export type ListingStatus = Listing["status"];
export function createListing(input: CreateListingInput): Listing {
  const values = listingInputSchema.parse(input);
  const timestamp = new Date().toISOString();
  return {
    ...values, id: crypto.randomUUID(), status: "draft",
    createdAt: timestamp, updatedAt: timestamp, images: [], marketplaceListings: [],
  };
}
export function updateListing(listing: Listing, input: CreateListingInput): Listing {
  return listingSchema.parse({
    ...listing, ...listingInputSchema.parse(input), updatedAt: new Date().toISOString(),
  });
}
export function getListingAgeLabel(createdAt: string): string {
  const hours = Math.max(1, Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
