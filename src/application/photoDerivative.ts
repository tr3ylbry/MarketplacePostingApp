import type { ValidatedExportImage } from "./ebayPrivateImages";

export const MAX_PHOTO_METADATA_BYTES = 256 * 1024;
export const PHOTO_DERIVATIVE_MS = 15_000;

// Sensitive, operation-local server data. Never serialize into a page/action DTO.
export interface PhotoDerivative extends ValidatedExportImage {
  bytes: Buffer;
  sourceDigest: string;
  derivativeDigest: string;
  recipe: string;
}
export interface PhotoTransformer {
  transform(bytes: Buffer, contentType: string, signal: AbortSignal, deadline: number): Promise<PhotoDerivative>;
}
export class PhotoDerivativeError extends Error {
  constructor(readonly code: "invalid" | "stale" | "unavailable" | "busy" | "aborted") {
    super({ invalid: "This photo cannot be prepared with the supported orientation, metadata and image limits. Use a supported static JPEG or PNG.",
      stale: "The listing, photo or Sandbox connection changed. Reload before preparing again.",
      unavailable: "Photo preparation is unavailable. Check your Sandbox connection and reload.",
      busy: "Photo preparation is busy. Wait before trying another photo.",
      aborted: "Photo preparation was cancelled or took too long. Try again." }[code]);
  }
}
