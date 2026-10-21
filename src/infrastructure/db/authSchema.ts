import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";

// Supported Better Auth core schema; dates intentionally use Date mode here.
const instant = (name: string) => timestamp(name, { withTimezone: true });
export const users = pgTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  email: text("email").notNull().unique(), emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"), createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), token: text("token").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: instant("expires_at").notNull(), createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(), ipAddress: text("ip_address"), userAgent: text("user_agent"),
}, table => [index("sessions_user_idx").on(table.userId), check("no_legacy_holder_session", sql`${table.userId} <> 'legacy-unclaimed'`)]);
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: instant("access_token_expires_at"), refreshTokenExpiresAt: instant("refresh_token_expires_at"),
  scope: text("scope"), password: text("password"),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
}, table => [index("accounts_user_idx").on(table.userId), uniqueIndex("accounts_provider_identity_idx").on(table.providerId, table.accountId), check("no_legacy_holder_account", sql`${table.userId} <> 'legacy-unclaimed'`)]);
export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: instant("expires_at").notNull(), createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
}, table => [index("verifications_identifier_idx").on(table.identifier)]);

export const authSchema = { user: users, session: sessions, account: accounts, verification: verifications };
