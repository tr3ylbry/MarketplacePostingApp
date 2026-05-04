import type { Listing } from "../domain/listing";
import { getSuggestedCategories } from "./categorySuggestions";
import { photoTargets } from "./photoTargets";
import type { PlatformAdapter } from "./types";

const REVERB_TARGET = photoTargets.find((target) => target.key === "reverb")!;

export const reverbAdapter: PlatformAdapter = {
  key: "reverb",
  label: "Reverb",
  formatListing(listing: Listing) {
    const suggestedCategories = getSuggestedCategories(listing);
    const notes: string[] = [];

    if (!listing.brand) {
      notes.push("Brand is required for Reverb.");
    }

    if (!listing.model) {
      notes.push("Model is required for Reverb.");
    }

    if (!listing.title) {
      notes.push("Listing title is required for Reverb.");
    }

    if (!listing.description) {
      notes.push("Description is required for Reverb.");
    }

    if (!Number.isFinite(listing.price) || listing.price <= 0) {
      notes.push("Listing price is required for Reverb.");
    }

    if (!listing.shippingRate) {
      notes.push("Shipping rate is required for Reverb.");
    }

    return {
      platform: "Reverb",
      fields: [
        { key: "brand", label: "Brand", value: listing.brand },
        { key: "model", label: "Model", value: listing.model },
        { key: "year", label: "Year", value: listing.year },
        { key: "finish", label: "Finish", value: listing.finish },
        {
          key: "manufacturerCountry",
          label: "Manufacturer's Country",
          value: listing.manufacturerCountry,
        },
        {
          key: "category",
          label: "Category (Reverb)",
          value: suggestedCategories.reverbCategory,
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
          value: listing.youtubeLink,
        },
        {
          key: "price",
          label: "Listing Price",
          value: listing.price > 0 ? listing.price.toFixed(2) : "",
        },
        {
          key: "purchasePrice",
          label: "What You Paid for the Item",
          value: listing.purchasePrice,
        },
        {
          key: "shippingRate",
          label: "Shipping Rate",
          value: listing.shippingRate,
        },
      ],
      photoSets: [
        {
          key: REVERB_TARGET.key,
          label: REVERB_TARGET.label,
          limit: REVERB_TARGET.limit,
          imageNames: listing.imageNames.slice(0, REVERB_TARGET.limit),
        },
      ],
      notes: [...notes, "Category values are scaffolded suggestions from the listing copy."],
    };
  },
};
