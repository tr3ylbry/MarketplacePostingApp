import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./authSchema";
import type { TokenEnvelope } from "../../application/ebayConnection";
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "string", precision: 3 });
// Tombstones survive disconnect to fence callbacks/refreshes already in flight.
export const ebayConnections = pgTable("ebay_connections", {
  ownerId: text("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  environment: text("environment").notNull().default("sandbox"),
  id: text("id").notNull().unique(), version: text("version").notNull(), configHash: text("config_hash").notNull(),
  status: text("status").notNull().default("disconnected"),
  sellerId: text("seller_id"), sellerLabel: text("seller_label"),
  access: jsonb("access").$type<TokenEnvelope>(), refresh: jsonb("refresh").$type<TokenEnvelope>(),
  accessExpiresAt: instant("access_expires_at"), refreshExpiresAt: instant("refresh_expires_at"),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`), connectedAt: instant("connected_at"),
  leaseToken: text("lease_token"), leaseUntil: instant("lease_until"),
}, t => [
  check("ebay_sandbox_only", sql`${t.environment} = 'sandbox'`),
  check("ebay_connection_status", sql`${t.status} IN ('disconnected','connected','reconnect','identity-unverified')`),
  check("ebay_connected_complete", sql`${t.status} <> 'connected' OR (${t.sellerId} IS NOT NULL AND ${t.sellerLabel} IS NOT NULL AND ${t.access} IS NOT NULL AND ${t.refresh} IS NOT NULL AND ${t.accessExpiresAt} IS NOT NULL AND ${t.refreshExpiresAt} IS NOT NULL AND ${t.connectedAt} IS NOT NULL)`),
  uniqueIndex("ebay_seller_owner_unique").on(t.environment, t.sellerId),
]);
export const ebayOauthStates = pgTable("ebay_oauth_states", {
  hash: text("hash").primaryKey(), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull(), configHash: text("config_hash").notNull(),
  connectionVersion: text("connection_version").notNull(), expiresAt: instant("expires_at").notNull(), consumedAt: instant("consumed_at"),
}, t => [index("ebay_states_owner_idx").on(t.ownerId), index("ebay_states_expiry_idx").on(t.expiresAt)]);
