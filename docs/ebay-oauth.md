# eBay Sandbox seller connection

Stage 9A adds a seller-connection foundation, **not inventory or publishing**. The application stays local at `https://127.0.0.1:3000`; eBay is Sandbox only. Real two-seller OAuth/identity validation remains a separate, explicitly authorized acceptance gate. Portal URL acceptance is not evidence of callback delivery or trustworthy identity.

## Local HTTPS and GitHub

Use the existing PostgreSQL Compose setup and ignored `.env.local`. Preserve existing secrets, especially encryption keys: replacing a key cannot decrypt saved credentials.

`npm run dev:https` uses Next.js HTTPS directly, binds only to `127.0.0.1:3000`, and sets `BETTER_AUTH_URL=https://127.0.0.1:3000` for its process. It never installs a CA, changes trust, generates certificates, deploys or opens a tunnel. HTTP `npm run dev` remains available, but its auth origin and GitHub callback must match HTTP.

Obtain operator approval **before** installing/trusting a local CA. The approved macOS setup uses mkcert, then a certificate with the **127.0.0.1 IP SAN** at:

- `~/.local/share/marketplace-posting-app/tls/127.0.0.1.pem`
- `~/.local/share/marketplace-posting-app/tls/127.0.0.1-key.pem`

Keep the directory/private key owner-only and outside Git. Never commit a local CA key. Never bypass browser TLS warnings. The launcher checks SAN, key match and validity before starting. Trust installation may require a human macOS approval; Firefox has a separate trust store and is not assumed to trust this CA.

With approval, configure the development GitHub OAuth app homepage as `https://127.0.0.1:3000` and callback as `https://127.0.0.1:3000/api/auth/callback/github`. HTTP and HTTPS sessions/callbacks are not interchangeable. Better Auth already supports exact HTTPS origins, Secure/HttpOnly/SameSite=Lax cookies, CSRF/origin checks and database sessions; those checks stay enabled.

Apply committed migrations with `npm run db:migrate`, then run `npm run dev:https`. The documented `skipProxyUrlNormalize` setting preserves the original request URL: Next's default loopback normalization otherwise turns `127.0.0.1` into `localhost`. Callback validation still requires exact scheme/IP/port/path/Host and rejects foreign forwarded-host/protocol values. No reverse proxy or request-derived trusted origin is used.

## Server-only configuration

Set these only in ignored, owner-readable server configuration; never print values or use `NEXT_PUBLIC_`:

- `EBAY_ENVIRONMENT=sandbox`
- `EBAY_SANDBOX_CLIENT_ID`
- `EBAY_SANDBOX_CLIENT_SECRET`
- `EBAY_SANDBOX_RUNAME`: the existing registered Sandbox **RuName**, not a callback URL
- `EBAY_CREDENTIAL_ENCRYPTION_KEY`: dedicated 32 random bytes encoded as 64 hex characters; never reuse auth/Reverb keys

The registered HTTPS routes are `/api/integrations/ebay/callback` and `/api/integrations/ebay/declined`. The app does not modify portal settings or the separately published privacy policy. Production/Vercel runtime configuration and other app origins fail closed for this local-only slice.

Only `https://api.ebay.com/oauth/api_scope` is requested: the base user scope for read-only Trading GetUser. Inventory, account-write, orders, payouts and marketing scopes are not requested. Later features need a reviewed permission expansion. An omitted token-response scope retains the originally requested permissions; explicit missing/expanded permissions are rejected.

## Boundaries and database

```text
GitHub-backed session → explicit Connect eBay Sandbox
  → short DB state/version transaction → Sandbox consent using RuName
  → exact-origin callback + same active session
  → atomic one-use state consumption → commit
  → server-side code exchange → authenticated GetUser identity
  → independently encrypt tokens → conditional connection write
```

`EbayConnectionService` coordinates the flow. `EbayGateway` exposes only exchange, refresh and identity. `EbayClient` pins Sandbox hosts/paths, forbids redirects, bounds bodies and uses 15-second timeouts. It contains no inventory, offer, image or listing operation. Settings rendering reads local state only; explicit actions/callbacks initiate provider traffic, not effects or polling.

Migration `0006_broken_warbird.sql` adds two tables without changing existing listing/Reverb data:

- `ebay_connections`: owner foreign key, Sandbox-only environment, verified seller hash/label, scopes/expiries, encrypted access/refresh envelopes, config fingerprint, UUID version and refresh lease. A seller cannot attach to different application owners. Disconnect clears credentials/identity but keeps a versioned tombstone to fence in-flight work.
- `ebay_oauth_states`: SHA-256 state/session hashes, owner/config/connection-version binding, ten-minute expiry and consumed timestamp. Raw state is not stored. New authorization supersedes old pending state; concurrent callbacks cannot consume state twice.

AES-256-GCM uses independent random 96-bit IVs/tags for each token. AAD binds format, token kind, owner, Sandbox, connection, configuration and verified seller. Envelopes have a key version, not an implemented multi-key rotation service. Back up keys securely with encrypted backups. Tampering/wrong context/lost keys fails closed and requires reconnect.

All network I/O occurs **outside PostgreSQL transactions**. Conditional version checks guard credential commits. Refresh claims a 90-second lease, performs bounded HTTP and verifies the same seller before commit. Missing replacement refresh tokens retain the original encrypted token and expiry; rotations get fresh envelopes. Expiry starts before provider work, not after network delay. Stale workers cannot overwrite reconnect/disconnect or invalidate a newer lease. Revocation, `invalid_grant`, uncertain refresh outcomes and identity mismatch require reconnect rather than blind retry.

## Trustworthy seller identity

Commerce Identity documents restricted access and mocked Sandbox responses, so it is **not identity proof** here. The narrow fallback is Trading GetUser with the OAuth token in the IAF header, no browser-supplied target UserID, and output selectors only for `User.EIASToken` and `User.UserID`.

The bounded strict XML parser rejects malformed XML, DTD/entities, wrong namespaces and missing/redacted/mock-shaped identifiers. It hashes the documented username-independent EIASToken into a source/environment-namespaced stable ID and retains only a safe username label. This EIASToken is an identity field, not an OAuth credential. Raw XML/profile/contact data is not persisted. Reconnect/refresh cannot silently switch sellers; switching needs explicit disconnect.

This contract is **not yet real two-seller proof**. Before acceptance, separately authorize A and B, demonstrate stable repeated identities and distinct hashes, and stop if Sandbox supplies static/mock identities. Parser/fake-provider success does not satisfy that gate.

## Callback and browser privacy

Callbacks require the initiating active database session and one-use state before code exchange. Duplicate parameters, expired/replayed state, wrong session/config/version and foreign origins fail closed. Denial consumes valid state without credentials. A declined redirect lacking state displays cancellation but mutates no pending state/connection; actual provider decline parameters remain a real-validation gate.

Callback responses are private/no-store, no-referrer, nosniff and asset-free with a restrictive CSP. Processing redirects to a fixed clean settings URL; codes/state are never echoed. UI/actions expose safe status/label/permission metadata, not tokens/envelopes/headers. No token belongs in localStorage/sessionStorage. Development logging excludes eBay and GitHub callback paths; provider errors omit raw bodies. Future proxy/APM must preserve those redaction rules.

Disconnect removes local credentials and invalidates pending work, but does **not** revoke provider consent remotely. Revoke through eBay separately if needed. A transmitted request cannot be recalled; stale results cannot restore disconnected credentials.

## Validation and next approval

`npm run check` covers lint, typecheck, unit tests, PostgreSQL integration, build and Chromium. Tests cover state/replay/expiry/session isolation, denial/codes/scopes, encryption/AAD/tampering, seller ownership/conflicts, rotation/missing replacement, lease/version races, revocation, strict hosts/HTTP/XML, passive zero traffic, browser storage and disconnect. CI uses the real client/parser with a secret-protected loopback fake on port 4313 and a disposable `_test` database. Build-time test aliases cannot run on Vercel. No real keyset/token is required; eBay traces are disabled.

On 2026-11-05, trusted local HTTPS, real GitHub sign-in/reload, sign-out and signed-out inventory denial passed without a TLS bypass/deployment. This real eBay plan requires **separate authorization**:

1. Before consent, approve an accurate published privacy notice, securely configure the existing Sandbox keyset/RuName, recover the original Reverb encryption key without replacing it, and verify trusted loopback HTTPS, GitHub session continuity and green automated checks. Obtain separate owner approval for this real procedure; preparing the runbook is not authorization to execute it.
2. Sign in through GitHub and explicitly connect Sandbox Seller A. Hand passwords/security checks to the owner. Verify exact callback origin, active session, clean post-callback URL and one-use state; inspect only boolean/structural evidence of owner-scoped encrypted tokens, independent IVs, scopes and expiries.
3. Make two fresh server-only authenticated GetUser reads and compare identity hashes without printing identities, tokens or raw XML. Both must match the connected seller. **Check eBay authorization can reuse a cached access token; clicking it alone does not prove a fresh identity read.** Do not decode opaque tokens or use Commerce Identity mocks as proof.
4. Exercise the normal refresh lease/version path after access expiry. Wait for expiry, or obtain explicit approval to mark only this disposable connection's local access expiry stale; never change its actual refresh token/expiry to force the test. Observe the real replacement-token behavior: rotate if returned, otherwise retain the original refresh token and expiry. Verify the same authenticated seller after refresh; stop on unexpected behavior rather than forcing rotation or a provider failure.
5. Disconnect A and confirm local credentials/pending state are cleared without changing Reverb or remote consent. Reconnect A and prove the same stable identity, then explicitly disconnect before switching to B. Authorize Sandbox Seller B and repeat the fresh identity reads; prove B is stable and A differs from B.
6. Sequential A/B authorization under **one application owner proves seller identity distinction, not cross-owner isolation**. If two real GitHub application owners are available, use separate browser sessions to verify each owner's status/actions cannot read, replace, refresh or disconnect the other's connection. Otherwise record real cross-owner testing as not run and distinguish the existing automated two-owner coverage; do not claim the sequential test satisfies it.
7. From a disconnected state, decline a new consent request if eBay presents that option. Verify the actual declined parameters safely, no code exchange and no active credentials. If Sandbox auto-consent prevents cancellation or the callback differs from the supported contract, stop and record the gap; do not invent a successful decline test.
8. Inspect localStorage/sessionStorage, safe connection responses, cookie attributes and captured logs without printing values. No tokens, encrypted envelopes, Authorization headers or signed URLs may appear in browser storage/responses or logs. Better Auth session cookies should remain Secure/HttpOnly/SameSite=Lax. Inspect callback logs without exposing query strings.
9. Remove only the approved disposable eBay connections/states/sessions and stop the temporary local app. Preserve existing Reverb data/keys and development infrastructure. Record each actual result separately from pending gates.

Real operations are limited to Sandbox consent, authorization-code exchange, read-only authenticated GetUser and token refresh. Make **no inventory/offer/media/location/policy/listing writes**, no live calls and no deployment. Unexpected identity, TLS/callback, session, scope or token behavior stops the procedure; do not weaken verification to continue.

No public app deployment, live seller support, background refresh, remote revocation endpoint, Inventory eligibility claim or Stage 9B implementation is included.

Official references: [OAuth grant](https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html), [refresh](https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html), [Commerce Identity](https://developer.ebay.com/api-docs/commerce/identity/overview.html), [GetUser](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetUser.html), [UserType](https://developer.ebay.com/devzone/xml/docs/reference/ebay/types/UserType.html).
