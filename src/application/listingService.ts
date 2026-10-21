import { z } from "zod";
import { createListing, listingInputSchema, listingSchema, updateListing } from "../domain/listing";
import { imagesFromNames } from "../domain/listingImage";
import { ListingConflictError, type ListingRepository } from "./listingRepository";

const idSchema = z.string().trim().min(1).max(200);
export const listingMutationSchema = listingInputSchema.extend({
  imageNames: z.array(z.string().min(1).max(255)).max(40).default([]),
});

export function createListingService(repository: ListingRepository) {
  return {
    listListings: () => repository.list(),
    getListing: (id: string) => repository.getById(idSchema.parse(id)),
    async createListing(input: unknown) {
      const values = listingMutationSchema.parse(input);
      const listing = createListing(values);
      listing.images = imagesFromNames(listing.id, values.imageNames);
      return repository.create(listingSchema.parse(listing));
    },
    async updateListing(id: string, input: unknown, expectedUpdatedAt: string) {
      idSchema.parse(id);
      z.iso.datetime().parse(expectedUpdatedAt);
      const values = listingMutationSchema.parse(input);
      const current = await repository.getById(id);
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
      return repository.update(listingSchema.parse(updated), expectedUpdatedAt);
    },
    deleteListing: (id: string) => repository.delete(idSchema.parse(id)),
    async importListings(input: unknown) {
      // Explicit import is the only mutation accepting preserved IDs/history.
      const listings = z.array(listingSchema).max(100).parse(input);
      return repository.importListings(listings);
    },
  };
}
