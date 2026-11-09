# Read-only eBay Sandbox seller readiness

This Stage 9B slice inspects existing seller settings. It cannot enroll a seller, create policies/locations, transfer photos, stage inventory, create offers or publish. The app remains local; all real seller authorization and API acceptance for this permission expansion are **pending separate owner approval**. PR #9's real metadata evidence does not validate these seller endpoints.

## Explicit permissions and actions

The existing base identity grant remains valid and unchanged. From integration settings, **Authorize read-only seller checks** deliberately requests the base scope plus:

- `https://api.ebay.com/oauth/api_scope/sell.account.readonly`
- `https://api.ebay.com/oauth/api_scope/sell.inventory.readonly`

Both read-only alternatives are present in the current endpoint contracts. No account-write or inventory-write scope is requested. Refreshing an old token cannot gain permissions. A real seller must approve this new grant before these checks can work; that consent has not been performed for this slice.

Migration `0007_goofy_famine.sql` adds requested scopes to each one-use OAuth state. Existing pending states default to their original base grant. The base configuration fingerprint and encryption AAD are unchanged; existing encrypted connections are not rotated or invalidated by adding the optional profile. State consumption still checks owner, session, configuration, expiry and connection version. Cancellation, insufficient scopes, token-exchange failure or a different/unverified seller leaves the existing verified connection intact. Only a fully verified grant replaces credentials through the existing version fence. Reconnect retains an expanded grant; refresh must retain its recorded scope set, with omission preserving that set.

Open an owned listing's eBay preparation page and click **Check eBay Seller Readiness**. Rendering, reload, local Save and temporary selection make zero provider requests. No polling or cached seller report is added. Results and selected policy/location keys remain transient component state, with no localStorage/sessionStorage or database storage. A new explicit check clears earlier choices.

## Provider contract

Reviewed 2026-11-09 against official [Account v1.9.3 OpenAPI](https://developer.ebay.com/api-docs/master/sell/account/openapi/3/sell_account_v1_oas3.json) and [Inventory v1.18.5 OpenAPI](https://developer.ebay.com/api-docs/master/sell/inventory/openapi/3/sell_inventory_v1_oas3.json). Runtime pins `https://api.sandbox.ebay.com`; there is no Production fallback. These are seller-authorized reads, never application-token metadata calls.

| Method/path | Query | Scope suffix | Returned information |
| --- | --- | --- | --- |
| GET `/sell/account/v1/privilege` | None | `sell.account.readonly` | Registration complete; zero monthly quantity limit warning |
| GET `/sell/account/v1/program/get_opted_in_programs` | None | `sell.account.readonly` | Whether `SELLING_POLICY_MANAGEMENT` is present |
| GET `/sell/account/v1/fulfillment_policy` | `marketplace_id=EBAY_US` | `sell.account.readonly` | Existing fulfillment-policy candidates |
| GET `/sell/account/v1/payment_policy` | `marketplace_id=EBAY_US` | `sell.account.readonly` | Existing payment-policy candidates |
| GET `/sell/account/v1/return_policy` | `marketplace_id=EBAY_US` | `sell.account.readonly` | Existing return-policy candidates |
| GET `/sell/inventory/v1/location` | `limit=100&offset=N` | `sell.inventory.readonly` | Existing location candidates |

Account lists currently return all policies; their pagination fields are reserved for future use. The client requires complete totals, with no active continuation, rather than inventing paging arguments. Locations use item offsets: the client validates stable totals, unique keys and exact next-page identity, but constructs each request itself instead of following a provider URL. Empty arrays are valid; omitted/malformed required fields fail safely. A 404 is an unavailable result, not fabricated proof of zero settings.

Policies expose only bounded ID, name and category types. They must belong to `EBAY_US`, have unique numeric IDs and valid category groups. Non-motor candidates are selectable; exact leaf/category, fulfillment services and shipping suitability remain unverified. The canonical shipping rate is not an eBay fulfillment policy. No nonexistent default policy is manufactured.

Locations expose bounded key/name and enabled/warehouse/address-completeness flags. Only enabled warehouses with postal code or city plus region are selectable. Full addresses, telephone numbers and financial amounts are discarded. The provider does not attach a marketplace ID to a warehouse: a non-US warehouse is not automatically invalid for `EBAY_US`; regional suitability remains a future check. Other location types are displayed as unsupported by this initial slice.

The [official location guide](https://developer.ebay.com/api-docs/sell/static/inventory/managing-inventory-locations.html) permits `merchantLocationKey` values up to **50 characters**. The list-response parser accepts that limit without truncation; longer, empty or unsafe text still fails. The downloaded v1.18.5 OpenAPI retains conflicting 36-character prose on individual-location path parameters, while its list-response key has no explicit maximum. This slice uses list GETs only and follows the guide's 50-character limit; it does not call individual-location or creation endpoints.

**Unresolved GET representation:** the guide and `InventoryLocationFull.locationTypes` describe omission at creation defaulting to `WAREHOUSE`. `InventoryLocationResponse.locationTypes` describes the returned function, but neither it nor the list-response schema marks the property required or guarantees materialization of a creation-time default. That is insufficient evidence that GET always includes the effective type. No response fallback is added: missing, null or empty `locationTypes` continues to fail safely. Real acceptance must inspect its presence/type and recognized values without exposing keys or addresses. If no existing location known to have used the creation default is available, that specific coverage remains pending; do not create one to resolve it without separate approval.

## Meaning of readiness

- **Prepare a local review:** existing metadata preparation remains available with the base connection.
- **Stage inventory:** not implemented. Registration/Inventory reads do not prove write eligibility.
- **Create an unpublished offer:** not implemented. Missing publish-only policies/location do not necessarily prevent a sparse unpublished offer.
- **Publish later:** unavailable. Registration, limits, enrollment, suitable policies/location, category/shipping and other publishing requirements need fresh validation.

Missing settings produce deliberate account-setup guidance, never automatic enrollment or resource creation. Account privileges are a limited observation, not an exhaustive financial/compliance audit. Current [default call limits](https://developer.ebay.com/develop/get-started/api-call-limits) are account-wide ceilings, not a promise of this keyset's entitlement. This client serializes six to fifteen requests per inspection, fails on 429 without automatic retries, and does not run load tests.

## Security, bounds and acceptance

The server derives owner identity, checks the owned listing/version before credential access, and obtains a token context tied to the exact connection/refresh version and seller. It checks that binding before and after all reads and rejects intervening edits, disconnects and reconnects. No network call runs inside a database transaction. Apart from an explicitly needed existing token refresh, readiness performs no database writes.

Responses are capped at 1 MiB decoded per request and 8 MiB per inspection, 15 seconds per HTTP call and 45 seconds overall, at most 500 policies per type and 1,000 locations. Unsupported/truncated responses fail closed. Redirects, arbitrary hosts and untrusted pagination are rejected. Errors contain no provider body, token or contact data. There is no raw seller-response cache or logging.

Fake-provider, component, PostgreSQL and Chromium tests cover scope/state upgrades and preservation, foreign ownership, stale versions, no provider I/O in transactions, exact methods/scopes, empty/malformed data, paging, HTTP failures, privacy and zero passive traffic. CI uses only disposable local credentials and fixtures.

Before real acceptance: review the draft PR; approve the exact read-only scope consent, code exchange and possible refresh; apply committed migration; use trusted local HTTPS and the existing verified seller; then explicitly inspect the six endpoints and verify sanitized results/empty behavior. Stop for unexpected scope, identity, callback or schema behavior. Do not create missing policies/locations to make a test pass. Two-owner real OAuth remains separately deferred; automated two-owner isolation is not represented as real consent evidence. Preserve the original Reverb ciphertext and separate missing-key recovery task.

### Proposed bounded real acceptance — not authorized or executed

1. **Local preflight:** verify reviewed head/CI, ignored owner-only configuration, committed migration, trusted loopback-only HTTPS, real GitHub session and the existing owner's verified Sandbox seller connection. Snapshot only safe metadata/boolean encryption evidence and version bindings; never dump credentials. Use an existing owned local listing. If none exists, obtain separate permission for a local-only fixture before testing; this plan creates no listing or provider resource.
2. **One explicit permission upgrade:** use the existing seller and registered Sandbox RuName. Review exactly the base `api_scope`, `sell.account.readonly` and `sell.inventory.readonly` scopes, then approve once. Allow one authorization-code exchange and the application's fresh authenticated Trading GetUser read. Require its stable identity hash to match the existing connection, valid one-use session-bound state, safe callback/query handling, encrypted persistence and exact granted scopes. Stop on any unexpected consent, identity, callback or scope behavior; no speculative second consent/exchange.
3. **First explicit readiness check:** one GET each for privilege, opted-in programs and EBAY_US fulfillment/payment/return policies; inventory locations at `limit=100`, following all validated item-offset pages. At most ten location pages/1,000 locations and fifteen GETs total, within existing time/byte ceilings. Verify registration/quantity-warning semantics, enrollment, policy IDs/marketplace/category groups and warehouse status/completeness. Record only statuses, shape/type/presence flags, counts and sanitized conclusions. No raw bodies, contact details, keys, policy IDs or names in evidence.
4. **Empty/partial account coverage:** inspect only settings actually present. Empty lists and incomplete registration/enrollment/settings should yield accurate guidance when their response shape meets the contract. Record null/omitted fields or provider errors structurally and stop on parser/provider mismatch; do not weaken validation or invent defaults. Check `locationTypes` as described above. Do not create policies/locations or modify seller setup to obtain coverage. If the existing seller has one page or no locations, record complete single-page/empty coverage; real multi-page/default-created-location coverage remains untested, with fake pagination tests retained.
5. **One controlled refresh, then one second readiness check:** approval must explicitly include moving only this owner's cached access-expiry timestamp into the past locally (not changing the token, refresh expiry, identity or ciphertext), then invoking the existing authorization check once. Allow at most one refresh exchange and its fresh GetUser identity check. Require the same seller, recorded scopes, safe replacement-token handling (retain the known refresh token if omitted), new version fence and encrypted persistence. Repeat the readiness check once under the new context. If refresh is revoked, inconsistent or uncertain, stop and preserve the reconnect fence; do not retry blindly.
6. **Privacy and boundaries:** compare passive navigation/reload against safe method/path counters; no provider call should occur. Ordinary local Save remains automated coverage; do not edit a listing for this read-only acceptance. Inspect client responses and Web Storage/cookies without exposing values. Confirm tokens/envelopes/headers and signed URLs are absent, callbacks are not query-logged, safe report fields only, and network operations remain outside transactions. Verify before/after owner/listing/connection versions; deliberate two-owner and reconnect/disconnect races remain automated coverage, not claimed real tests. No second GitHub owner or second seller authorization is implied.
7. **Ceiling and stop:** two readiness runs (maximum thirty GETs), one code exchange, one refresh and two GetUser reads: **at most 34 eBay API requests**, plus one consent navigation. Stop at the first auth/identity/schema/TLS/session/rate-limit/timeout/unexpected provider result; no automatic retries or additional diagnostic calls without approval. No account-setting, policy, location, media, inventory, offer or listing mutation; no Production call, tunnel or deployment.
8. **Finish:** retain the valid intended Sandbox connection and development infrastructure, stop any acceptance-only local app/diagnostics, remove temporary diagnostics and record sanitized actual results separately from untested branches. Do not disconnect/revoke or remove existing local data. Preserve Reverb ciphertext, local credentials and workspace file. PR #10 stays draft/unmerged until review and acceptance are separately completed.

The next slices remain [plans for EPS and guarded inventory staging](ebay-next-slices.md), not implemented capabilities.
