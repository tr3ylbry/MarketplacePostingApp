import type { BlobImageSource } from "../domain/listingImage";

export const PRIVATE_IMAGE_REVIEW_MS = 5 * 60 * 1000;
export const PRIVATE_IMAGE_READ_MS = 15 * 1000;
export const MAX_EXPORT_IMAGE_SIDE = 4096;
export const MAX_EXPORT_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MIN_EXPORT_IMAGE_LONG_SIDE = 500;

// Server-to-server bytes only. No credential or capability URL crosses this API.
export interface PrivateImageReader {
  readPrivateImage(source: BlobImageSource, signal: AbortSignal): Promise<Buffer>;
}
export interface ValidatedExportImage { width: number; height: number; contentType: "image/jpeg" | "image/png"; size: number }
export interface ExportImageValidator { validate(bytes: Buffer, contentType: string, signal: AbortSignal): Promise<ValidatedExportImage> }
export class PrivateImagePreparationError extends Error {
  constructor(readonly code: "unavailable" | "stale" | "unsupported" | "invalid" | "busy") {
    super({ unavailable: "Private photo preparation is unavailable. Check your Sandbox connection and reload.",
      stale: "The listing, photo or Sandbox connection changed. Reload before preparing again.",
      unsupported: "Use a saved private JPEG or PNG photo for eBay preparation.",
      invalid: "The photo could not be verified within the supported image limits.",
      busy: "Photo validation is busy. Wait before preparing another photo." }[code]);
  }
}
