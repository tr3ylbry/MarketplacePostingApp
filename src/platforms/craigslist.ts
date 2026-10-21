import { imageNames } from "../domain/listingImage";
import type { Listing } from "../domain/listing";
import { getSuggestedCategories } from "./categorySuggestions";
import { photoTargets } from "./photoTargets";
import type { MarketplaceMapper } from "./types";

const CRAIGSLIST_TARGET = photoTargets.find((target) => target.key === "craigslist")!;

export const craigslistMapper: MarketplaceMapper = {
  key: "craigslist",
  label: "Craigslist",
  sites: ["craigslist"],
  validate(listing: Listing) {
    const notes: string[] = [];
    if (!listing.title) {
      notes.push("Posting title is required for Craigslist.");
    }

    if (!Number.isFinite(listing.askingPrice.amount) || listing.askingPrice.amount <= 0) {
      notes.push("Price is required for Craigslist.");
    }

    if (!listing.marketplaceDetails.craigslistCity) {
      notes.push("City or neighborhood is required for Craigslist.");
    }

    if (!listing.marketplaceDetails.craigslistZipCode) {
      notes.push("Zip code is required for Craigslist.");
    }

    if (!listing.description) {
      notes.push("Description is required for Craigslist.");
    }

    if (!listing.attributes.brand) {
      notes.push("Make / manufacturer is required for Craigslist.");
    }

    if (!listing.attributes.model) {
      notes.push("Model name / number is required for Craigslist.");
    }

    if (!listing.condition) {
      notes.push("Condition is required for Craigslist.");
    }

    if (!listing.marketplaceDetails.craigslistPhoneNumber) {
      notes.push("Phone number is required for Craigslist.");
    }

    if (!listing.marketplaceDetails.craigslistContactName) {
      notes.push("Contact name is required for Craigslist.");
    }

    return { errors: notes, warnings: [] };
  },
  createDraft(listing: Listing) {
    const suggestedCategories = getSuggestedCategories(listing);


    return {
      platform: "Craigslist",
      fields: [
        {
          key: "category",
          label: "Category (Craigslist)",
          value: suggestedCategories.craigslistCategory,
        },
        { key: "title", label: "Posting Title", value: listing.title },
        { key: "price", label: "Price", value: listing.askingPrice.amount > 0 ? listing.askingPrice.amount.toFixed(2) : "" },
        {
          key: "craigslistCity",
          label: "City (Craigslist)",
          value: listing.marketplaceDetails.craigslistCity,
        },
        { key: "craigslistZipCode", label: "Zip Code (Craigslist)", value: listing.marketplaceDetails.craigslistZipCode },
        {
          key: "description",
          label: "Description",
          value: listing.description,
          multiline: true,
        },
        { key: "brand", label: "Make / Manufacturer (Craigslist)", value: listing.attributes.brand },
        { key: "model", label: "Model Name / Number", value: listing.attributes.model },
        {
          key: "craigslistSizeDimensions",
          label: "Size / Dimensions (Craigslist)",
          value: listing.marketplaceDetails.craigslistSizeDimensions,
        },
        { key: "condition", label: "Condition", value: listing.condition },
        {
          key: "craigslistPhoneNumber",
          label: "Phone Number (Craigslist)",
          value: listing.marketplaceDetails.craigslistPhoneNumber,
        },
        {
          key: "craigslistContactName",
          label: "Contact Name (Craigslist)",
          value: listing.marketplaceDetails.craigslistContactName,
        },
        { key: "craigslistStreet", label: "Street (Craigslist)", value: listing.marketplaceDetails.craigslistStreet },
        {
          key: "craigslistCrossStreet",
          label: "Cross Street (Craigslist)",
          value: listing.marketplaceDetails.craigslistCrossStreet,
        },
      ],
      photoSets: [
        {
          key: CRAIGSLIST_TARGET.key,
          label: CRAIGSLIST_TARGET.label,
          limit: CRAIGSLIST_TARGET.limit,
          imageNames: imageNames(listing.images).slice(0, CRAIGSLIST_TARGET.limit),
        },
      ],
      notes: [ "Category is currently a scaffolded suggestion from the listing copy."],
    };
  },
};
