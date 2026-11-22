-- Fixed diagnostic contract, not a selectable policy registry or network grant.
CREATE FUNCTION public.image_verification_policy_cutoff() RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT '2027-02-20T20:31:27.970Z'::timestamptz
$$;
--> statement-breakpoint
CREATE FUNCTION public.image_verification_profile_valid(c text,v text,h text,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce(c='diagnostic-image-get-v1' AND v='iana-image-address-v1-2026-11-22' AND
 h='e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887' AND isfinite(at_time) AND
 at_time>='2026-11-22T20:31:28.569Z'::timestamptz AND at_time<public.image_verification_policy_cutoff(),false)
$$;
--> statement-breakpoint
CREATE FUNCTION public.image_verification_envelope_valid(e jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
BEGIN
 IF e IS NULL OR jsonb_typeof(e)<>'object' OR octet_length(e::text)>2048 OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM
  ARRAY['bytes','event','exceeded','httpStatus','mime','reason','settlement','version'] THEN RETURN false; END IF;
 IF e->>'version'<>'diagnostic-verification-v1' OR e->>'event' NOT IN ('response','cancelled','failure','settlement') OR
  e->>'reason' NOT IN ('bounded-response','cancelled','transport','policy','context','deadline','unavailable','headers','body','status','settled','protocol') OR
  e->>'settlement' NOT IN ('settled','unsettled') OR jsonb_typeof(e->'exceeded')<>'boolean' OR
  jsonb_typeof(e->'bytes')<>'number' OR (e->>'bytes')!~'^(0|[1-9][0-9]{0,6})$' OR (e->>'bytes')::integer>1048576 OR
  (e->'httpStatus'<>'null'::jsonb AND (jsonb_typeof(e->'httpStatus')<>'number' OR (e->>'httpStatus')!~'^[1-5][0-9]{2}$')) OR
  (e->'mime'<>'null'::jsonb AND (jsonb_typeof(e->'mime')<>'string' OR e->>'mime' NOT IN ('image/png','image/jpeg'))) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(e) p WHERE p.key IN ('version','event','reason','settlement') AND jsonb_typeof(p.value)<>'string') THEN RETURN false; END IF;
 IF e->>'event'='response' AND (e->>'settlement'<>'settled' OR e->'httpStatus'='null'::jsonb OR e->>'reason' NOT IN ('bounded-response','headers','body','status')) OR
  e->>'event'='cancelled' AND (e->>'reason'<>'cancelled' OR e->>'settlement'<>'unsettled') OR
  e->>'event'='settlement' AND (e->>'reason'<>'settled' OR e->>'settlement'<>'settled') THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE "ebay_image_verification_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"verification_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"intent_revision" integer,
	"envelope" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"late" boolean NOT NULL,
	"protocol_conflict" boolean NOT NULL,
	"recorded_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "image_verification_outcome_shape" CHECK ("ebay_image_verification_outcomes"."id" ~ '^[A-Za-z0-9_-]{1,200}$' AND ("ebay_image_verification_outcomes"."intent_revision" IS NULL OR "ebay_image_verification_outcomes"."intent_revision"=1) AND "ebay_image_verification_outcomes"."fingerprint" ~ '^[a-f0-9]{64}$' AND isfinite("ebay_image_verification_outcomes"."recorded_at") AND public.image_verification_envelope_valid("ebay_image_verification_outcomes"."envelope"))
);
--> statement-breakpoint
CREATE TABLE "ebay_image_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"upload_attempt_id" text NOT NULL,
	"action_hash" text NOT NULL,
	"expected_source_digest" text NOT NULL,
	"expected_derivative_digest" text NOT NULL,
	"parent_preparing_revision" integer NOT NULL,
	"target_field" text DEFAULT 'imageUrl' NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"contract_version" text NOT NULL,
	"address_policy_version" text NOT NULL,
	"address_policy_data_hash" text NOT NULL,
	"phase" text DEFAULT 'prepared' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp(6) with time zone NOT NULL,
	"review_until" timestamp(6) with time zone NOT NULL,
	"request_intent_at" timestamp(6) with time zone,
	"response_received_at" timestamp(6) with time zone,
	"provider_expires_at" timestamp(6) with time zone,
	"use_until" timestamp(6) with time zone,
	"request_deadline" timestamp(6) with time zone,
	"close_reason" text,
	"evidence_overflow" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(6) with time zone NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"review_due_at" timestamp(6) with time zone NOT NULL,
	"disposition_due_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "image_verification_profile" CHECK ("ebay_image_verifications"."method"='GET' AND "ebay_image_verifications"."target_field"='imageUrl' AND "ebay_image_verifications"."contract_version"='diagnostic-image-get-v1' AND "ebay_image_verifications"."address_policy_version"='iana-image-address-v1-2026-11-22' AND "ebay_image_verifications"."address_policy_data_hash"='e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887'),
	CONSTRAINT "image_verification_bounds" CHECK ("ebay_image_verifications"."id" ~ '^[A-Za-z0-9_-]{1,200}$' AND length("ebay_image_verifications"."owner_id") BETWEEN 1 AND 200 AND "ebay_image_verifications"."upload_attempt_id" ~ '^[A-Za-z0-9_-]{1,200}$' AND "ebay_image_verifications"."action_hash" ~ '^[a-f0-9]{64}$' AND "ebay_image_verifications"."expected_source_digest" ~ '^[a-f0-9]{64}$' AND "ebay_image_verifications"."expected_derivative_digest" ~ '^[a-f0-9]{64}$' AND "ebay_image_verifications"."parent_preparing_revision" >= 0 AND "ebay_image_verifications"."revision" >= 0),
	CONSTRAINT "image_verification_phase" CHECK ("ebay_image_verifications"."phase" IN ('prepared','closed','intent-recorded') AND ("ebay_image_verifications"."close_reason" IS NULL OR "ebay_image_verifications"."close_reason" IN ('cancelled','expired','changed','preparation-failed','evidence-before-intent')) AND (("ebay_image_verifications"."phase"='closed')=("ebay_image_verifications"."close_reason" IS NOT NULL))),
	CONSTRAINT "image_verification_intent_shape" CHECK (("ebay_image_verifications"."phase"<>'intent-recorded' AND "ebay_image_verifications"."request_intent_at" IS NULL AND "ebay_image_verifications"."response_received_at" IS NULL AND "ebay_image_verifications"."provider_expires_at" IS NULL AND "ebay_image_verifications"."use_until" IS NULL AND "ebay_image_verifications"."request_deadline" IS NULL) OR ("ebay_image_verifications"."phase"='intent-recorded' AND "ebay_image_verifications"."request_intent_at" IS NOT NULL AND "ebay_image_verifications"."response_received_at" IS NOT NULL AND "ebay_image_verifications"."provider_expires_at" IS NOT NULL AND "ebay_image_verifications"."use_until" IS NOT NULL AND "ebay_image_verifications"."request_deadline" IS NOT NULL AND "ebay_image_verifications"."request_deadline">"ebay_image_verifications"."request_intent_at" AND "ebay_image_verifications"."request_deadline"<="ebay_image_verifications"."use_until")),
	CONSTRAINT "image_verification_times" CHECK (isfinite("ebay_image_verifications"."created_at") AND isfinite("ebay_image_verifications"."updated_at") AND isfinite("ebay_image_verifications"."review_until") AND isfinite("ebay_image_verifications"."lease_until") AND isfinite("ebay_image_verifications"."review_due_at") AND isfinite("ebay_image_verifications"."disposition_due_at") AND ("ebay_image_verifications"."request_intent_at" IS NULL OR isfinite("ebay_image_verifications"."request_intent_at") AND isfinite("ebay_image_verifications"."response_received_at") AND isfinite("ebay_image_verifications"."provider_expires_at") AND isfinite("ebay_image_verifications"."use_until") AND isfinite("ebay_image_verifications"."request_deadline")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "image_verification_owner_key" ON "ebay_image_verifications" USING btree ("id","owner_id");--> statement-breakpoint
ALTER TABLE "ebay_image_verification_outcomes" ADD CONSTRAINT "image_verification_outcome_owner" FOREIGN KEY ("verification_id","owner_id") REFERENCES "public"."ebay_image_verifications"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_image_verifications" ADD CONSTRAINT "image_verification_parent_owner" FOREIGN KEY ("upload_attempt_id","owner_id") REFERENCES "public"."ebay_real_media_attempts"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_verification_outcome_repeat" ON "ebay_image_verification_outcomes" USING btree ("verification_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "image_verification_parent_key" ON "ebay_image_verifications" USING btree ("upload_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "image_verification_action_key" ON "ebay_image_verifications" USING btree ("owner_id","action_hash");--> statement-breakpoint
CREATE INDEX "image_verification_owner_created" ON "ebay_image_verifications" USING btree ("owner_id","created_at");
--> statement-breakpoint
-- No external operation in these functions. SQL locks use the media order;
-- direct statements with a different lock order fail fast, never wait backwards.
CREATE FUNCTION public.image_verification_lock_context(p_parent text,p_owner text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.ebay_real_media_attempts;
BEGIN
 SELECT * INTO a FROM public.ebay_real_media_attempts WHERE id=p_parent AND owner_id=p_owner;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Diagnostic persistence refused'; END IF;
 PERFORM id FROM public.listings WHERE id=a.listing_id AND owner_id=a.owner_id FOR UPDATE NOWAIT;
 PERFORM owner_id FROM public.ebay_connections WHERE owner_id=a.owner_id FOR UPDATE NOWAIT;
 PERFORM id FROM public.listing_images WHERE id=a.image_id AND listing_id=a.listing_id FOR UPDATE NOWAIT;
 PERFORM id FROM public.sessions WHERE user_id=a.owner_id AND public.capture_session_hash(a.owner_id,id)=a.session_hash FOR SHARE NOWAIT;
 PERFORM id FROM public.ebay_real_media_attempts WHERE id=a.id AND owner_id=a.owner_id FOR UPDATE NOWAIT;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.image_verification_context_current(p_parent text,p_owner text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.ebay_real_media_attempts a
 JOIN public.listings l ON l.id=a.listing_id AND l.owner_id=a.owner_id AND l.updated_at=a.listing_version
 JOIN public.ebay_connections c ON c.owner_id=a.owner_id AND c.id=a.connection_id AND c.version=a.connection_version AND c.config_hash=a.config_hash
 JOIN public.listing_images i ON i.id=a.image_id AND i.listing_id=a.listing_id AND i.sort_order=a.image_order
 WHERE a.id=p_parent AND a.owner_id=p_owner AND a.operation='capture-only' AND a.environment='sandbox' AND a.state IN ('preparing','unknown')
 AND a.lease_until>clock_timestamp() AND c.environment='sandbox' AND c.status='connected' AND c.seller_id=a.seller_key
 AND c.access IS NOT NULL AND c.refresh IS NOT NULL AND c.access_expires_at>clock_timestamp() AND c.refresh_expires_at>clock_timestamp()
 AND public.real_media_grant_version(c.scopes)=a.grant_hash AND cardinality(c.scopes)=2
 AND c.scopes @> ARRAY['https://api.ebay.com/oauth/api_scope','https://api.ebay.com/oauth/api_scope/sell.inventory']::text[]
 AND i.storage_provider='vercel-blob' AND i.content_type='image/png' AND public.real_media_source_version(i.id)=a.source_version
 AND EXISTS(SELECT 1 FROM public.sessions s WHERE s.user_id=a.owner_id AND public.capture_session_hash(a.owner_id,s.id)=a.session_hash AND s.expires_at>clock_timestamp()))
$$;
--> statement-breakpoint
CREATE FUNCTION public.image_verification_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.ebay_real_media_attempts; c public.ebay_connections; s public.sessions; at_time timestamptz;
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Diagnostic safety history is retained'; END IF;
 IF TG_OP='INSERT' THEN
  -- Cover the primary-key index too: even direct inserts must not acquire an
  -- unaccounted uniqueness wait after the authoritative transition clock.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('image-verification-id:'||NEW.id,0)) THEN RAISE EXCEPTION 'Diagnostic persistence refused'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('image-verification:'||NEW.owner_id||':'||NEW.action_hash,0)) THEN RAISE EXCEPTION 'Diagnostic persistence refused'; END IF;
  PERFORM public.image_verification_lock_context(NEW.upload_attempt_id,NEW.owner_id);
  SELECT * INTO a FROM public.ebay_real_media_attempts WHERE id=NEW.upload_attempt_id AND owner_id=NEW.owner_id;
  at_time:=public.capture_media_authorize(a.id,a.owner_id,a.claim_hash,NEW.parent_preparing_revision);
  IF a.state<>'preparing' OR a.post_intent_at IS NOT NULL OR NEW.phase<>'prepared' OR NEW.revision<>0 OR NEW.request_intent_at IS NOT NULL OR
   NEW.close_reason IS NOT NULL OR NEW.evidence_overflow OR NOT public.image_verification_profile_valid(NEW.contract_version,NEW.address_policy_version,NEW.address_policy_data_hash,at_time) THEN RAISE EXCEPTION 'Diagnostic persistence refused'; END IF;
  SELECT * INTO c FROM public.ebay_connections WHERE owner_id=a.owner_id;
  SELECT * INTO s FROM public.sessions WHERE user_id=a.owner_id AND public.capture_session_hash(a.owner_id,id)=a.session_hash;
  IF NEW.lease_until IS NULL OR NEW.review_until IS NULL OR NOT isfinite(NEW.lease_until) OR NOT isfinite(NEW.review_until) THEN RAISE EXCEPTION 'Diagnostic deadline refused'; END IF;
  NEW.created_at:=at_time; NEW.updated_at:=at_time;
  NEW.lease_until:=least(NEW.lease_until,NEW.review_until,a.lease_until,s.expires_at,c.access_expires_at,c.refresh_expires_at,at_time+interval '30 seconds',public.image_verification_policy_cutoff());
  IF NEW.lease_until<=at_time THEN RAISE EXCEPTION 'Diagnostic deadline refused'; END IF;
  NEW.review_due_at:=at_time+interval '30 days'; NEW.disposition_due_at:=at_time+interval '90 days';
 ELSE
  IF (to_jsonb(NEW)-ARRAY['phase','revision','request_intent_at','response_received_at','provider_expires_at','use_until','request_deadline','close_reason','evidence_overflow','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['phase','revision','request_intent_at','response_received_at','provider_expires_at','use_until','request_deadline','close_reason','evidence_overflow','updated_at']) OR
   NEW.revision<>OLD.revision+1 OR OLD.evidence_overflow AND NOT NEW.evidence_overflow THEN RAISE EXCEPTION 'Immutable diagnostic binding'; END IF;
  IF OLD.request_intent_at IS NOT NULL AND ROW(NEW.request_intent_at,NEW.response_received_at,NEW.provider_expires_at,NEW.use_until,NEW.request_deadline)
   IS DISTINCT FROM ROW(OLD.request_intent_at,OLD.response_received_at,OLD.provider_expires_at,OLD.use_until,OLD.request_deadline) THEN RAISE EXCEPTION 'Immutable diagnostic intent'; END IF;
  IF OLD.phase='prepared' AND NEW.phase='intent-recorded' THEN
   IF OLD.revision<>0 OR OLD.evidence_overflow OR EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes WHERE verification_id=OLD.id) THEN RAISE EXCEPTION 'Consumed diagnostic action'; END IF;
   PERFORM public.image_verification_lock_context(OLD.upload_attempt_id,OLD.owner_id);
   SELECT * INTO a FROM public.ebay_real_media_attempts WHERE id=OLD.upload_attempt_id AND owner_id=OLD.owner_id;
   -- All potentially blocking context/parent/verification locks precede this
   -- trusted wall clock. Supplied historical transition times are not clocks.
   at_time:=public.capture_media_authorize(a.id,a.owner_id,a.claim_hash,OLD.parent_preparing_revision+1);
   IF a.state<>'unknown' OR a.post_intent_at IS NULL OR a.source_digest<>OLD.expected_source_digest OR a.derivative_digest<>OLD.expected_derivative_digest OR
    OLD.lease_until<=at_time OR OLD.review_until<=at_time OR NOT public.image_verification_profile_valid(OLD.contract_version,OLD.address_policy_version,OLD.address_policy_data_hash,at_time) OR
    NEW.response_received_at IS NULL OR NOT isfinite(NEW.response_received_at) OR NEW.response_received_at>at_time OR NEW.provider_expires_at IS NULL OR NOT isfinite(NEW.provider_expires_at) THEN RAISE EXCEPTION 'Diagnostic intent refused'; END IF;
   SELECT * INTO c FROM public.ebay_connections WHERE owner_id=a.owner_id;
   SELECT * INTO s FROM public.sessions WHERE user_id=a.owner_id AND public.capture_session_hash(a.owner_id,id)=a.session_hash;
   NEW.request_intent_at:=at_time;
   NEW.use_until:=least(OLD.lease_until,OLD.review_until,a.lease_until,s.expires_at,c.access_expires_at,c.refresh_expires_at,public.image_verification_policy_cutoff(),NEW.response_received_at+interval '30 seconds',NEW.provider_expires_at-interval '60 seconds');
   NEW.request_deadline:=least(NEW.use_until,at_time+interval '10 seconds');
   IF NEW.request_deadline<=at_time THEN RAISE EXCEPTION 'Diagnostic deadline refused'; END IF;
  ELSIF OLD.phase='prepared' AND NEW.phase='closed' THEN
   IF NEW.close_reason IS NULL OR NEW.close_reason='evidence-before-intent' AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Diagnostic closure refused'; END IF;
  ELSIF NEW.phase<>OLD.phase OR NEW.close_reason IS DISTINCT FROM OLD.close_reason OR
   NOT ((NOT OLD.evidence_overflow AND NEW.evidence_overflow) OR pg_trigger_depth()>1) THEN RAISE EXCEPTION 'Diagnostic action cannot reset'; END IF;
  IF OLD.phase<>'prepared' AND NEW.phase<>OLD.phase THEN RAISE EXCEPTION 'Diagnostic phase cannot reset'; END IF;
  NEW.updated_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER image_verification_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_image_verifications FOR EACH ROW EXECUTE FUNCTION public.image_verification_guard();
--> statement-breakpoint
CREATE TRIGGER image_verification_no_truncate BEFORE TRUNCATE ON public.ebay_image_verifications FOR EACH STATEMENT EXECUTE FUNCTION public.image_verification_guard();
--> statement-breakpoint
CREATE FUNCTION public.image_verification_intent_time(p_id text,p_owner text,p_hash text,p_parent_revision integer,p_revision integer) RETURNS timestamptz
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v public.ebay_image_verifications; a public.ebay_real_media_attempts; at_time timestamptz;
BEGIN
 SELECT * INTO v FROM public.ebay_image_verifications WHERE id=p_id AND owner_id=p_owner;
 IF v.id IS NULL THEN RAISE EXCEPTION 'Diagnostic persistence refused'; END IF;
 PERFORM public.image_verification_lock_context(v.upload_attempt_id,v.owner_id);
 SELECT * INTO v FROM public.ebay_image_verifications WHERE id=p_id AND owner_id=p_owner FOR UPDATE NOWAIT;
 SELECT * INTO a FROM public.ebay_real_media_attempts WHERE id=v.upload_attempt_id AND owner_id=v.owner_id;
 at_time:=public.capture_media_authorize(a.id,a.owner_id,p_hash,p_parent_revision);
 IF v.phase<>'intent-recorded' OR v.revision<>p_revision OR p_parent_revision<>v.parent_preparing_revision+1 OR
  a.state<>'unknown' OR a.post_intent_at IS NULL OR a.source_digest<>v.expected_source_digest OR a.derivative_digest<>v.expected_derivative_digest OR
  v.lease_until<=at_time OR v.review_until<=at_time OR v.request_deadline<=at_time OR v.use_until<=at_time OR v.evidence_overflow OR
  NOT public.image_verification_profile_valid(v.contract_version,v.address_policy_version,v.address_policy_data_hash,at_time) OR
  EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes WHERE verification_id=v.id) THEN RAISE EXCEPTION 'Diagnostic context refused'; END IF;
 RETURN at_time;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.image_verification_outcome_fingerprint(e jsonb,r integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('intentRevision',r,'envelope',e)::text,'UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION public.image_verification_outcome_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v public.ebay_image_verifications; at_time timestamptz;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Diagnostic outcomes are append only'; END IF;
 SELECT * INTO v FROM public.ebay_image_verifications WHERE id=NEW.verification_id AND owner_id=NEW.owner_id;
 IF v.id IS NULL THEN RAISE EXCEPTION 'Diagnostic persistence refused'; END IF;
 PERFORM id FROM public.ebay_real_media_attempts WHERE id=v.upload_attempt_id AND owner_id=v.owner_id FOR UPDATE NOWAIT;
 SELECT * INTO v FROM public.ebay_image_verifications WHERE id=v.id AND owner_id=NEW.owner_id FOR UPDATE NOWAIT;
 IF NOT public.image_verification_envelope_valid(NEW.envelope) OR
  (v.phase='intent-recorded' AND NEW.intent_revision IS DISTINCT FROM 1) OR
  (v.phase<>'intent-recorded' AND NEW.intent_revision IS NOT NULL) THEN RAISE EXCEPTION 'Diagnostic evidence refused'; END IF;
 NEW.fingerprint:=public.image_verification_outcome_fingerprint(NEW.envelope,NEW.intent_revision);
 -- Exact lost-ack retries are recognized before the distinct evidence budget.
 IF EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes WHERE verification_id=v.id AND fingerprint=NEW.fingerprint) THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM public.ebay_image_verification_outcomes WHERE verification_id=v.id)>=4 THEN
  IF NOT v.evidence_overflow THEN UPDATE public.ebay_image_verifications SET evidence_overflow=true,revision=revision+1 WHERE id=v.id; END IF;
  RETURN NULL;
 END IF;
 at_time:=clock_timestamp(); NEW.recorded_at:=at_time;
 NEW.protocol_conflict:=v.phase<>'intent-recorded' AND (NEW.envelope->>'event'='response' OR NEW.envelope->'httpStatus'<>'null'::jsonb OR (NEW.envelope->>'bytes')::integer>0);
 NEW.late:=v.phase<>'intent-recorded' OR v.request_deadline<=at_time OR
  NOT public.image_verification_context_current(v.upload_attempt_id,v.owner_id) OR
  NOT EXISTS(SELECT 1 FROM public.ebay_real_media_attempts a WHERE a.id=v.upload_attempt_id AND a.revision=v.parent_preparing_revision+1 AND a.post_intent_at IS NOT NULL AND a.source_digest=v.expected_source_digest AND a.derivative_digest=v.expected_derivative_digest) OR
  EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes WHERE verification_id=v.id AND (envelope->>'event'='cancelled' OR envelope->>'settlement'='unsettled'));
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER image_verification_outcome_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_image_verification_outcomes FOR EACH ROW EXECUTE FUNCTION public.image_verification_outcome_guard();
--> statement-breakpoint
CREATE TRIGGER image_verification_outcome_no_truncate BEFORE TRUNCATE ON public.ebay_image_verification_outcomes FOR EACH STATEMENT EXECUTE FUNCTION public.image_verification_outcome_guard();
--> statement-breakpoint
CREATE FUNCTION public.image_verification_outcome_effect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.ebay_image_verifications SET phase=CASE WHEN phase='prepared' THEN 'closed' ELSE phase END,
  close_reason=CASE WHEN phase='prepared' THEN 'evidence-before-intent' ELSE close_reason END,
  revision=revision+1 WHERE id=NEW.verification_id;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER image_verification_outcome_effect AFTER INSERT ON public.ebay_image_verification_outcomes FOR EACH ROW EXECUTE FUNCTION public.image_verification_outcome_effect();
