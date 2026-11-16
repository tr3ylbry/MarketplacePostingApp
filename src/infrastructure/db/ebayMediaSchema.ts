import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, boolean, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./authSchema";
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string", precision: 3 });

// Independent evidence: no cascade from listings/images/connections. Simulation
// is enforced in SQL; these records cannot be mistaken for real EPS exports.
export const ebayMediaAttempts = pgTable("ebay_media_attempts", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  environment: text("environment").notNull().default("sandbox"), simulation: boolean("simulation").notNull().default(true),
  sellerId: text("seller_id").notNull(), listingId: text("listing_id").notNull(), imageId: text("image_id").notNull(),
  listingVersion: instant("listing_version").notNull(), connectionId: text("connection_id").notNull(), connectionVersion: text("connection_version").notNull(), configHash: text("config_hash").notNull(),
  sourceMetadataHash: text("source_metadata_hash").notNull(), sourceDigest: text("source_digest"), exportDigest: text("export_digest"),
  transformationVersion: text("transformation_version").notNull(), exportSize: integer("export_size"),
  state: text("state").notNull(), leaseToken: text("lease_token").notNull(), leaseUntil: instant("lease_until"), postAttemptedAt: instant("post_attempted_at"),
  returnedImageId: text("returned_image_id"), imageUrl: text("image_url"), expiresAt: instant("expires_at"), responseStatus: integer("response_status"), reason: text("reason"),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, t => [
  uniqueIndex("ebay_media_source_fence_idx").on(t.ownerId, t.environment, t.sellerId, t.imageId),
  index("ebay_media_owner_idx").on(t.ownerId, t.createdAt),
  check("ebay_media_simulation_only", sql`${t.environment} = 'sandbox' AND ${t.simulation} = true`),
  check("ebay_media_state", sql`${t.state} IN ('preparing','not-sent','unknown','confirmed','residual')`),
  check("ebay_media_recipe", sql`${t.transformationVersion} = 'generated-fixture-v1'`),
  check("ebay_media_fence", sql`(${t.state} IN ('preparing','not-sent') AND ${t.postAttemptedAt} IS NULL) OR (${t.state} IN ('unknown','confirmed','residual') AND ${t.postAttemptedAt} IS NOT NULL AND ${t.sourceDigest} IS NOT NULL AND ${t.exportDigest} IS NOT NULL)`),
  check("ebay_media_confirmed", sql`${t.state} NOT IN ('confirmed','residual') OR (${t.returnedImageId} IS NOT NULL AND ${t.imageUrl} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)`),
  check("ebay_media_size", sql`${t.exportSize} IS NULL OR (${t.exportSize} > 0 AND ${t.exportSize} <= 1048576)`),
  check("ebay_media_digest", sql`${t.sourceMetadataHash} ~ '^[a-f0-9]{64}$' AND (${t.sourceDigest} IS NULL OR ${t.sourceDigest} ~ '^[a-f0-9]{64}$') AND (${t.exportDigest} IS NULL OR ${t.exportDigest} ~ '^[a-f0-9]{64}$')`),
  check("ebay_media_fixture_identity", sql`(${t.returnedImageId} IS NULL OR ${t.returnedImageId} ~ '^fake_[a-f0-9]{32}$') AND (${t.imageUrl} IS NULL OR ${t.imageUrl} ~ '^http://127[.]0[.]0[.]1:4313/eps/fake_[a-f0-9]{32}[.]png$')`),
]);
