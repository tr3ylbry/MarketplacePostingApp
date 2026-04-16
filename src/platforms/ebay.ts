import type { Listing } from "../domain/listing";
import type { PlatformAdapter } from "./types";

const EBAY_TITLE_LIMIT = 80;
const EBAY_IMAGE_LIMIT = 24;

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
    const conditionLabel = listing.condition.replace(/-/g, " ");
    const title = truncate(listing.title, EBAY_TITLE_LIMIT);

    const description = [
      `${listing.title}`,
      "",
      `Condition: ${conditionLabel}`,
      `Category: ${listing.category}`,
      "",
      listing.description.trim(),
      "",
      "Shipping, pickup, and payment details can be customized during posting.",
    ].join("\n");

    const limitedImages = listing.imageNames.slice(0, EBAY_IMAGE_LIMIT);
    const notes: string[] = [];

    if (listing.title.length > EBAY_TITLE_LIMIT) {
      notes.push(`Title truncated to ${EBAY_TITLE_LIMIT} characters for eBay.`);
    }

    if (listing.imageNames.length > EBAY_IMAGE_LIMIT) {
      notes.push(`Using first ${EBAY_IMAGE_LIMIT} images for eBay.`);
    }

    return {
      platform: "eBay",
      fields: [
        { key: "title", label: "Title", value: title },
        { key: "price", label: "Price", value: listing.price.toFixed(2) },
        {
          key: "description",
          label: "Description",
          value: description,
          multiline: true,
        },
        {
          key: "images",
          label: "Images",
          value: limitedImages.join("\n"),
          multiline: true,
        },
      ],
      notes,
    };
  },
};
