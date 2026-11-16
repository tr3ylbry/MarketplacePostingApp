import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, index, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { users } from "./authSchema";
import { ebayConnections } from "./ebaySchema";
import { listings, listingImages } from "./schema";
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string", precision: 3 });

// Real lifecycle evidence, independent of product/connection cascades. No transport.
export const ebayRealMediaAttempts = pgTable("ebay_real_media_attempts", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  environment: text("environment").notNull().default("sandbox"), sellerKey: text("seller_key").notNull(),
  identityVersion: text("identity_version").notNull().default("ebay-sandbox-eias-v1"),
  sessionHash: text("session_hash").notNull(), actionHash: text("action_hash").notNull(), operation: text("operation").notNull(),
  connectionId: text("connection_id").notNull(), connectionVersion: text("connection_version").notNull(),
  configHash: text("config_hash").notNull(), grantHash: text("grant_hash").notNull(),
  listingId: text("listing_id").notNull(), listingVersion: instant("listing_version").notNull(),
  imageId: text("image_id").notNull(), imageOrder: integer("image_order").notNull(), sourceVersion: text("source_version").notNull(),
  recipe: text("recipe").notNull(), sourceDigest: text("source_digest"), derivativeDigest: text("derivative_digest"),
  contentType: text("content_type"), encodedSize: integer("encoded_size"), width: integer("width"), height: integer("height"),
  state: text("state").notNull(), revision: integer("revision").notNull().default(0),
  claimHash: text("claim_hash").notNull(), leaseUntil: instant("lease_until"), postIntentAt: instant("post_intent_at"),
  reason: text("reason"), createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, t => [
  uniqueIndex("real_media_attempt_owner_key").on(t.id, t.ownerId),
  uniqueIndex("real_media_claim_key").on(t.ownerId, t.environment, t.listingId, t.imageId).where(sql`${t.state} = 'preparing'`),
  uniqueIndex("real_media_action_key").on(t.ownerId, t.actionHash),
  uniqueIndex("real_media_source_fence").on(t.environment, t.sellerKey, t.sourceDigest).where(sql`${t.postIntentAt} IS NOT NULL`),
  uniqueIndex("real_media_derivative_fence").on(t.environment, t.sellerKey, t.derivativeDigest).where(sql`${t.postIntentAt} IS NOT NULL`),
  index("real_media_owner_created").on(t.ownerId, t.createdAt),
  check("real_media_context", sql`${t.environment} = 'sandbox' AND ${t.identityVersion} = 'ebay-sandbox-eias-v1' AND ${t.operation} IN ('normal','capture-only') AND ${t.imageOrder} >= 0 AND ${t.revision} >= 0`),
  check("real_media_hashes", sql`${t.sellerKey} ~ '^[a-f0-9]{64}$' AND ${t.sessionHash} ~ '^[a-f0-9]{64}$' AND ${t.actionHash} ~ '^[a-f0-9]{64}$' AND ${t.configHash} ~ '^[a-f0-9]{64}$' AND ${t.grantHash} ~ '^[a-f0-9]{64}$' AND ${t.sourceVersion} ~ '^[a-f0-9]{64}$' AND ${t.claimHash} ~ '^[a-f0-9]{64}$'`),
  check("real_media_bounds", sql`length(${t.ownerId}) BETWEEN 1 AND 200 AND length(${t.id}) BETWEEN 1 AND 200 AND length(${t.listingId}) BETWEEN 1 AND 200 AND length(${t.imageId}) BETWEEN 1 AND 200 AND length(${t.connectionId}) BETWEEN 1 AND 200 AND length(${t.connectionVersion}) BETWEEN 1 AND 200 AND length(${t.recipe}) BETWEEN 1 AND 1024 AND ${t.recipe} ~ '^[ -~]+$'`),
  check("real_media_fence_shape", sql`(${t.postIntentAt} IS NULL AND ${t.state} IN ('preparing','not-sent') AND ${t.sourceDigest} IS NULL AND ${t.derivativeDigest} IS NULL AND ${t.encodedSize} IS NULL AND ${t.contentType} IS NULL AND ${t.width} IS NULL AND ${t.height} IS NULL) OR (${t.postIntentAt} IS NOT NULL AND ${t.state} IN ('unknown','confirmed','residual') AND ${t.sourceDigest} IS NOT NULL AND ${t.derivativeDigest} IS NOT NULL AND ${t.encodedSize} IS NOT NULL AND ${t.contentType} IS NOT NULL AND ${t.width} IS NOT NULL AND ${t.height} IS NOT NULL)`),
  check("real_media_content", sql`(${t.sourceDigest} IS NULL OR ${t.sourceDigest} ~ '^[a-f0-9]{64}$') AND (${t.derivativeDigest} IS NULL OR ${t.derivativeDigest} ~ '^[a-f0-9]{64}$') AND (${t.contentType} IS NULL OR ${t.contentType} IN ('image/jpeg','image/png')) AND (${t.encodedSize} IS NULL OR ${t.encodedSize} BETWEEN 1 AND 10485760) AND (${t.width} IS NULL OR ${t.width} BETWEEN 1 AND 4096) AND (${t.height} IS NULL OR ${t.height} BETWEEN 1 AND 4096) AND (${t.width} IS NULL OR greatest(${t.width},${t.height}) >= 500 AND ${t.width}::bigint * ${t.height} <= 16777216)`),
  check("real_media_reason", sql`${t.reason} IS NULL OR ${t.reason} IN ('preparation','response','changed','conflict','expired')`),
  check("real_media_times", sql`isfinite(${t.createdAt}) AND isfinite(${t.updatedAt}) AND isfinite(${t.listingVersion}) AND (${t.postIntentAt} IS NULL OR isfinite(${t.postIntentAt})) AND (${t.leaseUntil} IS NULL OR isfinite(${t.leaseUntil})) AND (${t.state} <> 'preparing' OR ${t.leaseUntil} IS NOT NULL)`),
]);

export const ebayRealMediaReceipts = pgTable("ebay_real_media_receipts", {
  id: text("id").primaryKey(), attemptId: text("attempt_id").notNull().references(() => ebayRealMediaAttempts.id, { onDelete: "restrict" }),
  contractVersion: text("contract_version").notNull(), fingerprint: text("fingerprint").notNull(), level: text("level").notNull(),
  resourceId: text("resource_id"), location: text("location"), imageUrl: text("image_url"), maximumUrl: text("maximum_url"),
  expiresAt: instant("expires_at"), responseStatus: integer("response_status"), createdAt: instant("created_at").notNull(),
}, t => [
  uniqueIndex("real_media_receipt_identity").on(t.id, t.attemptId),
  uniqueIndex("real_media_receipt_repeat").on(t.attemptId, t.fingerprint),
  check("real_media_receipt_contract", sql`${t.contractVersion} = 'synthetic-real-media-v1' AND current_database() ~ '^marketplace_real_media_[a-f0-9]{24}_test$'`),
  check("real_media_receipt_level", sql`${t.level} IN ('partial','complete','conflict') AND ${t.fingerprint} ~ '^[a-f0-9]{64}$' AND (${t.responseStatus} IS NULL OR ${t.responseStatus} BETWEEN 100 AND 599)`),
  check("real_media_receipt_fields", sql`(${t.resourceId} IS NULL OR ${t.resourceId} ~ '^test_resource_[a-f0-9]{16}$') AND (${t.location} IS NULL OR (${t.resourceId} IS NOT NULL AND ${t.location} = 'https://media-contract.invalid.test/image/' || ${t.resourceId})) AND (${t.imageUrl} IS NULL OR ${t.imageUrl} ~ '^https://eps-contract[.]invalid[.]test/photo/test_visual_[a-f0-9]{16}[.]png$') AND (${t.maximumUrl} IS NULL OR ${t.maximumUrl} ~ '^https://eps-contract[.]invalid[.]test/photo/test_visual_[a-f0-9]{16}[.]png$') AND (${t.expiresAt} IS NULL OR isfinite(${t.expiresAt})) AND isfinite(${t.createdAt})`),
  check("real_media_receipt_complete", sql`${t.level} <> 'complete' OR (${t.resourceId} IS NOT NULL AND ${t.location} IS NOT NULL AND ${t.imageUrl} IS NOT NULL AND ${t.expiresAt} IS NOT NULL AND ${t.responseStatus} = 201)`),
]);

// Only this current product binding cascades. Immutable evidence never does.
export const ebayRealMediaAssociations = pgTable("ebay_real_media_associations", {
  imageId: text("image_id").primaryKey().references(() => listingImages.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => ebayConnections.id, { onDelete: "cascade" }),
  attemptId: text("attempt_id").notNull(), receiptId: text("receipt_id").notNull(), createdAt: instant("created_at").notNull(),
}, t => [
  foreignKey({ columns: [t.attemptId, t.ownerId], foreignColumns: [ebayRealMediaAttempts.id, ebayRealMediaAttempts.ownerId], name: "real_media_association_owner" }).onDelete("restrict"),
  foreignKey({ columns: [t.receiptId, t.attemptId], foreignColumns: [ebayRealMediaReceipts.id, ebayRealMediaReceipts.attemptId], name: "real_media_association_receipt" }).onDelete("restrict"),
  uniqueIndex("real_media_current_attempt").on(t.attemptId),
  index("real_media_association_owner_idx").on(t.ownerId, t.listingId),
]);
