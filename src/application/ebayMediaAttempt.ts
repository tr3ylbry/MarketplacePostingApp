import { createHash } from "node:crypto";
import type { BlobImageSource } from "../domain/listingImage";

export const MEDIA_LEASE_MS = 60_000;
export const MEDIA_OPERATION_MS = 30_000;
export const MEDIA_FIXTURE_RECIPE = "generated-fixture-v1";
export const mediaDigest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const sourceMetadataDigest = (source: BlobImageSource) => mediaDigest(JSON.stringify(source));
export type MediaAttemptState = "preparing" | "not-sent" | "unknown" | "confirmed" | "residual";
export type MediaOutcomeReason = "complete" | "response" | "transport" | "http" | "expired" | "changed" | "preparation";
// Validated adapter evidence only; never raw provider bodies or headers.
export interface MediaOutcome {
  complete: boolean; imageId: string | null; imageUrl: string | null; expiresAt: string | null;
  responseStatus: number | null; reason: MediaOutcomeReason;
}
export interface MediaAttemptSummary { state: MediaAttemptState; simulation: true }
export interface MediaClaim {
  id: string; leaseToken: string; ownerId: string; listingId: string; imageId: string;
  listingVersion: string; connectionId: string; connectionVersion: string; configHash: string;
  sellerId: string; source: BlobImageSource; sourceMetadataHash: string;
}
export interface MediaAttemptRepository {
  claim(owner: string, listingId: string, version: string, imageId: string, configHash: string, now: Date): Promise<
    { kind: "claimed"; claim: MediaClaim } | { kind: "recorded"; summary: MediaAttemptSummary }>;
  markSending(claim: MediaClaim, content: { sourceDigest: string; exportDigest: string; size: number }, now: Date): Promise<void>;
  notSent(claim: MediaClaim): Promise<void>;
  settle(claim: MediaClaim, outcome: MediaOutcome, now: Date): Promise<MediaAttemptSummary>;
}
export interface SimulatedMediaGateway {
  create(bytes: Buffer, signal: AbortSignal): Promise<MediaOutcome>;
}
// Only a generated fixture is implemented. No production transform/original fallback.
export interface MediaFixtureFactory { create(signal: AbortSignal): Promise<Buffer> }
export class MediaAttemptError extends Error {
  constructor(readonly code: "disabled" | "stale" | "busy" | "unknown" | "preparation") {
    super({ disabled: "Real image transfer is disabled. No image was sent.",
      stale: "The listing, photo or Sandbox connection changed. Reload before trying again.",
      busy: "Photo simulation is busy. Wait before trying again.",
      unknown: "The simulated request may have created a copy. Another upload is blocked; operator review is required.",
      preparation: "The photo simulation could not be prepared. No upload was sent." }[code]);
  }
}
