import { z } from "zod";
import { ownerIdSchema } from "./owner";
import { mediaHash, mediaId, type RealMediaClaim, type RealMediaReviewGuard } from "./ebayRealMedia";

export const IMAGE_VERIFICATION_CONTRACT = "diagnostic-image-get-v1";
export const IMAGE_VERIFICATION_POLICY = Object.freeze({
  contractVersion: IMAGE_VERIFICATION_CONTRACT,
  targetField: "imageUrl",
  addressPolicyVersion: "iana-image-address-v1-2026-11-22",
  addressPolicyDataHash: "e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887",
});
export const MAXIMUM_IMAGE_VERIFICATION_POLICY = Object.freeze({
  ...IMAGE_VERIFICATION_POLICY,
  contractVersion: "diagnostic-maximum-image-get-v1",
  targetField: "maxDimensionImageUrl",
});
export type VerificationPolicy = typeof IMAGE_VERIFICATION_POLICY | typeof MAXIMUM_IMAGE_VERIFICATION_POLICY;
export const IMAGE_VERIFICATION_POLICY_CUTOFF = "2027-02-20T20:31:27.970Z";
export const IMAGE_VERIFICATION_BYTES = 1_048_576;
export const IMAGE_VERIFICATION_ENVELOPE_BYTES = 2_048;
const addressPolicy = {
  addressPolicyVersion: z.literal(IMAGE_VERIFICATION_POLICY.addressPolicyVersion),
  addressPolicyDataHash: z.literal(IMAGE_VERIFICATION_POLICY.addressPolicyDataHash),
};
export const verificationPolicySchema = z.union([z.strictObject({
  contractVersion: z.literal(IMAGE_VERIFICATION_POLICY.contractVersion),
  targetField: z.literal(IMAGE_VERIFICATION_POLICY.targetField), ...addressPolicy,
}), z.strictObject({
  contractVersion: z.literal(MAXIMUM_IMAGE_VERIFICATION_POLICY.contractVersion),
  targetField: z.literal(MAXIMUM_IMAGE_VERIFICATION_POLICY.targetField), ...addressPolicy,
})]);
export function sameVerificationPolicy(a: VerificationPolicy, b: VerificationPolicy): boolean {
  return a.contractVersion === b.contractVersion && a.targetField === b.targetField &&
    a.addressPolicyVersion === b.addressPolicyVersion && a.addressPolicyDataHash === b.addressPolicyDataHash;
}
export const verificationParentSchema = z.strictObject({
  id: mediaId, ownerId: ownerIdSchema, listingId: mediaId, imageId: mediaId, token: z.uuid(),
  revision: z.number().int().min(0).max(2_147_483_646), sessionHash: mediaHash, actionHash: mediaHash,
});
export const verificationReferenceSchema = z.strictObject({
  id: mediaId, ownerId: ownerIdSchema, actionHash: mediaHash,
  parent: verificationParentSchema, revision: z.number().int().min(0).max(2_147_483_646), policy: verificationPolicySchema,
}).refine(v => v.ownerId === v.parent.ownerId);
/** Internal correlation only; IDs/revisions do not authenticate or authorize I/O. */
export interface VerificationReference {
  id: string; ownerId: string; actionHash: string; parent: RealMediaClaim; revision: number; policy: VerificationPolicy;
}
export interface VerificationReservation {
  parent: RealMediaClaim; guard: RealMediaReviewGuard; actionHash: string;
  sourceDigest: string; derivativeDigest: string; reviewUntil: string;
  policy: VerificationPolicy;
}
export const verificationReservationSchema = z.strictObject({
  parent: verificationParentSchema, actionHash: mediaHash, sourceDigest: mediaHash,
  derivativeDigest: mediaHash, reviewUntil: z.iso.datetime(), policy: verificationPolicySchema,
});
export const verificationIntentSchema = z.strictObject({ responseReceivedAt: z.iso.datetime(), providerExpiresAt: z.iso.datetime() });
export const verificationCloseReason = z.enum(["cancelled", "expired", "changed", "preparation-failed"]);
export type VerificationCloseReason = z.infer<typeof verificationCloseReason>;
export const verificationEnvelopeSchema = z.strictObject({
  version: z.literal("diagnostic-verification-v1"),
  event: z.enum(["response", "cancelled", "failure", "settlement"]),
  reason: z.enum(["bounded-response", "cancelled", "transport", "policy", "context", "deadline", "unavailable", "headers", "body", "status", "settled", "protocol"]),
  settlement: z.enum(["settled", "unsettled"]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  bytes: z.number().int().min(0).max(IMAGE_VERIFICATION_BYTES),
  exceeded: z.boolean(), mime: z.enum(["image/png", "image/jpeg"]).nullable(),
}).superRefine((v, ctx) => {
  if (v.event === "response" && (v.settlement !== "settled" || v.httpStatus === null || !["bounded-response", "headers", "body", "status"].includes(v.reason)) ||
    v.event === "cancelled" && (v.reason !== "cancelled" || v.settlement !== "unsettled") ||
    v.event === "settlement" && (v.reason !== "settled" || v.settlement !== "settled")) ctx.addIssue({ code: "custom", message: "Invalid diagnostic category." });
});
export type VerificationEnvelope = z.infer<typeof verificationEnvelopeSchema>;
export function verificationEnvelope(input: unknown): VerificationEnvelope {
  const value = verificationEnvelopeSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(value)) > IMAGE_VERIFICATION_ENVELOPE_BYTES) throw new VerificationPersistenceError();
  return value;
}
export interface VerificationOutcomeInput { intentRevision: 1 | null; envelope: VerificationEnvelope }
export interface VerificationAcknowledgement { evidenceId: string | null; late: boolean; overflow: boolean; associated: false; policy: VerificationPolicy }
export interface VerificationStatus {
  phase: "prepared" | "closed" | "intent-recorded"; hasOutcome: boolean; late: boolean;
  conflict: boolean; overflow: boolean; detached: boolean; associated: false;
}
export class VerificationPersistenceError extends Error {
  constructor() { super("Diagnostic persistence refused or unavailable."); }
}
