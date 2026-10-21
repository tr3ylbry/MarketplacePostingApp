import type { Listing } from "../domain/listing";

export class ListingConflictError extends Error {
  constructor() { super("This listing changed or was deleted. Reload before saving again."); }
}

export interface ListingRepository {
  list(): Promise<Listing[]>;
  getById(id: string): Promise<Listing | null>;
  create(listing: Listing): Promise<Listing>;
  update(listing: Listing, expectedUpdatedAt: string): Promise<Listing>;
  delete(id: string): Promise<void>;
  importListings(listings: Listing[]): Promise<{ imported: number; skipped: number }>;
}
