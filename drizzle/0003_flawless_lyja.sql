CREATE TYPE "public"."reverb_environment" AS ENUM('sandbox', 'live');--> statement-breakpoint
CREATE TABLE "reverb_connections" (
	"owner_id" text NOT NULL,
	"environment" "reverb_environment" NOT NULL,
	"version" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"shop_id" text NOT NULL,
	"shop_name" text NOT NULL,
	"connected_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	CONSTRAINT "reverb_connections_owner_id_environment_pk" PRIMARY KEY("owner_id","environment")
);
--> statement-breakpoint
CREATE TABLE "reverb_draft_requests" (
	"listing_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"environment" "reverb_environment" NOT NULL,
	"shop_id" text NOT NULL,
	"review_id" text NOT NULL,
	"connection_version" text NOT NULL,
	"listing_version" timestamp(3) with time zone NOT NULL,
	"selection" jsonb NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"lease_until" timestamp(3) with time zone,
	"attempt_id" text,
	"post_attempted" boolean DEFAULT false NOT NULL,
	"external_id" text,
	CONSTRAINT "reverb_draft_requests_listing_id_environment_pk" PRIMARY KEY("listing_id","environment"),
	CONSTRAINT "reverb_draft_requests_review_id_unique" UNIQUE("review_id")
);
--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "provider_environment" text;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "provider_shop_id" text;--> statement-breakpoint
ALTER TABLE "reverb_connections" ADD CONSTRAINT "reverb_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverb_draft_requests" ADD CONSTRAINT "reverb_draft_requests_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reverb_draft_requests" ADD CONSTRAINT "reverb_draft_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reverb_requests_owner_idx" ON "reverb_draft_requests" USING btree ("owner_id");