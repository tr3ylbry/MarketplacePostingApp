import { sql } from "drizzle-orm";
import { pgTable, text, integer, boolean, timestamp, jsonb, uniqueIndex, foreignKey, check, index } from "drizzle-orm/pg-core";
import { ebayRealMediaAttempts } from "./ebayRealMediaSchema";
import type { VerificationEnvelope } from "../../application/ebayImageVerificationPersistence";

// Preserve database microseconds. JS observation timestamps are never clocks
// for authorization, and cannot establish causal order by millisecond equality.
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string", precision: 6 });
export const ebayImageVerifications = pgTable("ebay_image_verifications", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), uploadAttemptId: text("upload_attempt_id").notNull(),
  actionHash: text("action_hash").notNull(), expectedSourceDigest: text("expected_source_digest").notNull(),
  expectedDerivativeDigest: text("expected_derivative_digest").notNull(), parentPreparingRevision: integer("parent_preparing_revision").notNull(),
  targetField: text("target_field").notNull().default("imageUrl"), method: text("method").notNull().default("GET"),
  contractVersion: text("contract_version").notNull(), addressPolicyVersion: text("address_policy_version").notNull(), addressPolicyDataHash: text("address_policy_data_hash").notNull(),
  phase: text("phase").notNull().default("prepared"), revision: integer("revision").notNull().default(0),
  leaseUntil: instant("lease_until").notNull(), reviewUntil: instant("review_until").notNull(),
  requestIntentAt: instant("request_intent_at"), responseReceivedAt: instant("response_received_at"), providerExpiresAt: instant("provider_expires_at"),
  useUntil: instant("use_until"), requestDeadline: instant("request_deadline"),
  closeReason: text("close_reason"), evidenceOverflow: boolean("evidence_overflow").notNull().default(false),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
  reviewDueAt: instant("review_due_at").notNull(), dispositionDueAt: instant("disposition_due_at").notNull(),
}, t => [
  foreignKey({ columns: [t.uploadAttemptId, t.ownerId], foreignColumns: [ebayRealMediaAttempts.id, ebayRealMediaAttempts.ownerId], name: "image_verification_parent_owner" }).onDelete("restrict"),
  uniqueIndex("image_verification_owner_key").on(t.id, t.ownerId),
  uniqueIndex("image_verification_parent_key").on(t.uploadAttemptId),
  uniqueIndex("image_verification_action_key").on(t.ownerId, t.actionHash),
  index("image_verification_owner_created").on(t.ownerId, t.createdAt),
  check("image_verification_profile", sql`${t.method}='GET' AND ${t.targetField}='imageUrl' AND ${t.contractVersion}='diagnostic-image-get-v1' AND ${t.addressPolicyVersion}='iana-image-address-v1-2026-11-22' AND ${t.addressPolicyDataHash}='e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887'`),
  check("image_verification_bounds", sql`${t.id} ~ '^[A-Za-z0-9_-]{1,200}$' AND length(${t.ownerId}) BETWEEN 1 AND 200 AND ${t.uploadAttemptId} ~ '^[A-Za-z0-9_-]{1,200}$' AND ${t.actionHash} ~ '^[a-f0-9]{64}$' AND ${t.expectedSourceDigest} ~ '^[a-f0-9]{64}$' AND ${t.expectedDerivativeDigest} ~ '^[a-f0-9]{64}$' AND ${t.parentPreparingRevision} >= 0 AND ${t.revision} >= 0`),
  check("image_verification_phase", sql`${t.phase} IN ('prepared','closed','intent-recorded') AND (${t.closeReason} IS NULL OR ${t.closeReason} IN ('cancelled','expired','changed','preparation-failed','evidence-before-intent')) AND ((${t.phase}='closed')=(${t.closeReason} IS NOT NULL))`),
  check("image_verification_intent_shape", sql`(${t.phase}<>'intent-recorded' AND ${t.requestIntentAt} IS NULL AND ${t.responseReceivedAt} IS NULL AND ${t.providerExpiresAt} IS NULL AND ${t.useUntil} IS NULL AND ${t.requestDeadline} IS NULL) OR (${t.phase}='intent-recorded' AND ${t.requestIntentAt} IS NOT NULL AND ${t.responseReceivedAt} IS NOT NULL AND ${t.providerExpiresAt} IS NOT NULL AND ${t.useUntil} IS NOT NULL AND ${t.requestDeadline} IS NOT NULL AND ${t.requestDeadline}>${t.requestIntentAt} AND ${t.requestDeadline}<=${t.useUntil})`),
  check("image_verification_times", sql`isfinite(${t.createdAt}) AND isfinite(${t.updatedAt}) AND isfinite(${t.reviewUntil}) AND isfinite(${t.leaseUntil}) AND isfinite(${t.reviewDueAt}) AND isfinite(${t.dispositionDueAt}) AND (${t.requestIntentAt} IS NULL OR isfinite(${t.requestIntentAt}) AND isfinite(${t.responseReceivedAt}) AND isfinite(${t.providerExpiresAt}) AND isfinite(${t.useUntil}) AND isfinite(${t.requestDeadline}))`),
]);
export const ebayImageVerificationOutcomes = pgTable("ebay_image_verification_outcomes", {
  id: text("id").primaryKey(), verificationId: text("verification_id").notNull(), ownerId: text("owner_id").notNull(),
  intentRevision: integer("intent_revision"), envelope: jsonb("envelope").$type<VerificationEnvelope>().notNull(),
  fingerprint: text("fingerprint").notNull(), late: boolean("late").notNull(), protocolConflict: boolean("protocol_conflict").notNull(),
  recordedAt: instant("recorded_at").notNull(),
}, t => [
  foreignKey({ columns: [t.verificationId, t.ownerId], foreignColumns: [ebayImageVerifications.id, ebayImageVerifications.ownerId], name: "image_verification_outcome_owner" }).onDelete("restrict"),
  uniqueIndex("image_verification_outcome_repeat").on(t.verificationId, t.fingerprint),
  check("image_verification_outcome_shape", sql`${t.id} ~ '^[A-Za-z0-9_-]{1,200}$' AND (${t.intentRevision} IS NULL OR ${t.intentRevision}=1) AND ${t.fingerprint} ~ '^[a-f0-9]{64}$' AND isfinite(${t.recordedAt}) AND public.image_verification_envelope_valid(${t.envelope})`),
]);
