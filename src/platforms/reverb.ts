import type { Listing } from "../domain/listing";
import type { PlatformAdapter } from "./types";

export const reverbAdapter: PlatformAdapter = {
  key: "reverb",
  label: "Reverb",
  formatListing(listing: Listing) {
    const notes: string[] = [];

    if (!listing.brand) {
      notes.push("Brand is required for Reverb.");
    }

    if (!listing.model) {
      notes.push("Model is required for Reverb.");
    }

    if (!listing.category) {
      notes.push("Category is required for Reverb.");
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
          label: "Manufacturer's country",
          value: listing.manufacturerCountry,
        },
        { key: "category", label: "Category", value: listing.category },
        { key: "subcategory", label: "Subcategory", value: listing.subcategory },
        {
          key: "additionalSubcategory",
          label: "Additional subcategory",
          value: listing.additionalSubcategory,
        },
        { key: "title", label: "Listing title", value: listing.title },
        {
          key: "description",
          label: "Description",
          value: listing.description,
          multiline: true,
        },
        {
          key: "youtubeLink",
          label: "Link to a YouTube video",
          value: listing.youtubeLink,
        },
        {
          key: "price",
          label: "Listing price",
          value: listing.price > 0 ? listing.price.toFixed(2) : "",
        },
        {
          key: "purchasePrice",
          label: "What you paid for the item",
          value: listing.purchasePrice,
        },
        {
          key: "shippingRate",
          label: "Shipping rate",
          value: listing.shippingRate,
        },
      ],
      notes,
    };
  },
};
