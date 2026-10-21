# Marketplace Posting Assistant

A local-first React + Vite application for drafting an item once and preparing marketplace-specific fields for manual posting. Create, edit, delete, and save listings locally; preview and copy generated fields; select/order photos and download marketplace photo bundles. HEIC conversion remains a lazy-loaded, browser-side operation.

## V2 foundation status

This slice establishes the domain and integration architecture for V2 while retaining the existing application. Persistence is still browser localStorage. **Marketplace API publishing is not implemented.** There is no authentication, database, backend, or synchronization service. Next.js and PostgreSQL are future work, not part of this foundation.

## Architecture

- `src/domain`: React-independent Zod schemas and helpers for canonical listings, USD Money, ordered filename image references, and marketplace publication records.
- `src/platforms`: pure marketplace validation, deterministic draft mapping, category suggestions, photo limits, and the mapper registry. No HTTP or React dependencies.
- `src/storage`: versioned local persistence, schema validation, and a single V1 compatibility conversion.
- `src/features/listings`: existing form/dashboard/preview UI, temporary photo uploads, and the listings hook. `listingFormInput` and `listingFormMapping` adapt the existing flat form fields to the canonical domain.

### Listing versus MarketplaceListing

`Listing` is the item: title, description, `askingPrice`, optional `acquisitionCost` and `shippingRate`, condition, category, attributes, timestamps, and a `draft | active | sold | archived` lifecycle. Optional brand/model/year/finish/country/video details live in `attributes`. Existing marketplace category/contact preferences live in `marketplaceDetails`; they are not publication status.

`MarketplaceListing` describes one publication of that item: marketplace, status, optional external ID/URL, price override, and publication/sync timestamps. Status supports `draft`, `ready`, `published`, `sold`, `error`, and legacy `needs-renewal`. Creating a canonical item does not claim it was published. These records are stored alongside ordered `ListingImage` metadata in the local listing aggregate; they can move to separate persistence later without changing their meaning.

All persisted monetary amounts use `{ amount: number, currency: "USD" }`. Amounts must be finite and non-negative; asking prices must be positive. This is deliberately a simple USD model, not financial accounting infrastructure.

### Marketplace mappers

Each mapper provides `validate(listing)` returning errors/warnings and `createDraft(listing)` returning copyable fields, photo sets, and explanatory notes. Both operations are pure and deterministic. Drafts remain available even when validation reports missing fields, so incomplete listings can still be reviewed. A future network client will be separate from these mappers.

- eBay: 80-character title formatting, 24-photo cap, formatted description, and item-specific recommendations. The photo bundle uses the same cap.
- Reverb: explicit brand, model, category, title, description, positive price, and shipping-rate checks; zero-cost shipping is valid. Draft fields retain music-specific details.
- Existing Craigslist and combined OfferUp/Facebook previews remain supported through the same contract.

The registry provides individual marketplace lookup and a preview collection preserving the existing combined OfferUp/Facebook view. Category suggestions remain scaffolding, not authoritative marketplace taxonomy. A Reverb suggestion does not satisfy category validation until an explicit category exists. The existing form's save requirements are preserved; full readiness is reported in preview.

## Local persistence and compatibility

V2 stores `{ version: 2, listings: [...] }` under `marketplace-posting-assistant:listings:v2`. Reads safely parse JSON and validate each record, recovering valid records independently. Storage access/quota failures do not crash the app; failed writes display an in-memory-only warning.

If no V2 key exists, V1 records under `marketplace-posting-assistant:listings` are converted on read. Valid records retain IDs, timestamps, attributes, prices, photo ordering, and recognized posting records. Earlier category/platform aliases are supported. `needs-renewal` moves to publication records while the canonical item becomes active. Missing update timestamps fall back to creation time. Invalid records are skipped; the original V1 key is never modified. Migration is saved only on the next explicit create/edit/delete operation, not on page load.

Malformed V2 data is left untouched on read. Before replacing it during a user edit, the original bytes are retained at the V2 key with `:recovery` appended. An existing different recovery copy is never overwritten; the save fails visibly instead. The recovery keys are manual recovery aids, not a migration framework or cross-device backup.

Images persist **filename metadata only**, including stable identity, listing association, and order. Files, object URLs, conversion results, and downloadable photo bytes remain in memory and are lost on reload. Re-select files to preview or bundle them after reload. Real image storage is future work.

## Development

Use Node.js 24 (see `.nvmrc`) and npm:

```sh
npm ci
npm run dev
```

```sh
npm run lint       # TypeScript/React hooks lint checks
npm run typecheck  # Strict TypeScript, including Vite configuration
npm test           # Vitest business logic and focused React regression tests
npm run build     # Typecheck and production Vite build
npm run check     # Complete local validation chain
npm run preview   # Serve the production build locally
```

GitHub Actions runs dependency installation, lint, typecheck, unit tests, and build on pull requests and pushes to `main`. There is no deployment automation.

## Later V2 phases

Next work can add a small, typed category-confirmation UI and improve persistence recovery feedback within this stack. Framework migration, PostgreSQL persistence, authentication, real image storage, and marketplace API clients/publishing require separate design and implementation phases. No preview or local status should be interpreted as a real marketplace publication.
