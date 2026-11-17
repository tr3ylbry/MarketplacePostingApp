import type { PhotoDerivative } from "./photoDerivative";
import type { PhotoCapacity } from "./photoCapacity";
import type { RealMediaClaim, RealMediaRepository, RealMediaSummary } from "./ebayRealMedia";

// Application proposals for the isolated fake pipeline, NOT eBay limits.
export const FAKE_MEDIA_OPERATION_MS = 30_000;
export const FAKE_MEDIA_SEND_MS = 10_000;
export const FAKE_MEDIA_RESPONSE_BYTES = 64 * 1024;
export interface LiveMediaSession { ownerId: string; id: string; expiresAt: string }
export interface FakeMediaReview {
  readonly simulation: true; readonly environment: "sandbox"; readonly imageId: string;
  readonly photoNumber: number; readonly recipe: string; readonly expiresAt: string;
}
export interface FakeMediaDependencies {
  // Trusted server authentication adapter, never form-submitted owner/session.
  session(): Promise<LiveMediaSession | null>;
  configHash(): string;
  recipe(): string;
  repository: RealMediaRepository;
  derive(owner: string, listingId: string, version: string, imageId: string, signal: AbortSignal, capacity: PhotoCapacity): Promise<PhotoDerivative>;
  // In-memory synthetic sender only. No token, host, path or provider URL input.
  create(bytes: Buffer, contentType: "image/jpeg" | "image/png", signal: AbortSignal): Promise<Uint8Array>;
  // Must use the existing opaque, actual-disposable-DB-bound proof issuer.
  admit(claim: RealMediaClaim, response: Uint8Array): Promise<unknown>;
}
export type FakeMediaSummary = RealMediaSummary & { simulation: true };
export class FakeMediaError extends Error {
  constructor(readonly code: "stale" | "busy" | "unavailable") {
    super({ stale: "This one-use photo review expired or changed. Prepare a new review.",
      busy: "Photo preparation is busy. Wait, then prepare a new review.",
      unavailable: "The isolated photo operation could not be completed." }[code]);
  }
}
