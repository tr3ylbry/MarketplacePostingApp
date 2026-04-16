import type { Listing } from "../domain/listing";

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

export interface PlatformAdapter {
  key: string;
  label: string;
  formatListing: (listing: Listing) => FormattedListing;
}
