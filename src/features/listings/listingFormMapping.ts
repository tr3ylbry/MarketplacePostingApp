import { createListing, updateListing, listingSchema, type Listing, type CreateListingInput as DomainInput } from "../../domain/listing";
import { createMoney, formatMoney } from "../../domain/money";
import { imageNames, imagesFromNames } from "../../domain/listingImage";
import type { CreateListingInput } from "./listingFormInput";

export function toDomainInput(input: CreateListingInput): DomainInput {
  return {
    title: input.title, description: input.description, condition: input.condition,
    category: input.type, askingPrice: createMoney(input.price),
    acquisitionCost: input.purchasePrice.trim() ? createMoney(Number(input.purchasePrice)) : undefined,
    shippingRate: input.shippingRate.trim() ? createMoney(Number(input.shippingRate)) : undefined,
    attributes: { ...input, videoUrl: input.youtubeLink },
    selectedPlatforms: input.selectedPlatforms, marketplaceDetails: input,
  };
}
export function toFormInput(listing: Listing): CreateListingInput {
  return {
    ...listing.attributes, ...listing.marketplaceDetails,
    title: listing.title, description: listing.description, condition: listing.condition,
    price: listing.askingPrice.amount,
    purchasePrice: formatMoney(listing.acquisitionCost), shippingRate: formatMoney(listing.shippingRate),
    youtubeLink: listing.attributes.videoUrl,
    selectedPlatforms: [...listing.selectedPlatforms], imageNames: imageNames(listing.images),
  };
}
export function createListingFromForm(input: CreateListingInput): Listing {
  const listing = createListing(toDomainInput(input));
  return listingSchema.parse({ ...listing, images: imagesFromNames(listing.id, input.imageNames) });
}
export function updateListingFromForm(listing: Listing, input: CreateListingInput): Listing {
  const updated = updateListing(listing, toDomainInput(input));
  // Match each occurrence once, including duplicate filenames, to retain media identity.
  const remaining = [...listing.images];
  const images = imagesFromNames(listing.id, input.imageNames).map(image => {
    const index = remaining.findIndex(old => old.source.name === image.source.name);
    if (index < 0) return image;
    const [old] = remaining.splice(index, 1);
    return { ...old, order: image.order };
  });
  return listingSchema.parse({ ...updated, images });
}
