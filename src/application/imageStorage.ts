import { z } from "zod";
import { imageContentTypeSchema, MAX_IMAGE_BYTES, type BlobImageSource } from "../domain/listingImage";

export const UPLOAD_TTL_MS = 5 * 60 * 1000;
export const READ_TTL_MS = 60 * 1000;
export const PROVIDER_READ_TTL_MS = 15 * 60 * 1000;
export interface ProviderImageAccess { createProviderReadAccess(pathname: string): Promise<string> }
export const CLEANUP_GRACE_MS = 60 * 1000;
export const uploadInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: imageContentTypeSchema,
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
}).strict();
export type UploadInput = z.infer<typeof uploadInputSchema>;
export interface ImageUpload extends UploadInput {
  id: string; listingId: string; pathname: string; expiresAt: string;
}
export interface ImageStorage {
  prepareUpload(upload: ImageUpload): Promise<string>;
  verifyUpload(upload: ImageUpload): Promise<BlobImageSource>;
  createReadAccess(pathname: string): Promise<string>;
  deleteObject(pathname: string): Promise<void>;
}
export class ImageOperationError extends Error {}
export function imagePathname(id: string, input: UploadInput) {
  const stem = input.filename.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "image";
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[input.contentType];
  return `images/${id}/${stem}.${extension}`;
}

export function matchesImageHeader(bytes: Uint8Array, type: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  return type === "image/webp" && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}
