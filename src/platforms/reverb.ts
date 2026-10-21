import { formatMoney } from "../domain/money";
import { reverbRequiredErrors } from "./reverbValidation";
import { imageNames } from "../domain/listingImage";
import type { Listing } from "../domain/listing";
import { getSuggestedCategories } from "./categorySuggestions";
import { photoTargets } from "./photoTargets";
import type { MarketplaceMapper } from "./types";

const REVERB_TARGET = photoTargets.find((target) => target.key === "reverb")!;

export const reverbMapper: MarketplaceMapper = {
  key: "reverb",
  label: "Reverb",
  sites: ["reverb"],
  validate(listing: Listing) {
    return { errors: Object.values(reverbRequiredErrors({
      ...listing.attributes, title: listing.title, description: listing.description,
      category: listing.marketplaceDetails.reverbCategory || listing.category,
      price: listing.askingPrice, shippingRate: listing.shippingRate,
    })), warnings: [] };
  },
  createDraft(listing: Listing) {
    const suggestedCategories = getSuggestedCategories(listing);


    return {
      platform: "Reverb",
      fields: [
        { key: "brand", label: "Brand", value: listing.attributes.brand },
        { key: "model", label: "Model", value: listing.attributes.model },
        { key: "year", label: "Year", value: listing.attributes.year },
        { key: "finish", label: "Finish", value: listing.attributes.finish },
        {
          key: "manufacturerCountry",
          label: "Manufacturer's Country",
          value: listing.attributes.manufacturerCountry,
        },
        {
          key: "category",
          label: "Category (Reverb)",
          value: listing.marketplaceDetails.reverbCategory || listing.category || suggestedCategories.reverbCategory,
        },
        {
          key: "subcategory",
          label: "Subcategory (Reverb)",
          value: suggestedCategories.reverbSubcategory,
        },
        {
          key: "additionalSubcategory",
          label: "Additional Subcategory (Reverb)",
          value: suggestedCategories.reverbAdditionalSubcategory,
        },
        { key: "title", label: "Listing Title", value: listing.title },
        {
          key: "description",
          label: "Description",
          value: listing.description,
          multiline: true,
        },
        {
          key: "youtubeLink",
          label: "Link to a YouTube Video",
          value: listing.attributes.videoUrl,
        },
        {
          key: "price",
          label: "Listing Price",
          value: listing.askingPrice.amount > 0 ? listing.askingPrice.amount.toFixed(2) : "",
        },
        {
          key: "purchasePrice",
          label: "What You Paid for the Item",
          value: formatMoney(listing.acquisitionCost),
        },
        {
          key: "shippingRate",
          label: "Shipping Rate",
          value: formatMoney(listing.shippingRate),
        },
      ],
      photoSets: [
        {
          key: REVERB_TARGET.key,
          label: REVERB_TARGET.label,
          limit: REVERB_TARGET.limit,
          imageNames: imageNames(listing.images).slice(0, REVERB_TARGET.limit),
        },
      ],
      notes: [ "Category values are scaffolded suggestions from the listing copy."],
    };
  },
};
