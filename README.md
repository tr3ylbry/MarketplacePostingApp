# Marketplace Posting Assistant

Draft an item once, preview marketplace-specific fields, and explicitly create a Reverb **draft** through your own connected account. The V2 foundation uses Next.js App Router, Better Auth, PostgreSQL/Drizzle and durable private images, preserving the domain and pure marketplace mappers established in PR #1.

**No live marketplace publishing or public deployment is included.** Reverb creation is draft-only; other marketplaces remain manual previews. Development and production-server scripts bind to loopback by default. Public-launch hardening remains separate work.

**Start with the [system architecture guide](docs/architecture.md)** for the system map, database model, security boundaries and integration lifecycle. This README covers development and operations; the [Reverb guide](docs/reverb-drafts.md) covers provider-specific behavior. Stage 7 documents the implemented foundation without adding runtime features.

## Architecture

```text
Authenticated user → database-validated server session
                                  ↓
                       ListingService(userId)
                                  ↓
                    Owner-scoped ListingRepository
                                  ↓
                          Drizzle / PostgreSQL
                         WHERE owner_id = userId

Canonical Listing → pure marketplace validation / draft mappers → previews
```

- `src/domain`: framework-independent Zod schemas, listing creation/update rules, USD Money, image metadata, and publication records. No React, Next.js, or database imports.
- `src/application`: validated use cases and a small listing repository contract. `server.ts` is the server-only composition root.
- `src/auth`: Better Auth configuration, GitHub OAuth client, and server-only session boundary. The test helper is separate and never imported by the application.
- `src/infrastructure/db`: PostgreSQL tables and lazy server-only connection pool. `drizzle/` contains committed, repeatable migrations.
- `src/infrastructure/repositories`: explicit row/domain conversion and transactional aggregate persistence. Database table types do not leak into domain or UI code.
- `src/app`: server-rendered inventory/detail/edit routes and server actions. Mutations validate untrusted input before persistence and return safe error messages.
- `src/features/listings`: existing form, dashboard, photo tooling, and marketplace previews. Forms wait for confirmed server success; failed requests do not report a successful save.
- `src/platforms`: pure, deterministic validation and draft mapping, with a central registry; no database or network dependencies.
- `src/storage`: isolated legacy browser compatibility utilities, used only for deliberate import—not normal persistence.

### Listing and publication records

`Listing` represents the item: title, description, asking price, optional acquisition cost/shipping rate, condition/category, attributes, marketplace preferences, timestamps, and `draft | active | sold | archived` lifecycle. `MarketplaceListing` represents one marketplace publication with its own status, external ID/URL, optional price override and publication/sync timestamps. Saving an item never claims it was published.

PostgreSQL stores three listing persistence areas, plus the auth library's `users`, `accounts`, `sessions` and `verifications` tables:

| Table | Contents |
| --- | --- |
| `listings` | Required owner foreign key, canonical fields, USD numeric amounts, lifecycle, JSONB attributes/preferences, selected marketplace enum array, timestamps |
| `listing_images` | Stable image ID, listing foreign key, storage provider/pathname, original filename, MIME, byte size, uploaded timestamp, unique ordered position, optional alt text |
| `marketplace_listings` | Publication ID, listing foreign key, marketplace/status enums, optional external details, price override and timestamps |

Foreign keys cascade on listing deletion. Image positions are unique per listing; publication foreign keys and inventory ordering are indexed. Database checks reinforce USD and finite positive/nonnegative money rules. JSONB keeps optional category details pragmatic without a dynamic schema engine; the domain schema validates their structure on writes and reads. Text IDs preserve valid historical local IDs. Numeric columns map explicitly to the existing JavaScript-number Money model, not an accounting/decimal arithmetic framework.

Creates and imports are transactional across all three listing tables. Ordinary product edits preserve images; dedicated image mutations serialize on the owned parent and advance its edit version. Edits use an expected `updatedAt` version to reject stale writes instead of silently losing changes. Import skips existing canonical IDs without overwriting them; conflicting child IDs roll back the batch. Normal deletion is permanent with confirmation, matching the existing workflow. No archive UI has been added.

### Authentication and authorization

[Better Auth](https://better-auth.com/docs/integrations/next) with its official [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) provides one GitHub OAuth flow and database-backed sessions. It fits the current App Router/PostgreSQL stack without custom password or session cryptography. Internal UUID user IDs—not email addresses or GitHub display names—own listings. Account linking and password authentication are disabled.

Every protected page and server action validates the session on the server. Services and repository methods require the trusted owner ID explicitly; browser-supplied ownership fields are stripped by validation. Inventory and individual reads filter by owner. SQL updates include owner, listing ID **and** expected timestamp; deletes include owner and ID. Image reads/mutations require both the owned parent and matching image/reservation. Publications remain aggregate-scoped. PostgreSQL requires a non-null owner foreign key and indexes owner/inventory ordering; deleting a user with listings is restricted.

**Knowing another listing UUID is insufficient to access it.** Foreign detail/edit IDs return the same not-found screen as missing IDs. Foreign updates use the same conflict response as missing/stale listings; deletes use the same not-found response. Imports skip existing IDs regardless of owner, revealing no owner or listing details and never transferring ownership.

The domain and marketplace mappers remain framework-independent; ownership is an application/persistence concern, not a client-editable product attribute. PostgreSQL RLS is not added: the trusted server database connection uses comprehensively tested owner-scoped repositories. Direct SQL access is privileged; any future entrypoint must keep this boundary. Cookie session caching is disabled so revoked sessions are rejected against PostgreSQL. Cookies are HttpOnly/SameSite=Lax and Secure for HTTPS origins. Callback origins are explicitly configured; library CSRF/origin checks remain enabled (including tests). Provider tokens are encrypted by the auth library. Unexpected auth/mutation failures return generic responses without SQL or credentials.

### Marketplace support

Each mapper exposes `validate(listing)` and `createDraft(listing)`. Incomplete listings can still be previewed; canonical validity and marketplace readiness remain separate.

- eBay retains its 80-character title rule, 24-image limit, formatted description, and notes.
- Reverb checks brand, model, category, title, description, positive price and shipping rate (zero shipping is valid).
- Craigslist and the combined OfferUp/Facebook preview retain their existing formatting/validation.

Category suggestions in manual previews remain scaffolding. The separate Reverb integration retrieves authoritative taxonomy and conditions; no network code was added to the pure mappers. There is no background synchronization or live publishing.

### Reverb draft creation and management

Connect your own Personal Access Token at `/settings/integrations/reverb`, then open a saved listing's Reverb page and explicitly **Load Reverb Options**. Select real category/condition identifiers and shipping, review the exact meaningful fields, and explicitly confirm **Create Reverb Draft**. Both server layers force `publish=false`. The default environment is Sandbox; Live mode is prominently labeled and is not permission to test against a live account.

Page rendering reads only local state. **Refresh Reverb Status** explicitly checks the remote SKU; **Delete Reverb Draft** revalidates identity and draft state before deleting remotely and confirming absence. Local listings/photos remain. A confirmed missing draft can be deliberately recreated, while an unconfirmed ambiguous POST remains blocked from unsafe retries. Non-drafts, duplicate SKU matches and identity conflicts require management on Reverb. Migration `0005_reverb_draft_management.sql` adds nullable provider state/check time and short management leases; there is no polling or remote content update.

Tokens require `public`, `read_listings`, `write_listings`, and `read_profile` (shop identity/profiles). PostgreSQL stores only AES-256-GCM encrypted credentials under a dedicated server key. Owner-scoped short transactions coordinate reviews/attempts and publication identity; all Reverb network calls and private photo signing run outside transactions. Stable SKU lookup with `state=all` reconciles retries before any POST. Temporary private photo URLs expire after 15 minutes and are never persisted or returned in reviews. Before signing, an owner-scoped boundary durably retains each source Blob through that expiry plus a one-minute margin. Image/listing removal stays immediate in the app, but physical deletion waits in the cleanup ledger so concurrent deletion cannot interrupt Reverb ingestion. Apply migration `0004_provider_image_retention.sql` and use the existing operator cleanup command for deferred objects. Existing 60-second browser reads are unchanged and do not extend retention.

See [Reverb architecture, setup, failure policy and Sandbox smoke procedure](docs/reverb-drafts.md). Migration `0003_flawless_lyja.sql` introduced encrypted connections, focused draft-attempt records, and provider environment/shop context to `MarketplaceListing`; it did not add a second publication model. Add `REVERB_ENVIRONMENT=sandbox` and a securely generated `REVERB_CREDENTIAL_ENCRYPTION_KEY` to ignored server configuration. Real Sandbox draft creation, private photo ingestion, explicit shipping rates, duplicate reconciliation and remote draft deletion passed on 2026-10-24. PR #6 additionally verified passive-page zero traffic, refresh, app-driven deletion, recreation and external-deletion detection on 2026-10-25; disposable data was cleaned up after image retention expired. CI continues to use isolated fakes.

## Routes and images

`/` redirects to `/listings`. `/sign-in` offers GitHub sign-in; `/api/auth/[...all]` hosts the auth library handlers. Inventory is at `/listings`; creation at `/listings/new`; detail/previews at `/listings/[id]`; editing at `/listings/[id]/edit`. All listing routes and create/update/delete/import actions require a server-validated session; unauthenticated requests redirect to sign-in. Data is server-rendered; forms, confirmation, clipboard/preview navigation and file selection are client interactions. The account name and sign-out button are the only account UI. Sign-out revokes the current session and performs a full navigation to clear user-specific router state.

**Vercel Private Blob stores bytes; PostgreSQL stores authoritative image metadata and order.** Save a listing first, then upload photos. Images survive reload. Earlier/Later controls reorder without re-uploading; Remove persists deletion. Photo bundles fetch durable images on demand. Global `SessionPhotos` and obsolete session-only ordering were removed; client state is limited to conversion/upload and UI feedback. Legacy filename entries clearly show that bytes are unavailable and are omitted from bundles.

### Private media boundary

```text
Authenticated user → owner-scoped listing
                         ├── prepare exact-path signed PUT → Vercel Private Blob
                         └── verify uploaded object → PostgreSQL metadata

GET /api/listings/[id]/images/[imageId]
  → database-validated session → owner + parent/image lookup
  → short-lived signed GET redirect → Vercel Private Blob
```

`ImageStorage` is a focused application interface; `VercelBlobImageStorage` contains all provider calls. SDK **@vercel/blob 2.8.2** uses `issueSignedToken` + `presignUrl`, `head`, bounded-prefix private `get`, and `del`. OIDC (`BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN`) is preferred; a server-only static credential is the local fallback. Marketplace mappers still consume stable domain metadata, never storage clients.

The server generates a random image UUID and sanitized `images/{imageId}/{filename}` pathname. A **five-minute** reservation scopes one PUT to that exact path, MIME and declared maximum size, with overwrite and random provider suffixes disabled. The browser receives only a ready signed URL—not signing material or a full credential. Finalization rechecks ownership, expiry, object existence, exact size/type/path and image magic bytes before committing metadata. Repeated finalization is idempotent; ordinary form saves/imports cannot attach Blob paths.

Reads issue **60-second** signed GETs with private/no-store redirect headers and no referrer. Images bypass Next's shared image optimizer (`unoptimized`). Expiring URLs are never stored in PostgreSQL. Knowing a pathname or image ID is insufficient. Signed URLs are temporary **bearer capabilities**: authorized recipients can share one until expiry, downloaded bytes cannot be revoked, and sign-out/deletion cannot instantly revoke an issued URL. Logs/proxies must redact query strings. The Retry image control requests fresh access.

Limits: **40 images/listing** including legacy entries and unexpired reservations; **10 MiB/image**; filenames up to **255 characters**; JPEG/PNG/WebP only. HEIC/HEIF converts to JPEG before upload with accurate filename/type; conversion input is also capped at 10 MiB. SVG/GIF/BMP are not accepted. Signature checks are not full decoding, malware scanning, EXIF removal or decompression-bomb protection. Images get immutable paths rather than overwrites.

### Migration, consistency and cleanup

Migration `0002_glorious_thaddeus_ross` backfills historical JSON filename sources into explicit relational columns before removing the old column. IDs, names, positions and alt text survive. Domain sources discriminate `filename` from `vercel-blob`; no bytes are invented or matched by filename. Re-upload originals and remove obsolete entries deliberately. Image ownership derives from its parent, with no redundant owner column.

Two small support tables hold `image_uploads` reservations and an `image_cleanup` retry ledger. Parent-row locking serializes capacity checks/order/delete; positions remain unique through transactional metadata replacement. Reservations expire after five minutes and are not visible saved images. Each reservation creates cleanup intent. Finalization resolves the owned reservation in a short transaction, verifies the object **outside any database transaction**, then locks/rechecks ownership, expiry and all verified metadata against the reservation in a new short commit transaction. That commit inserts metadata, removes reservation/cleanup records and advances the listing version. Concurrent finalizers recognize an already committed image without inserting duplicates. Provider checks have bounded timeouts; no cross-system ACID guarantee is claimed.

If verification/DB finalization fails, compensation cancels the owned reservation and best-effort deletes the new object. A committed-image check prevents deleting a successful image after an ambiguous commit response. If PostgreSQL is unavailable, the ledger remains for retry. Image/listing deletion first commits metadata removal plus cleanup intent, then attempts Blob deletion using paths from trusted owned database records, including pending uploads. Objects with active provider-ingestion retention are excluded from immediate deletion and queued until at least their retained deadline, which survives parent deletion in the ledger. Failure leaves an orphan rather than a visible image pointing to missing bytes. Warnings never include raw provider errors, secrets or signed URLs.

Cleanup records remain until upload capabilities expire plus a one-minute grace period—even after successful immediate deletion—to handle PUT replay. Run **`npm run images:cleanup`** explicitly with the intended database and matching Blob credentials. It processes at most 100 due entries: a short transaction refuses referenced images or reservations still within expiry/grace and claims an entry by advancing `notBefore` one minute; Blob deletion runs **outside the transaction**; a short completion transaction rechecks the lease, references and expiry before removing the entry/expired reservation. Failure or interruption leaves the lease for retry after it expires. A requeued or newer worker's entry is not removed by an older completion. Repeat until drained. This is an operator command, not an HTTP endpoint, queue or scheduled job. Abandoned uploads require this command. Back up/manage database and storage together; no bucket-wide deletion is performed.

### Vercel setup (outside CI)

1. Create/connect a **PRIVATE** Blob store to the Vercel project. Use separate disposable development/preview resources from production and verify environment access.
2. Run `vercel link`, then `vercel env pull .env.local`. Back up existing local settings first: pulling can replace that file. Keep PostgreSQL and GitHub auth configured too.
3. Verify server-only `BLOB_STORE_ID` and `VERCEL_OIDC_TOKEN` locally. Vercel supplies deployed OIDC for linked resources. Local OIDC expires; refresh with `vercel env pull .env.local`. Never commit pulled files.
4. If local OIDC is unavailable, put `BLOB_READ_WRITE_TOKEN` only in ignored server-side configuration, never `NEXT_PUBLIC_`, client code, logs or PRs.
5. Apply migrations, sign in and test a disposable listing's upload/read/reload/delete with the matching private store. This repository provisions no Vercel infrastructure.

References: [SDK/authentication](https://vercel.com/docs/vercel-blob/using-blob-sdk), [private storage](https://vercel.com/docs/vercel-blob/private-storage). PR #4 passed a real development PRIVATE Blob smoke test (upload, durable read, reorder, deletion, cleanup and transaction boundaries) before merging. PR #5 separately verified real Reverb Sandbox ingestion of two temporary private photo URLs on 2026-10-24.

### Storage tests

Unit/adapter tests mock the narrow SDK boundary; application/repository tests use deterministic in-memory bytes with real PostgreSQL ownership. Browser tests use a separate loopback capability server; no real Blob account or credentials are required.

Only an explicit `MARKETPLACE_TEST_BUILD=1` build aliases the adapter to test storage, outputs `.next-test`, and requires a loopback `_test` database with no Vercel environment. Normal builds always resolve the real provider; setting test flags on a normal production artifact does not replace it. The test provider additionally requires a random per-run secret. There are no test upload/read/auth-bypass routes in the production app. Playwright creates genuine database sessions through its test-process-only auth helper. The test server must never be deployed.

## Import existing browser listings

Use **Import local listings** on inventory. Nothing imports or deletes automatically. The compatibility reader validates V2 records or converts V1 records when no V2 key exists; malformed canonical records are skipped. Optional malformed legacy purchase/shipping money is omitted, known marketplace names normalize, unsupported publications are skipped, valid publication details survive, and invalid optional publication timestamps are omitted.

The server validates the batch again and imports up to 100 valid records transactionally into the **currently authenticated account**, reporting imported/skipped counts. Payloads cannot set the owner or attach Blob paths: local import accepts filename-only images. Repeated imports and IDs belonging to other accounts are skipped without overwrite or claim. Failure leaves the database batch and original local data unchanged. Existing V1/V2/recovery storage keys are never changed by this flow. On a shared browser, local records belong to that browser profile, not an auth account: review them before deliberately importing into the signed-in account.

Browser storage is origin-specific. To import from a previous Vite origin such as `http://localhost:5173`, run this app at **that exact host and port** in the same browser profile (for example `npm run dev -- --hostname localhost --port 5173`), set `BETTER_AUTH_URL` to that origin and configure the corresponding GitHub OAuth callback. A different host, port or protocol cannot read those records. Back up important browser data first. Cross-origin export/import and batches above 100 are deferred.

## Development

Use Node.js 24 (`.nvmrc`), npm, and PostgreSQL 18. Docker Compose provides a small local database; an existing private development PostgreSQL instance also works.

```sh
npm ci
cp .env.example .env.local
docker compose up -d
npm run db:migrate
# Configure GitHub OAuth and the auth secret as described below before signing in.
npm run dev
```

Open `http://127.0.0.1:3000`. `DATABASE_URL` is server-only; never prefix it with `NEXT_PUBLIC_` or commit real credentials. The example credentials are deliberately disposable/local. The Compose volume preserves development data across restarts. No seed is required: create items in the form.

### Local GitHub sign-in setup

1. Create a development [GitHub OAuth app](https://better-auth.com/docs/authentication/github). Set its homepage to `http://127.0.0.1:3000` and authorization callback to `http://127.0.0.1:3000/api/auth/callback/github`.
2. Put its `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in ignored `.env.local`. Generate a unique `BETTER_AUTH_SECRET` locally with `openssl rand -base64 32`; keep it secret and stable across restarts. Do not paste credentials into issues, PRs or logs.
3. Set `BETTER_AUTH_URL=http://127.0.0.1:3000`. This exact origin must match the browser URL and registered callback. HTTP is accepted only for loopback development; other origins require HTTPS. Never derive trusted origins from arbitrary request headers.
4. Apply migrations, start the app and use **Sign in with GitHub**. The first sign-in creates a stable internal user but **does not claim old database listings**. There is no email/password signup or admin UI.

All four auth variables and `DATABASE_URL` are server-only; no `NEXT_PUBLIC_` secrets. CI uses fake OAuth configuration and genuine local database sessions, not these credentials. Builds do not require a live database or auth secrets.

### Existing pre-auth database listings

Back up the database before applying migration `0001_famous_harrier`. It preserves existing listing IDs, fields, images and publication records under the reserved, non-login `legacy-unclaimed` holding identity, then enforces the owner foreign key and NOT NULL constraint with **no default owner**. Normal service/repository calls reject the holder; database constraints prohibit its sessions and provider accounts. Old inventory is intentionally invisible until a trusted operator explicitly assigns it—never to the first person who signs in.

For a trusted single-owner development database:

1. Apply migrations and sign in with the intended GitHub account.
2. Using a trusted local database connection or Drizzle Studio, inspect `users` joined to `accounts` (`provider_id = 'github'`) and verify the intended GitHub provider account ID. Record its internal `users.id`. Do not infer ownership from a browser payload or email alone.
3. Review/back up **all** rows whose `owner_id = 'legacy-unclaimed'`. The following command claims that entire pre-auth set, not selected rows; do not use it on mixed-owner historical data.
4. Run `npm run db:claim-legacy -- --owner INTERNAL_USER_ID --confirm-all-legacy` with the intended development `DATABASE_URL`.

The offline script requires an existing GitHub-backed user, changes only holding-owner rows in one transaction, advances their edit versions, and leaves already-owned records/children intact. Repeating it claims zero rows. There is no HTTP claim endpoint, automatic login hook, or admin privilege in the app. Mixed-owner historical data needs a separate reviewed migration; it is safely retained in the meantime. This database claim is separate from deliberate browser localStorage import.

```sh
npm run db:generate  # Generate a committed migration after a schema change
npm run db:migrate   # Apply pending migrations; safe to repeat
npm run db:studio    # Optional local database inspection
npm run build
npm start           # Serve the production build on loopback
```

Migration tools load `.env.local` then `.env`; deployment operators should supply `DATABASE_URL` securely. Apply migrations before running a new application version. Never use schema push or manual production edits as a replacement for committed migrations.

## Validation

Tests use a **separate disposable database**, never the development database. Create it once for Compose:

```sh
docker compose exec postgres createdb -U marketplace marketplace_test
npx playwright install chromium
```

Set `TEST_DATABASE_URL` as shown in `.env.example`. Database tests refuse URLs whose database name does not end in `_test`; this guard is not a substitute for choosing a disposable database. Tests migrate it and clean up their own fixture records without truncating unrelated tables. The historical-data migration/claim test uses a separately generated schema. E2E builds an isolated `.next-test` production-mode server on port 3100 plus a disposable loopback storage server on port 4311, never a running development server.

Auth tests use the library's documented [test utilities](https://better-auth.com/docs/plugins/test-utils) only in the test process to create real database sessions and signed cookies. Production configuration has no test plugin or login bypass. An ephemeral secret is shared with the E2E server; no personal GitHub/OAuth account is used. Integration tests cover absent/tampered/expired/revoked sessions, CSRF/callback rejection, OAuth initiation, two-user guessed IDs, spoofed owners, child-ID collisions, import retries and stale edits. Browser tests cover authenticated create/reload/edit/previews/delete/import, sign-out and unauthenticated/foreign routes. Real GitHub OAuth consent/token exchange and database-backed session persistence across reload passed during the development Private Blob integration smoke test, using the local application and a development OAuth app—not a production deployment. CI deliberately does not contact GitHub.

```sh
npm run lint
npm run typecheck         # Next route generation + strict TypeScript
npm test                  # Domain, mappers, compatibility, service and React tests
npm run test:integration  # Real PostgreSQL repository/migration/constraint tests
npm run build
npm run test:e2e          # Builds isolated test app; Chromium workflows
npm run check            # All of the above, including production build and E2E
```

GitHub Actions uses an ephemeral PostgreSQL service for pull requests and pushes to `main`/`tbryant/dev`. It runs install, lint, typecheck, unit tests, integration tests, production build and Chromium E2E. Failure traces are retained briefly. No personal database or deployment credentials are used.

Validation covers domain/component/adapter tests, real PostgreSQL ownership/storage/Reverb lifecycle tests and five Chromium workflows. The image workflow uploads two fixtures, reloads, checks decoded images, reorders/reloads, removes/reloads, downloads a bundle and deletes the listing. It also checks foreign and unauthenticated image reads. The Reverb workflow uses a secret-protected local fake on port 4312 with real application/server/database boundaries: connect, explicitly load options, create, refresh, delete and recreate, plus zero Reverb traffic on passive navigation or ordinary saves. Production never resolves the test gateway. Exact final results are recorded in the PR.

## Intentionally deferred

Export/backup UX, pagination, live publishing, other marketplace clients, background synchronization and product polish remain separate work. No teams, roles/admin UI, billing, AI, queues, Redis, public deployment or desktop/mobile packaging are included. Auth rate limiting is in-process; multi-instance rate limits, sanitized operational monitoring, secret rotation, session/token housekeeping and public-launch configuration need a later operational pass. Signing out revokes the current session, not every device. There is no account-deletion UI. Account-wide media quotas, automated cleanup scheduling, image scanning/EXIF removal, and streaming large ZIP bundles remain deferred. PR #6 already delivered manual Reverb status refresh, reconciliation, safe draft deletion, recreation and external-deletion detection. Background synchronization, remote content updates and broader operational tooling remain deferred; ordinary local edits are not pushed to Reverb.

Dependency audit reports four moderate entries from Drizzle Kit's transitive legacy esbuild loader (one underlying advisory). Drizzle Kit is development tooling, but Better Auth declares it as an optional peer, so npm now also reports this chain with `--omit=dev`. The app does not import Drizzle Kit or run that esbuild development server. Keep database tooling local and review the deployed dependency artifact before any public launch. Revisit when a compatible stable Drizzle Kit update removes the dependency; the audit's suggested breaking downgrade is not applied.
