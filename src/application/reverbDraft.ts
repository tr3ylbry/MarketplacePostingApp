import { createHash } from "node:crypto";
import type { Listing } from "../domain/listing";
import { listingSchema } from "../domain/listing";
import type { ReverbSelection } from "./reverbRepository";
import { ReverbDraftError, type ReverbPayload } from "./reverbGateway";

// Fixed-length ASCII identifier, independent of mutable product fields.
export const reverbSku = (listingId: string) => `crosslist-${createHash("sha256").update(listingId).digest("hex").slice(0, 32)}`;
export function reverbDraftPayload(listing: Listing, selection: ReverbSelection): Omit<ReverbPayload, "photos"> {
  listingSchema.parse(listing);
  if (!listing.attributes.brand || !listing.attributes.model) throw new ReverbDraftError("Brand / make and model are required. Edit the listing first.");
  if (!listing.images.length || listing.images.some(i => i.source.kind !== "vercel-blob")) throw new ReverbDraftError("Upload durable photos first. Remove or re-upload unavailable legacy filename entries.");
  if (!selection.shippingProfile && !listing.shippingRate) throw new ReverbDraftError("Select a shipping profile or set a shipping rate before preparing this draft.");
  return { publish: false, sku: reverbSku(listing.id), title: listing.title, make: listing.attributes.brand, model: listing.attributes.model,
    description: listing.description, ...(listing.attributes.year ? { year: listing.attributes.year } : {}),
    ...(listing.attributes.finish ? { finish: listing.attributes.finish } : {}),
    categories: [{ uuid: selection.category.id }], condition: { uuid: selection.condition.id },
    price: { amount: listing.askingPrice.amount.toFixed(2), currency: "USD" },
    ...(selection.shippingProfile ? { shipping_profile_id: selection.shippingProfile.id } : {
      shipping: { rates: [{ rate: { amount: listing.shippingRate!.amount.toFixed(2), currency: "USD" }, region_code: "US_CON" }] },
    }),
  };
}
