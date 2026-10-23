import { z } from "zod";

export const MAX_IMAGE_COUNT = 40;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const imageContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const blobImageSourceSchema = z.object({
  kind: z.literal("vercel-blob"),
  pathname: z.string().regex(/^images\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/),
  originalFilename: z.string().min(1).max(255),
  contentType: imageContentTypeSchema,
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
  uploadedAt: z.iso.datetime(),
});
export type BlobImageSource = z.infer<typeof blobImageSourceSchema>;
export const listingImageSchema = z.object({
  id: z.string().min(1),
  listingId: z.string().min(1),
  source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("filename"), name: z.string().min(1) }), blobImageSourceSchema]),
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
  return [...images].sort((a, b) => a.order - b.order).map(imageName);
}

export function imageName(image: ListingImage) {
  return image.source.kind === "filename" ? image.source.name : image.source.originalFilename;
}
