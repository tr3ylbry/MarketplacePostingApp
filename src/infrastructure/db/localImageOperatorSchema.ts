import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { users } from "./authSchema";

export const localImageOperatorPhases = ["armed", "consent-pending", "connected", "fixture-preparing", "ready", "running", "settled", "stopped", "cleanup-queued"] as const;
export type LocalImageOperatorPhase = typeof localImageOperatorPhases[number];

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string", precision: 6 });
// Local diagnostic permission accounting, never remote ownership or admission.
// Product/session links are retained identifiers, not cascading foreign keys.
export const localImageOperatorActivations = pgTable("local_image_operator_activations", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewedHead: text("reviewed_head").notNull(), reviewedTree: text("reviewed_tree").notNull(),
  configHash: text("config_hash").notNull(), sellerKey: text("seller_key").notNull(),
  connectionId: text("connection_id").notNull(), initialConnectionVersion: text("initial_connection_version").notNull(),
  derivativeRecipe: text("derivative_recipe").notNull(), comparisonRecipe: text("comparison_recipe").notNull(),
  phase: text("phase").$type<LocalImageOperatorPhase>().notNull().default("armed"), revision: integer("revision").notNull().default(0),
  expiresAt: instant("expires_at").notNull(), createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
  reviewDueAt: instant("review_due_at").notNull(), dispositionDueAt: instant("disposition_due_at").notNull(),
  sessionHash: text("session_hash"), consentStateHash: text("consent_state_hash"),
  consentVersion: text("consent_version"), connectedVersion: text("connected_version"),
  consentStartedAt: instant("consent_started_at"), exchangeIntentAt: instant("exchange_intent_at"), identityIntentAt: instant("identity_intent_at"),
  fixtureStartedAt: instant("fixture_started_at"), listingId: text("listing_id"), imageId: text("image_id"), listingVersion: instant("listing_version"),
  sourceDigest: text("source_digest"), derivativeDigest: text("derivative_digest"),
  runStartedAt: instant("run_started_at"), runnerId: text("runner_id"), cancelRequestedAt: instant("cancel_requested_at"), settledAt: instant("settled_at"),
  stoppedAt: instant("stopped_at"), cleanupStartedAt: instant("cleanup_started_at"), cleanupSessionHash: text("cleanup_session_hash"), cleanupNotBefore: instant("cleanup_not_before"),
}, t => [
  uniqueIndex("local_image_operator_state_key").on(t.consentStateHash),
  check("local_image_operator_hashes", sql`${t.reviewedHead} ~ '^[a-f0-9]{40}$' AND ${t.reviewedTree} ~ '^[a-f0-9]{40}$' AND ${t.configHash} ~ '^[a-f0-9]{64}$' AND ${t.sellerKey} ~ '^[a-f0-9]{64}$' AND (${t.sessionHash} IS NULL OR ${t.sessionHash} ~ '^[a-f0-9]{64}$') AND (${t.consentStateHash} IS NULL OR ${t.consentStateHash} ~ '^[a-f0-9]{64}$') AND (${t.sourceDigest} IS NULL OR ${t.sourceDigest} ~ '^[a-f0-9]{64}$') AND (${t.derivativeDigest} IS NULL OR ${t.derivativeDigest} ~ '^[a-f0-9]{64}$') AND (${t.cleanupSessionHash} IS NULL OR ${t.cleanupSessionHash} ~ '^[a-f0-9]{64}$')`),
  check("local_image_operator_bounds", sql`length(${t.id}) BETWEEN 1 AND 200 AND length(${t.ownerId}) BETWEEN 1 AND 200 AND length(${t.connectionId}) BETWEEN 1 AND 200 AND length(${t.initialConnectionVersion}) BETWEEN 1 AND 200 AND length(${t.derivativeRecipe}) BETWEEN 1 AND 1024 AND length(${t.comparisonRecipe}) BETWEEN 1 AND 1024 AND ${t.revision}>=0 AND (${t.listingId} IS NULL OR length(${t.listingId}) BETWEEN 1 AND 200) AND (${t.imageId} IS NULL OR length(${t.imageId}) BETWEEN 1 AND 200)`),
  check("local_image_operator_phase", sql`${t.phase} IN ('armed','consent-pending','connected','fixture-preparing','ready','running','settled','stopped','cleanup-queued')`),
  check("local_image_operator_times", sql`isfinite(${t.createdAt}) AND isfinite(${t.updatedAt}) AND isfinite(${t.expiresAt}) AND isfinite(${t.reviewDueAt}) AND isfinite(${t.dispositionDueAt}) AND ${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '2 hours' AND ${t.reviewDueAt}=${t.createdAt}+interval '30 days' AND ${t.dispositionDueAt}=${t.createdAt}+interval '90 days'`),
]);
