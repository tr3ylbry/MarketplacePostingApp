import type { Listing } from "../domain/listing";

export interface FormattedListing {
  platform: string;
  title: string;
  description: string;
  price: string;
  imageNames: string[];
  notes: string[];
}

export interface PlatformAdapter {
  key: string;
  label: string;
  formatListing: (listing: Listing) => FormattedListing;
}
