import { sql } from "drizzle-orm";
import { pgTable, text, numeric, timestamp, jsonb, integer, index, uniqueIndex, check, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./authSchema";
export { users, sessions, accounts, verifications } from "./authSchema";

export const listingStatus = pgEnum("listing_status", ["draft", "active", "sold", "archived"]);
export const marketplace = pgEnum("marketplace", ["ebay", "craigslist", "reverb", "offerup", "facebook-marketplace"]);
export const publicationStatus = pgEnum("publication_status", ["draft", "ready", "published", "sold", "error", "needs-renewal"]);
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string", precision: 3 });

export const listings = pgTable("listings", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(), description: text("description").notNull(),
  askingPriceAmount: numeric("asking_price_amount").notNull(), currency: text("currency").notNull(),
  acquisitionCostAmount: numeric("acquisition_cost_amount"), shippingRateAmount: numeric("shipping_rate_amount"),
  condition: text("condition").notNull(), category: text("category").notNull(),
  status: listingStatus("status").notNull(),
  attributes: jsonb("attributes").notNull(), marketplaceDetails: jsonb("marketplace_details").notNull(),
  selectedPlatforms: marketplace("selected_platforms").array().notNull(),
  createdAt: instant("created_at").notNull(), updatedAt: instant("updated_at").notNull(),
}, table => [
  index("listings_created_idx").on(table.createdAt, table.id),
  index("listings_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
  check("listing_usd", sql`${table.currency} = 'USD'`),
  check("listing_price_positive", sql`${table.askingPriceAmount} > 0 AND ${table.askingPriceAmount} < 'Infinity'::numeric`),
  check("listing_cost_nonnegative", sql`${table.acquisitionCostAmount} >= 0 AND ${table.acquisitionCostAmount} < 'Infinity'::numeric`),
  check("listing_shipping_nonnegative", sql`${table.shippingRateAmount} >= 0 AND ${table.shippingRateAmount} < 'Infinity'::numeric`),
]);

export const listingImages = pgTable("listing_images", {
  id: text("id").primaryKey(), listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  storageProvider: text("storage_provider").notNull(), pathname: text("pathname"),
  originalFilename: text("original_filename").notNull(), contentType: text("content_type"), byteSize: integer("byte_size"),
  uploadedAt: instant("uploaded_at"),
  order: integer("sort_order").notNull(), altText: text("alt_text"),
}, table => [
  uniqueIndex("listing_images_order_idx").on(table.listingId, table.order),
  uniqueIndex("listing_images_path_idx").on(table.pathname),
  check("image_order_nonnegative", sql`${table.order} >= 0`),
  check("image_source_valid", sql`(${table.storageProvider} = 'filename' AND ${table.pathname} IS NULL AND ${table.contentType} IS NULL AND ${table.byteSize} IS NULL AND ${table.uploadedAt} IS NULL) OR (${table.storageProvider} = 'vercel-blob' AND ${table.pathname} IS NOT NULL AND ${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp') AND ${table.contentType} IS NOT NULL AND ${table.byteSize} > 0 AND ${table.byteSize} <= 10485760 AND ${table.byteSize} IS NOT NULL AND ${table.uploadedAt} IS NOT NULL)`),
]);

// Reservations are not visible images. Expired reservations do not consume slots.
export const imageUploads = pgTable("image_uploads", {
  id: text("id").primaryKey(), listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  pathname: text("pathname").notNull().unique(), filename: text("filename").notNull(),
  contentType: text("content_type").notNull(), size: integer("byte_size").notNull(), expiresAt: instant("expires_at").notNull(),
}, table => [index("image_uploads_listing_idx").on(table.listingId), check("upload_size_valid", sql`${table.size} > 0 AND ${table.size} <= 10485760`)]);

// Durable retry ledger, not a background job system. Survives parent deletion.
export const imageCleanup = pgTable("image_cleanup", {
  pathname: text("pathname").primaryKey(), notBefore: instant("not_before").notNull(),
}, table => [index("image_cleanup_due_idx").on(table.notBefore)]);

export const marketplaceListings = pgTable("marketplace_listings", {
  id: text("id").primaryKey(), listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  marketplace: marketplace("marketplace").notNull(), status: publicationStatus("status").notNull(),
  externalListingId: text("external_listing_id"), externalUrl: text("external_url"),
  priceOverrideAmount: numeric("price_override_amount"), priceOverrideCurrency: text("price_override_currency"),
  publishedAt: instant("published_at"), lastSyncedAt: instant("last_synced_at"),
}, table => [
  index("publications_listing_idx").on(table.listingId),
  check("publication_price_valid", sql`(${table.priceOverrideAmount} IS NULL AND ${table.priceOverrideCurrency} IS NULL) OR (${table.priceOverrideAmount} IS NOT NULL AND ${table.priceOverrideCurrency} IS NOT NULL AND ${table.priceOverrideAmount} >= 0 AND ${table.priceOverrideAmount} < 'Infinity'::numeric AND ${table.priceOverrideCurrency} = 'USD')`),
]);
