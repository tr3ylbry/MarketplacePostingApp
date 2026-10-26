CREATE TABLE "reverb_management_leases" (
	"listing_id" text NOT NULL,
	"environment" "reverb_environment" NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "reverb_management_leases_listing_id_environment_pk" PRIMARY KEY("listing_id","environment")
);
--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "provider_state" text;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD COLUMN "provider_checked_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "reverb_management_leases" ADD CONSTRAINT "reverb_management_leases_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "publication_provider_state_valid" CHECK ("marketplace_listings"."provider_state" IS NULL OR "marketplace_listings"."provider_state" ~ '^[a-z][a-z0-9_-]{0,63}$');