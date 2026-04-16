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
    const usesOfferUp = listing.selectedPlatforms.includes("offerup");
    const usesFacebook = listing.selectedPlatforms.includes("facebook-marketplace");
    const platformLabel =
      usesOfferUp && usesFacebook
        ? "OfferUp / Facebook Marketplace"
        : usesOfferUp
          ? "OfferUp"
          : "Facebook Marketplace";

    if (!listing.title) {
      notes.push(`Title is required for ${platformLabel}.`);
    }

    if (!listing.description) {
      notes.push(`Description is required for ${platformLabel}.`);
    }

    if (!listing.category) {
      notes.push(`Category is required for ${platformLabel}.`);
    }

    if (!listing.condition) {
      notes.push(`Condition is required for ${platformLabel}.`);
    }

    if (!Number.isFinite(listing.price) || listing.price <= 0) {
      notes.push(`Price is required for ${platformLabel}.`);
    }

    return {
      platform: platformLabel,
      fields: [
        { key: "title", label: "Title", value: listing.title },
        { key: "price", label: "Price", value: listing.price > 0 ? listing.price.toFixed(2) : "" },
        { key: "category", label: "Category", value: listing.category },
        ...(usesOfferUp
          ? [{ key: "subcategory", label: "Sub-category (OfferUp)", value: listing.subcategory }]
          : []),
        { key: "condition", label: "Condition", value: listing.condition },
        ...(usesOfferUp
          ? [{ key: "brand", label: "Brand (OfferUp)", value: listing.brand }]
          : []),
        ...(usesOfferUp
          ? [{ key: "type", label: "Type (OfferUp)", value: listing.type }]
          : []),
        {
          key: "description",
          label: "Description",
          value: listing.description,
          multiline: true,
        },
      ],
      photoSets: [
        ...(usesOfferUp
          ? [
              {
                key: OFFERUP_TARGET.key,
                label: OFFERUP_TARGET.label,
                limit: OFFERUP_TARGET.limit,
                imageNames: listing.imageNames.slice(0, OFFERUP_TARGET.limit),
              },
            ]
          : []),
        ...(usesFacebook
          ? [
              {
                key: FACEBOOK_TARGET.key,
                label: FACEBOOK_TARGET.label,
                limit: FACEBOOK_TARGET.limit,
                imageNames: listing.imageNames.slice(0, FACEBOOK_TARGET.limit),
              },
            ]
          : []),
      ],
      notes,
    };
  },
};
