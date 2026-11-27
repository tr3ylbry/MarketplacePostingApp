# Fixed maximum-field M3 diagnostic

This is an offline-tested diagnostic profile, not real-image acceptance or normal EPS transport. The existing primary profile remains available internally and through the manual operator. The opt-in browser operator now composes the fixed maximum profile and displays that choice before any upload. It accepts no URL, field selector or profile from the browser.

## Provider contract and evidence limit

The official [Media API OpenAPI v1_beta.5.0](https://developer.ebay.com/api-docs/master/commerce/media/openapi/3/commerce_media_v1_beta_oas3.json), inspected on November 27, 2026, describes `imageUrl` as an EPS image address for listing use and `maxDimensionImageUrl` as the address of the largest-dimension version. The create-from-file response uses `ImageResponse`; neither URL property is marked required. The schema does **not** guarantee original dimensions, a particular primary size, or equivalence between the two URLs. Its Production examples/server entries do not establish Sandbox behavior.

The retained real primary-image observation was HTTP 200 PNG, 15,267 bytes, with encoded-header claims **334×400**. The unchanged **500×600** gate refused it before full response decoding. Orientation, marker, color and similarity did not run. This observation does not prove a universal provider sizing rule or that the maximum field will pass. Historical URLs/bytes are unavailable and must not be reconstructed. All historical request allowances remain spent; unknown/unassociated state, permanent fences, queued cleanup and review obligations are preserved.

## Two fixed profiles, one upload-parent consumption

| Composition | Exact response field | Immutable contract |
| --- | --- | --- |
| `createDiagnosticImageWorkflow` / `observeFreshImage` | `imageUrl` | `diagnostic-image-get-v1` |
| `createMaximumDiagnosticImageWorkflow` / `observeFreshMaximumImage` | `maxDimensionImageUrl` | `diagnostic-maximum-image-get-v1` |

Trusted server composition selects the profile before review/upload. The reservation commits the paired contract and target before the source/derivative upload fence. The native observer refuses a mismatched binding before POST; after actual response settlement it can issue an opaque one-use handle only for that selected field from its own fresh authenticated create response. No arbitrary response-to-handle issuer or field selector is exported. The complete profile is part of the handle fingerprint together with all existing owner/session/seller/grant/configuration/version/content bindings.

Missing, null, non-string, malformed, unsafe or insufficiently live selected URLs produce no usable handle, even when the other field is valid. Location is never a target. The exact selected URL/query stays server-only and operation-local, passes unchanged to the existing downloader, and is discarded after consumption/cancellation/expiry/settlement. There is no primary fallback, query rewriting, URL construction, guessed size variant or second GET. Equal URL strings in both fields do not create two permissions.

Migration **0014_maximum_image_verification.sql** changes only the paired field/contract constraint and fixed contract-time helper, with the matching Drizzle snapshot/journal. Applied migration 0012 is untouched. Existing primary rows, outcomes and deadlines are not rewritten. The same exclusive address-policy cutoff, method, data hash and time bounds apply to both profiles. The unconditional upload-parent and owner/action unique keys remain unchanged across profiles. Expiry, closure, a new action/profile, lost acknowledgement or restart cannot allocate another verification for the old upload.

Internal references, immutable request intent and local outcome acknowledgements bind the retained profile. Repository checks reject a changed reference; SQL independently rejects invalid pairings and changes to either immutable field. Outcomes retain their existing strict four-envelope/2 KiB budget, idempotency, late/conflicting evidence rules and Day-30/Day-90 review obligations. No URL, query, visual measurement, image byte or capability fingerprint is added to SQL evidence or receipt storage.

## Unchanged acceptance and request safeguards

The submitted reference and frozen recipe still require exact **500×600** geometry. Generated 334×400 PNG/JPEG controls are rejected before response native decoding, with bounded header claims reported separately from decoded pixels. No resize, rotation, crop, padding or transformation search is added. Marker, orientation, color, similarity, malformed-container and resource gates remain unchanged.

Both profiles retain the exact Sandbox image origin, opaque-query rules, two-question DNS/all-address classification, pinned peer/TLS/anonymous request, no redirects/retries/alternate address, original deadlines, post-lock SQL authorization, cancellation, zeroization and settlement-owned capacity. No database lock spans native or network work. The documented final-check-to-network race remains; this does not promise cross-system atomicity or remote erasure.

Normal EPS transport, real receipt/association admission and Inventory writes remain disabled. A diagnostic match still returns unknown/unassociated, never usable media.

## Verification and next gate

Synthetic tests exercise both fixed profiles through native local wire fixtures and signed sessions/disposable PostgreSQL: exact target/query transmission, missing/unsafe maximum refusal, replay/tampering, version/owner/session changes, immutable SQL pairs, competing profiles, stale workers, uncertain acknowledgements, cancellation and preserved fences. A populated pre-0014 primary database upgrades without rewriting history; all 15 committed migrations are checked and repeat safely. These tests are not provider acceptance.

Before any future run: independent review and merge; separate authorization to apply only the new migration to the intended local database; a fresh exact-commit package with new distinct content, unused activation and owner approval. A proposed four-slot run would still contain one code exchange, one GetUser, one image POST and **one maximum-field GET**, plus its separately bounded DNS precheck/setup/guarded cleanup. This document authorizes none of those actions. Do not reuse a historical source, derivative, URL, attempt or allowance. Stage 9B remains In Progress; estimates stay 75/100 and 71/100 overall.
