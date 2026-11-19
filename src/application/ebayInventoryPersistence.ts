import { createHash } from "node:crypto";
import { z } from "zod";
import { ownerIdSchema } from "./owner";

export const INVENTORY_LEASE_MS = 60_000;
export const INVENTORY_EVIDENCE_BYTES = 65_536;
export const INVENTORY_REFERENCE_LIMIT = 250;
export const inventoryDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export const inventoryHash = z.string().regex(/^[a-f0-9]{64}$/);
export const inventoryId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const inventoryClaimInput = z.strictObject({
  ownerId: ownerIdSchema, listingId: inventoryId, listingVersion: z.iso.datetime(),
  connectionId: inventoryId, connectionVersion: inventoryId, configHash: inventoryHash, grantHash: inventoryHash,
  sessionId: inventoryId, actionHash: inventoryHash,
  operation: z.enum(["inspect", "initial-stage", "cleanup"]),
});
export type InventoryClaimInput = z.infer<typeof inventoryClaimInput>;
export const inventoryClaimSchema = z.strictObject({
  id: z.uuid(), resourceId: z.uuid(), ownerId: ownerIdSchema, token: z.uuid(),
  revision: z.number().int().nonnegative(), actionHash: inventoryHash, sessionHash: inventoryHash,
});
export type InventoryClaim = z.infer<typeof inventoryClaimSchema>;
export const inventoryIntentSchema = z.strictObject({ payloadDigest: inventoryHash, mediaManifestDigest: inventoryHash });
export type InventoryIntent = z.infer<typeof inventoryIntentSchema>;
const reference = z.strictObject({ kind: z.enum(["offer", "listing", "group"]), id: inventoryId });
const envelopeSchema = z.strictObject({
  version: z.literal("inventory-local-v1"),
  kind: z.enum(["inspection", "acknowledgement", "conflict", "recovery"]),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(),
  item: z.enum(["absent", "present", "unknown"]), coverage: z.enum(["complete", "incomplete", "unknown"]),
  outcome: z.enum(["observed", "uncertain", "not-sent"]),
  code: z.enum(["none", "collision", "stale", "conflict", "recreation", "integrity", "overflow"]),
  contentDigest: inventoryHash.nullable(), related: z.array(reference),
  httpStatus: z.number().int().min(100).max(599).nullable(), overflow: z.boolean(),
}).refine(v => Date.parse(v.startedAt) <= Date.parse(v.finishedAt));
export type InventoryEvidence = z.infer<typeof envelopeSchema>;

// This is a local normalized record contract, NOT a provider-response parser or
// provenance issuer. Unknown fields (including credentials/URLs/raw bodies) fail.
export function normalizeInventoryEvidence(input: unknown): InventoryEvidence {
  const value = envelopeSchema.parse(input);
  if (value.related.length > INVENTORY_REFERENCE_LIMIT || Buffer.byteLength(JSON.stringify(value), "utf8") > INVENTORY_EVIDENCE_BYTES || value.overflow) {
    return { ...value, item: "unknown", coverage: "incomplete", outcome: "uncertain",
      code: ["conflict", "recreation", "integrity"].includes(value.code) ? value.code : "overflow",
      contentDigest: null, related: [], overflow: true };
  }
  return value;
}
export interface InventoryProjection {
  resourceId: string; attemptId: string; state: string; hold: "none" | "resource" | "seller";
  ownership: "unproven"; canStage: false; canDelete: false;
}
export class InventoryPersistenceError extends Error {
  constructor(readonly code: "blocked" | "stale" | "invalid" | "unavailable") {
    super({ blocked: "This operation requires private review before continuing.", stale: "The local context changed. Reload before continuing.",
      invalid: "The local Inventory evidence is invalid.", unavailable: "Inventory persistence is temporarily unavailable." }[code]);
  }
}
