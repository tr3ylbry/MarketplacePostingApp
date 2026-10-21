# Marketplace Posting Assistant

Draft an item once, then preview and copy marketplace-specific fields for manual posting. This V2 slice moves the existing workflow to Next.js App Router and PostgreSQL/Drizzle, preserving the domain and pure marketplace mappers established in PR #1. It is a persistence/framework foundation, not a product redesign.

**No authentication or marketplace API publishing is implemented.** Run this single-user foundation locally or in a trusted private environment; do not expose its unauthenticated read/write endpoints to the public internet. Development and production-server scripts bind to loopback by default. No deployment automation is included.

## Architecture

```text
Browser → Next.js routes / server actions → ListingService
                                              ↓
                                       ListingRepository
                                              ↓
                                            Drizzle
                                              ↓
                                          PostgreSQL

Canonical Listing → pure marketplace validation / draft mappers → previews
```

- `src/domain`: framework-independent Zod schemas, listing creation/update rules, USD Money, image metadata, and publication records. No React, Next.js, or database imports.
- `src/application`: validated use cases and a small listing repository contract. `server.ts` is the server-only composition root.
- `src/infrastructure/db`: PostgreSQL tables and lazy server-only connection pool. `drizzle/` contains committed, repeatable migrations.
- `src/infrastructure/repositories`: explicit row/domain conversion and transactional aggregate persistence. Database table types do not leak into domain or UI code.
- `src/app`: server-rendered inventory/detail/edit routes and server actions. Mutations validate untrusted input before persistence and return safe error messages.
- `src/features/listings`: existing form, dashboard, photo tooling, and marketplace previews. Forms wait for confirmed server success; failed requests do not report a successful save.
- `src/platforms`: pure, deterministic validation and draft mapping, with a central registry; no database or network dependencies.
- `src/storage`: isolated legacy browser compatibility utilities, used only for deliberate import—not normal persistence.

### Listing and publication records

`Listing` represents the item: title, description, asking price, optional acquisition cost/shipping rate, condition/category, attributes, marketplace preferences, timestamps, and `draft | active | sold | archived` lifecycle. `MarketplaceListing` represents one marketplace publication with its own status, external ID/URL, optional price override and publication/sync timestamps. Saving an item never claims it was published.

PostgreSQL stores three tables:

| Table | Contents |
| --- | --- |
| `listings` | Canonical fields, USD numeric amounts, lifecycle, JSONB attributes/preferences, selected marketplace enum array, timestamps |
| `listing_images` | Stable image ID, listing foreign key, filename source metadata, unique ordered position, optional alt text |
| `marketplace_listings` | Publication ID, listing foreign key, marketplace/status enums, optional external details, price override and timestamps |

Foreign keys cascade on listing deletion. Image positions are unique per listing; publication foreign keys and inventory ordering are indexed. Database checks reinforce USD and finite positive/nonnegative money rules. JSONB keeps optional category details pragmatic without a dynamic schema engine; the domain schema validates their structure on writes and reads. Text IDs preserve valid historical local IDs. Numeric columns map explicitly to the existing JavaScript-number Money model, not an accounting/decimal arithmetic framework.

Creates, edits and imports are transactional across all three tables. Edits use an expected `updatedAt` version to reject stale writes instead of silently losing changes. Import skips existing canonical IDs without overwriting them; conflicting child IDs roll back the batch. Normal deletion is permanent with confirmation, matching the existing workflow. No archive UI has been added.

### Marketplace support

Each mapper exposes `validate(listing)` and `createDraft(listing)`. Incomplete listings can still be previewed; canonical validity and marketplace readiness remain separate.

- eBay retains its 80-character title rule, 24-image limit, formatted description, and notes.
- Reverb checks brand, model, category, title, description, positive price and shipping rate (zero shipping is valid).
- Craigslist and the combined OfferUp/Facebook preview retain their existing formatting/validation.

Category suggestions are scaffolding, not authoritative marketplace taxonomy. There are no real HTTP publishing clients, synchronization jobs, or external listing creation calls.

## Routes and images

`/` redirects to `/listings`. Inventory is at `/listings`; creation at `/listings/new`; detail/previews at `/listings/[id]`; editing at `/listings/[id]/edit`. Data is server-rendered; forms, confirmation, clipboard/preview navigation and file selection are client interactions.

**Only image filename metadata is durable.** Actual selected bytes, object URLs, HEIC conversions and photo bundles remain browser-session-only. The UI explicitly warns after reload that files must be selected again. PostgreSQL does not store image bytes and no object storage is implemented. Existing ordering, preview and bundle tools remain available when bytes exist in the session.

## Import existing browser listings

Use **Import local listings** on inventory. Nothing imports or deletes automatically. The compatibility reader validates V2 records or converts V1 records when no V2 key exists; malformed canonical records are skipped. Optional malformed legacy purchase/shipping money is omitted, known marketplace names normalize, unsupported publications are skipped, valid publication details survive, and invalid optional publication timestamps are omitted.

The server validates the batch again, imports up to 100 valid records transactionally and reports imported/skipped counts. Repeated imports skip existing IDs. Failure leaves the database batch and original local data unchanged. Existing V1/V2/recovery storage keys are never changed by this flow.

Browser storage is origin-specific. To import from a previous Vite origin such as `http://localhost:5173`, run this app at **that exact host and port** in the same browser profile (for example `npm run dev -- --hostname localhost --port 5173`). A different host, port or protocol cannot read those records. Back up important browser data first. Cross-origin export/import and batches above 100 are deferred.

## Development

Use Node.js 24 (`.nvmrc`), npm, and PostgreSQL 18. Docker Compose provides a small local database; an existing private development PostgreSQL instance also works.

```sh
npm ci
cp .env.example .env.local
docker compose up -d
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:3000`. `DATABASE_URL` is server-only; never prefix it with `NEXT_PUBLIC_` or commit real credentials. The example credentials are deliberately disposable/local. The Compose volume preserves development data across restarts. No seed is required: create items in the form.

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

Set `TEST_DATABASE_URL` as shown in `.env.example`. Database tests refuse URLs whose database name does not end in `_test`; this guard is not a substitute for choosing a disposable database. Tests migrate it and clean up their own fixture records without truncating unrelated tables. E2E starts a production server on port 3100 using the test URL, never a running development server.

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

## Intentionally deferred

Authentication/authorization must precede public deployment. Real image storage, export/backup UX, pagination, richer category confirmation, marketplace API clients, background synchronization and product polish remain separate work. No accounts, billing, AI, queues, Redis or desktop/mobile packaging are included. A sensible next PR is authentication and ownership boundaries, with authorization tests, before enabling shared access.

Dependency audit currently reports four moderate development-only entries from Drizzle Kit's transitive legacy esbuild loader (one underlying advisory). No production dependencies are flagged. This application does not run that esbuild development server. Keep database tooling local and revisit when a compatible stable Drizzle Kit update removes the dependency; the audit's suggested downgrade is not applied.
