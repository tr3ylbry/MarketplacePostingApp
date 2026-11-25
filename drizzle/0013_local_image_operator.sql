CREATE TABLE "local_image_operator_activations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"reviewed_head" text NOT NULL,
	"reviewed_tree" text NOT NULL,
	"config_hash" text NOT NULL,
	"seller_key" text NOT NULL,
	"connection_id" text NOT NULL,
	"initial_connection_version" text NOT NULL,
	"derivative_recipe" text NOT NULL,
	"comparison_recipe" text NOT NULL,
	"phase" text DEFAULT 'armed' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp(6) with time zone NOT NULL,
	"created_at" timestamp(6) with time zone NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"review_due_at" timestamp(6) with time zone NOT NULL,
	"disposition_due_at" timestamp(6) with time zone NOT NULL,
	"session_hash" text,
	"consent_state_hash" text,
	"consent_version" text,
	"connected_version" text,
	"consent_started_at" timestamp(6) with time zone,
	"exchange_intent_at" timestamp(6) with time zone,
	"identity_intent_at" timestamp(6) with time zone,
	"fixture_started_at" timestamp(6) with time zone,
	"listing_id" text,
	"image_id" text,
	"listing_version" timestamp(6) with time zone,
	"source_digest" text,
	"derivative_digest" text,
	"run_started_at" timestamp(6) with time zone,
	"runner_id" text,
	"cancel_requested_at" timestamp(6) with time zone,
	"settled_at" timestamp(6) with time zone,
	"stopped_at" timestamp(6) with time zone,
	"cleanup_started_at" timestamp(6) with time zone,
	"cleanup_session_hash" text,
	"cleanup_not_before" timestamp(6) with time zone,
	CONSTRAINT "local_image_operator_hashes" CHECK ("local_image_operator_activations"."reviewed_head" ~ '^[a-f0-9]{40}$' AND "local_image_operator_activations"."reviewed_tree" ~ '^[a-f0-9]{40}$' AND "local_image_operator_activations"."config_hash" ~ '^[a-f0-9]{64}$' AND "local_image_operator_activations"."seller_key" ~ '^[a-f0-9]{64}$' AND ("local_image_operator_activations"."session_hash" IS NULL OR "local_image_operator_activations"."session_hash" ~ '^[a-f0-9]{64}$') AND ("local_image_operator_activations"."consent_state_hash" IS NULL OR "local_image_operator_activations"."consent_state_hash" ~ '^[a-f0-9]{64}$') AND ("local_image_operator_activations"."source_digest" IS NULL OR "local_image_operator_activations"."source_digest" ~ '^[a-f0-9]{64}$') AND ("local_image_operator_activations"."derivative_digest" IS NULL OR "local_image_operator_activations"."derivative_digest" ~ '^[a-f0-9]{64}$') AND ("local_image_operator_activations"."cleanup_session_hash" IS NULL OR "local_image_operator_activations"."cleanup_session_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "local_image_operator_bounds" CHECK (length("local_image_operator_activations"."id") BETWEEN 1 AND 200 AND length("local_image_operator_activations"."owner_id") BETWEEN 1 AND 200 AND length("local_image_operator_activations"."connection_id") BETWEEN 1 AND 200 AND length("local_image_operator_activations"."initial_connection_version") BETWEEN 1 AND 200 AND length("local_image_operator_activations"."derivative_recipe") BETWEEN 1 AND 1024 AND length("local_image_operator_activations"."comparison_recipe") BETWEEN 1 AND 1024 AND "local_image_operator_activations"."revision">=0 AND ("local_image_operator_activations"."listing_id" IS NULL OR length("local_image_operator_activations"."listing_id") BETWEEN 1 AND 200) AND ("local_image_operator_activations"."image_id" IS NULL OR length("local_image_operator_activations"."image_id") BETWEEN 1 AND 200)),
	CONSTRAINT "local_image_operator_phase" CHECK ("local_image_operator_activations"."phase" IN ('armed','consent-pending','connected','fixture-preparing','ready','running','settled','stopped','cleanup-queued')),
	CONSTRAINT "local_image_operator_times" CHECK (isfinite("local_image_operator_activations"."created_at") AND isfinite("local_image_operator_activations"."updated_at") AND isfinite("local_image_operator_activations"."expires_at") AND isfinite("local_image_operator_activations"."review_due_at") AND isfinite("local_image_operator_activations"."disposition_due_at") AND "local_image_operator_activations"."expires_at">"local_image_operator_activations"."created_at" AND "local_image_operator_activations"."expires_at"<="local_image_operator_activations"."created_at"+interval '2 hours' AND "local_image_operator_activations"."review_due_at"="local_image_operator_activations"."created_at"+interval '30 days' AND "local_image_operator_activations"."disposition_due_at"="local_image_operator_activations"."created_at"+interval '90 days')
);
--> statement-breakpoint
ALTER TABLE "local_image_operator_activations" ADD CONSTRAINT "local_image_operator_activations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_image_operator_state_key" ON "local_image_operator_activations" USING btree ("consent_state_hash");
--> statement-breakpoint
-- Secondary database enforcement for an already genuinely authenticated local
-- browser capability. This function never authenticates an HTTP caller.
CREATE FUNCTION public.local_image_operator_context(a public.local_image_operator_activations, p_kind text) RETURNS timestamptz
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE s public.sessions; c public.ebay_connections; l public.listings; i public.listing_images; at_time timestamptz; expected_version text;
BEGIN
 IF p_kind IN ('run','ready','cleanup') THEN
  SELECT * INTO l FROM public.listings WHERE id=a.listing_id AND owner_id=a.owner_id FOR UPDATE NOWAIT;
  SELECT * INTO i FROM public.listing_images WHERE id=a.image_id AND listing_id=a.listing_id FOR UPDATE NOWAIT;
 END IF;
 SELECT * INTO s FROM public.sessions WHERE user_id=a.owner_id AND public.capture_session_hash(a.owner_id,id)=CASE WHEN p_kind='cleanup' THEN a.cleanup_session_hash ELSE a.session_hash END FOR SHARE NOWAIT;
 IF p_kind<>'cleanup' THEN SELECT * INTO c FROM public.ebay_connections WHERE owner_id=a.owner_id FOR UPDATE NOWAIT; END IF;
 at_time:=clock_timestamp();
 IF s.id IS NULL OR s.expires_at<=at_time THEN RAISE EXCEPTION 'Local diagnostic context changed'; END IF;
 IF p_kind='cleanup' THEN
  IF l.id IS NULL OR i.id IS NULL OR l.updated_at<>a.listing_version OR l.title<>'SANDBOX M3 Generated '||left(a.source_digest,12) OR i.storage_provider<>'vercel-blob' OR i.content_type<>'image/png' OR i.sort_order<>0 OR (SELECT count(*) FROM public.listing_images WHERE listing_id=l.id)<>1 OR EXISTS(SELECT 1 FROM public.image_uploads WHERE listing_id=l.id) OR EXISTS(SELECT 1 FROM public.marketplace_listings WHERE listing_id=l.id AND (external_listing_id IS NOT NULL OR external_url IS NOT NULL OR published_at IS NOT NULL)) OR i.provider_retain_until IS NULL OR i.provider_retain_until>at_time OR
   (SELECT count(*) FROM public.ebay_real_media_attempts m WHERE m.owner_id=a.owner_id AND m.environment='sandbox' AND m.seller_key=a.seller_key AND m.connection_version=a.connected_version AND m.listing_id=a.listing_id AND m.listing_version=a.listing_version AND m.image_id=a.image_id AND m.operation='capture-only' AND m.post_intent_at IS NOT NULL AND m.source_digest=a.source_digest AND m.derivative_digest=a.derivative_digest AND m.source_version=public.real_media_source_version(i.id))<>1 THEN RAISE EXCEPTION 'Local diagnostic cleanup unavailable'; END IF;
  RETURN at_time;
 END IF;
 expected_version:=CASE WHEN p_kind='consent' THEN a.initial_connection_version WHEN p_kind IN ('exchange','identity') THEN a.consent_version ELSE a.connected_version END;
 IF a.expires_at<=at_time OR a.cancel_requested_at IS NOT NULL OR a.stopped_at IS NOT NULL OR c.id IS NULL OR c.id<>a.connection_id OR c.version<>expected_version OR c.config_hash<>a.config_hash OR c.seller_id<>a.seller_key OR c.environment<>'sandbox' OR c.status<>'connected' OR c.lease_token IS NOT NULL OR c.lease_until IS NOT NULL THEN RAISE EXCEPTION 'Local diagnostic context changed'; END IF;
 IF p_kind NOT IN ('consent','exchange','identity') AND (c.access IS NULL OR c.refresh IS NULL OR c.access_expires_at IS NULL OR c.access_expires_at<=at_time+interval '150 seconds' OR c.refresh_expires_at IS NULL OR c.refresh_expires_at<=at_time OR c.lease_token IS NOT NULL OR c.lease_until IS NOT NULL OR cardinality(c.scopes)<>2 OR NOT c.scopes @> ARRAY['https://api.ebay.com/oauth/api_scope','https://api.ebay.com/oauth/api_scope/sell.inventory']::text[]) THEN RAISE EXCEPTION 'Local diagnostic grant changed'; END IF;
 IF p_kind IN ('exchange','identity') AND NOT EXISTS(SELECT 1 FROM public.ebay_oauth_states o WHERE o.hash=a.consent_state_hash AND o.owner_id=a.owner_id AND o.config_hash=a.config_hash AND o.connection_version=a.consent_version AND o.session_hash=encode(sha256(convert_to(s.id,'UTF8')),'hex') AND o.consumed_at IS NOT NULL AND o.expires_at>at_time AND cardinality(o.requested_scopes)=2 AND o.requested_scopes @> ARRAY['https://api.ebay.com/oauth/api_scope','https://api.ebay.com/oauth/api_scope/sell.inventory']::text[]) THEN RAISE EXCEPTION 'Local diagnostic consent changed'; END IF;
 IF p_kind IN ('run','ready') AND (l.id IS NULL OR l.updated_at<>a.listing_version OR l.title<>'SANDBOX M3 Generated '||left(a.source_digest,12) OR i.id IS NULL OR i.storage_provider<>'vercel-blob' OR i.content_type<>'image/png' OR i.byte_size>1048576 OR i.sort_order<>0 OR (SELECT count(*) FROM public.listing_images WHERE listing_id=l.id)<>1 OR EXISTS(SELECT 1 FROM public.image_uploads WHERE listing_id=l.id) OR EXISTS(SELECT 1 FROM public.marketplace_listings WHERE listing_id=l.id AND (external_listing_id IS NOT NULL OR external_url IS NOT NULL OR status='published'))) THEN RAISE EXCEPTION 'Local diagnostic fixture changed'; END IF;
 RETURN at_time;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.local_image_operator_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE allowed text[]; kind text; at_time timestamptz; c public.ebay_connections;
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Local diagnostic history is retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.phase<>'armed' OR NEW.revision<>0 OR (to_jsonb(NEW)-ARRAY['id','owner_id','reviewed_head','reviewed_tree','config_hash','seller_key','connection_id','initial_connection_version','derivative_recipe','comparison_recipe','phase','revision','expires_at','created_at','updated_at','review_due_at','disposition_due_at']) <> jsonb_build_object('session_hash',NULL,'consent_state_hash',NULL,'consent_version',NULL,'connected_version',NULL,'consent_started_at',NULL,'exchange_intent_at',NULL,'identity_intent_at',NULL,'fixture_started_at',NULL,'listing_id',NULL,'image_id',NULL,'listing_version',NULL,'source_digest',NULL,'derivative_digest',NULL,'run_started_at',NULL,'runner_id',NULL,'cancel_requested_at',NULL,'settled_at',NULL,'stopped_at',NULL,'cleanup_started_at',NULL,'cleanup_session_hash',NULL,'cleanup_not_before',NULL) THEN RAISE EXCEPTION 'Local diagnostic must start unconsumed'; END IF;
  SELECT * INTO c FROM public.ebay_connections WHERE owner_id=NEW.owner_id FOR UPDATE NOWAIT;
  at_time:=clock_timestamp();
  IF c.id IS NULL OR c.id<>NEW.connection_id OR c.version<>NEW.initial_connection_version OR c.config_hash<>NEW.config_hash OR c.seller_id<>NEW.seller_key OR c.status<>'connected' OR c.environment<>'sandbox' OR c.lease_token IS NOT NULL OR c.lease_until IS NOT NULL OR NEW.expires_at<=at_time OR NEW.expires_at>at_time+interval '2 hours' THEN RAISE EXCEPTION 'Local diagnostic activation changed'; END IF;
  NEW.created_at:=at_time;NEW.updated_at:=at_time;NEW.review_due_at:=at_time+interval '30 days';NEW.disposition_due_at:=at_time+interval '90 days';
  RETURN NEW;
 END IF;
 IF OLD.revision=2147483647 OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Local diagnostic revision changed'; END IF;
 allowed:=ARRAY['revision','updated_at'];
 IF OLD.consent_started_at IS NULL AND NEW.consent_started_at IS NOT NULL AND OLD.phase='armed' AND NEW.phase='consent-pending' AND NEW.session_hash IS NOT NULL AND NEW.consent_state_hash IS NOT NULL AND NEW.consent_version IS NOT NULL THEN
  kind:='consent'; allowed:=allowed||ARRAY['phase','session_hash','consent_state_hash','consent_version','consent_started_at'];
 ELSIF OLD.exchange_intent_at IS NULL AND NEW.exchange_intent_at IS NOT NULL AND OLD.phase='consent-pending' AND NEW.phase=OLD.phase THEN
  kind:='exchange';allowed:=allowed||ARRAY['exchange_intent_at'];
 ELSIF OLD.identity_intent_at IS NULL AND NEW.identity_intent_at IS NOT NULL AND OLD.exchange_intent_at IS NOT NULL AND OLD.phase='consent-pending' AND NEW.phase=OLD.phase THEN
  kind:='identity';allowed:=allowed||ARRAY['identity_intent_at'];
 ELSIF OLD.phase='consent-pending' AND NEW.phase='connected' AND OLD.identity_intent_at IS NOT NULL AND OLD.connected_version IS NULL AND NEW.connected_version IS NOT NULL THEN
  kind:='connected';allowed:=allowed||ARRAY['phase','connected_version'];
 ELSIF OLD.phase='connected' AND NEW.phase='fixture-preparing' AND OLD.fixture_started_at IS NULL AND NEW.fixture_started_at IS NOT NULL AND NEW.listing_id IS NOT NULL AND OLD.listing_id IS NULL THEN
  kind:='fixture';allowed:=allowed||ARRAY['phase','fixture_started_at','listing_id'];
 ELSIF OLD.phase='fixture-preparing' AND NEW.phase=OLD.phase AND OLD.source_digest IS NULL AND OLD.derivative_digest IS NULL AND NEW.source_digest IS NOT NULL AND NEW.derivative_digest IS NOT NULL THEN
  kind:='fixture';allowed:=allowed||ARRAY['source_digest','derivative_digest'];
 ELSIF OLD.phase='fixture-preparing' AND NEW.phase='ready' AND OLD.source_digest IS NOT NULL AND OLD.derivative_digest IS NOT NULL AND OLD.image_id IS NULL AND OLD.listing_version IS NULL AND NEW.image_id IS NOT NULL AND NEW.listing_version IS NOT NULL THEN
  kind:='ready';allowed:=allowed||ARRAY['phase','image_id','listing_version'];
 ELSIF OLD.phase='ready' AND NEW.phase='running' AND OLD.run_started_at IS NULL AND NEW.run_started_at IS NOT NULL AND OLD.runner_id IS NULL AND NEW.runner_id IS NOT NULL THEN
  kind:='run';allowed:=allowed||ARRAY['phase','run_started_at','runner_id'];
 ELSIF OLD.cancel_requested_at IS NULL AND NEW.cancel_requested_at IS NOT NULL AND NEW.phase=OLD.phase AND OLD.phase NOT IN ('settled','stopped','cleanup-queued') THEN
  kind:='cancel';allowed:=allowed||ARRAY['cancel_requested_at'];
 ELSIF OLD.settled_at IS NULL AND NEW.settled_at IS NOT NULL AND OLD.run_started_at IS NOT NULL AND NEW.phase=(CASE WHEN OLD.stopped_at IS NULL THEN 'settled' ELSE 'stopped' END) THEN
  kind:='settle';allowed:=allowed||ARRAY['phase','settled_at'];
 ELSIF OLD.stopped_at IS NULL AND NEW.stopped_at IS NOT NULL AND NEW.phase='stopped' AND OLD.phase<>'cleanup-queued' THEN
  kind:='stop';allowed:=allowed||ARRAY['phase','stopped_at'];
 ELSIF OLD.cleanup_started_at IS NULL AND NEW.cleanup_started_at IS NOT NULL AND OLD.phase IN ('settled','stopped') AND NEW.phase=OLD.phase AND OLD.settled_at IS NOT NULL AND NEW.cleanup_session_hash IS NOT NULL THEN
  kind:='cleanup';allowed:=allowed||ARRAY['cleanup_started_at','cleanup_session_hash'];
 ELSIF OLD.cleanup_started_at IS NOT NULL AND OLD.cleanup_not_before IS NULL AND NEW.cleanup_not_before IS NOT NULL AND NEW.phase='cleanup-queued' AND NOT EXISTS(SELECT 1 FROM public.listings WHERE id=OLD.listing_id) AND NOT EXISTS(SELECT 1 FROM public.listing_images WHERE id=OLD.image_id) AND (SELECT count(*) FROM public.image_cleanup WHERE pathname LIKE 'images/'||OLD.image_id||'/%' AND not_before=NEW.cleanup_not_before)=1 THEN
  kind:='cleanup-record';allowed:=allowed||ARRAY['phase','cleanup_not_before'];
 ELSE RAISE EXCEPTION 'Local diagnostic transition unavailable'; END IF;
 IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION 'Local diagnostic bindings are immutable'; END IF;
 IF kind='cancel' THEN
  -- Cancellation cannot open a new network permission and remains possible
  -- after activation/grant expiry, but still requires the original live session.
  PERFORM 1 FROM public.sessions WHERE user_id=NEW.owner_id AND public.capture_session_hash(NEW.owner_id,id)=NEW.session_hash AND expires_at>clock_timestamp() FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Local diagnostic session changed'; END IF;
  at_time:=clock_timestamp();
 ELSIF kind IN ('stop','settle','cleanup-record') THEN at_time:=clock_timestamp();
 ELSE at_time:=public.local_image_operator_context(NEW,kind); END IF;
 NEW.updated_at:=at_time;
 IF kind='consent' THEN NEW.consent_started_at:=at_time;
 ELSIF kind='exchange' THEN NEW.exchange_intent_at:=at_time;
 ELSIF kind='identity' THEN NEW.identity_intent_at:=at_time;
 ELSIF kind='fixture' AND NEW.fixture_started_at IS DISTINCT FROM OLD.fixture_started_at THEN NEW.fixture_started_at:=at_time;
 ELSIF kind='run' THEN NEW.run_started_at:=at_time;
 ELSIF kind='cancel' THEN NEW.cancel_requested_at:=at_time;
 ELSIF kind='settle' THEN NEW.settled_at:=at_time;
 ELSIF kind='stop' THEN NEW.stopped_at:=at_time;
 ELSIF kind='cleanup' THEN NEW.cleanup_started_at:=at_time; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER local_image_operator_transition BEFORE INSERT OR UPDATE OR DELETE ON public.local_image_operator_activations FOR EACH ROW EXECUTE FUNCTION public.local_image_operator_guard();
--> statement-breakpoint
CREATE TRIGGER local_image_operator_truncate BEFORE TRUNCATE ON public.local_image_operator_activations FOR EACH STATEMENT EXECUTE FUNCTION public.local_image_operator_guard();
