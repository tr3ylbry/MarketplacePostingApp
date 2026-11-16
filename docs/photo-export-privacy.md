# Accepted local photo-export privacy defaults

**Owner-approved on 2026-11-16 for the local server-only implementation.** A focused internal boundary creates a separate metadata-stripped derivative for admitted JPEG/PNG inputs. It has no route, server action, download/export UI or provider consumer. Ordinary validation, image reads, Reverb ingestion and photo bundles are unchanged; saved private originals can retain EXIF/GPS. This approves no provider operation. [Implementation and supported subset](photo-derivatives.md); [current provider boundary](ebay-private-media.md).

[Offline review, 2026-11-16](photo-export-review.md) supplied the measured evidence, not the authorization. The later explicit owner decision accepts Q95/4:4:4, adaptive PNG filtering, omitted PNG resolution metadata and the narrow handling below. Provider behavior and real-transfer authorization remain pending.

## Accepted local defaults

Preserve the saved private source byte-for-byte. For any future provider transfer, create a separate, bounded, server-side export copy. Never overwrite the source or fall back to sending it unchanged when transformation fails. A local validation summary is neither export authorization nor evidence that an export copy exists. For HEIC/HEIF, today's browser conversion happens before saving; “original” here means the saved private Blob, not a recovered camera file.

| Concern | Accepted default | Tradeoff / implementation boundary |
| --- | --- | --- |
| Identifying metadata | Exclude EXIF/GPS, serial numbers, dates, owner/maker notes, thumbnails, XMP, IPTC, comments, source resolution and ancillary payloads from final output | Admit only bounded, safely classified metadata; unsupported forms fail rather than being silently repaired. Re-encode into an inspected output allowlist. Useful copyright/caption data is also removed; any attribution feature requires a separate decision. |
| Orientation | Apply EXIF orientations 1–8, including mirrored variants, to pixels before metadata removal; final pixels are upright with no orientation dependency | No crop/stretch. Conflicting orientation sources or a non-default XMP-only orientation fail for manual review in the first implementation; do not silently guess. Validate final dimensions after rotation. |
| Color | Normalize admitted 8-bit RGB/grayscale to untagged sRGB; assume sRGB only for admitted unprofiled inputs | JPEG admits only the two exact bounded sRGB/Display P3 profiles documented in the implementation guide, with consistent EXIF color declarations. Other profiles, CMYK, HDR, higher depths and ambiguous calibration fail. PNG compressed metadata/ICC admission is not expanded. |
| JPEG | Re-encode once from the saved source at quality 95, 4:4:4, baseline, fixed Huffman/encoder options and version | Lossy: no identical-pixel/size promise, repeated quality reduction, enhancement, crop or upscale. Numeric quality regression thresholds are specific to generated fixtures, not every photo or an eBay requirement. |
| PNG | Lossless, preserved straight alpha/dimensions, compression 6 with adaptive filtering; omit pHYs; no flattening or JPEG conversion | Admitted unprofiled PNG regression pixels must match exactly. Hidden RGB is preserved too; no pixel-redaction promise. Provider alpha support remains unverified and cannot authorize automatic flattening. |
| Filenames | Return no filename/path from this internal boundary | Any future provider filename must be separately generated and MIME-consistent, never copied from the original or derived from private identity. No such consumer is implemented. |

The implementation uses no broad metadata-copy option. It explicitly removes the pinned PNG encoder's pHYs, rejects unexpected output containers and independently fully decodes the exact final bytes. EXIF/XMP interpretation is classified before Sharp because `autoOrient` alone does not resolve XMP. Library documentation remains a reference, not proof of privacy completeness: [output options](https://sharp.pixelplumbing.com/api-output/), [orientation behavior](https://sharp.pixelplumbing.com/api-operation/#autoorient).

## Identity and authorization of the actual exported bytes

The internal server entry derives the owner from the session, validates the owned listing/image/version and persisted Sandbox connection, then commits max source retention before I/O. Read/classification/transformation/final verification run outside transactions; owner/source/listing/connection versions are rechecked before returning bytes. This is not provider-send permission: any later transport needs its own fresh binding/authorization checks.

Keep two identities distinct:

- **Original content:** trusted source image ID/version and a server-side digest of the exact encoded source bytes. A pathname, filename or listing timestamp alone is not a content digest.
- **Export content:** a separate digest of the exact final encoded derivative, its MIME, encoded length, oriented dimensions, source identity and transformation recipe/version (including encoder version/options). Re-encoding/upgrading may change this digest even when a photo looks the same.

Validate and hash the same final buffer that would be transmitted: signature, allowed container/segments, metadata allowlist, exact byte length, dimensions, color/alpha and full decode. Rechecking only the original is insufficient. Do not mutate/re-encode after establishing export identity. Never put digests, buffers or metadata into browser storage/logs. A future durable attempt/association design must bind source **and** export identities to owner/seller/version and handle uncertain sends. A digest is not a provider idempotency guarantee. No table or ledger is added by this specification.

## Temporary lifetime, bounds and failures

The accepted initial **application** budget is input and encoded output each at most 10 MiB, longest side at least 500, each side at most 4096, at most 16,777,216 pixels, static 8-bit RGB/grayscale with at most four channels. These are not confirmed eBay limits. Orientation may swap dimensions; no resizing is implemented.

- Aggregate encoded source metadata/profile containers, including framing, are limited to 256 KiB before native work. EXIF/XML structural limits and the unchanged rejection of PNG compressed metadata prevent unbounded traversal/decompression. Unexpected output payloads and concatenated/trailing images fail.
- At most two active jobs per process, no waiting queue. A 15-second wall-clock eligibility deadline covers the operation; each native processing timeout is at most ten seconds and rounded down to the remaining budget. Cancellation/deadline prevents promotion of late results but does not imply native preemption. Capacity remains reserved until started I/O/native work settles. Each full raw result is at most 64 MiB. Native codecs/encoded intermediates/runtime caches may allocate before an output-size failure; this is not an RSS quota or mobile-memory guarantee.
- Keep derivatives in server memory for one explicit operation only; no disk cache, browser copy, signed download capability or five-minute byte cache. Release readers/decoders/buffer references on success, cancellation, timeout, stale identity or failure. JavaScript/OS memory cannot be promised to be immediately zeroized. Any future durable retry storage requires its own privacy, encryption and expiry design.
- The existing five-minute preparation window plus one-minute source hold is a review/cleanup boundary, not permission to keep temporary derivatives or send stale bytes. A future transfer must establish a separately reviewed hold sufficient for its operation; never shorten an existing hold. Local image/listing removal remains immediate, with physical source cleanup deferred by the existing ledger.
- Fail closed for invalid/conflicting orientation, malformed metadata, decoding/encoding errors, output-limit violations, aborts or changed source/seller versions. An ordinary untagged image with no orientation metadata is orientation 1; an explicit invalid/conflicting tag is not “missing.” Preserve originals and existing credentials. Return an actionable generic error, never source metadata/provider payloads. No original-byte fallback, automatic provider retry or provider request on ordinary Save/navigation.

Metadata removal does not remove a serial number, face, address, document or hidden data encoded in pixels. A user must still choose non-sensitive images. Existing Reverb URL ingestion, image reads and local bundles do not gain sanitization from this unconnected internal boundary. Provider-downloaded copies cannot be revoked by deleting a local original.

## Regression coverage and remaining acceptance

Tests use generated synthetic metadata/coordinates and distinct corners, with narrow fixtures ported from the retained offline review. Local regression evidence is recorded in the implementation PR; it is not real-provider acceptance. The following cases remain the acceptance contract, including later real-I/O/rollout cases not claimed by local fakes.

| Case | Required evidence |
| --- | --- |
| Metadata-bearing JPEG | Synthetic GPS, EXIF owner/camera/date/thumbnail, XMP/IPTC and comment sentinels are absent from decoded output metadata and container inspection. No copied APP payload or trailer remains. Recognize legitimate generated codec/color structures separately. |
| Rotated/mirrored JPEG | Orientations 1–8 produce the intended corner positions and swapped dimensions where applicable; no retained orientation tag. Reject explicit invalid/conflicting/XMP-only non-default orientation rather than trusting auto-orient alone. |
| Transparent PNG | Semi-transparent and fully transparent edges retain alpha and intended sRGB appearance; no halos from unintended flattening, no copied text/EXIF. Unsupported compressed-metadata inputs fail safely under current constraints. |
| Color and quality | Grayscale, unprofiled RGB and supported profiled test charts have reviewed visual/tolerance results. Reject CMYK, invalid/oversized profiles and unsupported depth. JPEG recompression differences are measured; PNG pixel comparison accounts for deliberate color conversion. |
| Malformed input/output | Truncation, spoofed MIME, oversized/concatenated payloads, malformed chunks/metadata and injected encoder output failures produce no transferable copy and preserve the source. Independently fail a derivative that retains a sentinel despite a valid original. |
| Resource limits | Exact byte/pixel/side boundaries; over-limit input/output/profile; stalled read; native timeout/cancellation; two concurrent jobs and a rejected third; no stranded readers or temporary files. |
| Identity / races | Original digest/bytes unchanged after success and failure. Derivative digest describes actual encoded output. Changed source, recipe, listing or seller version invalidates review/send; concurrent local deletion respects source retention. Identical recipes can reuse only a verified matching derivative identity, never an assumed provider result. |
| Privacy / scope | No image bytes, metadata, original filename/path, digest, token or signed capability in logs, public responses or Web Storage. Unit/fake-provider tests do not count as real eBay format/ingestion acceptance. |

## Accepted choices and provider gates still open

The owner explicitly accepted the local derivative policy, Q95/4:4:4, adaptive PNG with omitted pHYs, untagged sRGB, metadata attribution loss and narrow profile/orientation exclusions. This does not approve real transport, broadened PNG/profile admission, pixel redaction, a durable derivative cache or provider writes.

Developer Support has identified `apim.sandbox.ebay.com` for image creation, the 201 body/Location fields and unavailable Sandbox `getImage`. Exact returned URL grammar, specific visual ingestion, precise limits/color/alpha and lost-response recovery remain unverified. Do not send support messages or make a probe from this spec. Real transport/record design and acceptance remain separately gated; PR #15's simulation schema/URL constraints are not real records. EPS stays disabled; Stage 9B stays In Progress.
