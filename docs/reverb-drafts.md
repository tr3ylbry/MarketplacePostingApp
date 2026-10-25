# Reverb draft integration

## Contract and scope

Reviewed against current official Reverb documentation on 2026-10-23:
[Personal Tokens](https://www.reverb-api.com/docs/authentication),
[scopes](https://www.reverb-api.com/docs/personal-token-scopes-1),
[Create Listings, taxonomy, conditions and shipping](https://www.reverb-api.com/docs/create-listings),
[SKU reconciliation](https://www.reverb-api.com/docs/build-an-e-commerce-sync-integration),
[Manage Drafts](https://www.reverb-api.com/docs/deleting-a-draft-listing-1),
[Sandbox](https://www.reverb-api.com/docs/testing-on-sandbox),
[headers](https://www.reverb-api.com/docs/http-headers),
[rate limits](https://www.reverb-api.com/docs/rate-limiting-and-terms-of-service),
[errors](https://www.reverb-api.com/docs/error-handling).

This slice supports user-scoped Personal Access Tokens, not a global token and not another OAuth flow. It requests **public, read_listings, write_listings, read_profile**. `read_profile` supplies the connected shop identity and available shipping profiles. No orders, messages, payouts or write-profile scopes are requested. Tokens do not expire automatically according to Reverb; revoke them in Reverb when no longer needed.

Only a deliberately confirmed **Create Reverb Draft** action can POST. Both the application payload and HTTP client force `publish: false`; there is no live-publish option or update endpoint. Ordinary saves, uploads and reorder operations never call Reverb. Existing non-draft remote matches stop for manual resolution rather than altering a live listing.

## Architecture

```text
Authenticated user → owner-scoped Listing
                          ↓
                 Reverb draft preparation
                   ├─ authenticated shop / real category / condition UUIDs
                   ├─ explicit shipping selection
                   └─ deterministic SKU
                          ↓
                 Persisted, version-bound review (10 minutes)
                          ↓ explicit confirmation
                 Short database claim → transaction ends
                          ↓
                 ReverbGateway: SKU lookup (state=all)
                   ├─ one draft match → reconcile
                   ├─ multiple / non-draft matches → stop
                   └─ absent, no uncertain prior POST
                          ↓
                 Owner-loaded images → private 15-minute GET capabilities
                          ↓
                 Short durable POST fence → transaction ends
                          ↓
                 POST publish=false
                          ↓
                 Short MarketplaceListing persistence transaction
```

`src/platforms/reverb.ts` stays pure. `src/application/reverbService.ts` orchestrates owner-scoped use cases. `ReverbGateway` isolates HTTP; `ReverbClient` pins hosts, Bearer/HAL headers, Accept-Version 3.0 and User-Agent, disables redirects/caching, bounds response sizes and sets 15-second request timeouts. Error mapping never includes raw responses, request objects, tokens, SQL or signed URLs. HTTP 412 is handled as validation failure as documented by Reverb, alongside 400, 401, 403, 404, 409, 429 and 5xx. No automatic polling, background workers or aggressive retry loop exists. A 401 marks the connection as needing replacement; transient failures do not erase it.

### Persistence and security

Migration `0003_flawless_lyja.sql` adds:

- `reverb_connections`: one owner/environment connection; AES-256-GCM ciphertext, random 96-bit IV, authentication tag, shop identity and a new UUID version on each replacement. Owner/environment are authenticated additional data, preventing ciphertext swapping across users/environments. Only safe connection metadata reaches client components.
- `reverb_draft_requests`: one listing/environment review and attempt record. It stores confirmed UUIDs/labels/shipping profile, listing and connection versions, expiry, a two-minute operation lease, a sticky POST-attempt flag, and reconciled external ID. No token or image capability URL is stored here. This is explicit-operation state, not a queue.
- Optional provider environment/shop identity on the existing `marketplace_listings`, so Sandbox/live and changed-shop identities cannot be confused. Draft success upserts this existing publication model, leaves `publishedAt` null and canonical lifecycle unchanged, sets `lastSyncedAt`, and advances the listing's edit version.

All entrypoints derive the owner from Better Auth. Foreign listing/review IDs fail before provider access. Review claims and the pre-POST fence recheck ownership, versions and connection state. The server signs only durable image metadata loaded through the owner's repository. Legacy filename-only records must be removed or re-uploaded; they never become invented URLs. Acquisition cost is never included in the provider payload.

The connection key is dedicated, server-only, exactly 32 random bytes encoded as 64 hex characters, and must not equal `BETTER_AUTH_SECRET`. Losing/changing it makes existing credentials unreadable; reconnect with replacement tokens (disconnect remains possible). Back up the key securely with encrypted database backups; a multi-key rotation framework is intentionally deferred. Disconnect removes local encrypted credentials only, does not revoke the PAT/delete remote drafts, and cannot undo an already in-flight provider request.

### Taxonomy, shipping and review

`/settings/integrations/reverb` connects/replaces/disconnects the current user's credential and clearly displays SANDBOX or LIVE. `/listings/[id]/reverb` retrieves actual listable `/api/categories/flat` UUIDs, authenticated `/api/listing_conditions`, and `/api/shop` shipping profiles. Nothing is silently preselected. Preparation resolves selections against fresh provider data, not labels supplied by the browser. The review displays shop, environment, title, make, model, year, finish, full description, category, condition, USD price, shipping, photo count and SKU. Changed listings/images/connections require a fresh review.

Shipping profiles are recommended and explicitly selectable by their real IDs. Alternatively, an explicitly selected canonical `shippingRate` maps to `shipping.rates` for **US_CON (continental US only)**, including a valid zero rate. No guessed shipping profile or international shipping matrix is created. Unsupported optional fields (including videos/inventory/offers) are not sent.

### Duplicate prevention and failure policy

SKU is `crosslist-` plus the first 32 lowercase hex characters of SHA-256(canonical listing ID): stable, 41-character ASCII independent of product edits. Reverb's guide does not specify a maximum SKU length; this representation was accepted in the real Sandbox smoke test on 2026-10-24.

Each confirmed action first checks local publication identity and looks up the exact SKU using `state=all`. Pagination follows only same-host listing links preserving SKU/state, has a bounded page limit, and fails closed if incomplete. One matching draft is adopted, multiple matches require manual resolution, and local IDs cannot silently be replaced by a different remote ID. Legacy/imported external identities without authoritative environment/shop information require manual resolution.

The short DB lease blocks overlapping clicks. A durable fence is recorded immediately before POST and survives process/DB failure. Timeouts, 5xx and malformed success responses trigger a single reconciliation lookup, **never another POST**. If nothing is visible yet, later explicit actions may reconcile, but will not POST again: absence can reflect delayed provider indexing. An operator must resolve a truly failed ambiguous attempt rather than clearing state blindly. Explicit 400/412 validation, 401/403 permission or 429 rejection allows a later corrected attempt; SKU lookup still happens first. This conservative policy trades convenience for duplicate safety.

Remote success followed by local persistence failure does not delete the remote draft. It reports an uncertain local result and the next action reconciles by SKU. No PostgreSQL transaction/row lock is intentionally held across Reverb calls or Blob signing. Normal listing edits after a remote request starts can make the remote draft older than the local item; this slice does not sync edits. Inspect/edit the draft on Reverb rather than expecting an update call.

### Private photo ingestion

`ProviderImageAccess` is separate from the normal 60-second browser read. It signs private GET capabilities for **15 minutes**, generated only after confirmation and sent server-to-Reverb in `photos`. They never enter review/client responses, persistence or application logs. Blob remains PRIVATE. These are bearer capabilities until expiry; Reverb retains its downloaded copies. Deleting local images does not delete copies already ingested by Reverb. Operators must redact query strings in any future tracing/proxy/APM. Real Sandbox testing must confirm Reverb downloads the photos within this bounded TTL.

## Local setup and tests

1. Use the existing local PostgreSQL Compose environment and separate `_test` database. Apply committed migrations with `npm run db:migrate`; never schema push.
2. Preserve ignored `.env.local`; add `REVERB_ENVIRONMENT=sandbox` and a dedicated `REVERB_CREDENTIAL_ENCRYPTION_KEY`. Generate the latter securely from Node `crypto.randomBytes(32).toString("hex")` directly into the ignored server environment, without printing it. Use owner-only permissions. Do not reuse another key or use `NEXT_PUBLIC_`.
3. Start the loopback application, authenticate through GitHub, and open Reverb integration settings. Enter the Sandbox PAT there, not in chat, source, shell history or a global environment token.
4. Run `npm run check`: lint, strict typecheck, unit/component tests, real PostgreSQL integration tests, production build and Chromium E2E. Individual commands remain available in the README.

CI needs no real Reverb credentials. A build-time-only `@reverb-gateway` alias wires the real HTTP parser to a secret-protected loopback fake service for E2E. Production cannot select arbitrary hosts or enable this adapter through browser data/runtime flags. Tests use synthetic PATs, an ephemeral encryption key, genuine test database sessions and the isolated local image capability service. The fake ingests image bytes, counts POSTs, and proves ordinary saves make zero POSTs while repeated confirmations reconcile to one draft. PostgreSQL tests cover ownership, encryption, stale versions, concurrent actions, uncertain POST/local-commit outcomes and transaction boundaries. Adapter tests cover headers/hosts/taxonomy/status errors and malformed/time-out responses; Blob tests separately assert ingestion TTL.

## Real Sandbox smoke procedure (required before calling provider validation complete)

1. Create/sign into [Reverb Sandbox](https://sandbox.reverb.com/signup), not live Reverb. Finish shop/profile setup. The official sync guide requires billing setup and a first manually created listing; use only Reverb's documented Sandbox test payment details, never a real card. Account/payment/security confirmations are manual user actions.
2. Under My Profile → API & Integrations → Generate New Token, choose only **public, read_listings, write_listings, read_profile**. Enter the token through the local connection UI; never paste it into chat.
3. Verify SANDBOX/shop identity, create a disposable local listing and upload one or two small durable PRIVATE Blob images.
4. Select real category/condition and shipping, review the payload, and explicitly create a draft. Verify one Sandbox draft, successfully ingested photos and local external ID/status with no publication timestamp.
5. Prepare/confirm again and verify no second draft. Inspect owner denial and safe errors as practical.
6. Delete only the disposable Sandbox draft (UI or documented `DELETE /api/listings/{id}`), delete the local listing/images, drain due image cleanup after its grace period, and disconnect the disposable connection as appropriate. Keep shared infrastructure. Do not delete unrelated resources.

**Real Sandbox draft creation and photo ingestion passed on 2026-10-24.** The local-only application used the real GitHub-backed session, encrypted Sandbox PAT and development PRIVATE Blob store. A disposable Boss DS-1 listing used real Distortion/Good selections, $50 USD price, explicit $10 US_CON shipping (zero shipping profiles), and two generated images. Reverb accepted `publish=false` with HTTP 202, returned a draft, and served both ingested images from its own image CDN with HTTP 200. Local publication identity/state matched, with `publishedAt` unset. A repeated confirmed action kept one remote SKU match and one observed create POST; an ordinary local title edit left the remote draft unchanged. Documented draft deletion returned HTTP 200 and subsequent SKU lookup returned zero matches.

The real category response exposed one legacy 36-character hexadecimal GUID without RFC UUID version/variant bits. Category parsing and selection now accept GUID syntax while still validating names, listability and membership in freshly retrieved provider options. Condition IDs and local review IDs remain strict UUIDs. Synthetic adapter/application regression tests cover the observed shape and malformed/unknown categories.

Live-account testing is never implied by `REVERB_ENVIRONMENT=live` and requires explicit separate authorization. Live mode still forces draft-only behavior.

## Deferred

No live publishing, sync/update endpoint, orders, offers, messages, payouts, eBay API, Facebook automation, jobs, queues, AI, teams, billing or public deployment. Additional operational controls (PAT rotation automation, rate-limit scheduling, ambiguous-attempt operator UI, remote deletion UI and photo ingestion observability) are future focused work, not hidden background behavior.
