# Private photo preparation; EPS transfer remains gated

This is the first small media slice after merged seller-readiness PR #10. It implements an explicit owner-authorized **local preparation** action, not EPS upload support. No eBay media gateway, upload action, provider association, upload attempt or new OAuth profile is implemented. The disabled upload control has no server upload operation behind it. There is no runtime environment switch that enables real transfer.

## Implemented boundary

On an owned listing's eBay page, **Validate photo N** checks one durable private JPEG/PNG. Rendering, reload and ordinary Save do not read image bytes through this boundary or call eBay. The existing browser image-read route and read-only seller/metadata actions are unchanged.

1. The server derives the owner from the Better Auth session. It checks listing version, matching saved image identity and the owner's verified Sandbox connection/configuration. Legacy filename-only entries, foreign/missing images, unsupported types and unusable connections fail closed.
2. The repository rechecks owner/listing/image under the existing short parent lock and extends `providerRetainUntil` through the five-minute preparation window plus one minute. It never shortens a longer hold. The trusted pathname comes from the repository, not browser input.
3. After commit, the Blob SDK reads the private object directly using server credentials, no cache and an abort signal. No source capability is created or returned. Metadata must match the trusted path, MIME and length. A single preallocated buffer rejects overrun/truncation; the reader is cancelled/released on success, error or abort.
4. Sharp validates the signature, structure, metadata and **full pixel decode**. Then the service rechecks listing/image and exact owner/seller/connection version. Deletion, edits, disconnect and reconnect during I/O invalidate the review. A failed validation can leave harmless extra retention; it is never rolled back.
5. Only dimensions, MIME, byte size, image/order identity, check/expiry times and `exportEnabled=false` / `exportStatus=not-attempted` reach the browser. The result is temporary React state, not export permission. No token, ciphertext, Blob path, source URL, image bytes or profile metadata is returned or stored in Web Storage.

An expired **access** token alone does not cause refresh: local byte preparation uses verified persisted connection metadata, requires unexpired refresh authorization and never decrypts credentials or invokes eBay. This is not a fresh provider identity or token-validity check. A later real transfer needs fresh authorized credentials and additional review.

## Conservative preparation limits

| Input | Accepted subset |
| --- | --- |
| Format | Static JPEG or PNG only; MIME and signature agree |
| Encoded size | Positive and exact, at most 10 MiB (existing application cap) |
| Dimensions | Longest side at least 500; each side at most 4096; at most 16,777,216 pixels |
| Pixels | 8-bit RGB or grayscale, at most four channels; no CMYK |
| Structure | Full decode; reject truncation/corruption, APNG, PNG compressed-metadata/EXIF chunks, malformed PNG chunks/trailing data, more than 4096 PNG chunks and JPEG trailing data |

These are **application limits**, not a claimed universal EPS upload contract. The [eBay picture policy](https://www.ebay.com/help/policies/listing-policies/picture-policy?id=4370) requires 500 pixels on the longest side for listing photos. The [image guide](https://developer.ebay.com/api-docs/sell/static/inventory/managing-image-media.html) lists broader formats, but its 12 MB / combined-dimension examples are not treated as verified Sandbox limits. No resize, format conversion, EXIF removal or malware scanning is claimed. Original bytes remain unchanged and are discarded after validation; embedded metadata is never displayed. Metadata privacy must be reviewed before eventual provider transfer.

Two concurrent validations per server process are allowed; further requests fail busy without an unbounded queue. Each has at most one 10 MiB source buffer and one 64 MiB raw pixel result, plus bounded stream chunks and decoder/runtime overhead. There is no multipart buffer in this slice. These bounds are not an absolute process-RSS quota. The Blob read uses a 15-second abort signal; Sharp additionally has a ten-second processing timeout and is destroyed on abort/completion. Sharp 0.35.5, already used transitively by Next.js, is now a pinned direct dependency because complete decoding is necessary for this trust boundary. No global decoder cache settings are changed.

## Deletion and persistence

An image/listing still disappears from the application immediately. The existing cleanup ledger preserves trusted path/retention before metadata cascades; physical deletion waits until due and remains retryable. Concurrent preparation either establishes retention first or fails after deletion. Committed references/live uploads remain protected by the existing cleanup operator. Ordinary 60-second browser reads do not extend retention.

There is **no schema change**: this slice creates no remote resource and therefore needs no durable provider association. Temporary validation is not falsely persisted as an EPS export. The future association/attempt ledger must precede the first provider POST; it is not optional work that can follow real uploads.

The UI marks temporary photo reviews expired when their deadline passes; this is a local timer, not polling or renewed export permission. Updated listing/connection state resets temporary preparation. [The isolated walkthrough](isolated-walkthrough.md) reproduces this workflow without real provider access. [The proposed photo-export privacy policy](photo-export-privacy.md) defines a future separate derivative, orientation/color handling and acceptance cases; it does not add sanitization to current bytes.

## Verified provider contract and unresolved gates

Reviewed 2026-11-10 against the [Media v1_beta.5.0 OpenAPI](https://developer.ebay.com/api-docs/master/commerce/media/openapi/3/commerce_media_v1_beta_oas3.json), [Media overview](https://developer.ebay.com/api-docs/commerce/media/static/overview.html) and image guide:

- `POST /commerce/media/v1_beta/image/create_image_from_file`: multipart form field `image`, seller `sell.inventory` scope, HTTP 201 and an image-resource `Location` header. A successful image payload describes `imageUrl` and `expirationDate`, with optional `maxDimensionImageUrl`.
- `GET /commerce/media/v1_beta/image/{image_id}` retrieves the resource; expired/missing resources can return 404. Future code must capture a validated ID, reconstruct a fixed-host read and never follow arbitrary `Location` or redirect URLs.
- The OpenAPI declares **Production** hosts only. The overview warns that Sandbox data may be static/mocked. An image-specific supported Sandbox host and genuine byte ingestion remain **UNVERIFIED**. No speculative authenticated probe, Production substitution or deprecated Trading upload is used.
- No image DELETE, idempotency key or digest lookup is documented. Unused images have a returned expiry; use in an active listing can extend retention. Do not invent a fixed image TTL from the unrelated video retention rule or promise immediate remote deletion.
- `sell.inventory` is broader than an image-only permission. The current base/read-only grant is deliberately unchanged; no consent or scope upgrade occurs in this implementation.

Before a transfer-capable follow-up: obtain authoritative Sandbox host/behavior and exact format/size/URL/expiry requirements; review the least-privilege explicit scope upgrade; implement pinned HTTP upload/readback, durable pre-send attempt fencing and seller/image/content-bound associations, known-ID reconciliation, unknown-outcome/manual-resolution behavior and residual evidence surviving local deletion. No blind POST retry or misleading delete guarantee. See the [full next-slice lifecycle design](ebay-next-slices.md).

## Tests and acceptance gates

Isolated tests cover byte/decoder limits and failures, owner/listing/image/connection fences, cancelled readers, two concurrent slots, server-only SDK reads, no capability signing, existing retention/cleanup behavior and stale deletion/edit/reconnect results. PostgreSQL tests use only the separate test database and in-memory storage; Chromium uploads a generated photo only to its local fake Blob store, explicitly validates it, checks no eBay call delta or browser storage, then confirms ordinary Save/navigation make no private-byte reads or eBay writes. No real EPS host or provider credentials are needed in CI.

The following is a **proposed future acceptance plan, not authorization and not executable with this preparation-only PR**:

1. Resolve the Sandbox host and genuine-ingestion gate with official documentation/support. Complete/review the transfer lifecycle and its fake-provider tests; CI green at the exact new head. Do not enable a URL by assumption or use Production.
2. Identify the existing owner-verified **Seller B** privately and reverify its identity/version. Obtain separate owner approval for the reviewed `sell.inventory` consent/refresh/identity procedure. No policies/locations/inventory/offers/listings are part of it.
3. Approve one generated static RGB PNG (500×600, encoded size at most 1 MiB; within the conservative limits above), uploaded through the existing private Blob flow. Use a checkerboard with a unique per-test pixel marker, without personal data, so a static mock cannot pass as genuine ingestion. Capture a local decoded-pixel/content reference without logging bytes or capabilities. Scope is one photo, no second image unless separately approved.
4. Approve **at most one image POST**, with no retry, plus at most two fixed-resource metadata GETs and one bounded download of the validated EPS image URL to verify genuine decoded pixel/visual content. These are proposed separate media limits; the earlier readiness request allowance is exhausted and is not reusable authorization. OAuth/identity calls require their own named ceiling.
5. Persist the pre-transmission fence, trusted image ID, actual readback URL/expiry and owner/seller/content association. Demonstrate that a repeat action reconciles/reuses without POST. Stop immediately on unexpected identity, response shape, host, timeout, scope, stale version or uncertain upload; preserve minimal safe evidence, never loosen checks to continue.
6. Delete only the approved local fixture and source Blob after retention/cleanup. Preserve encrypted connections and infrastructure. If the provider has no image-delete mechanism, disclose the residual copy and actual expiry **before** requesting upload approval; cleanup cannot claim the EPS copy was erased. Unknown lost-ID outcomes require manual resolution and may lack a verifiable expiry.

No real consent, refresh, Blob read/upload, EPS creation/readback, seller mutation, inventory/offer/listing operation or application deployment is performed by implementation/fake-provider validation. Stage 9B remains In Progress; Stage 9C is not started.
