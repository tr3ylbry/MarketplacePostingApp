import { z } from "zod";
import { IMAGE_COMPARISON_RECIPE } from "../src/infrastructure/storage/diagnosticImageDecode";
import type { DiagnosticImageResult } from "../src/infrastructure/ebay/diagnosticImageWorkflow";

const check = z.enum(["not-run", "passed", "failed"]), settlement = z.enum(["settled", "unsettled"]);
const diagnostic = z.strictObject({
  outcome: z.enum(["retrieved", "refused"]), reason: z.enum(["retrieved", "policy", "context", "clock", "deadline", "cancelled", "busy", "dns", "address", "tls", "peer", "headers", "body", "status", "transport"]),
  bytes: z.number().int().min(0).max(1_048_576), mime: z.enum(["image/png", "image/jpeg"]).nullable(),
  exceeded: z.boolean(), unverified: z.literal(true), associated: z.literal(false), settlement,
});
const margin = z.number().min(0).max(128), delta = z.number().min(0).max(255);
const visual = z.strictObject({
  recipe: z.literal(IMAGE_COMPARISON_RECIPE), verdict: z.enum(["match", "mismatch", "inconclusive"]),
  reason: z.enum(["matched", "reference", "unsupported", "decode", "geometry", "orientation", "marker", "color", "similarity", "cancelled", "deadline", "context", "busy"]),
  decoding: check, geometry: check, orientation: check, marker: check, color: check, similarity: check, settlement, associated: z.literal(false),
  metrics: z.strictObject({ orientationErrors: z.number().int().min(0).max(6), orientationMargin: margin,
    markerErrors: z.number().int().min(0).max(144), markerMargin: margin, mae: delta, rmse: delta, tileMae: delta, anchorDelta: delta }).nullable(),
});
const outcome = z.strictObject({ state: z.enum(["unknown", "not-sent"]), associated: z.literal(false), retrieved: z.boolean(),
  diagnostic: diagnostic.nullable(), visual: visual.nullable(), acknowledgement: z.enum(["not-attempted", "recorded", "overflow", "uncertain"]),
  settlement, reason: z.enum(["completed", "cancelled", "deadline", "busy", "unavailable"]),
});

// The native workflow is trusted, but the terminal is still a disclosure sink.
// Reject unexpected fields/nonfinite metrics instead of serializing an error.
export function verificationOutcome(value: DiagnosticImageResult) { return outcome.parse(value); }
export interface VerificationAccounting {
  postBudgetConsumed: boolean | null; getBudgetConsumed: boolean | null;
  postResponseObserved: boolean; getResponseObserved: boolean; postStatus: number | null; getStatus: 200 | null; ceiling: 2;
}
export const unknownVerificationAccounting = (): VerificationAccounting => ({ postBudgetConsumed:null,getBudgetConsumed:null,postResponseObserved:false,getResponseObserved:false,postStatus:null,getStatus:null,ceiling:2 });
