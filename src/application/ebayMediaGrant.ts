import { EBAY_SCOPES, sameEbayScopes, validEbayScopes } from "./ebayConnection";

// Proposed minimal media profile, exercised with synthetic grants only. It is
// deliberately NOT added to ebayScopesFor or the real OAuth state/profile union.
export const PROPOSED_MEDIA_PROFILE = "sandbox-media-proposal-v1";
export const PROPOSED_MEDIA_SCOPES = [...EBAY_SCOPES, "https://api.ebay.com/oauth/api_scope/sell.inventory"] as const;
export const hasProposedMediaScopes = (scopes: readonly string[]) => sameEbayScopes(scopes, PROPOSED_MEDIA_SCOPES);

// Local byte preparation and persistence may inspect this exact synthetic grant.
// Existing identity/readiness authorization and refresh validation stay exact.
export const validPhotoPreparationScopes = (scopes: readonly string[]) => validEbayScopes(scopes) || hasProposedMediaScopes(scopes);
