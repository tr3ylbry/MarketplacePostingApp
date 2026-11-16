CREATE TABLE "ebay_real_media_associations" (
	"image_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ebay_real_media_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"seller_key" text NOT NULL,
	"identity_version" text DEFAULT 'ebay-sandbox-eias-v1' NOT NULL,
	"session_hash" text NOT NULL,
	"action_hash" text NOT NULL,
	"operation" text NOT NULL,
	"connection_id" text NOT NULL,
	"connection_version" text NOT NULL,
	"config_hash" text NOT NULL,
	"grant_hash" text NOT NULL,
	"listing_id" text NOT NULL,
	"listing_version" timestamp(3) with time zone NOT NULL,
	"image_id" text NOT NULL,
	"image_order" integer NOT NULL,
	"source_version" text NOT NULL,
	"recipe" text NOT NULL,
	"source_digest" text,
	"derivative_digest" text,
	"content_type" text,
	"encoded_size" integer,
	"width" integer,
	"height" integer,
	"state" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"claim_hash" text NOT NULL,
	"lease_until" timestamp(3) with time zone,
	"post_intent_at" timestamp(3) with time zone,
	"reason" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "real_media_context" CHECK ("ebay_real_media_attempts"."environment" = 'sandbox' AND "ebay_real_media_attempts"."identity_version" = 'ebay-sandbox-eias-v1' AND "ebay_real_media_attempts"."operation" IN ('normal','capture-only') AND "ebay_real_media_attempts"."image_order" >= 0 AND "ebay_real_media_attempts"."revision" >= 0),
	CONSTRAINT "real_media_hashes" CHECK ("ebay_real_media_attempts"."seller_key" ~ '^[a-f0-9]{64}$' AND "ebay_real_media_attempts"."session_hash" ~ '^[a-f0-9]{64}$' AND "ebay_real_media_attempts"."action_hash" ~ '^[a-f0-9]{64}$' AND "ebay_real_media_attempts"."config_hash" ~ '^[a-f0-9]{64}$' AND "ebay_real_media_attempts"."grant_hash" ~ '^[a-f0-9]{64}$' AND "ebay_real_media_attempts"."source_version" ~ '^[a-f0-9]{64}$' AND "ebay_real_media_attempts"."claim_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "real_media_bounds" CHECK (length("ebay_real_media_attempts"."owner_id") BETWEEN 1 AND 200 AND length("ebay_real_media_attempts"."id") BETWEEN 1 AND 200 AND length("ebay_real_media_attempts"."listing_id") BETWEEN 1 AND 200 AND length("ebay_real_media_attempts"."image_id") BETWEEN 1 AND 200 AND length("ebay_real_media_attempts"."connection_id") BETWEEN 1 AND 200 AND length("ebay_real_media_attempts"."connection_version") BETWEEN 1 AND 200 AND length("ebay_real_media_attempts"."recipe") BETWEEN 1 AND 1024 AND "ebay_real_media_attempts"."recipe" ~ '^[ -~]+$'),
	CONSTRAINT "real_media_fence_shape" CHECK (("ebay_real_media_attempts"."post_intent_at" IS NULL AND "ebay_real_media_attempts"."state" IN ('preparing','not-sent') AND "ebay_real_media_attempts"."source_digest" IS NULL AND "ebay_real_media_attempts"."derivative_digest" IS NULL AND "ebay_real_media_attempts"."encoded_size" IS NULL AND "ebay_real_media_attempts"."content_type" IS NULL AND "ebay_real_media_attempts"."width" IS NULL AND "ebay_real_media_attempts"."height" IS NULL) OR ("ebay_real_media_attempts"."post_intent_at" IS NOT NULL AND "ebay_real_media_attempts"."state" IN ('unknown','confirmed','residual') AND "ebay_real_media_attempts"."source_digest" IS NOT NULL AND "ebay_real_media_attempts"."derivative_digest" IS NOT NULL AND "ebay_real_media_attempts"."encoded_size" IS NOT NULL AND "ebay_real_media_attempts"."content_type" IS NOT NULL AND "ebay_real_media_attempts"."width" IS NOT NULL AND "ebay_real_media_attempts"."height" IS NOT NULL)),
	CONSTRAINT "real_media_content" CHECK (("ebay_real_media_attempts"."source_digest" IS NULL OR "ebay_real_media_attempts"."source_digest" ~ '^[a-f0-9]{64}$') AND ("ebay_real_media_attempts"."derivative_digest" IS NULL OR "ebay_real_media_attempts"."derivative_digest" ~ '^[a-f0-9]{64}$') AND ("ebay_real_media_attempts"."content_type" IS NULL OR "ebay_real_media_attempts"."content_type" IN ('image/jpeg','image/png')) AND ("ebay_real_media_attempts"."encoded_size" IS NULL OR "ebay_real_media_attempts"."encoded_size" BETWEEN 1 AND 10485760) AND ("ebay_real_media_attempts"."width" IS NULL OR "ebay_real_media_attempts"."width" BETWEEN 1 AND 4096) AND ("ebay_real_media_attempts"."height" IS NULL OR "ebay_real_media_attempts"."height" BETWEEN 1 AND 4096) AND ("ebay_real_media_attempts"."width" IS NULL OR greatest("ebay_real_media_attempts"."width","ebay_real_media_attempts"."height") >= 500 AND "ebay_real_media_attempts"."width"::bigint * "ebay_real_media_attempts"."height" <= 16777216)),
	CONSTRAINT "real_media_reason" CHECK ("ebay_real_media_attempts"."reason" IS NULL OR "ebay_real_media_attempts"."reason" IN ('preparation','response','changed','conflict','expired')),
	CONSTRAINT "real_media_times" CHECK (isfinite("ebay_real_media_attempts"."created_at") AND isfinite("ebay_real_media_attempts"."updated_at") AND isfinite("ebay_real_media_attempts"."listing_version") AND ("ebay_real_media_attempts"."post_intent_at" IS NULL OR isfinite("ebay_real_media_attempts"."post_intent_at")) AND ("ebay_real_media_attempts"."lease_until" IS NULL OR isfinite("ebay_real_media_attempts"."lease_until")) AND ("ebay_real_media_attempts"."state" <> 'preparing' OR "ebay_real_media_attempts"."lease_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ebay_real_media_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"level" text NOT NULL,
	"resource_id" text,
	"location" text,
	"image_url" text,
	"maximum_url" text,
	"expires_at" timestamp(3) with time zone,
	"response_status" integer,
	"created_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "real_media_receipt_contract" CHECK ("ebay_real_media_receipts"."contract_version" = 'synthetic-real-media-v1' AND current_database() ~ '^marketplace_real_media_[a-f0-9]{24}_test$'),
	CONSTRAINT "real_media_receipt_level" CHECK ("ebay_real_media_receipts"."level" IN ('partial','complete','conflict') AND "ebay_real_media_receipts"."fingerprint" ~ '^[a-f0-9]{64}$' AND ("ebay_real_media_receipts"."response_status" IS NULL OR "ebay_real_media_receipts"."response_status" BETWEEN 100 AND 599)),
	CONSTRAINT "real_media_receipt_fields" CHECK (("ebay_real_media_receipts"."resource_id" IS NULL OR "ebay_real_media_receipts"."resource_id" ~ '^test_resource_[a-f0-9]{16}$') AND ("ebay_real_media_receipts"."location" IS NULL OR ("ebay_real_media_receipts"."resource_id" IS NOT NULL AND "ebay_real_media_receipts"."location" = 'https://media-contract.invalid.test/image/' || "ebay_real_media_receipts"."resource_id")) AND ("ebay_real_media_receipts"."image_url" IS NULL OR "ebay_real_media_receipts"."image_url" ~ '^https://eps-contract[.]invalid[.]test/photo/test_visual_[a-f0-9]{16}[.]png$') AND ("ebay_real_media_receipts"."maximum_url" IS NULL OR "ebay_real_media_receipts"."maximum_url" ~ '^https://eps-contract[.]invalid[.]test/photo/test_visual_[a-f0-9]{16}[.]png$') AND ("ebay_real_media_receipts"."expires_at" IS NULL OR isfinite("ebay_real_media_receipts"."expires_at")) AND isfinite("ebay_real_media_receipts"."created_at")),
	CONSTRAINT "real_media_receipt_complete" CHECK ("ebay_real_media_receipts"."level" <> 'complete' OR ("ebay_real_media_receipts"."resource_id" IS NOT NULL AND "ebay_real_media_receipts"."location" IS NOT NULL AND "ebay_real_media_receipts"."image_url" IS NOT NULL AND "ebay_real_media_receipts"."expires_at" IS NOT NULL AND "ebay_real_media_receipts"."response_status" = 201))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_attempt_owner_key" ON "ebay_real_media_attempts" USING btree ("id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_receipt_identity" ON "ebay_real_media_receipts" USING btree ("id","attempt_id");--> statement-breakpoint
ALTER TABLE "ebay_real_media_associations" ADD CONSTRAINT "ebay_real_media_associations_image_id_listing_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."listing_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_real_media_associations" ADD CONSTRAINT "ebay_real_media_associations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_real_media_associations" ADD CONSTRAINT "ebay_real_media_associations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_real_media_associations" ADD CONSTRAINT "ebay_real_media_associations_connection_id_ebay_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ebay_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_real_media_associations" ADD CONSTRAINT "real_media_association_owner" FOREIGN KEY ("attempt_id","owner_id") REFERENCES "public"."ebay_real_media_attempts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_real_media_associations" ADD CONSTRAINT "real_media_association_receipt" FOREIGN KEY ("receipt_id","attempt_id") REFERENCES "public"."ebay_real_media_receipts"("id","attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_real_media_attempts" ADD CONSTRAINT "ebay_real_media_attempts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_real_media_receipts" ADD CONSTRAINT "ebay_real_media_receipts_attempt_id_ebay_real_media_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."ebay_real_media_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_current_attempt" ON "ebay_real_media_associations" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "real_media_association_owner_idx" ON "ebay_real_media_associations" USING btree ("owner_id","listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_claim_key" ON "ebay_real_media_attempts" USING btree ("owner_id","environment","listing_id","image_id") WHERE "ebay_real_media_attempts"."state" = 'preparing';--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_action_key" ON "ebay_real_media_attempts" USING btree ("owner_id","action_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_source_fence" ON "ebay_real_media_attempts" USING btree ("environment","seller_key","source_digest") WHERE "ebay_real_media_attempts"."post_intent_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_derivative_fence" ON "ebay_real_media_attempts" USING btree ("environment","seller_key","derivative_digest") WHERE "ebay_real_media_attempts"."post_intent_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "real_media_owner_created" ON "ebay_real_media_attempts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "real_media_receipt_repeat" ON "ebay_real_media_receipts" USING btree ("attempt_id","fingerprint");--> statement-breakpoint
-- SQL-owned snapshot hashes avoid duplicating private metadata in evidence.
CREATE FUNCTION public.real_media_source_version(p_id text) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(i.storage_provider,i.pathname,i.original_filename,i.content_type,i.byte_size,extract(epoch FROM i.uploaded_at))::text,'UTF8')),'hex')
 FROM public.listing_images i WHERE i.id = p_id
$$;
--> statement-breakpoint
CREATE FUNCTION public.real_media_grant_version(p_scopes text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT encode(sha256(convert_to(to_jsonb(p_scopes)::text,'UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION public.real_media_immutable_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'Media evidence is immutable'; END IF;
 IF TG_OP = 'DELETE' THEN
  IF OLD.post_intent_at IS NOT NULL THEN RAISE EXCEPTION 'Media evidence is immutable'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.revision <> OLD.revision + 1 OR NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'Invalid media revision'; END IF;
 IF OLD.post_intent_at IS NOT NULL AND
  (to_jsonb(NEW) - ARRAY['state','revision','lease_until','updated_at','reason']) IS DISTINCT FROM
  (to_jsonb(OLD) - ARRAY['state','revision','lease_until','updated_at','reason']) THEN
  RAISE EXCEPTION 'Media evidence is immutable';
 END IF;
 IF NEW.state IN ('confirmed','residual') AND NOT EXISTS (SELECT 1 FROM public.ebay_real_media_receipts WHERE attempt_id=NEW.id AND level='complete') THEN
  RAISE EXCEPTION 'Complete media state requires a receipt';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER real_media_attempt_immutable BEFORE UPDATE OR DELETE ON public.ebay_real_media_attempts FOR EACH ROW EXECUTE FUNCTION public.real_media_immutable_attempt();
--> statement-breakpoint
CREATE TRIGGER real_media_attempt_no_truncate BEFORE TRUNCATE ON public.ebay_real_media_attempts FOR EACH STATEMENT EXECUTE FUNCTION public.real_media_immutable_attempt();
--> statement-breakpoint
CREATE FUNCTION public.real_media_immutable_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Media evidence is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.ebay_real_media_attempts a WHERE a.id = NEW.attempt_id AND a.post_intent_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Media receipt requires send intent';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER real_media_receipt_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_real_media_receipts FOR EACH ROW EXECUTE FUNCTION public.real_media_immutable_receipt();
--> statement-breakpoint
CREATE TRIGGER real_media_receipt_no_truncate BEFORE TRUNCATE ON public.ebay_real_media_receipts FOR EACH STATEMENT EXECUTE FUNCTION public.real_media_immutable_receipt();
--> statement-breakpoint
CREATE FUNCTION public.real_media_current_association() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.ebay_real_media_attempts a
  JOIN public.ebay_real_media_receipts r ON r.id=NEW.receipt_id AND r.attempt_id=a.id
  JOIN public.listings l ON l.id=a.listing_id AND l.owner_id=a.owner_id
  JOIN public.listing_images i ON i.id=a.image_id AND i.listing_id=l.id
  JOIN public.ebay_connections c ON c.owner_id=a.owner_id
  WHERE a.id=NEW.attempt_id AND a.owner_id=NEW.owner_id AND a.listing_id=NEW.listing_id AND a.image_id=NEW.image_id
   AND a.connection_id=NEW.connection_id AND a.environment='sandbox' AND a.operation='normal' AND a.state='confirmed' AND a.post_intent_at IS NOT NULL
   AND l.updated_at=a.listing_version AND i.sort_order=a.image_order AND public.real_media_source_version(i.id)=a.source_version
   AND i.storage_provider='vercel-blob' AND i.content_type=a.content_type
   AND c.id=a.connection_id AND c.version=a.connection_version AND c.seller_id=a.seller_key AND c.config_hash=a.config_hash
   AND c.environment='sandbox' AND c.status='connected' AND c.access IS NOT NULL AND c.refresh IS NOT NULL
   AND c.refresh_expires_at > clock_timestamp() AND public.real_media_grant_version(c.scopes)=a.grant_hash
   AND r.level='complete' AND r.response_status=201 AND r.expires_at > clock_timestamp() + interval '60 seconds'
   AND NOT EXISTS (SELECT 1 FROM public.ebay_real_media_receipts s WHERE s.attempt_id=a.id AND
    (s.level='conflict' OR (s.resource_id IS NOT NULL AND r.resource_id IS NOT NULL AND s.resource_id<>r.resource_id)
     OR (s.location IS NOT NULL AND r.location IS NOT NULL AND s.location<>r.location)
     OR (s.image_url IS NOT NULL AND r.image_url IS NOT NULL AND s.image_url<>r.image_url)
     OR (s.maximum_url IS NOT NULL AND r.maximum_url IS NOT NULL AND s.maximum_url<>r.maximum_url)
     OR (s.expires_at IS NOT NULL AND r.expires_at IS NOT NULL AND s.expires_at<>r.expires_at)
     OR (s.response_status IS NOT NULL AND r.response_status IS NOT NULL AND s.response_status<>r.response_status)))
 ) THEN RAISE EXCEPTION 'Media association is stale or unverified'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER real_media_association_current BEFORE INSERT OR UPDATE ON public.ebay_real_media_associations FOR EACH ROW EXECUTE FUNCTION public.real_media_current_association();
