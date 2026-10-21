import { z } from "zod";
import { createListing, listingInputSchema, listingSchema, updateListing } from "../domain/listing";
import { imagesFromNames } from "../domain/listingImage";
import { ListingConflictError, type ListingRepository } from "./listingRepository";
import { ownerIdSchema, type OwnerId } from "./owner";

const idSchema = z.string().trim().min(1).max(200);
export const listingMutationSchema = listingInputSchema.extend({
  imageNames: z.array(z.string().min(1).max(255)).max(40).default([]),
});

export function createListingService(repository: ListingRepository) {
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
      const remaining = [...current.images];
      updated.images = imagesFromNames(id, values.imageNames).map(image => {
        const index = remaining.findIndex(old => old.source.name === image.source.name);
        if (index < 0) return image;
        const [old] = remaining.splice(index, 1);
        return { ...old, order: image.order };
      });
      return repository.update(ownerId, listingSchema.parse(updated), expectedUpdatedAt);
    },
    deleteListing: (ownerId: OwnerId, id: string) => repository.delete(ownerIdSchema.parse(ownerId), idSchema.parse(id)),
    async importListings(ownerId: OwnerId, input: unknown) {
      ownerIdSchema.parse(ownerId);
      // Explicit import is the only mutation accepting preserved IDs/history.
      const listings = z.array(listingSchema).max(100).parse(input);
      return repository.importListings(ownerId, listings);
    },
  };
}
