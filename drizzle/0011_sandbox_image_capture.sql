-- Capture is a separate structural-evidence channel, never receipt admission.
CREATE FUNCTION public.capture_report_valid(e jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE u jsonb; p jsonb; k text;
BEGIN
 IF jsonb_typeof(e)<>'object' OR NOT e ?& ARRAY['version','status','outcome','duplicateHeaders','json','topLevel','location','imageUrl','maximumUrl','expiration'] OR
 (e-ARRAY['version','status','outcome','duplicateHeaders','json','topLevel','location','imageUrl','maximumUrl','expiration'])<>'{}'::jsonb OR octet_length(e::text)>8192 OR
 jsonb_typeof(e->'version')<>'string' OR e->>'version'<>'sandbox-image-shape-v1' OR e->>'outcome' NOT IN ('captured','redirect','headers','body','encoding','json','duplicate','content-type','transport','cancelled') OR
 jsonb_typeof(e->'outcome')<>'string' OR jsonb_typeof(e->'duplicateHeaders')<>'boolean' OR jsonb_typeof(e->'json')<>'boolean' OR
 e->>'topLevel' NOT IN ('missing','null','string','number','boolean','array','object') OR jsonb_typeof(e->'topLevel')<>'string' THEN RETURN false; END IF;
 IF e->'status'<>'null'::jsonb AND (jsonb_typeof(e->'status')<>'number' OR (e->>'status')!~'^[1-5][0-9]{2}$') THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['location','imageUrl','maximumUrl'] LOOP
  u:=e->k;
  IF jsonb_typeof(u)<>'object' OR NOT u ?& ARRAY['kind','valid','scheme','hostname','port','query','fragment','userInfo','segments','truncated'] OR
   (u-ARRAY['kind','valid','scheme','hostname','port','query','fragment','userInfo','segments','truncated'])<>'{}'::jsonb OR
   u->>'kind' NOT IN ('missing','null','string','number','boolean','array','object') OR jsonb_typeof(u->'kind')<>'string' OR
   jsonb_typeof(u->'valid')<>'boolean' OR jsonb_typeof(u->'port')<>'boolean' OR jsonb_typeof(u->'query')<>'boolean' OR
   jsonb_typeof(u->'fragment')<>'boolean' OR jsonb_typeof(u->'userInfo')<>'boolean' OR jsonb_typeof(u->'truncated')<>'boolean' THEN RETURN false; END IF;
  IF u->'scheme'<>'null'::jsonb AND (jsonb_typeof(u->'scheme')<>'string' OR u->>'scheme' NOT IN ('http','https','other')) THEN RETURN false; END IF;
  IF u->'hostname'<>'null'::jsonb AND (jsonb_typeof(u->'hostname')<>'string' OR length(u->>'hostname') NOT BETWEEN 1 AND 253 OR u->>'hostname'!~'^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$') THEN RETURN false; END IF;
  IF jsonb_typeof(u->'segments')<>'array' OR jsonb_array_length(u->'segments')>16 THEN RETURN false; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(u->'segments') LOOP
   IF jsonb_typeof(p)<>'object' OR NOT p ?& ARRAY['length','shape','encoded'] OR (p-ARRAY['length','shape','encoded'])<>'{}'::jsonb OR
    jsonb_typeof(p->'length')<>'number' OR (p->>'length')!~'^[0-9]{1,4}$' OR (p->>'length')::int>8192 OR jsonb_typeof(p->'encoded')<>'boolean' OR
    jsonb_typeof(p->'shape')<>'string' OR p->>'shape' NOT IN ('digits','hex','ascii','encoded','other') THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 u:=e->'expiration';
 IF jsonb_typeof(u)<>'object' OR NOT u ?& ARRAY['kind','syntax','normalized'] OR (u-ARRAY['kind','syntax','normalized'])<>'{}'::jsonb OR
  jsonb_typeof(u->'kind')<>'string' OR u->>'kind' NOT IN ('missing','null','string','number','boolean','array','object') OR
  jsonb_typeof(u->'syntax')<>'string' OR u->>'syntax' NOT IN ('missing','invalid','utc') THEN RETURN false; END IF;
 IF u->'normalized'<>'null'::jsonb AND (jsonb_typeof(u->'normalized')<>'string' OR length(u->>'normalized')<>24 OR
  u->>'syntax'<>'utc' OR u->>'normalized'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' OR NOT isfinite((u->>'normalized')::timestamptz)) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE "ebay_media_captures" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"report" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_capture_report" CHECK (public.capture_report_valid("ebay_media_captures"."report")),
	CONSTRAINT "media_capture_fingerprint" CHECK ("ebay_media_captures"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "ebay_media_captures" ADD CONSTRAINT "ebay_media_captures_attempt_id_ebay_real_media_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."ebay_real_media_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_capture_repeat" ON "ebay_media_captures" USING btree ("attempt_id","fingerprint");--> statement-breakpoint
-- Last transition authorization: no caller/transaction-start clock. NOWAIT
-- context rechecks fail closed if an existing transaction lacks these locks.
CREATE FUNCTION public.capture_media_authorize(p_id text,p_owner text,p_hash text,p_revision integer) RETURNS timestamptz
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.ebay_real_media_attempts; l public.listings; c public.ebay_connections; i public.listing_images; s public.sessions; at_time timestamptz;
BEGIN
 SELECT * INTO a FROM public.ebay_real_media_attempts WHERE id=p_id AND owner_id=p_owner;
 IF p_id IS NULL OR p_owner IS NULL OR p_hash IS NULL OR p_revision IS NULL OR a.id IS NULL OR a.operation<>'capture-only' OR a.claim_hash<>p_hash OR a.revision<>p_revision THEN RAISE EXCEPTION 'Capture context changed'; END IF;
 SELECT * INTO l FROM public.listings WHERE id=a.listing_id AND owner_id=a.owner_id FOR UPDATE NOWAIT;
 SELECT * INTO c FROM public.ebay_connections WHERE owner_id=a.owner_id FOR UPDATE NOWAIT;
 SELECT * INTO i FROM public.listing_images WHERE id=a.image_id AND listing_id=a.listing_id FOR UPDATE NOWAIT;
 SELECT * INTO s FROM public.sessions WHERE user_id=a.owner_id AND public.capture_session_hash(a.owner_id,id)=a.session_hash FOR SHARE NOWAIT;
 SELECT * INTO a FROM public.ebay_real_media_attempts WHERE id=p_id AND owner_id=p_owner FOR UPDATE NOWAIT;
 at_time:=clock_timestamp();
 IF a.id IS NULL OR a.claim_hash<>p_hash OR a.revision<>p_revision OR a.state NOT IN ('preparing','unknown') OR a.lease_until IS NULL OR a.lease_until<=at_time OR
  l.id IS NULL OR l.updated_at<>a.listing_version OR i.id IS NULL OR i.sort_order<>a.image_order OR i.storage_provider<>'vercel-blob' OR i.content_type<>'image/png' OR public.real_media_source_version(i.id)<>a.source_version OR
  c.id IS NULL OR c.id<>a.connection_id OR c.version<>a.connection_version OR c.config_hash<>a.config_hash OR c.seller_id<>a.seller_key OR c.environment<>'sandbox' OR c.status<>'connected' OR c.access IS NULL OR c.refresh IS NULL OR
  c.access_expires_at IS NULL OR c.access_expires_at<=at_time OR c.refresh_expires_at IS NULL OR c.refresh_expires_at<=at_time OR
  public.real_media_grant_version(c.scopes)<>a.grant_hash OR cardinality(c.scopes)<>2 OR NOT c.scopes @> ARRAY['https://api.ebay.com/oauth/api_scope','https://api.ebay.com/oauth/api_scope/sell.inventory']::text[] OR
  s.id IS NULL OR s.expires_at<=at_time THEN RAISE EXCEPTION 'Capture context expired or changed'; END IF;
 RETURN at_time;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.capture_session_hash(p_owner text,p_session text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT encode(sha256(convert_to('["media-session-v1",' || to_json(p_owner)::text || ',' || to_json(p_session)::text || ']','UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION public.capture_media_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE at_time timestamptz; l public.listings; c public.ebay_connections; i public.listing_images; s public.sessions;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.operation='capture-only' THEN RAISE EXCEPTION 'Consumed capture actions are retained'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.operation<>NEW.operation THEN RAISE EXCEPTION 'Media operation is immutable'; END IF;
 IF NEW.operation<>'capture-only' THEN RETURN NEW; END IF;
 IF NEW.state NOT IN ('preparing','not-sent','unknown') THEN RAISE EXCEPTION 'Capture cannot establish a receipt or association'; END IF;
 IF TG_OP='UPDATE' AND NEW.lease_until IS DISTINCT FROM OLD.lease_until AND NOT (OLD.post_intent_at IS NULL AND NEW.state='not-sent' AND NEW.lease_until IS NULL) THEN RAISE EXCEPTION 'Capture lease cannot be renewed'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['state','revision','lease_until','updated_at','reason','source_digest','derivative_digest','content_type','encoded_size','width','height','post_intent_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['state','revision','lease_until','updated_at','reason','source_digest','derivative_digest','content_type','encoded_size','width','height','post_intent_at']) THEN RAISE EXCEPTION 'Capture action binding is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO l FROM public.listings WHERE id=NEW.listing_id AND owner_id=NEW.owner_id FOR UPDATE NOWAIT;
  SELECT * INTO c FROM public.ebay_connections WHERE owner_id=NEW.owner_id FOR UPDATE NOWAIT;
  SELECT * INTO i FROM public.listing_images WHERE id=NEW.image_id AND listing_id=NEW.listing_id FOR UPDATE NOWAIT;
  SELECT * INTO s FROM public.sessions WHERE user_id=NEW.owner_id AND public.capture_session_hash(NEW.owner_id,id)=NEW.session_hash FOR SHARE NOWAIT;
  at_time:=clock_timestamp();
  IF NEW.state<>'preparing' OR NEW.post_intent_at IS NOT NULL OR l.id IS NULL OR l.updated_at<>NEW.listing_version OR c.id IS NULL OR c.id<>NEW.connection_id OR c.version<>NEW.connection_version OR c.config_hash<>NEW.config_hash OR c.seller_id<>NEW.seller_key OR c.environment<>'sandbox' OR c.status<>'connected' OR
   c.access IS NULL OR c.refresh IS NULL OR c.access_expires_at IS NULL OR c.access_expires_at<=at_time OR c.refresh_expires_at IS NULL OR c.refresh_expires_at<=at_time OR
   cardinality(c.scopes)<>2 OR NOT c.scopes @> ARRAY['https://api.ebay.com/oauth/api_scope','https://api.ebay.com/oauth/api_scope/sell.inventory']::text[] OR public.real_media_grant_version(c.scopes)<>NEW.grant_hash OR
   i.id IS NULL OR i.storage_provider<>'vercel-blob' OR i.content_type<>'image/png' OR i.sort_order<>NEW.image_order OR public.real_media_source_version(i.id)<>NEW.source_version OR s.id IS NULL OR s.expires_at<=at_time OR NEW.lease_until<=at_time OR NEW.lease_until IS NULL THEN RAISE EXCEPTION 'Capture claim expired or changed'; END IF;
  NEW.created_at:=at_time;NEW.updated_at:=at_time;NEW.lease_until:=least(NEW.lease_until,at_time+interval '60 seconds');
  UPDATE public.listing_images SET provider_retain_until=greatest(provider_retain_until,at_time+interval '6 minutes') WHERE id=i.id;
 ELSIF NEW.post_intent_at IS NOT NULL AND OLD.post_intent_at IS NULL THEN
  at_time:=public.capture_media_authorize(OLD.id,OLD.owner_id,OLD.claim_hash,OLD.revision);
  IF NEW.content_type<>'image/png' OR NEW.width<>500 OR NEW.height<>600 OR NEW.encoded_size>1048576 THEN RAISE EXCEPTION 'Capture fixture bounds'; END IF;
  NEW.post_intent_at:=at_time;NEW.updated_at:=at_time;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER capture_media_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_real_media_attempts FOR EACH ROW EXECUTE FUNCTION public.capture_media_guard();
--> statement-breakpoint
CREATE FUNCTION public.capture_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.ebay_real_media_attempts;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Capture evidence is append only'; END IF;
 SELECT * INTO a FROM public.ebay_real_media_attempts WHERE id=NEW.attempt_id FOR UPDATE;
 IF a.operation<>'capture-only' OR a.post_intent_at IS NULL OR a.state<>'unknown' THEN RAISE EXCEPTION 'Capture fence required'; END IF;
 NEW.fingerprint:=encode(sha256(convert_to(NEW.report::text,'UTF8')),'hex');NEW.created_at:=clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM public.ebay_media_captures WHERE attempt_id=a.id AND fingerprint=NEW.fingerprint) AND
  (SELECT count(*) FROM public.ebay_media_captures WHERE attempt_id=a.id)>=4 THEN RAISE EXCEPTION 'Capture evidence budget'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER capture_evidence_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_media_captures FOR EACH ROW EXECUTE FUNCTION public.capture_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER capture_evidence_no_truncate BEFORE TRUNCATE ON public.ebay_media_captures FOR EACH STATEMENT EXECUTE FUNCTION public.capture_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION public.capture_no_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ebay_real_media_attempts WHERE id=NEW.attempt_id AND operation='capture-only') THEN RAISE EXCEPTION 'Capture is not receipt admission'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER capture_no_receipt BEFORE INSERT ON public.ebay_real_media_receipts FOR EACH ROW EXECUTE FUNCTION public.capture_no_receipt();
