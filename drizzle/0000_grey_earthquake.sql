CREATE TYPE "public"."listing_status" AS ENUM('draft', 'active', 'sold', 'archived');--> statement-breakpoint
CREATE TYPE "public"."marketplace" AS ENUM('ebay', 'craigslist', 'reverb', 'offerup', 'facebook-marketplace');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'ready', 'published', 'sold', 'error', 'needs-renewal');--> statement-breakpoint
CREATE TABLE "listing_images" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"source" jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"alt_text" text,
	CONSTRAINT "image_order_nonnegative" CHECK ("listing_images"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"asking_price_amount" numeric NOT NULL,
	"currency" text NOT NULL,
	"acquisition_cost_amount" numeric,
	"shipping_rate_amount" numeric,
	"condition" text NOT NULL,
	"category" text NOT NULL,
	"status" "listing_status" NOT NULL,
	"attributes" jsonb NOT NULL,
	"marketplace_details" jsonb NOT NULL,
	"selected_platforms" "marketplace"[] NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "listing_usd" CHECK ("listings"."currency" = 'USD'),
	CONSTRAINT "listing_price_positive" CHECK ("listings"."asking_price_amount" > 0 AND "listings"."asking_price_amount" < 'Infinity'::numeric),
	CONSTRAINT "listing_cost_nonnegative" CHECK ("listings"."acquisition_cost_amount" >= 0 AND "listings"."acquisition_cost_amount" < 'Infinity'::numeric),
	CONSTRAINT "listing_shipping_nonnegative" CHECK ("listings"."shipping_rate_amount" >= 0 AND "listings"."shipping_rate_amount" < 'Infinity'::numeric)
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"status" "publication_status" NOT NULL,
	"external_listing_id" text,
	"external_url" text,
	"price_override_amount" numeric,
	"price_override_currency" text,
	"published_at" timestamp(3) with time zone,
	"last_synced_at" timestamp(3) with time zone,
	CONSTRAINT "publication_price_valid" CHECK (("marketplace_listings"."price_override_amount" IS NULL AND "marketplace_listings"."price_override_currency" IS NULL) OR ("marketplace_listings"."price_override_amount" IS NOT NULL AND "marketplace_listings"."price_override_currency" IS NOT NULL AND "marketplace_listings"."price_override_amount" >= 0 AND "marketplace_listings"."price_override_amount" < 'Infinity'::numeric AND "marketplace_listings"."price_override_currency" = 'USD'))
);
--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_images_order_idx" ON "listing_images" USING btree ("listing_id","sort_order");--> statement-breakpoint
CREATE INDEX "listings_created_idx" ON "listings" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "publications_listing_idx" ON "marketplace_listings" USING btree ("listing_id");