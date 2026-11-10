# Read-only eBay Sandbox seller readiness

This Stage 9B slice inspects existing seller settings. It cannot enroll a seller, create policies/locations, transfer photos, stage inventory, create offers or publish. The app remains local. The read-only grant and authenticated seller identity passed earlier development acceptance; complete readiness, refresh and runtime privacy acceptance remain separate gates. The enrollment-aware behavior below still needs its own bounded real Sandbox acceptance. PR #9's real metadata evidence does not validate these seller endpoints.

## Explicit permissions and actions

The existing base identity grant remains valid and unchanged. From integration settings, **Authorize read-only seller checks** deliberately requests the base scope plus:

- `https://api.ebay.com/oauth/api_scope/sell.account.readonly`
- `https://api.ebay.com/oauth/api_scope/sell.inventory.readonly`

Both read-only alternatives are present in the current endpoint contracts. No account-write or inventory-write scope is requested. Refreshing an old token cannot gain permissions. A seller must explicitly approve this grant before these checks can work. Reuse the existing verified read-only connection when valid; do not repeat consent simply to inspect settings.

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

### Narrow empty-location compatibility

A real Sandbox HTTP 200 returned an explicit zero-length `locations` array while omitting `total`, `offset` and `limit`. The retained sanitized observation confirms the array and omitted fields; no raw provider body is stored. The official response schema lists those properties without marking them required, although its `total` prose expects zero when no items are found. This is observed behavior, not a guarantee that every empty response has the same fields.

The adapter accepts this case only on the first location request (`offset=0`, `limit=100`) with HTTP 200 and an explicitly validated empty array. Each present metadata field must be exact: `total=0`, `offset=0`, `limit=100`. No `next`, `prev` or other continuation/unknown field is accepted. An optional bounded current-page `href` is discarded, never followed or returned. Missing/null/malformed `locations`, contradictory metadata and partial/async HTTP responses remain failures. The result carries only the verified empty collection; absent provider pagination metadata is not fabricated or returned as evidence.

Nonempty pages retain the original required pagination schema, stable totals, exact offsets/limits, strict reconstructed next-page requests, duplicate/50-character key checks, locationTypes validation and all page/item/request/time/byte caps. The exception cannot accept an empty later page during incomplete pagination. Registration, enrollment and unavailable policy results are preserved; Inventory write eligibility stays unverified and all resource-write flags remain false.

Synthetic adapter and PostgreSQL regressions cover absent/full/partial metadata, contradictory or malformed fields and continuation, missing locations, incomplete later pages and owner/version fences. The fake-provider Chromium unenrolled-seller workflow now uses the observed sparse empty representation and must display a complete readiness report with no passive requests, policy calls, stored credentials or resource writes. **The corrected flow has not yet passed a new real Sandbox retest.** Real nonempty/multi-page/default-created locationTypes and runtime browser storage/cookie attributes remain unverified. Registration was still incomplete and enrollment absent in the prior real run; this correction changes no seller setting.

### Policy availability and independent location reads

The policy group is a discriminated result. Only `available` contains `collections` for fulfillment, payment and return:

| State | Meaning |
| --- | --- |
| `available` | All three collections were successfully and completely validated; each may legitimately be empty. |
| `not-enrolled` | The validated program response lacks `SELLING_POLICY_MANAGEMENT`. Skip all three policy requests. |
| `ineligible` | An enrolled seller received the narrowly recognized policy eligibility rejection. Discard any partial policy collections. |
| `unknown-failure` | A bounded, well-formed policy HTTP 400 has no verified eligibility explanation. This is a failed policy inspection, with no accepted collections. |

A known unavailable policy group does not suppress independent inventory-location inspection. A well-formed unknown policy validation rejection also permits location reads, while remaining visibly failed rather than masquerading as an empty/successful policy result. Remaining policy calls stop after either rejection; there is no retry. Authentication/permission failures, 404, rate limiting, 5xx, transport/timeouts, malformed responses and exhausted budgets abort the entire report. Owner/seller/connection-version checks still bracket the whole inspection; stale partial results are never returned.

The eligibility exception requires policy HTTP 400, exactly one validated error, numeric `20403`, domain `API_ACCOUNT`, category `REQUEST` and the verified eligibility-specific message template. The official code is generic enough to describe other invalid fields, so its number alone is insufficient. Parse only bounded allowlisted error fields in server memory (at most ten errors, a 16 KiB decoded error body, bounded message lengths); discard provider messages, parameters and other fields. No raw error enters the browser, database or logs. Unknown errors are never coerced into empty lists.

Unenrolled guidance directs the seller to manage enrollment on eBay; the app never enrolls or creates resources. Registration, policy availability and location results are shown separately. Unavailable policy controls are disabled and temporary selections reset on every explicit check. Inventory write eligibility remains unverified; this is not a fully-ready or publish-capable seller result. [eBay's business-policy guide](https://developer.ebay.com/api-docs/sell/static/seller-accounts/business-policies.html) describes the enrollment requirement.

Policies expose only bounded ID, name and category types. They must belong to `EBAY_US`, have unique numeric IDs and valid category groups. Non-motor candidates are selectable; exact leaf/category, fulfillment services and shipping suitability remain unverified. The canonical shipping rate is not an eBay fulfillment policy. No nonexistent default policy is manufactured.

Locations expose bounded key/name and enabled/warehouse/address-completeness flags. Only enabled warehouses with postal code or city plus region are selectable. Full addresses, telephone numbers and financial amounts are discarded. The provider does not attach a marketplace ID to a warehouse: a non-US warehouse is not automatically invalid for `EBAY_US`; regional suitability remains a future check. Other location types are displayed as unsupported by this initial slice.

The [official location guide](https://developer.ebay.com/api-docs/sell/static/inventory/managing-inventory-locations.html) permits `merchantLocationKey` values up to **50 characters**. The list-response parser accepts that limit without truncation; longer, empty or unsafe text still fails. The downloaded v1.18.5 OpenAPI retains conflicting 36-character prose on individual-location path parameters, while its list-response key has no explicit maximum. This slice uses list GETs only and follows the guide's 50-character limit; it does not call individual-location or creation endpoints.

**Unresolved GET representation:** the guide and `InventoryLocationFull.locationTypes` describe omission at creation defaulting to `WAREHOUSE`. `InventoryLocationResponse.locationTypes` describes the returned function, but neither it nor the list-response schema marks the property required or guarantees materialization of a creation-time default. That is insufficient evidence that GET always includes the effective type. No response fallback is added: missing, null or empty `locationTypes` continues to fail safely. Real acceptance must inspect its presence/type and recognized values without exposing keys or addresses. If no existing location known to have used the creation default is available, that specific coverage remains pending; do not create one to resolve it without separate approval.

## Meaning of readiness

- **Prepare a local review:** existing metadata preparation remains available with the base connection.
- **Stage inventory:** not implemented. Registration/Inventory reads do not prove write eligibility.
- **Create an unpublished offer:** not implemented. Missing publish-only policies/location do not necessarily prevent a sparse unpublished offer.
- **Publish later:** unavailable. Registration, limits, enrollment, suitable policies/location, category/shipping and other publishing requirements need fresh validation.

Missing settings produce deliberate account-setup guidance, never automatic enrollment or resource creation. Account privileges are a limited observation, not an exhaustive financial/compliance audit. Current [default call limits](https://developer.ebay.com/develop/get-started/api-call-limits) are account-wide ceilings, not a promise of this keyset's entitlement. This client serializes three to fifteen requests per inspection (three to twelve when not enrolled), fails on 429 without automatic retries, and does not run load tests.

## Security, bounds and acceptance

The server derives owner identity, checks the owned listing/version before credential access, and obtains a token context tied to the exact connection/refresh version and seller. It checks that binding before and after all reads and rejects intervening edits, disconnects and reconnects. No network call runs inside a database transaction. Apart from an explicitly needed existing token refresh, readiness performs no database writes.

Responses are capped at 1 MiB decoded per request and 8 MiB per inspection, 15 seconds per HTTP call and 45 seconds overall, at most 500 policies per type and 1,000 locations. Unsupported/truncated responses fail closed. Redirects, arbitrary hosts and untrusted pagination are rejected. Errors contain no provider body, token or contact data. There is no raw seller-response cache or logging.

Fake-provider, component, PostgreSQL and Chromium tests cover scope/state upgrades and preservation, foreign ownership, stale versions, no provider I/O in transactions, exact methods/scopes, empty/malformed data, paging, HTTP failures, privacy and zero passive traffic. CI uses only disposable local credentials and fixtures.

Before further real acceptance: review the corrected draft PR and approve the bounded procedure below. The earlier real run verified the read-only grant/identity, then observed incomplete registration and no opted-in programs; a separately approved diagnostic confirmed policy eligibility rejection. A later authorized run verified normal refresh, unchanged GetUser identity, policy skipping and one location HTTP 200, but the old parser rejected its empty response without pagination metadata. That evidence does not establish successful delivery of the corrected complete report, nonempty location shapes or runtime browser storage/cookie behavior. Two-owner automated isolation is not represented as real two-owner consent evidence. Preserve the original Reverb ciphertext and separate missing-key recovery task.

### Proposed next bounded read-only acceptance — requires separate approval

1. **Preflight, no provider calls:** verify reviewed head/green CI, ignored owner-only environment, existing migrations, trusted HTTPS on 127.0.0.1 only and the real GitHub owner session. Require the existing verified Sandbox connection with the exact read-only grant and an access token valid for at least two more minutes. Compare safe encrypted-row/version evidence without printing identifiers or envelopes. If disconnected, expired, near expiry or otherwise unusable, stop: no reconsent, authorization-code exchange, expiry adjustment or automatic refresh is included. One normal refresh plus its one GetUser may run before inspection only under separate explicit approval, adding at most two calls (fourteen overall including the twelve-GET ceiling). Recheck the same seller, grant, encrypted persistence and version after any approved refresh. If no suitable owned listing exists, ask separately before creating/removing a local-only fixture.
2. **Passive behavior:** open/reload settings and the owned listing page. A safe method/path counter must show zero eBay requests. No Connect/Reconnect or metadata action. Install only temporary diagnostic guards, outside source, that permit the next step's fixed GETs and block token/identity/policy or other requests without revealing headers or bodies.
3. **One explicit readiness action:** permit one GET each for privilege and opted-in programs, then at most ten inventory-location pages using reconstructed `limit=100&offset=N`. **Maximum twelve authenticated GETs**, with the existing 15-second request, 45-second overall, 1 MiB/request, 8 MiB/inspection and 1,000-location bounds. No retries. Require the expected absent enrollment and accurate `not-enrolled` policy status, with zero policy GETs. If enrollment unexpectedly changed, stop before policy calls and obtain a revised plan. No other authenticated endpoint is allowed.
4. **Actual results:** registration and program results remain separate from policy availability. Validate all returned location pages and safe flags. If locations exist, record only locationTypes presence/type/recognized values and counts, never keys/names/addresses. Missing/null/empty required types fail safely for any returned object. If the first page has an explicit empty array, accept only the narrow validated case above and verify the complete report shows incomplete registration, not-enrolled policies, zero policy calls and no usable warehouses without invented metadata. If there are no locations, report verified empty results; do not claim actual multi-page or default-created-type coverage and do not create a location for the test. Inventory write eligibility remains unverified.
5. **Privacy and consistency:** verify owner/listing/connection bindings before and after, encrypted credential and expiry preservation, safe browser response fields and no sensitive query/body logging. Inspect native localStorage/sessionStorage in a supported browser or owner-assisted DevTools check; report only counts/flags. Inspect actual cookie Secure/HttpOnly attributes with a supported cookie inspector or DevTools Application/Cookies, without values. A document.cookie count alone cannot establish cookie attributes, and unsupported APIs remain NOT VERIFIED. Fake-provider stale-version, foreign-owner and concurrent reconnect tests remain distinct from real coverage. Ordinary Save has automated zero-traffic coverage; no unnecessary edit is part of this read-only test.
6. **Stop and cleanup:** stop on unexpected auth/scope/identity, TLS/session, HTTP/schema, pagination, rate-limit or timeout behavior. No extra diagnostic, second inspection or automatic refresh. Keep the intended connection and infrastructure. Remove any separately approved local fixture, temporary diagnostics and test-only app process; preserve credentials, Reverb ciphertext and all workspace files. Record actual outcomes separately from untested branches. No enrollment, policy/location/media/inventory/offer/listing mutation, Production access, tunnel, application deployment or merge.

The prior 34-call consent/refresh procedure was stopped and is not permission to resume. Refresh and any additional endpoint/consent testing require their own reviewed approval. Seller enrollment is needed for later business-policy use, but is not required merely to inspect independent locations; no enrollment is performed by this slice. Missing publish-only prerequisites are not treated as an automatic sparse unpublished-offer prohibition.

The next slices remain [plans for EPS and guarded inventory staging](ebay-next-slices.md), not implemented capabilities.
