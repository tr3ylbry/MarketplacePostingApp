# Marketplace Posting Assistant

Draft an item once, then preview and copy marketplace-specific fields for manual posting. The V2 foundation uses Next.js App Router and PostgreSQL/Drizzle, preserving the domain and pure marketplace mappers established in PR #1. This slice adds GitHub authentication and structural, server-enforced listing ownership—not a product redesign.

**No public deployment, object storage or marketplace API publishing is included.** Development and production-server scripts bind to loopback by default. Authentication is implemented, but public-launch hardening and operational setup remain separate work.

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
| `listing_images` | Stable image ID, listing foreign key, filename source metadata, unique ordered position, optional alt text |
| `marketplace_listings` | Publication ID, listing foreign key, marketplace/status enums, optional external details, price override and timestamps |

Foreign keys cascade on listing deletion. Image positions are unique per listing; publication foreign keys and inventory ordering are indexed. Database checks reinforce USD and finite positive/nonnegative money rules. JSONB keeps optional category details pragmatic without a dynamic schema engine; the domain schema validates their structure on writes and reads. Text IDs preserve valid historical local IDs. Numeric columns map explicitly to the existing JavaScript-number Money model, not an accounting/decimal arithmetic framework.

Creates, edits and imports are transactional across all three tables. Edits use an expected `updatedAt` version to reject stale writes instead of silently losing changes. Import skips existing canonical IDs without overwriting them; conflicting child IDs roll back the batch. Normal deletion is permanent with confirmation, matching the existing workflow. No archive UI has been added.

### Authentication and authorization

[Better Auth](https://better-auth.com/docs/integrations/next) with its official [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) provides one GitHub OAuth flow and database-backed sessions. It fits the current App Router/PostgreSQL stack without custom password or session cryptography. Internal UUID user IDs—not email addresses or GitHub display names—own listings. Account linking and password authentication are disabled.

Every protected page and server action validates the session on the server. Services and repository methods require the trusted owner ID explicitly; browser-supplied ownership fields are stripped by validation. Inventory and individual reads filter by owner. SQL updates include owner, listing ID **and** expected timestamp; deletes include owner and ID. Child images/publications are accessed only through an authorized aggregate. There are no child-by-ID mutation endpoints. PostgreSQL requires a non-null owner foreign key and indexes owner/inventory ordering; deleting a user with listings is restricted.

**Knowing another listing UUID is insufficient to access it.** Foreign detail/edit IDs return the same not-found screen as missing IDs. Foreign updates use the same conflict response as missing/stale listings; deletes use the same not-found response. Imports skip existing IDs regardless of owner, revealing no owner or listing details and never transferring ownership.

The domain and marketplace mappers remain framework-independent; ownership is an application/persistence concern, not a client-editable product attribute. PostgreSQL RLS is not added: the trusted server database connection uses comprehensively tested owner-scoped repositories. Direct SQL access is privileged; any future entrypoint must keep this boundary. Cookie session caching is disabled so revoked sessions are rejected against PostgreSQL. Cookies are HttpOnly/SameSite=Lax and Secure for HTTPS origins. Callback origins are explicitly configured; library CSRF/origin checks remain enabled (including tests). Provider tokens are encrypted by the auth library. Unexpected auth/mutation failures return generic responses without SQL or credentials.

### Marketplace support

Each mapper exposes `validate(listing)` and `createDraft(listing)`. Incomplete listings can still be previewed; canonical validity and marketplace readiness remain separate.

- eBay retains its 80-character title rule, 24-image limit, formatted description, and notes.
- Reverb checks brand, model, category, title, description, positive price and shipping rate (zero shipping is valid).
- Craigslist and the combined OfferUp/Facebook preview retain their existing formatting/validation.

Category suggestions are scaffolding, not authoritative marketplace taxonomy. There are no real HTTP publishing clients, synchronization jobs, or external listing creation calls.

## Routes and images

`/` redirects to `/listings`. `/sign-in` offers GitHub sign-in; `/api/auth/[...all]` hosts the auth library handlers. Inventory is at `/listings`; creation at `/listings/new`; detail/previews at `/listings/[id]`; editing at `/listings/[id]/edit`. All listing routes and create/update/delete/import actions require a server-validated session; unauthenticated requests redirect to sign-in. Data is server-rendered; forms, confirmation, clipboard/preview navigation and file selection are client interactions. The account name and sign-out button are the only account UI. Sign-out revokes the current session and performs a full navigation to clear user-specific router/photo state.

**Only image filename metadata is durable.** Actual selected bytes, object URLs, HEIC conversions and photo bundles remain browser-session-only. The UI explicitly warns after reload that files must be selected again. PostgreSQL does not store image bytes and no object storage is implemented. Existing ordering, preview and bundle tools remain available when bytes exist in the session.

## Import existing browser listings

Use **Import local listings** on inventory. Nothing imports or deletes automatically. The compatibility reader validates V2 records or converts V1 records when no V2 key exists; malformed canonical records are skipped. Optional malformed legacy purchase/shipping money is omitted, known marketplace names normalize, unsupported publications are skipped, valid publication details survive, and invalid optional publication timestamps are omitted.

The server validates the batch again and imports up to 100 valid records transactionally into the **currently authenticated account**, reporting imported/skipped counts. Payloads cannot set the owner. Repeated imports and IDs belonging to other accounts are skipped without overwrite or claim. Failure leaves the database batch and original local data unchanged. Existing V1/V2/recovery storage keys are never changed by this flow. On a shared browser, local records belong to that browser profile, not an auth account: review them before deliberately importing into the signed-in account.

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

Set `TEST_DATABASE_URL` as shown in `.env.example`. Database tests refuse URLs whose database name does not end in `_test`; this guard is not a substitute for choosing a disposable database. Tests migrate it and clean up their own fixture records without truncating unrelated tables. The historical-data migration/claim test uses a separately generated schema. E2E starts a production server on port 3100 using the test URL, never a running development server.

Auth tests use the library's documented [test utilities](https://better-auth.com/docs/plugins/test-utils) only in the test process to create real database sessions and signed cookies. Production configuration has no test plugin or login bypass. An ephemeral secret is shared with the E2E server; no personal GitHub/OAuth account is used. Integration tests cover absent/tampered/expired/revoked sessions, CSRF/callback rejection, OAuth initiation, two-user guessed IDs, spoofed owners, child-ID collisions, import retries and stale edits. Browser tests cover authenticated create/reload/edit/previews/delete/import, sign-out and unauthenticated/foreign routes. The real external GitHub consent/token exchange still needs a manual smoke test with your own development OAuth app; CI deliberately does not contact GitHub.

```sh
npm run lint
npm run typecheck         # Next route generation + strict TypeScript
npm test                  # Domain, mappers, compatibility, service and React tests
npm run test:integration  # Real PostgreSQL repository/migration/constraint tests
npm run build
npm run test:e2e          # Build first; Chromium create/reload/edit/preview/delete/import
npm run check            # All of the above, including production build and E2E
```

GitHub Actions uses an ephemeral PostgreSQL service for pull requests and pushes to `main`/`tbryant/dev`. It runs install, lint, typecheck, unit tests, integration tests, production build and Chromium E2E. Failure traces are retained briefly. No personal database or deployment credentials are used.

This slice's validation covers 99 unit/component tests, 19 PostgreSQL integration tests and 4 Chromium workflows, in addition to lint, strict typecheck and the production build.

## Intentionally deferred

Real image storage, export/backup UX, pagination, richer category confirmation, marketplace API clients, background synchronization and product polish remain separate work. No teams, roles/admin UI, billing, AI, queues, Redis, public deployment or desktop/mobile packaging are included. Auth rate limiting is in-process; multi-instance rate limits, sanitized operational monitoring, secret rotation, session/token housekeeping and public-launch configuration need a later operational pass. Signing out revokes the current session, not every device. There is no account-deletion UI. The next proposed PR is owner-authorized persistent images/object storage, only after this slice is reviewed and merged.

Dependency audit reports four moderate entries from Drizzle Kit's transitive legacy esbuild loader (one underlying advisory). Drizzle Kit is development tooling, but Better Auth declares it as an optional peer, so npm now also reports this chain with `--omit=dev`. The app does not import Drizzle Kit or run that esbuild development server. Keep database tooling local and review the deployed dependency artifact before any public launch. Revisit when a compatible stable Drizzle Kit update removes the dependency; the audit's suggested breaking downgrade is not applied.
