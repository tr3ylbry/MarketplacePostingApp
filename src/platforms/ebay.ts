import type { Listing } from "../domain/listing";
import { getSuggestedCategories } from "./categorySuggestions";
import { photoTargets } from "./photoTargets";
import type { PlatformAdapter } from "./types";

const EBAY_TITLE_LIMIT = 80;
const EBAY_TARGET = photoTargets.find((target) => target.key === "ebay")!;

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength - 1).trimEnd()}…`;
}

export const ebayAdapter: PlatformAdapter = {
  key: "ebay",
  label: "eBay",
  formatListing(listing: Listing) {
    const suggestedCategories = getSuggestedCategories(listing);
    const conditionLabel = listing.condition.replace(/-/g, " ");
    const title = truncate(listing.title, EBAY_TITLE_LIMIT);

    const description = [
      `${listing.title}`,
      "",
      `Condition: ${conditionLabel}`,
      `Category: ${suggestedCategories.ebayCategory}`,
      "",
      listing.description.trim(),
      "",
      "Shipping, pickup, and payment details can be customized during posting.",
    ].join("\n");

    const limitedImages = listing.imageNames.slice(0, EBAY_TARGET.limit);
    const notes: string[] = [];

    if (listing.title.length > EBAY_TITLE_LIMIT) {
      notes.push(`Title truncated to ${EBAY_TITLE_LIMIT} characters for eBay.`);
    }

    if (listing.imageNames.length > EBAY_TARGET.limit) {
      notes.push(`Using first ${EBAY_TARGET.limit} images for eBay.`);
    }

    if (!listing.brand) {
      notes.push("Brand is commonly needed in eBay item specifics.");
    }

    if (!listing.type) {
      notes.push("Type is commonly needed in eBay item specifics.");
    }

    if (!listing.model) {
      notes.push("Model is commonly needed in eBay item specifics.");
    }

    return {
      platform: "eBay",
      fields: [
        { key: "title", label: "Item Title", value: title },
        { key: "category", label: "Category", value: suggestedCategories.ebayCategory },
        { key: "condition", label: "Item Condition", value: conditionLabel },
        { key: "brand", label: "Brand", value: listing.brand },
        { key: "type", label: "Type", value: listing.type },
        { key: "model", label: "Model", value: listing.model },
        { key: "price", label: "Price", value: listing.price.toFixed(2) },
        {
          key: "description",
          label: "Description",
          value: description,
          multiline: true,
        },
      ],
      photoSets: [
        {
          key: EBAY_TARGET.key,
          label: EBAY_TARGET.label,
          limit: EBAY_TARGET.limit,
          imageNames: limitedImages,
        },
      ],
      notes: [...notes, "Category is currently a scaffolded suggestion from the listing copy."],
    };
  },
};
