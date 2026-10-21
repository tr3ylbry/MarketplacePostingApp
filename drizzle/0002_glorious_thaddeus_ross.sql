CREATE TABLE "image_cleanup" (
	"pathname" text PRIMARY KEY NOT NULL,
	"not_before" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"pathname" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "image_uploads_pathname_unique" UNIQUE("pathname"),
	CONSTRAINT "upload_size_valid" CHECK ("image_uploads"."byte_size" > 0 AND "image_uploads"."byte_size" <= 10485760)
);
--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "storage_provider" text;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "pathname" text;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "listing_images" ADD COLUMN "uploaded_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "image_uploads" ADD CONSTRAINT "image_uploads_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_cleanup_due_idx" ON "image_cleanup" USING btree ("not_before");--> statement-breakpoint
CREATE INDEX "image_uploads_listing_idx" ON "image_uploads" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_images_path_idx" ON "listing_images" USING btree ("pathname");--> statement-breakpoint
-- Existing records contain names, not stored bytes. Preserve them explicitly.
UPDATE "listing_images" SET "storage_provider" = 'filename', "original_filename" = "source"->>'name';--> statement-breakpoint
ALTER TABLE "listing_images" ALTER COLUMN "storage_provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_images" ALTER COLUMN "original_filename" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_images" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "image_source_valid" CHECK (("listing_images"."storage_provider" = 'filename' AND "listing_images"."pathname" IS NULL AND "listing_images"."content_type" IS NULL AND "listing_images"."byte_size" IS NULL AND "listing_images"."uploaded_at" IS NULL) OR ("listing_images"."storage_provider" = 'vercel-blob' AND "listing_images"."pathname" IS NOT NULL AND "listing_images"."content_type" IN ('image/jpeg', 'image/png', 'image/webp') AND "listing_images"."content_type" IS NOT NULL AND "listing_images"."byte_size" > 0 AND "listing_images"."byte_size" <= 10485760 AND "listing_images"."byte_size" IS NOT NULL AND "listing_images"."uploaded_at" IS NOT NULL));
