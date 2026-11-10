# Proposed photo-export privacy policy

**Decision proposal, not implemented.** The current app stores private source photos and validates selected JPEG/PNG bytes. It does not sanitize metadata, create export copies or upload to eBay. JPEG EXIF/GPS can remain in originals; some PNG metadata is rejected by the conservative validator. This document approves no new provider operation. [Current boundary](ebay-private-media.md).

## Recommended defaults

Preserve the saved private source byte-for-byte. For any future provider transfer, create a separate, bounded, server-side export copy. Never overwrite the source or fall back to sending it unchanged when transformation fails. A local validation summary is neither export authorization nor evidence that an export copy exists. For HEIC/HEIF, today's browser conversion happens before saving; “original” here means the saved private Blob, not a recovered camera file.

| Concern | Proposed default | Tradeoff / review requirement |
| --- | --- | --- |
| Identifying metadata | Drop EXIF (including GPS, serial numbers, dates, owner/maker notes and thumbnails), XMP, IPTC, JPEG comments, PNG text/EXIF chunks, software/host identifiers and unknown ancillary metadata | Re-encode from decoded pixels into an allowlisted output structure. Do not copy metadata wholesale or trust a list of known GPS tags alone. This also removes useful copyright/caption data; any future attribution feature requires an explicit separate decision. |
| Orientation | Apply EXIF orientations 1–8, including mirrored variants, to pixels before metadata removal; final pixels are upright with no orientation dependency | No crop/stretch. Conflicting orientation sources or a non-default XMP-only orientation fail for manual review in the first implementation; do not silently guess. Validate final dimensions after rotation. |
| Color | Normalize supported 8-bit RGB/grayscale to sRGB. Interpret only bounded, valid supported source profiles; assume sRGB only for unprofiled supported inputs | Do not copy the original ICC profile. Recommend untagged sRGB output initially; if testing shows a required profile, attach only a fixed trusted sRGB profile and validate that allowlist. Malformed/oversized/unsupported profiles fail; no silent color-loss fallback. CMYK, HDR and higher bit depths stay unsupported. |
| JPEG | Re-encode JPEG as JPEG, quality 90, 4:4:4 chroma, fixed encoder options/version | This is lossy: do not promise identical pixels or file size. No automatic repeated quality reduction, upscaling, enhancement, watermark or crop. A later quality decision needs visual fixture review. Propose a synthetic-chart target of at least 35 dB RGB PSNR against the oriented sRGB reference, plus corner/color checks; this is a product acceptance proposal, not an eBay rule. |
| PNG | Lossless PNG, preserve straight-alpha transparency and dimensions, fixed compression level 6; no JPEG conversion | For unprofiled 8-bit sRGB fixtures, decoded RGBA must match the oriented reference exactly; profile conversion uses an independent reference with at most one level of rounding difference per channel. No silent flattening on white/black. If eBay requires flattening or disallows PNG/alpha, stop until a background/format choice is explicitly reviewed. Output color signaling may only be standard, non-identifying generated data. |
| Filenames | Generate an opaque export filename with a MIME-consistent extension | Do not forward original filenames, paths, listing text, owner/seller identifiers or a source hash in filenames, image metadata or public URLs. |

Sharp documents that default output removes metadata while converting to sRGB, whereas `keepMetadata`/`withMetadata` retain metadata. Therefore a future implementation must avoid broad metadata-copy options and independently inspect the encoded output. Its `autoOrient` consumes EXIF orientation, but does not resolve XMP orientation. These are library behaviors, not proof of a safe implementation: [output options](https://sharp.pixelplumbing.com/api-output/), [orientation behavior](https://sharp.pixelplumbing.com/api-operation/#autoorient).

## Identity and authorization of the actual exported bytes

The future boundary must first derive the session owner, owned listing/image, immutable source identity and exact verified seller/connection version. Establish durable source retention before private storage I/O, commit, then read/transform outside database transactions. Recheck all bindings before any eventual provider send. Current retention/deletion and version protections must remain intact.

Keep two identities distinct:

- **Original content:** trusted source image ID/version and a server-side digest of the exact encoded source bytes. A pathname, filename or listing timestamp alone is not a content digest.
- **Export content:** a separate digest of the exact final encoded derivative, its MIME, encoded length, oriented dimensions, source identity and transformation recipe/version (including encoder version/options). Re-encoding/upgrading may change this digest even when a photo looks the same.

Validate and hash the same final buffer that would be transmitted: signature, allowed container/segments, metadata allowlist, exact byte length, dimensions, color/alpha and full decode. Rechecking only the original is insufficient. Do not mutate/re-encode after establishing export identity. Never put digests, buffers or metadata into browser storage/logs. A future durable attempt/association design must bind source **and** export identities to owner/seller/version and handle uncertain sends. A digest is not a provider idempotency guarantee. No table or ledger is added by this specification.

## Temporary lifetime, bounds and failures

Propose the existing conservative preparation limits as the initial **application** budget: input and encoded output each at most 10 MiB, longest side at least 500, each side at most 4096, at most 16,777,216 pixels, static 8-bit RGB/grayscale with at most four channels. These are not confirmed eBay limits. Orientation can swap width/height; no resizing to meet provider requirements is implicitly authorized.

- Limit source plus output metadata scanning to bounded input; propose at most 256 KiB of parsed source profile/metadata data, with no unbounded decompression or nested metadata traversal. Existing unsupported PNG compressed metadata remains rejected until a separately reviewed bounded decoder path exists. Output must contain no copied identifying payload, including thumbnails or trailing concatenated images.
- At most two jobs per process, no unbounded queue. Share a 15-second wall-clock abort budget across reading/decoding/encoding/verification, with native processing timeouts no longer than that remaining budget. Cap each full pixel result at 64 MiB and release it before a second full-decode verification allocation. Budget for input/output buffers plus native/runtime overhead; this is not an absolute RSS guarantee. Measure memory/cancellation behavior before rollout.
- Keep derivatives in server memory for one explicit operation only; no disk cache, browser copy, signed download capability or five-minute byte cache. Release readers/decoders/buffer references on success, cancellation, timeout, stale identity or failure. JavaScript/OS memory cannot be promised to be immediately zeroized. Any future durable retry storage requires its own privacy, encryption and expiry design.
- The existing five-minute preparation window plus one-minute source hold is a review/cleanup boundary, not permission to keep temporary derivatives or send stale bytes. A future transfer must establish a separately reviewed hold sufficient for its operation; never shorten an existing hold. Local image/listing removal remains immediate, with physical source cleanup deferred by the existing ledger.
- Fail closed for invalid/conflicting orientation, malformed metadata, decoding/encoding errors, output-limit violations, aborts or changed source/seller versions. An ordinary untagged image with no orientation metadata is orientation 1; an explicit invalid/conflicting tag is not “missing.” Preserve originals and existing credentials. Return an actionable generic error, never source metadata/provider payloads. No original-byte fallback, automatic provider retry or provider request on ordinary Save/navigation.

Metadata removal does not remove a serial number, face, address or document photographed in the pixels. A user must still choose non-sensitive images. Existing Reverb URL ingestion and local photo bundles do not gain sanitization from this future eBay proposal. Provider-downloaded copies cannot be revoked by deleting a local original.

## Acceptance cases for a future implementation

Generate all fixtures locally with synthetic metadata/coordinates and distinct colored corners; never use personal photos. These cases are **specified, not passed sanitizer tests** in this PR.

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

## Decisions and provider gates still open

Owner review must approve the derivative policy, lossy JPEG defaults, untagged sRGB choice, metadata attribution loss and the first implementation's conservative profile/orientation exclusions. These recommendations are decision-ready, not automatically approved by writing the specification.

eBay still needs to establish supported Sandbox image hosts, genuine ingestion, exact limits/formats/color/alpha behavior, URL/expiry semantics and unknown-outcome/recovery options. Do not chase support or make a probe from this spec. After clarification, review a small transfer design covering pinned transport, durable attempts/associations and residual-copy cleanup before separately authorizing real writes. EPS transfer stays blocked; Stage 9B stays In Progress.
