import type { Listing } from "../domain/listing";
import { photoTargets } from "./photoTargets";
import type { PlatformAdapter } from "./types";

const CRAIGSLIST_TARGET = photoTargets.find((target) => target.key === "craigslist")!;

export const craigslistAdapter: PlatformAdapter = {
  key: "craigslist",
  label: "Craigslist",
  formatListing(listing: Listing) {
    const notes: string[] = [];

    if (!listing.category) {
      notes.push("Category is required for Craigslist.");
    }

    if (!listing.title) {
      notes.push("Posting title is required for Craigslist.");
    }

    if (!Number.isFinite(listing.price) || listing.price <= 0) {
      notes.push("Price is required for Craigslist.");
    }

    if (!listing.craigslistCity) {
      notes.push("City or neighborhood is required for Craigslist.");
    }

    if (!listing.craigslistZipCode) {
      notes.push("Zip code is required for Craigslist.");
    }

    if (!listing.description) {
      notes.push("Description is required for Craigslist.");
    }

    if (!listing.brand) {
      notes.push("Make / manufacturer is required for Craigslist.");
    }

    if (!listing.model) {
      notes.push("Model name / number is required for Craigslist.");
    }

    if (!listing.condition) {
      notes.push("Condition is required for Craigslist.");
    }

    if (!listing.craigslistPhoneNumber) {
      notes.push("Phone number is required for Craigslist.");
    }

    if (!listing.craigslistContactName) {
      notes.push("Contact name is required for Craigslist.");
    }

    return {
      platform: "Craigslist",
      fields: [
        { key: "category", label: "Category", value: listing.category },
        { key: "title", label: "Posting title", value: listing.title },
        { key: "price", label: "Price", value: listing.price > 0 ? listing.price.toFixed(2) : "" },
        {
          key: "craigslistCity",
          label: "City or neighborhood",
          value: listing.craigslistCity,
        },
        { key: "craigslistZipCode", label: "Zip code", value: listing.craigslistZipCode },
        {
          key: "description",
          label: "Description",
          value: listing.description,
          multiline: true,
        },
        { key: "brand", label: "Make / manufacturer", value: listing.brand },
        { key: "model", label: "Model name / number", value: listing.model },
        {
          key: "craigslistSizeDimensions",
          label: "Size / dimensions",
          value: listing.craigslistSizeDimensions,
        },
        { key: "condition", label: "Condition", value: listing.condition },
        {
          key: "craigslistPhoneNumber",
          label: "Phone number",
          value: listing.craigslistPhoneNumber,
        },
        {
          key: "craigslistContactName",
          label: "Contact name",
          value: listing.craigslistContactName,
        },
        { key: "craigslistStreet", label: "Street", value: listing.craigslistStreet },
        {
          key: "craigslistCrossStreet",
          label: "Cross street",
          value: listing.craigslistCrossStreet,
        },
      ],
      photoSets: [
        {
          key: CRAIGSLIST_TARGET.key,
          label: CRAIGSLIST_TARGET.label,
          limit: CRAIGSLIST_TARGET.limit,
          imageNames: listing.imageNames.slice(0, CRAIGSLIST_TARGET.limit),
        },
      ],
      notes,
    };
  },
};
