import type { Listing } from "../domain/listing";

export interface FormattedListingField {
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
}

export interface FormattedListing {
  platform: string;
  fields: FormattedListingField[];
  notes: string[];
}

export interface PlatformAdapter {
  key: string;
  label: string;
  formatListing: (listing: Listing) => FormattedListing;
}
