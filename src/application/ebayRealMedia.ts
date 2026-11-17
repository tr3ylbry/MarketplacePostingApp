import { createHash } from "node:crypto";
import { z } from "zod";
import { ownerIdSchema } from "./owner";

export const REAL_MEDIA_LEASE_MS = 60_000;
export const realMediaDigest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const mediaHash = z.string().regex(/^[a-f0-9]{64}$/);
export const mediaId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const mediaRecipe = z.string().min(1).max(1024).regex(/^[\x20-\x7e]+$/);
export const realMediaContextSchema = z.strictObject({
  ownerId: ownerIdSchema, listingId: mediaId, imageId: mediaId, listingVersion: z.iso.datetime(),
  sessionHash: mediaHash, actionHash: mediaHash, configHash: mediaHash, recipe: mediaRecipe,
  operation: z.enum(["normal", "capture-only"]).default("normal"),
});
export type RealMediaContext = z.input<typeof realMediaContextSchema>;
export const realMediaContentSchema = z.strictObject({
  sourceDigest: mediaHash, derivativeDigest: mediaHash, recipe: mediaRecipe,
  contentType: z.enum(["image/jpeg", "image/png"]), size: z.number().int().min(1).max(10485760),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
}).refine(v => Math.max(v.width, v.height) >= 500 && v.width * v.height <= 16777216);
export type RealMediaContent = z.infer<typeof realMediaContentSchema>;
// Internal lease capability only, never a browser DTO or permission to send.
export interface RealMediaClaim {
  id: string; ownerId: string; listingId: string; imageId: string; token: string; revision: number;
  sessionHash: string; actionHash: string;
}
export type RealMediaState = "preparing" | "not-sent" | "unknown" | "confirmed" | "residual";
export interface RealMediaSummary { state: RealMediaState; associated: boolean }
// Internal context only; no private pathname, token or browser-facing receipt.
export interface RealMediaBinding {
  ownerId: string; listingId: string; imageId: string; listingVersion: string;
  connectionId: string; connectionVersion: string; configHash: string; grantHash: string;
  sellerKey: string; sourceVersion: string; imageOrder: number;
}
export interface RealMediaSnapshot extends RealMediaBinding { mediaGrant: boolean; accessExpiresAt: string | null }
export interface RealMediaReviewGuard { binding: RealMediaSnapshot; sessionId: string }
export const mediaSessionHash = (owner: string, sessionId: string) => realMediaDigest(JSON.stringify(["media-session-v1", owner, sessionId]));
export interface RealMediaRepository {
  snapshot(owner: string, listingId: string, imageId: string): Promise<RealMediaSnapshot>;
  claim(input: RealMediaContext, guard?: RealMediaReviewGuard): Promise<RealMediaClaim>;
  fence(input: RealMediaClaim, content: RealMediaContent, guard?: RealMediaReviewGuard): Promise<RealMediaClaim>;
  beforeSend(input: RealMediaClaim, guard: RealMediaReviewGuard): Promise<void>;
  notSent(input: RealMediaClaim): Promise<RealMediaSummary>;
  acknowledge(input: RealMediaClaim, proof: unknown, options?: { guard: RealMediaReviewGuard; responseOnly: boolean }): Promise<RealMediaSummary>;
}
export class RealMediaError extends Error {
  constructor(readonly code: "stale" | "blocked" | "contract" | "unavailable") {
    super({ stale: "The photo, session or Sandbox connection changed. Reload before continuing.",
      blocked: "This operation is blocked by an existing claim or retained outcome.",
      contract: "Real image response admission is not enabled.",
      unavailable: "Media persistence is temporarily unavailable." }[code]);
  }
}
export function safeRealMediaFailure(error: unknown): RealMediaError {
  if (error instanceof RealMediaError) return error;
  let current: unknown = error;
  for (let n = 0; n < 4 && current && typeof current === "object"; n++) {
    const value = current as { code?: string; cause?: unknown };
    if (value.code === "23505" || value.code === "40P01") return new RealMediaError("blocked");
    current = value.cause;
  }
  return new RealMediaError("unavailable");
}
