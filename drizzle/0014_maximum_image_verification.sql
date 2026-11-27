ALTER TABLE "ebay_image_verifications" DROP CONSTRAINT "image_verification_profile";--> statement-breakpoint
ALTER TABLE "ebay_image_verifications" ADD CONSTRAINT "image_verification_profile" CHECK ("ebay_image_verifications"."method"='GET' AND (("ebay_image_verifications"."target_field"='imageUrl' AND "ebay_image_verifications"."contract_version"='diagnostic-image-get-v1') OR ("ebay_image_verifications"."target_field"='maxDimensionImageUrl' AND "ebay_image_verifications"."contract_version"='diagnostic-maximum-image-get-v1')) AND "ebay_image_verifications"."address_policy_version"='iana-image-address-v1-2026-11-22' AND "ebay_image_verifications"."address_policy_data_hash"='e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887');
--> statement-breakpoint
-- A second fixed contract only. The paired field/contract constraint above,
-- immutable history trigger and global parent/action keys remain authoritative.
-- Existing primary rows and their deadlines are not rewritten.
CREATE OR REPLACE FUNCTION public.image_verification_profile_valid(c text,v text,h text,at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce(c IN ('diagnostic-image-get-v1','diagnostic-maximum-image-get-v1') AND v='iana-image-address-v1-2026-11-22' AND
 h='e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887' AND isfinite(at_time) AND
 at_time>='2026-11-22T20:31:28.569Z'::timestamptz AND at_time<public.image_verification_policy_cutoff(),false)
$$;
