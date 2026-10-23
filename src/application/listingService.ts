import { z } from "zod";
import { createListing, listingInputSchema, listingSchema, updateListing } from "../domain/listing";
import { imagesFromNames } from "../domain/listingImage";
import { ListingConflictError, type ListingRepository } from "./listingRepository";
import { ownerIdSchema, type OwnerId } from "./owner";
import type { ImageStorage } from "./imageStorage";
import { cleanupObjects } from "./imageService";

const idSchema = z.string().trim().min(1).max(200);
export const listingMutationSchema = listingInputSchema.extend({
  imageNames: z.array(z.string().min(1).max(255)).max(40).default([]),
});

export function createListingService(repository: ListingRepository, storage?: ImageStorage) {
  return {
    listListings: (ownerId: OwnerId) => repository.list(ownerIdSchema.parse(ownerId)),
    getListing: (ownerId: OwnerId, id: string) => repository.getById(ownerIdSchema.parse(ownerId), idSchema.parse(id)),
    async createListing(ownerId: OwnerId, input: unknown) {
      ownerIdSchema.parse(ownerId);
      const values = listingMutationSchema.parse(input);
      const listing = createListing(values);
      listing.images = imagesFromNames(listing.id, values.imageNames);
      return repository.create(ownerId, listingSchema.parse(listing));
    },
    async updateListing(ownerId: OwnerId, id: string, input: unknown, expectedUpdatedAt: string) {
      ownerIdSchema.parse(ownerId);
      idSchema.parse(id);
      z.iso.datetime().parse(expectedUpdatedAt);
      const values = listingMutationSchema.parse(input);
      const current = await repository.getById(ownerId, id);
      if (!current || current.updatedAt !== expectedUpdatedAt) throw new ListingConflictError();
      const updated = updateListing(current, values);
      // Ensure every accepted edit advances the optimistic-concurrency token.
      updated.updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
      // Image mutations have their own owner-scoped boundary. A stale form may
      // not remove/replace stored objects by submitting a list of filenames.
      updated.images = current.images;
      return repository.update(ownerId, listingSchema.parse(updated), expectedUpdatedAt);
    },
    async deleteListing(ownerId: OwnerId, id: string) {
      const paths = await repository.delete(ownerIdSchema.parse(ownerId), idSchema.parse(id));
      if (storage && paths) await cleanupObjects(storage, paths);
    },
    async importListings(ownerId: OwnerId, input: unknown) {
      ownerIdSchema.parse(ownerId);
      // Explicit import is the only mutation accepting preserved IDs/history.
      const listings = z.array(listingSchema).max(100).parse(input);
      if (listings.some(listing => listing.images.some(image => image.source.kind !== "filename"))) {
        throw new z.ZodError([{ code: "custom", path: ["images"], message: "Local import accepts filename metadata only." }]);
      }
      return repository.importListings(ownerId, listings);
    },
  };
}
