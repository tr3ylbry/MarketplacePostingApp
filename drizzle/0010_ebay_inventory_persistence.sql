CREATE TABLE "ebay_inventory_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"ordinal" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"resource_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"operation" text NOT NULL,
	"action_hash" text NOT NULL,
	"session_hash" text NOT NULL,
	"listing_id" text NOT NULL,
	"listing_version" timestamp(3) with time zone NOT NULL,
	"connection_id" text NOT NULL,
	"connection_version" text NOT NULL,
	"config_hash" text NOT NULL,
	"grant_hash" text NOT NULL,
	"claim_hash" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'preparing' NOT NULL,
	"lease_until" timestamp(3) with time zone NOT NULL,
	"intent_at" timestamp(3) with time zone,
	"payload_digest" text,
	"media_manifest_digest" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "inventory_attempt_shape" CHECK ("ebay_inventory_attempts"."operation" IN ('inspect','initial-stage','cleanup') AND "ebay_inventory_attempts"."state" IN ('preparing','retired','fenced','acknowledged','conflict') AND "ebay_inventory_attempts"."revision" >= 0),
	CONSTRAINT "inventory_attempt_hashes" CHECK ("ebay_inventory_attempts"."action_hash" ~ '^[a-f0-9]{64}$' AND "ebay_inventory_attempts"."session_hash" ~ '^[a-f0-9]{64}$' AND "ebay_inventory_attempts"."claim_hash" ~ '^[a-f0-9]{64}$' AND "ebay_inventory_attempts"."config_hash" ~ '^[a-f0-9]{64}$' AND "ebay_inventory_attempts"."grant_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "inventory_attempt_bounds" CHECK (length("ebay_inventory_attempts"."id") BETWEEN 1 AND 200 AND length("ebay_inventory_attempts"."listing_id") BETWEEN 1 AND 200 AND length("ebay_inventory_attempts"."connection_id") BETWEEN 1 AND 200 AND length("ebay_inventory_attempts"."connection_version") BETWEEN 1 AND 200),
	CONSTRAINT "inventory_intent_shape" CHECK (("ebay_inventory_attempts"."intent_at" IS NULL AND "ebay_inventory_attempts"."payload_digest" IS NULL AND "ebay_inventory_attempts"."media_manifest_digest" IS NULL AND "ebay_inventory_attempts"."state" IN ('preparing','retired','acknowledged','conflict')) OR ("ebay_inventory_attempts"."intent_at" IS NOT NULL AND "ebay_inventory_attempts"."operation" <> 'inspect' AND "ebay_inventory_attempts"."payload_digest" IS NOT NULL AND "ebay_inventory_attempts"."payload_digest" ~ '^[a-f0-9]{64}$' AND "ebay_inventory_attempts"."media_manifest_digest" IS NOT NULL AND "ebay_inventory_attempts"."media_manifest_digest" ~ '^[a-f0-9]{64}$' AND "ebay_inventory_attempts"."state" IN ('fenced','acknowledged','conflict')))
);
--> statement-breakpoint
CREATE TABLE "ebay_inventory_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"expected_revision" integer NOT NULL,
	"late" boolean NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "inventory_evidence_shape" CHECK (length("ebay_inventory_evidence"."id") BETWEEN 1 AND 200 AND "ebay_inventory_evidence"."fingerprint" ~ '^[a-f0-9]{64}$' AND "ebay_inventory_evidence"."expected_revision" >= 0 AND octet_length("ebay_inventory_evidence"."envelope"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "ebay_inventory_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"seller_key" text NOT NULL,
	"identity_version" text DEFAULT 'ebay-sandbox-eias-v1' NOT NULL,
	"sku" text NOT NULL,
	"historical_listing_id" text NOT NULL,
	"current_listing_id" text,
	"current_connection_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"hold" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"review_due_at" timestamp(3) with time zone NOT NULL,
	"retired_at" timestamp(3) with time zone,
	"retention_review_at" timestamp(3) with time zone,
	"offboard_review_due_at" timestamp(3) with time zone,
	"disposition_due_at" timestamp(3) with time zone,
	CONSTRAINT "inventory_resource_shape" CHECK ("ebay_inventory_resources"."environment" = 'sandbox' AND "ebay_inventory_resources"."identity_version" = 'ebay-sandbox-eias-v1' AND "ebay_inventory_resources"."seller_key" ~ '^[a-f0-9]{64}$' AND length("ebay_inventory_resources"."sku") BETWEEN 1 AND 50 AND "ebay_inventory_resources"."sku" ~ '^[A-Za-z0-9_-]+$' AND "ebay_inventory_resources"."revision" >= 0 AND "ebay_inventory_resources"."hold" IN ('none','resource','seller')),
	CONSTRAINT "inventory_resource_bounds" CHECK (length("ebay_inventory_resources"."id") BETWEEN 1 AND 200 AND length("ebay_inventory_resources"."owner_id") BETWEEN 1 AND 200 AND length("ebay_inventory_resources"."historical_listing_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_resource_owner" ON "ebay_inventory_resources" USING btree ("id","owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_attempt_identity" ON "ebay_inventory_attempts" USING btree ("id","resource_id","owner_id");
--> statement-breakpoint
ALTER TABLE "ebay_inventory_attempts" ADD CONSTRAINT "inventory_attempt_resource_owner" FOREIGN KEY ("resource_id","owner_id") REFERENCES "public"."ebay_inventory_resources"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_inventory_evidence" ADD CONSTRAINT "inventory_evidence_owner" FOREIGN KEY ("attempt_id","resource_id","owner_id") REFERENCES "public"."ebay_inventory_attempts"("id","resource_id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_inventory_resources" ADD CONSTRAINT "ebay_inventory_resources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_inventory_resources" ADD CONSTRAINT "ebay_inventory_resources_current_listing_id_listings_id_fk" FOREIGN KEY ("current_listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_inventory_resources" ADD CONSTRAINT "ebay_inventory_resources_current_connection_id_ebay_connections_id_fk" FOREIGN KEY ("current_connection_id") REFERENCES "public"."ebay_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_consumed_action" ON "ebay_inventory_attempts" USING btree ("owner_id","action_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_active_claim" ON "ebay_inventory_attempts" USING btree ("resource_id") WHERE "ebay_inventory_attempts"."state" = 'preparing';--> statement-breakpoint
CREATE INDEX "inventory_attempt_history" ON "ebay_inventory_attempts" USING btree ("resource_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inventory_owner_attempts" ON "ebay_inventory_attempts" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_evidence_repeat" ON "ebay_inventory_evidence" USING btree ("attempt_id","fingerprint");--> statement-breakpoint
CREATE INDEX "inventory_evidence_history" ON "ebay_inventory_evidence" USING btree ("resource_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_resource_namespace" ON "ebay_inventory_resources" USING btree ("environment","seller_key","sku");--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "inventory_seller_holds" ON "ebay_inventory_resources" USING btree ("environment","seller_key","hold");
--> statement-breakpoint
-- These triggers protect application SQL transitions, not an administrator who
-- can change DDL. There is deliberately no remote ownership/permission column.
CREATE FUNCTION public.inventory_resource_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Inventory history is retained'; END IF;
 IF TG_OP = 'INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory:sandbox:' || NEW.seller_key,0));
  IF NEW.revision <> 0 OR NEW.hold <> 'none' OR NEW.retired_at IS NOT NULL OR
   NEW.retention_review_at IS NOT NULL OR NEW.offboard_review_due_at IS NOT NULL OR NEW.disposition_due_at IS NOT NULL OR
   NOT EXISTS (SELECT 1 FROM public.listings l JOIN public.ebay_connections c ON c.owner_id=l.owner_id
    WHERE l.id=NEW.current_listing_id AND l.id=NEW.historical_listing_id AND l.owner_id=NEW.owner_id
     AND c.id=NEW.current_connection_id AND c.seller_id=NEW.seller_key AND c.environment='sandbox' AND c.status='connected') THEN
   RAISE EXCEPTION 'Invalid local Inventory anchor';
  END IF;
  NEW.review_due_at := NEW.created_at + interval '1 year';
 ELSE
  IF (to_jsonb(NEW) - ARRAY['revision','hold','current_listing_id','current_connection_id','retired_at','retention_review_at','offboard_review_due_at','disposition_due_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revision','hold','current_listing_id','current_connection_id','retired_at','retention_review_at','offboard_review_due_at','disposition_due_at']) OR
   (NEW.current_listing_id IS DISTINCT FROM OLD.current_listing_id AND NEW.current_listing_id IS NOT NULL) OR
   (NEW.current_connection_id IS DISTINCT FROM OLD.current_connection_id AND NEW.current_connection_id IS NOT NULL) OR
   (OLD.hold='seller' AND NEW.hold<>'seller') OR (OLD.hold='resource' AND NEW.hold='none') OR
   (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
   RAISE EXCEPTION 'Inventory history is immutable';
  END IF;
  -- SET NULL FK actions cannot supply a revision. Only exact detachment gets
  -- an automatic increment; arbitrary same-revision writes are rejected.
  IF NEW.revision=OLD.revision AND
    (to_jsonb(NEW)-ARRAY['current_listing_id','current_connection_id'])=(to_jsonb(OLD)-ARRAY['current_listing_id','current_connection_id']) AND
    (NEW.current_listing_id IS DISTINCT FROM OLD.current_listing_id OR NEW.current_connection_id IS DISTINCT FROM OLD.current_connection_id) THEN
   NEW.revision := OLD.revision+1;
  END IF;
  IF NEW.revision <> OLD.revision+1 THEN RAISE EXCEPTION 'Invalid Inventory revision'; END IF;
  IF NEW.current_listing_id IS NULL AND OLD.current_listing_id IS NOT NULL AND NEW.hold='none' THEN NEW.hold := 'resource'; END IF;
  IF NEW.current_connection_id IS NULL AND OLD.current_connection_id IS NOT NULL AND NEW.retired_at IS NULL THEN NEW.retired_at := clock_timestamp(); END IF;
  IF NEW.retired_at IS NOT NULL AND OLD.retired_at IS NULL THEN
   NEW.retired_at := clock_timestamp();
   NEW.hold := 'seller'; NEW.current_listing_id := NULL; NEW.current_connection_id := NULL;
   NEW.retention_review_at := NEW.retired_at + interval '12 months';
   NEW.offboard_review_due_at := NEW.retired_at + interval '7 days';
   NEW.disposition_due_at := NEW.retired_at + interval '30 days';
  ELSIF NEW.retention_review_at IS DISTINCT FROM OLD.retention_review_at OR
   NEW.offboard_review_due_at IS DISTINCT FROM OLD.offboard_review_due_at OR NEW.disposition_due_at IS DISTINCT FROM OLD.disposition_due_at THEN
   RAISE EXCEPTION 'Inventory deadlines cannot silently renew';
  END IF;
 END IF;
 IF NOT isfinite(NEW.created_at) OR NOT isfinite(NEW.review_due_at) OR
  (NEW.retired_at IS NOT NULL AND (NOT isfinite(NEW.retired_at) OR NEW.retired_at<NEW.created_at)) THEN RAISE EXCEPTION 'Invalid Inventory dates'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_resource_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_inventory_resources FOR EACH ROW EXECUTE FUNCTION public.inventory_resource_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_resource_no_truncate BEFORE TRUNCATE ON public.ebay_inventory_resources FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_resource_guard();
--> statement-breakpoint
CREATE FUNCTION public.inventory_session_hash(owner_key text, session_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array('inventory-session-v1',owner_key,session_key)::text,'UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION public.inventory_attempt_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r public.ebay_inventory_resources; l public.listings; c public.ebay_connections; s public.sessions;
 authorization_at timestamptz; authorizing boolean;
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Consumed Inventory actions are retained'; END IF;
 SELECT * INTO r FROM public.ebay_inventory_resources WHERE id=NEW.resource_id AND owner_id=NEW.owner_id;
 IF r.id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('inventory:sandbox:' || r.seller_key,0)); END IF;
 SELECT * INTO r FROM public.ebay_inventory_resources WHERE id=NEW.resource_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Invalid Inventory context'; END IF;
 IF TG_OP='INSERT' THEN authorizing := true; ELSE authorizing := NEW.intent_at IS DISTINCT FROM OLD.intent_at; END IF;
 IF authorizing THEN
  -- The repository already owns these locks in listing -> connection -> seller
  -- -> resource -> attempt -> session order. Direct SQL must fail fast rather
  -- than wait for earlier locks while holding the attempt/resource in reverse.
  SELECT * INTO l FROM public.listings WHERE id=NEW.listing_id AND owner_id=NEW.owner_id FOR UPDATE NOWAIT;
  SELECT * INTO c FROM public.ebay_connections WHERE owner_id=NEW.owner_id FOR UPDATE NOWAIT;
  SELECT * INTO s FROM public.sessions WHERE user_id=NEW.owner_id AND public.inventory_session_hash(user_id,id)=NEW.session_hash FOR SHARE NOWAIT;
  -- Neither transaction_timestamp()/now() nor caller timestamps measure elapsed
  -- time after a lock wait. Sample once AFTER every potentially blocking lock.
  authorization_at := clock_timestamp();
  IF l.id IS NULL OR c.id IS NULL OR s.id IS NULL OR r.retired_at IS NOT NULL OR
   r.current_listing_id IS DISTINCT FROM NEW.listing_id OR r.current_connection_id IS DISTINCT FROM NEW.connection_id OR
   l.updated_at IS DISTINCT FROM NEW.listing_version OR c.id IS DISTINCT FROM NEW.connection_id OR
   c.version IS DISTINCT FROM NEW.connection_version OR c.config_hash IS DISTINCT FROM NEW.config_hash OR
   c.seller_id IS DISTINCT FROM r.seller_key OR c.environment<>'sandbox' OR c.status<>'connected' OR
   public.real_media_grant_version(c.scopes) IS DISTINCT FROM NEW.grant_hash OR
   c.refresh_expires_at IS NULL OR c.refresh_expires_at<=authorization_at OR s.expires_at<=authorization_at THEN
   RAISE EXCEPTION 'Inventory authorization expired or changed';
  END IF;
 END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.state<>'preparing' OR NEW.revision<>0 OR NEW.intent_at IS NOT NULL OR NEW.lease_until<=authorization_at OR
   NEW.lease_until>authorization_at+interval '60 seconds' THEN RAISE EXCEPTION 'Invalid Inventory claim'; END IF;
  IF NEW.operation<>'inspect' AND (r.hold<>'none' OR EXISTS(SELECT 1 FROM public.ebay_inventory_resources x WHERE x.environment=r.environment AND x.seller_key=r.seller_key AND x.hold='seller')) THEN
   RAISE EXCEPTION 'Inventory requires private review';
  END IF;
  NEW.created_at := authorization_at; NEW.updated_at := authorization_at;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revision','state','intent_at','payload_digest','media_manifest_digest','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['revision','state','intent_at','payload_digest','media_manifest_digest','updated_at']) OR
    NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'Immutable Inventory binding or invalid revision'; END IF;
  IF OLD.intent_at IS NOT NULL AND ROW(NEW.intent_at,NEW.payload_digest,NEW.media_manifest_digest) IS DISTINCT FROM
    ROW(OLD.intent_at,OLD.payload_digest,OLD.media_manifest_digest) THEN RAISE EXCEPTION 'Inventory intent is immutable'; END IF;
  IF authorizing THEN
   IF OLD.state<>'preparing' OR NEW.state<>'fenced' OR NEW.operation='inspect' OR OLD.lease_until<=authorization_at OR r.hold<>'none' OR
     EXISTS(SELECT 1 FROM public.ebay_inventory_resources x WHERE x.environment=r.environment AND x.seller_key=r.seller_key AND x.hold='seller') THEN
    RAISE EXCEPTION 'Inventory intent context is stale';
   END IF;
   NEW.intent_at := authorization_at; NEW.updated_at := authorization_at;
  ELSIF NEW.state='fenced' AND OLD.state<>'fenced' THEN RAISE EXCEPTION 'Inventory intent is required'; END IF;
  IF NEW.state='retired' THEN
   authorization_at := clock_timestamp();
   IF OLD.state<>'preparing' OR OLD.intent_at IS NOT NULL OR OLD.lease_until>authorization_at THEN RAISE EXCEPTION 'Only expired unfenced claims may retire'; END IF;
   NEW.updated_at := authorization_at;
  END IF;
  IF OLD.state IN ('retired','conflict') AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'Inventory uncertainty cannot reset'; END IF;
  IF NEW.state='preparing' THEN RAISE EXCEPTION 'Inventory actions cannot reset'; END IF;
  IF NEW.state IN ('acknowledged','conflict') AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Inventory outcome requires append-only evidence'; END IF;
 END IF;
 IF NOT isfinite(NEW.created_at) OR NOT isfinite(NEW.updated_at) OR NOT isfinite(NEW.listing_version) OR NOT isfinite(NEW.lease_until) OR
   NEW.lease_until<=NEW.created_at OR (NEW.intent_at IS NOT NULL AND NOT isfinite(NEW.intent_at)) THEN RAISE EXCEPTION 'Invalid Inventory dates'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_inventory_attempts FOR EACH ROW EXECUTE FUNCTION public.inventory_attempt_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_attempt_no_truncate BEFORE TRUNCATE ON public.ebay_inventory_attempts FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_attempt_guard();
--> statement-breakpoint
CREATE FUNCTION public.inventory_intent_hold() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW.intent_at IS NOT NULL AND OLD.intent_at IS NULL THEN
  UPDATE public.ebay_inventory_resources SET hold='seller',revision=revision+1 WHERE id=NEW.resource_id;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_intent_hold AFTER UPDATE ON public.ebay_inventory_attempts FOR EACH ROW EXECUTE FUNCTION public.inventory_intent_hold();
--> statement-breakpoint
CREATE FUNCTION public.inventory_evidence_valid(e jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE ref jsonb; key text;
BEGIN
 IF jsonb_typeof(e)<>'object' OR NOT e ?& ARRAY['version','kind','startedAt','finishedAt','item','coverage','outcome','code','contentDigest','related','httpStatus','overflow'] OR
  (e - ARRAY['version','kind','startedAt','finishedAt','item','coverage','outcome','code','contentDigest','related','httpStatus','overflow'])<>'{}'::jsonb OR
  e->>'version'<>'inventory-local-v1' OR e->>'kind' NOT IN ('inspection','acknowledgement','conflict','recovery') OR
  e->>'item' NOT IN ('present','absent','unknown') OR e->>'coverage' NOT IN ('complete','incomplete','unknown') OR
  e->>'outcome' NOT IN ('observed','uncertain','not-sent') OR e->>'code' NOT IN ('none','collision','stale','conflict','recreation','integrity','overflow') OR
  jsonb_typeof(e->'related')<>'array' OR jsonb_typeof(e->'overflow')<>'boolean' OR
  (e->'contentDigest'<>'null'::jsonb AND (jsonb_typeof(e->'contentDigest')<>'string' OR e->>'contentDigest' !~ '^[a-f0-9]{64}$')) OR
  (e->'httpStatus'<>'null'::jsonb AND (jsonb_typeof(e->'httpStatus')<>'number' OR e->>'httpStatus' !~ '^[0-9]{3}$' OR (e->>'httpStatus')::int NOT BETWEEN 100 AND 599)) OR
  length(e->>'startedAt')>30 OR length(e->>'finishedAt')>30 OR
  NOT isfinite((e->>'startedAt')::timestamptz) OR NOT isfinite((e->>'finishedAt')::timestamptz) OR
  (e->>'startedAt')::timestamptz>(e->>'finishedAt')::timestamptz THEN RETURN false; END IF;
 FOREACH key IN ARRAY ARRAY['version','kind','startedAt','finishedAt','item','coverage','outcome','code'] LOOP
  IF jsonb_typeof(e->key)<>'string' THEN RETURN false; END IF;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(e->'related') LOOP
  IF jsonb_typeof(ref)<>'object' OR NOT ref ?& ARRAY['kind','id'] OR (ref-ARRAY['kind','id'])<>'{}'::jsonb OR
   jsonb_typeof(ref->'kind')<>'string' OR ref->>'kind' NOT IN ('offer','listing','group') OR jsonb_typeof(ref->'id')<>'string' OR
   length(ref->>'id') NOT BETWEEN 1 AND 200 OR ref->>'id' !~ '^[A-Za-z0-9_-]+$' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.inventory_evidence_fingerprint(e jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT encode(sha256(convert_to(e::text,'UTF8')),'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION public.inventory_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE a public.ebay_inventory_attempts; r public.ebay_inventory_resources; refs bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Inventory evidence is append only'; END IF;
 SELECT * INTO r FROM public.ebay_inventory_resources WHERE id=NEW.resource_id AND owner_id=NEW.owner_id;
 IF r.id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('inventory:sandbox:' || r.seller_key,0)); END IF;
 SELECT * INTO r FROM public.ebay_inventory_resources WHERE id=NEW.resource_id AND owner_id=NEW.owner_id FOR UPDATE;
 SELECT * INTO a FROM public.ebay_inventory_attempts WHERE id=NEW.attempt_id AND resource_id=NEW.resource_id AND owner_id=NEW.owner_id FOR UPDATE;
 NEW.created_at := clock_timestamp();
 IF a.id IS NULL OR r.id IS NULL OR NEW.expected_revision>a.revision OR NOT public.inventory_evidence_valid(NEW.envelope) OR
   (NEW.envelope->>'finishedAt')::timestamptz>NEW.created_at OR NOT isfinite(NEW.created_at) THEN RAISE EXCEPTION 'Invalid normalized Inventory evidence'; END IF;
 IF NEW.envelope->>'kind'='acknowledgement' AND a.intent_at IS NULL THEN RAISE EXCEPTION 'Acknowledgement requires immutable local intent'; END IF;
 -- Retry identity is checked BEFORE the cumulative inspection budget. An exact
 -- lost-ack retry must not become a different overflow record.
 NEW.fingerprint := public.inventory_evidence_fingerprint(NEW.envelope);
 IF EXISTS(SELECT 1 FROM public.ebay_inventory_evidence WHERE attempt_id=a.id AND fingerprint=NEW.fingerprint) THEN RETURN NEW; END IF;
 SELECT coalesce(sum(jsonb_array_length(envelope->'related')),0) INTO refs FROM public.ebay_inventory_evidence WHERE attempt_id=a.id;
 IF refs+jsonb_array_length(NEW.envelope->'related')>250 OR octet_length(NEW.envelope::text)>65536 OR (NEW.envelope->>'overflow')::boolean THEN
  NEW.envelope := NEW.envelope || jsonb_build_object('code',CASE WHEN NEW.envelope->>'code' IN ('conflict','recreation','integrity') THEN NEW.envelope->>'code' ELSE 'overflow' END)
    || '{"item":"unknown","coverage":"incomplete","outcome":"uncertain","contentDigest":null,"related":[],"overflow":true}'::jsonb;
  -- Preserve the normalized input fingerprint across budget downgrades, so an
  -- identical local acknowledgement remains idempotent after partial capture.
 END IF;
 NEW.late := NEW.expected_revision<>a.revision OR a.state IN ('retired','conflict') OR (NEW.envelope->>'startedAt')::timestamptz<a.created_at OR
   r.current_listing_id IS NULL OR r.current_connection_id IS NULL OR r.retired_at IS NOT NULL OR
   a.lease_until<=NEW.created_at OR NOT EXISTS(SELECT 1 FROM public.listings l JOIN public.ebay_connections c ON c.owner_id=l.owner_id
    WHERE l.id=a.listing_id AND l.owner_id=a.owner_id AND l.updated_at=a.listing_version
     AND c.id=a.connection_id AND c.version=a.connection_version AND c.config_hash=a.config_hash AND c.seller_id=r.seller_key AND c.status='connected'
     AND public.real_media_grant_version(c.scopes)=a.grant_hash);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ebay_inventory_evidence FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER inventory_evidence_no_truncate BEFORE TRUNCATE ON public.ebay_inventory_evidence FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION public.inventory_evidence_effect() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE a public.ebay_inventory_attempts; r public.ebay_inventory_resources; conflict boolean; hold_value text;
BEGIN
 SELECT * INTO r FROM public.ebay_inventory_resources WHERE id=NEW.resource_id FOR UPDATE;
 SELECT * INTO a FROM public.ebay_inventory_attempts WHERE id=NEW.attempt_id FOR UPDATE;
 conflict := NEW.envelope->>'kind'='conflict' OR NEW.envelope->>'code' IN ('conflict','recreation','integrity') OR
   EXISTS(SELECT 1 FROM public.ebay_inventory_evidence e WHERE e.attempt_id=a.id AND e.id<>NEW.id AND
     ((e.envelope->>'item' IN ('present','absent') AND NEW.envelope->>'item' IN ('present','absent') AND e.envelope->>'item'<>NEW.envelope->>'item') OR
      (e.envelope->'contentDigest'<>'null'::jsonb AND NEW.envelope->'contentDigest'<>'null'::jsonb AND e.envelope->'contentDigest'<>NEW.envelope->'contentDigest'))) OR
   (a.payload_digest IS NOT NULL AND NEW.envelope->'contentDigest'<>'null'::jsonb AND a.payload_digest<>NEW.envelope->>'contentDigest');
 hold_value := CASE
  WHEN a.intent_at IS NOT NULL OR NEW.envelope->>'code' IN ('recreation','integrity') THEN 'seller'
  WHEN conflict OR NEW.late OR NEW.envelope->>'item'='present' OR NEW.envelope->>'coverage'<>'complete' OR NEW.envelope->>'outcome'='uncertain' OR NEW.envelope->>'code'<>'none' THEN 'resource'
  ELSE 'none' END;
 IF r.hold<>'seller' AND (hold_value='seller' OR (r.hold='none' AND hold_value='resource')) THEN
  UPDATE public.ebay_inventory_resources SET hold=hold_value,revision=revision+1 WHERE id=r.id;
 END IF;
 IF conflict AND a.state NOT IN ('retired','conflict') THEN
  UPDATE public.ebay_inventory_attempts SET state='conflict',revision=revision+1,updated_at=greatest(updated_at,NEW.created_at) WHERE id=a.id;
 ELSIF NOT NEW.late AND a.state IN ('preparing','fenced') AND NEW.envelope->>'kind' IN ('inspection','acknowledgement') THEN
  UPDATE public.ebay_inventory_attempts SET state='acknowledged',revision=revision+1,updated_at=greatest(updated_at,NEW.created_at) WHERE id=a.id;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_evidence_effect AFTER INSERT ON public.ebay_inventory_evidence FOR EACH ROW EXECUTE FUNCTION public.inventory_evidence_effect();
--> statement-breakpoint
-- Disconnect/configuration/identity changes retire current links without
-- deleting history. This trigger takes only resource locks after connection;
-- it never takes listing, session, or advisory locks in reverse order.
CREATE FUNCTION public.inventory_connection_offboard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW.status<>'connected' OR NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.config_hash IS DISTINCT FROM OLD.config_hash THEN
  UPDATE public.ebay_inventory_resources SET retired_at=clock_timestamp(),hold='seller',revision=revision+1,
   current_listing_id=NULL,current_connection_id=NULL WHERE current_connection_id=OLD.id AND retired_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_connection_offboard AFTER UPDATE ON public.ebay_connections FOR EACH ROW EXECUTE FUNCTION public.inventory_connection_offboard();
