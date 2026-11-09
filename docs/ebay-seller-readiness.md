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

The next slices remain [plans for EPS and guarded inventory staging](ebay-next-slices.md), not implemented capabilities.
