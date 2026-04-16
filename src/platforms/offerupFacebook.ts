import type { Listing } from "../domain/listing";
import { photoTargets } from "./photoTargets";
import type { PlatformAdapter } from "./types";

const OFFERUP_TARGET = photoTargets.find((target) => target.key === "offerup")!;
const FACEBOOK_TARGET = photoTargets.find(
  (target) => target.key === "facebook-marketplace",
)!;

export const offerupFacebookAdapter: PlatformAdapter = {
  key: "offerup-facebook",
  label: "OfferUp / Facebook Marketplace",
  formatListing(listing: Listing) {
    const notes: string[] = [];

    if (!listing.title) {
      notes.push("Title is required for OfferUp and Facebook Marketplace.");
    }

    if (!listing.description) {
      notes.push("Description is required for OfferUp and Facebook Marketplace.");
    }

    if (!listing.category) {
      notes.push("Category is required for OfferUp and Facebook Marketplace.");
    }

    if (!listing.condition) {
      notes.push("Condition is required for OfferUp and Facebook Marketplace.");
    }

    if (!Number.isFinite(listing.price) || listing.price <= 0) {
      notes.push("Price is required for OfferUp and Facebook Marketplace.");
    }

    return {
      platform: "OfferUp / Facebook Marketplace",
      fields: [
        { key: "title", label: "Title", value: listing.title },
        { key: "price", label: "Price", value: listing.price > 0 ? listing.price.toFixed(2) : "" },
        { key: "category", label: "Category", value: listing.category },
        { key: "subcategory", label: "OfferUp sub-category", value: listing.subcategory },
        { key: "condition", label: "Condition", value: listing.condition },
        { key: "brand", label: "OfferUp brand", value: listing.brand },
        { key: "type", label: "OfferUp type", value: listing.type },
        {
          key: "description",
          label: "Description",
          value: listing.description,
          multiline: true,
        },
      ],
      photoSets: [
        {
          key: OFFERUP_TARGET.key,
          label: OFFERUP_TARGET.label,
          limit: OFFERUP_TARGET.limit,
          imageNames: listing.imageNames.slice(0, OFFERUP_TARGET.limit),
        },
        {
          key: FACEBOOK_TARGET.key,
          label: FACEBOOK_TARGET.label,
          limit: FACEBOOK_TARGET.limit,
          imageNames: listing.imageNames.slice(0, FACEBOOK_TARGET.limit),
        },
      ],
      notes,
    };
  },
};
