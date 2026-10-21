import type { Listing } from "../domain/listing";
import type { OwnerId } from "./owner";

export class ListingConflictError extends Error {
  constructor() { super("This listing changed or was deleted. Reload before saving again."); }
}
export class ListingUnavailableError extends Error {
  constructor() { super("Listing not found."); }
}

export interface ListingRepository {
  list(ownerId: OwnerId): Promise<Listing[]>;
  getById(ownerId: OwnerId, id: string): Promise<Listing | null>;
  create(ownerId: OwnerId, listing: Listing): Promise<Listing>;
  update(ownerId: OwnerId, listing: Listing, expectedUpdatedAt: string): Promise<Listing>;
  delete(ownerId: OwnerId, id: string): Promise<void>;
  importListings(ownerId: OwnerId, listings: Listing[]): Promise<{ imported: number; skipped: number }>;
}
