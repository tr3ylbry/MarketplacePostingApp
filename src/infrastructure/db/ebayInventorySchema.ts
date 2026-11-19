import { sql } from "drizzle-orm";
import { pgTable, text, integer, bigint, timestamp, jsonb, boolean, index, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { users } from "./authSchema";
import { ebayConnections } from "./ebaySchema";
import { listings } from "./schema";
import type { InventoryEvidence } from "../../application/ebayInventoryPersistence";
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string", precision: 3 });

// Retained local namespace anchors, never proof of remote ownership. Only the
// nullable current links detach; identity/history are independent of cascades.
export const ebayInventoryResources = pgTable("ebay_inventory_resources", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  environment: text("environment").notNull().default("sandbox"), sellerKey: text("seller_key").notNull(),
  identityVersion: text("identity_version").notNull().default("ebay-sandbox-eias-v1"), sku: text("sku").notNull(),
  historicalListingId: text("historical_listing_id").notNull(),
  currentListingId: text("current_listing_id").references(() => listings.id, { onDelete: "set null" }),
  currentConnectionId: text("current_connection_id").references(() => ebayConnections.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(0), hold: text("hold").notNull().default("none"),
  createdAt: instant("created_at").notNull(), reviewDueAt: instant("review_due_at").notNull(),
  retiredAt: instant("retired_at"), retentionReviewAt: instant("retention_review_at"),
  offboardReviewDueAt: instant("offboard_review_due_at"), dispositionDueAt: instant("disposition_due_at"),
}, t => [
  uniqueIndex("inventory_resource_namespace").on(t.environment, t.sellerKey, t.sku),
  uniqueIndex("inventory_resource_owner").on(t.id, t.ownerId),
  index("inventory_seller_holds").on(t.environment, t.sellerKey, t.hold),
  check("inventory_resource_shape", sql`${t.environment} = 'sandbox' AND ${t.identityVersion} = 'ebay-sandbox-eias-v1' AND ${t.sellerKey} ~ '^[a-f0-9]{64}$' AND length(${t.sku}) BETWEEN 1 AND 50 AND ${t.sku} ~ '^[A-Za-z0-9_-]+$' AND ${t.revision} >= 0 AND ${t.hold} IN ('none','resource','seller')`),
  check("inventory_resource_bounds", sql`length(${t.id}) BETWEEN 1 AND 200 AND length(${t.ownerId}) BETWEEN 1 AND 200 AND length(${t.historicalListingId}) BETWEEN 1 AND 200`),
]);
export const ebayInventoryAttempts = pgTable("ebay_inventory_attempts", {
  id: text("id").primaryKey(), resourceId: text("resource_id").notNull(), ownerId: text("owner_id").notNull(),
  ordinal: bigint("ordinal", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
  operation: text("operation").notNull(), actionHash: text("action_hash").notNull(), sessionHash: text("session_hash").notNull(),
  listingId: text("listing_id").notNull(), listingVersion: instant("listing_version").notNull(),
  connectionId: text("connection_id").notNull(), connectionVersion: text("connection_version").notNull(),
  configHash: text("config_hash").notNull(), grantHash: text("grant_hash").notNull(),
  claimHash: text("claim_hash").notNull(), revision: integer("revision").notNull().default(0),
  state: text("state").notNull().default("preparing"), leaseUntil: instant("lease_until").notNull(),
  intentAt: instant("intent_at"), payloadDigest: text("payload_digest"), mediaManifestDigest: text("media_manifest_digest"),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, t => [
  foreignKey({ columns: [t.resourceId, t.ownerId], foreignColumns: [ebayInventoryResources.id, ebayInventoryResources.ownerId], name: "inventory_attempt_resource_owner" }).onDelete("restrict"),
  uniqueIndex("inventory_attempt_identity").on(t.id, t.resourceId, t.ownerId),
  uniqueIndex("inventory_consumed_action").on(t.ownerId, t.actionHash),
  uniqueIndex("inventory_active_claim").on(t.resourceId).where(sql`${t.state} = 'preparing'`),
  index("inventory_attempt_history").on(t.resourceId, t.createdAt, t.id),
  index("inventory_owner_attempts").on(t.ownerId, t.createdAt, t.id),
  check("inventory_attempt_shape", sql`${t.operation} IN ('inspect','initial-stage','cleanup') AND ${t.state} IN ('preparing','retired','fenced','acknowledged','conflict') AND ${t.revision} >= 0`),
  check("inventory_attempt_hashes", sql`${t.actionHash} ~ '^[a-f0-9]{64}$' AND ${t.sessionHash} ~ '^[a-f0-9]{64}$' AND ${t.claimHash} ~ '^[a-f0-9]{64}$' AND ${t.configHash} ~ '^[a-f0-9]{64}$' AND ${t.grantHash} ~ '^[a-f0-9]{64}$'`),
  check("inventory_attempt_bounds", sql`length(${t.id}) BETWEEN 1 AND 200 AND length(${t.listingId}) BETWEEN 1 AND 200 AND length(${t.connectionId}) BETWEEN 1 AND 200 AND length(${t.connectionVersion}) BETWEEN 1 AND 200`),
  check("inventory_intent_shape", sql`(${t.intentAt} IS NULL AND ${t.payloadDigest} IS NULL AND ${t.mediaManifestDigest} IS NULL AND ${t.state} IN ('preparing','retired','acknowledged','conflict')) OR (${t.intentAt} IS NOT NULL AND ${t.operation} <> 'inspect' AND ${t.payloadDigest} IS NOT NULL AND ${t.payloadDigest} ~ '^[a-f0-9]{64}$' AND ${t.mediaManifestDigest} IS NOT NULL AND ${t.mediaManifestDigest} ~ '^[a-f0-9]{64}$' AND ${t.state} IN ('fenced','acknowledged','conflict'))`),
]);
export const ebayInventoryEvidence = pgTable("ebay_inventory_evidence", {
  id: text("id").primaryKey(), resourceId: text("resource_id").notNull(), ownerId: text("owner_id").notNull(), attemptId: text("attempt_id").notNull(),
  fingerprint: text("fingerprint").notNull(), envelope: jsonb("envelope").$type<InventoryEvidence>().notNull(),
  expectedRevision: integer("expected_revision").notNull(), late: boolean("late").notNull(), createdAt: instant("created_at").notNull(),
}, t => [
  foreignKey({ columns: [t.attemptId, t.resourceId, t.ownerId], foreignColumns: [ebayInventoryAttempts.id, ebayInventoryAttempts.resourceId, ebayInventoryAttempts.ownerId], name: "inventory_evidence_owner" }).onDelete("restrict"),
  uniqueIndex("inventory_evidence_repeat").on(t.attemptId, t.fingerprint),
  index("inventory_evidence_history").on(t.resourceId, t.createdAt, t.id),
  check("inventory_evidence_shape", sql`length(${t.id}) BETWEEN 1 AND 200 AND ${t.fingerprint} ~ '^[a-f0-9]{64}$' AND ${t.expectedRevision} >= 0 AND octet_length(${t.envelope}::text) <= 65536`),
]);
