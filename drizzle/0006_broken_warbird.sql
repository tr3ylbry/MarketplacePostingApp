CREATE TABLE "ebay_connections" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"id" text NOT NULL,
	"version" text NOT NULL,
	"config_hash" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"seller_id" text,
	"seller_label" text,
	"access" jsonb,
	"refresh" jsonb,
	"access_expires_at" timestamp(3) with time zone,
	"refresh_expires_at" timestamp(3) with time zone,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"connected_at" timestamp(3) with time zone,
	"lease_token" text,
	"lease_until" timestamp(3) with time zone,
	CONSTRAINT "ebay_connections_id_unique" UNIQUE("id"),
	CONSTRAINT "ebay_sandbox_only" CHECK ("ebay_connections"."environment" = 'sandbox'),
	CONSTRAINT "ebay_connection_status" CHECK ("ebay_connections"."status" IN ('disconnected','connected','reconnect','identity-unverified')),
	CONSTRAINT "ebay_connected_complete" CHECK ("ebay_connections"."status" <> 'connected' OR ("ebay_connections"."seller_id" IS NOT NULL AND "ebay_connections"."seller_label" IS NOT NULL AND "ebay_connections"."access" IS NOT NULL AND "ebay_connections"."refresh" IS NOT NULL AND "ebay_connections"."access_expires_at" IS NOT NULL AND "ebay_connections"."refresh_expires_at" IS NOT NULL AND "ebay_connections"."connected_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ebay_oauth_states" (
	"hash" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"session_hash" text NOT NULL,
	"config_hash" text NOT NULL,
	"connection_version" text NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"consumed_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD CONSTRAINT "ebay_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_oauth_states" ADD CONSTRAINT "ebay_oauth_states_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_seller_owner_unique" ON "ebay_connections" USING btree ("environment","seller_id");--> statement-breakpoint
CREATE INDEX "ebay_states_owner_idx" ON "ebay_oauth_states" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ebay_states_expiry_idx" ON "ebay_oauth_states" USING btree ("expires_at");