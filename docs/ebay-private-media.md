# Private photo preparation; EPS transfer remains gated

This is the first small media slice after merged seller-readiness PR #10. It implements an explicit owner-authorized **local preparation** action, not EPS upload support. Real image transport and a media-write OAuth profile remain unimplemented. A separate fake-tested attempt foundation below exercises durable fencing using generated fixtures only. The disabled real-upload control has no real uploader behind it; no runtime environment switch enables real transfer.

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

Two concurrent validations per server process are allowed; further requests fail busy without an unbounded queue. Each has at most one 10 MiB source buffer and one 64 MiB raw pixel result, plus bounded stream chunks and decoder/runtime overhead. The preparation-only path has no multipart buffer; the separate simulation below has its own bounded generated fixture. These bounds are not an absolute process-RSS quota. The Blob read uses a 15-second abort signal; Sharp additionally has a ten-second processing timeout and is destroyed on abort/completion. Sharp 0.35.5, already used transitively by Next.js, is now a pinned direct dependency because complete decoding is necessary for this trust boundary. No global decoder cache settings are changed.

## Deletion and persistence

An image/listing still disappears from the application immediately. The existing cleanup ledger preserves trusted path/retention before metadata cascades; physical deletion waits until due and remains retryable. Concurrent preparation either establishes retention first or fails after deletion. Committed references/live uploads remain protected by the existing cleanup operator. Ordinary 60-second browser reads do not extend retention.

The original preparation slice added no schema. The simulation foundation adds `ebay_media_attempts`: an owner/seller/source-bound attempt and response journal, explicitly marked simulation-only. Temporary photo validation is still not an EPS export. Attempt rows intentionally do not cascade with listing/image/connection deletion; they preserve uncertainty and residual evidence. No real association is created.

The UI marks temporary photo reviews expired when their deadline passes; this is a local timer, not polling or renewed export permission. Updated listing/connection state resets temporary preparation. [The isolated walkthrough](isolated-walkthrough.md) reproduces this workflow without real provider access. [The proposed photo-export privacy policy](photo-export-privacy.md) defines a future separate derivative, orientation/color handling and acceptance cases; it does not add sanitization to current bytes.

## Contract reconciliation — reviewed 2026-11-16

The [Media v1_beta.5.0 OpenAPI](https://developer.ebay.com/api-docs/master/commerce/media/openapi/3/commerce_media_v1_beta_oas3.json) documents multipart `image` creation, HTTP 201, a Location resource identity and JSON `imageUrl`/`expirationDate` (optional `maxDimensionImageUrl`), using seller `sell.inventory`. Its server list still names Production only. The [current method documentation](https://developer.ebay.com/develop/api/sell/media_api#sell-media_api-image-createimagefromfile) and [image guide](https://developer.ebay.com/api-docs/sell/static/inventory/managing-image-media.html) remain reference sources, not proof of Sandbox output.

Developer Support clarified that `createImageFromFile` is supported at **apim.sandbox.ebay.com**, **getImage is unavailable in Sandbox**, and the 201 body/Location supply the image details/identity. Support reports no image DELETE, idempotency or specific recovery mechanism. These are support statements; **no real image transfer has been observed**. The general Sandbox caveat does not prove mocked image ingestion. Support's unused-image retention description is not a verified erasure deadline for a particular object.

Still unverified: actual Location/EPS origins and path formats, genuine ingestion of our image, exact static JPEG/PNG byte/dimension/pixel limits, transparency/color behavior and any recovery of a known ID with a lost body. Do not substitute Production, guess URL suffix allowlists or probe with credentials. An image ID alone is **not recoverable** without a supported lookup. The old mandatory upload → getImage design is superseded.

## Attempt and response foundation

Selected slice: durable pre-transmission fencing and conservative response handling, exercised end to end only in protected isolated test builds. Production composition is hard-disabled and contains no upload transport. Test composition requires `DATABASE_URL` to exactly equal the loopback-only `_test` `TEST_DATABASE_URL`, rejects Vercel and non-test builds, and pins a loopback fake, validates its exact fixture URL grammar and sends a **new server-generated non-personal PNG**, never a production original-byte fallback. This fixture recipe is not the proposed sanitizer or approval of its defaults. Real EPS URL validation has no allowlist yet and stays blocked until verified evidence exists.

An explicit authenticated action revalidates owner, listing version, durable image and verified Sandbox seller/connection/configuration. A short transaction claims a lease and extends source retention before any private read. Outside PostgreSQL, bounded reads and full image validation establish the original content digest; the generated fixture has a separate final-byte digest and transformation version. A second short transaction rechecks identity/version and durably marks that a POST may occur. Only then may the fake transport send once. Final response persistence is another short transaction; no network work holds a transaction.

The journal binds owner, Sandbox, verified seller, connection/config/version, source listing/image/metadata/content, exported content and recipe to validated returned identity/URL/expiration. It contains no token, private source pathname, source capability, raw response or image bytes. Browser DTOs expose only a simulation state; provider URLs/IDs/digests stay server-side. The database constrains this slice to simulation records, not real exports. No confirmed-image reuse, download, remote deletion or resource attachment is implemented.

| Outcome | Durable behavior |
| --- | --- |
| Preparation/validation fails before transmission fence | Not sent; explicit safe preparation retry permitted |
| Worker dies while preparing | Lease may expire; no POST permitted without a fresh successful fence |
| Fence committed, crash before/after send | Unknown; never automatically repost, even after lease expiry |
| Complete valid 201 plus single trusted Location | Record response; confirmed only if current source/listing/seller/connection still match |
| Location only, malformed/lost body, missing/conflicting Location, invalid/expired fields | Keep independently validated partial evidence; unknown, no automatic repost or inferred recovery |
| Timeout, connection loss, redirects, non-201 or oversized response | Unknown; no retry, no raw provider error surfaced |
| Complete success after edit/delete/reconnect/seller change | Retain residual response evidence; never attach it to changed product state |
| Local final commit fails | Pre-send fence survives; captured response may be unavailable durably, so manual resolution remains required |
| Returned information later missing/expired | No reuse or inferred erasure; does not unlock another POST |

Original preparation's existing limits apply to source validation. Simulation uses a generated PNG of at most 1 MiB (multipart framing bounded to another 2048 bytes), at most 64 KiB of streamed JSON, a ten-second HTTP deadline inside a 30-second pipeline deadline, a 60-second claim lease, and at most two active pipelines per process with no waiting queue. These are application test limits, not eBay limits. Same-owner connection-row locking also prevents identical source/export/recipe content under a new image ID from bypassing an existing send fence. Source and exported identities remain distinct. Image/listing removal stays immediate; retained source bytes use the existing deferred cleanup ledger, independently of remote residual evidence.

## Validation and real acceptance gate

Automated tests use the dedicated disposable PostgreSQL database, generated photos and loopback fakes. They cover owner/version/concurrency fences, partial and malformed responses, no retries, transaction boundaries, deletion-surviving evidence and passive navigation/Save/privacy. Successful fake behavior is not real Sandbox acceptance. Normal grants remain base/read-only; no real media consent or token access occurs.

A later separately approved test requires reviewed privacy/export handling, a real pinned transport and verified exact Location/EPS allowlists. Proposed ceiling:

1. The previously verified Sandbox Seller B (owner privately confirms identity before consent) and one visibly unique generated static RGB PNG, 500×600 and no larger than 1 MiB. These are proposed fixture bounds, not claimed provider limits.
2. Explicit approval for `sell.inventory` consent, which also authorizes inventory/offer writes. Proposed OAuth allowance, if needed: one owner-approved consent/code exchange, one GetUser identity check; only if an appropriately authorized media grant already exists, an alternative specifically approved path is one refresh plus one identity check. A refresh cannot expand the existing read-only grant. Never both paths without a revised ceiling. Stop if refresh/extra consent is unexpectedly needed.
3. **At most one** `POST https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/create_image_from_file`; no retry and **zero getImage calls**. Persist validated 201 body and Location together. Stop on any unknown or unexpected host/identity/status/expiry/outcome.
4. **At most one** bounded unauthenticated download from an independently verified, exact allowlisted returned EPS URL, redirects disabled. This proposed mechanism is not yet proven available. Verify the unique oriented visual marker after full decode; allow re-encoding/resizing within an explicitly reviewed comparison tolerance, not byte equality. An inconclusive result stays unverified.
5. Recheck unchanged owner/seller/source/connection, encrypted persistence and browser/log privacy. Remove only disposable local data after source retention. Preserve minimal attempt/residual evidence. No image DELETE is available: returned expiry or local deletion does not prove immediate remote erasure; lost details may leave an unverifiable residual copy.

No real OAuth, refresh, private Blob access, image transfer/download, seller mutation, inventory/offer/listing operation or deployment is authorized by this document. Stage 9B remains In Progress. [Photo privacy](photo-export-privacy.md) stays a proposal; safe export remains incomplete. See [next-slice boundaries](ebay-next-slices.md).
