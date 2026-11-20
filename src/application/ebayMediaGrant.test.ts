import { EBAY_SCOPES, EBAY_READINESS_SCOPES, ebayScopesFor, validEbayScopes } from "./ebayConnection";
import { PROPOSED_MEDIA_SCOPES, hasProposedMediaScopes, validPhotoPreparationScopes } from "./ebayMediaGrant";

it("models an explicit minimal discovery profile without broadening identity/readiness", () => {
  expect(PROPOSED_MEDIA_SCOPES).toEqual([EBAY_SCOPES[0], "https://api.ebay.com/oauth/api_scope/sell.inventory"]);
  expect(hasProposedMediaScopes([...PROPOSED_MEDIA_SCOPES].reverse())).toBe(true);
  expect(validEbayScopes(PROPOSED_MEDIA_SCOPES)).toBe(true);
  expect(ebayScopesFor("media-discovery")).toEqual(PROPOSED_MEDIA_SCOPES);
  expect(ebayScopesFor("identity")).toEqual(EBAY_SCOPES);
  expect(ebayScopesFor("readiness")).toEqual(EBAY_READINESS_SCOPES);
});
it.each([EBAY_SCOPES, EBAY_READINESS_SCOPES, PROPOSED_MEDIA_SCOPES].map(scopes => ({ scopes })))("keeps exact local photo-grant compatibility for $scopes", ({ scopes }) => {
  expect(validPhotoPreparationScopes(scopes)).toBe(true);
});
it.each([[], [PROPOSED_MEDIA_SCOPES[1]], [...PROPOSED_MEDIA_SCOPES, EBAY_SCOPES[0]],
  [...PROPOSED_MEDIA_SCOPES, EBAY_READINESS_SCOPES[1]], [...PROPOSED_MEDIA_SCOPES, "https://api.ebay.com/oauth/api_scope/sell.account"],
  [...PROPOSED_MEDIA_SCOPES, ...EBAY_READINESS_SCOPES.slice(1)]].map(scopes => ({ scopes })))("rejects missing, duplicate, unrelated and silently combined media permissions $scopes", ({ scopes }) => {
  expect(hasProposedMediaScopes(scopes)).toBe(false); expect(validPhotoPreparationScopes(scopes)).toBe(false);
});
