import type { Listing, PlatformSiteKey } from "../domain/listing";

export interface FormattedListingField {
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
}

export interface FormattedListingPhotoSet {
  key: string;
  label: string;
  limit: number;
  imageNames: string[];
}

export interface FormattedListing {
  platform: string;
  fields: FormattedListingField[];
  photoSets: FormattedListingPhotoSet[];
  notes: string[];
}

export interface MarketplaceValidationResult {
  errors: string[];
  warnings: string[];
}

export interface MarketplaceMapper {
  key: PlatformSiteKey | "offerup-facebook";
  label: string;
  sites: readonly PlatformSiteKey[];
  validate: (listing: Listing) => MarketplaceValidationResult;
  createDraft: (listing: Listing) => FormattedListing;
}
