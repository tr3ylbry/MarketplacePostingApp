import { z } from "zod";
import { ownerIdSchema } from "./owner";
import { mediaHash, mediaId } from "./ebayRealMedia";
import { ebaySku } from "./ebayPreparationMapping";

// Normalized internal observations, not browser input, authentication or durable evidence.
export const inventoryBindingSchema = z.strictObject({
  ownerId: ownerIdSchema, listingId: mediaId, listingVersion: z.iso.datetime(),
  environment: z.enum(["sandbox", "production"]), sellerKey: mediaId,
  connectionId: mediaId, connectionVersion: mediaId, configHash: mediaHash, grantHash: mediaHash,
});
export type InventoryBinding = z.infer<typeof inventoryBindingSchema>;
export const inventoryPhotoBindingSchema = inventoryBindingSchema.extend({
  imageId: mediaId, imageOrder: z.number().int().nonnegative(), sourceVersion: mediaHash,
});
export type InventoryPhotoBinding = z.infer<typeof inventoryPhotoBindingSchema>;

export function sameInventoryBinding(a: InventoryBinding, b: InventoryBinding): boolean {
  return (Object.keys(inventoryBindingSchema.shape) as (keyof InventoryBinding)[]).every(key => a[key] === b[key]);
}
export function observationIsFresh(checkedAt: string, expiresAt: string, now: string): boolean {
  const times = [checkedAt, expiresAt, now].map(value => z.iso.datetime().safeParse(value));
  if (times.some(value => !value.success)) return false;
  return Date.parse(checkedAt) <= Date.parse(now) && Date.parse(now) < Date.parse(expiresAt);
}

const ownershipSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unproven") }),
  z.strictObject({ state: z.literal("confirmed"), recordId: mediaId, sku: z.string().min(1).max(50), binding: inventoryBindingSchema }),
]);
const observationSchema = z.strictObject({
  binding: inventoryBindingSchema, sku: z.string().min(1).max(50),
  checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  item: z.enum(["absent", "present", "unknown"]),
  content: z.enum(["matches", "different", "unknown"]),
  offers: z.strictObject({ complete: z.boolean(), scope: z.enum(["all-marketplaces-and-formats", "filtered"]), count: z.number().int().nonnegative() }),
  listings: z.enum(["none", "present", "unknown"]), groups: z.enum(["none", "present", "unknown"]),
  ownership: ownershipSchema,
  priorWrite: z.enum(["none", "not-sent", "confirmed", "uncertain"]),
  reconciliation: z.enum(["complete", "incomplete"]),
  media: z.enum(["missing", "expired", "mismatched", "unverified", "reported-current"]),
});
export type InventoryObservation = z.infer<typeof observationSchema>;
export type InventoryDecisionReason =
  | "invalid-observation" | "owner-mismatch" | "seller-mismatch" | "environment-mismatch" | "stale-snapshot"
  | "sku-mismatch" | "stale-observation" | "item-state-unknown" | "offers-incomplete" | "related-offers"
  | "related-listings" | "related-groups" | "related-state-unknown" | "ownership-unproven" | "ownership-mismatch"
  | "uncertain-write" | "reconciliation-incomplete" | "existing-sku" | "previous-write"
  | "content-conflict" | "content-unverified" | "external-create-race" | "external-delete-race"
  | "media-missing" | "media-stale" | "media-mismatch" | "media-unverified";
export interface InventoryDecision {
  outcome: "blocked" | "manual-review" | "consistent" | "observed-absent";
  reasons: InventoryDecisionReason[];
  canStage: false;
  canDelete: false;
}
function decision(reasons: InventoryDecisionReason[], clean: InventoryDecision["outcome"]): InventoryDecision {
  const unique = [...new Set(reasons)];
  const manual: InventoryDecisionReason[] = ["ownership-unproven", "uncertain-write", "previous-write", "content-conflict", "external-create-race", "external-delete-race"];
  return { outcome: unique.length ? unique.every(reason => manual.includes(reason)) ? "manual-review" : "blocked" : clean,
    reasons: unique, canStage: false, canDelete: false };
}

function inspect(expected: InventoryBinding, input: InventoryObservation, now: string) {
  const binding = inventoryBindingSchema.safeParse(expected), observed = observationSchema.safeParse(input);
  const reasons: InventoryDecisionReason[] = [];
  if (!binding.success || !observed.success || !z.iso.datetime().safeParse(now).success) return { reasons: ["invalid-observation"] as InventoryDecisionReason[], observed: null };
  const a = binding.data, b = observed.data.binding, observation = observed.data;
  if (a.ownerId !== b.ownerId) reasons.push("owner-mismatch");
  if (a.sellerKey !== b.sellerKey) reasons.push("seller-mismatch");
  if (a.environment !== "sandbox" || b.environment !== "sandbox") reasons.push("environment-mismatch");
  if (!sameInventoryBinding(a, b)) reasons.push("stale-snapshot");
  if (observation.sku !== ebaySku(a.listingId)) reasons.push("sku-mismatch");
  if (!observationIsFresh(observation.checkedAt, observation.expiresAt, now)) reasons.push("stale-observation");
  if (observation.item === "unknown") reasons.push("item-state-unknown");
  if (observation.item !== "present" && observation.content !== "unknown") reasons.push("invalid-observation");
  if (!observation.offers.complete || observation.offers.scope !== "all-marketplaces-and-formats") reasons.push("offers-incomplete");
  if (observation.offers.count) reasons.push("related-offers");
  if (observation.listings === "present") reasons.push("related-listings");
  if (observation.groups === "present") reasons.push("related-groups");
  if (observation.listings === "unknown" || observation.groups === "unknown") reasons.push("related-state-unknown");
  if (observation.priorWrite === "uncertain") reasons.push("uncertain-write");
  if (observation.reconciliation !== "complete") reasons.push("reconciliation-incomplete");
  if (observation.ownership.state === "confirmed" && (observation.ownership.sku !== observation.sku ||
      !sameInventoryBinding(a, observation.ownership.binding))) reasons.push("ownership-mismatch");
  return { reasons, observed: observation };
}

/** Initial staging refuses replacements, even of an otherwise consistent app-owned item. */
export function assessInventoryPreflight(expected: InventoryBinding, input: InventoryObservation, now: string): InventoryDecision {
  const { reasons, observed } = inspect(expected, input, now);
  if (observed?.item === "present") {
    reasons.push("existing-sku");
    if (observed.ownership.state !== "confirmed") reasons.push("ownership-unproven");
  }
  if (observed?.priorWrite === "confirmed") reasons.push("previous-write");
  if (observed?.media === "missing") reasons.push("media-missing");
  if (observed?.media === "expired") reasons.push("media-stale");
  if (observed?.media === "mismatched") reasons.push("media-mismatch");
  if (observed?.media === "unverified") reasons.push("media-unverified");
  // A read of absence is not an atomic conditional-create guarantee against another client.
  if (observed?.item === "absent") reasons.push("external-create-race");
  return decision(reasons, "blocked");
}

/** Describes consistency/absence only. Never adopts ownership, resets a fence or retries a PUT. */
export function assessInventoryReconciliation(expected: InventoryBinding, input: InventoryObservation, now: string): InventoryDecision {
  const { reasons, observed } = inspect(expected, input, now);
  if (observed?.item === "present") {
    if (observed.ownership.state !== "confirmed") reasons.push("ownership-unproven");
    if (observed.content === "different") reasons.push("content-conflict");
    if (observed.content === "unknown") reasons.push("content-unverified");
  }
  return decision(reasons, observed?.item === "absent" ? "observed-absent" : "consistent");
}

/** No-offers observations cannot reserve an item against a concurrent external client. */
export function assessInventoryCleanup(expected: InventoryBinding, input: InventoryObservation, now: string): InventoryDecision {
  const { reasons, observed } = inspect(expected, input, now);
  if (observed && (observed.ownership.state !== "confirmed" || observed.priorWrite !== "confirmed")) reasons.push("ownership-unproven");
  if (observed?.item === "present") {
    if (observed.content === "different") reasons.push("content-conflict");
    if (observed.content === "unknown") reasons.push("content-unverified");
    reasons.push("external-delete-race");
  }
  return decision(reasons, "observed-absent");
}
