import { z } from "zod";

export const listingImageSchema = z.object({
  id: z.string().min(1),
  listingId: z.string().min(1),
  source: z.object({ kind: z.literal("filename"), name: z.string().min(1) }),
  order: z.number().int().nonnegative(),
  altText: z.string().optional(),
});
export type ListingImage = z.infer<typeof listingImageSchema>;

// Filename references are metadata, not persisted files or working image URLs.
export function imagesFromNames(listingId: string, names: string[]): ListingImage[] {
  return names.map((name, order) => listingImageSchema.parse({
    id: crypto.randomUUID(), listingId, source: { kind: "filename", name }, order,
  }));
}

export function imageNames(images: ListingImage[]): string[] {
  return [...images].sort((a, b) => a.order - b.order).map((image) => image.source.name);
}
