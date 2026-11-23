# Internal local photo derivatives

The unwired [diagnostic workflow and Milestone 3 comparison](ebay-image-comparison.md) reuse the exact accepted derivative buffer. Local export validation and untrusted returned-image decoding are separate boundaries with different container/metadata policies; an export digest is not a returned-content identity. No normal app/manual provider wiring or real operation is enabled.

The [accepted local privacy defaults](photo-export-privacy.md) are implemented behind `deriveOwnedPhoto` in `src/application/photoDerivativeServer.ts`. This is a **server-only internal function**, not a route, server action, download or browser export. The [internal fake-only workflow](ebay-fake-media-workflow.md) now consumes the same derivative service through isolated test composition. Existing **Validate photo N**, browser reads, Reverb, bundles and media simulation are unchanged. Real EPS transport remains hard-disabled; there is no new schema, credential, real OAuth grant or environment switch.

## Authorized operation

The caller supplies listing/image IDs and the listing version, never an owner or pathname. Better Auth supplies the owner. The service validates the owned listing/image and persisted verified Sandbox connection/configuration/scopes. It does not decrypt credentials, refresh access tokens or make provider calls; an expired access token alone is irrelevant to this local operation while refresh authorization remains valid.

Local derivative/persistence scope guards accept the exact proposed synthetic base-plus-`sell.inventory` profile as well as the existing identity/readiness profiles. The actual OAuth selection/callback/refresh validators remain unchanged and reject that proposed profile; no real consent is enabled or readiness permissions silently combined. The complete fake workflow separately requires the proposed profile and adequate access lifetime.

The existing repository commits owner-authorized source retention for five minutes plus one minute before storage I/O, never shortening a longer hold. The reader resolves only the trusted private source. Classification, Sharp encoding and final verification run outside PostgreSQL transactions. Before returning, the service rechecks owner, source metadata/identity, listing and exact connection/seller/configuration/scope versions. Edit, deletion, source changes, disconnect, reconnect or expired authorization discard the result. Physical source cleanup continues to respect the existing ledger even if the product record disappears.

Internal results contain only the operation-local buffer, allowlisted MIME/length/dimensions, SHA-256 source digest, independently computed final derivative digest and a versioned transformation recipe containing actual encoder/library versions/options. Source and derivative digests are separate identities, though identical content can have identical hash values. No filename, private pathname, metadata payload, token, signed capability or browser DTO is created. Consumers must not cache, mutate, serialize or treat these bytes as provider-send permission.

## Deliberately narrow input subset

- Static 8-bit JPEG or unprofiled PNG, admitted RGB/grayscale and at most four channels. Input and promoted output each ≤10 MiB, longest side ≥500, sides ≤4096, pixels ≤16,777,216. These are application limits, not confirmed EPS limits. No crop, resize or quality fallback.
- JPEG framing/entropy boundaries and one 8-bit frame; classic bounded TIFF EXIF (II or MM) with at most 256 entries per IFD/1024 total, depth three, disjoint in-range values, optional EXIF/GPS/interop and one framed JPEG thumbnail. Duplicate/invalid tags, unsafe pointers, alternative TIFF image data/calibration and unsupported forms fail. Opaque maker/identity payloads are discarded, not interpreted or displayed.
- EXIF orientation 1–8, including mirrors. Missing means one; an explicit invalid tag does not. Single bounded basic XMP may agree with EXIF or omit orientation; XMP-only non-default orientation, disagreement, duplicates and unknown orientation namespaces fail. XMP is UTF-8, ≤64 KiB, with bounded nodes/depth, DTD/entity declarations disabled, no CDATA/comments and a documented namespace subset in `xmpOrientation.ts`. Unknown/HDR namespaces or XMP color-calibration declarations fail rather than being guessed.
- JPEG JFIF, one supported Photoshop IPTC resource, comments and classified EXIF/XMP are stripped. Unknown APP/extended XMP/multi-picture/gain-map payloads fail. Aggregate encoded APP/COM metadata including framing is ≤256 KiB.
- PNG permits 8-bit grayscale/RGB with optional alpha or valid tRNS, bounded tEXt and pHYs before IDAT, and consistent standard sRGB signaling. Non-sRGB/gamma-only calibration, conflicting declarations, unknown chunks, palette/animation, compressed text, ICC and EXIF chunks fail. Chunk framing/order/CRC/endings and the aggregate 256 KiB ancillary budget are checked before decoding. Current compressed-metadata/ICC admission is not expanded.

### JPEG profiles

Only these exact **480-byte** profiles shipped with the pinned Sharp/libvips stack are admitted, including complete bounded split ICC chunks. This is an exact-content allowlist, not a general ICC validator. A different otherwise-valid sRGB profile is deliberately unsupported. No source profile is copied to output.

| Profile | SHA-256 |
| --- | --- |
| Built-in sRGB | c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353 |
| Built-in Display P3 | 231752984cd4a5278e1b8d2390fe496767d4511fc81f54e1a5c69ae9ab4c42b5 |

EXIF sRGB declarations cannot conflict with a P3 profile; uncalibrated EXIF requires an admitted profile. Unsupported explicit color spaces/gamma/interop fail. CMYK, HDR/gain maps and higher depths are not converted permissively. Admitted pixels are normalized to sRGB and output is untagged. Future profile expansion needs its own bounded fixtures and review.

## Actual encoded output

JPEG uses quality **95**, 4:4:4, baseline, optimized Huffman coding, quantization table zero, no progressive/MozJPEG/trellis/overshoot fallback. PNG uses lossless compression **6**, adaptive filtering, no palette/flattening and preserved alpha. PNG pHYs is explicitly omitted. Hidden RGB is preserved; no photographed or covert pixel information is redacted.

An independent final-container allowlist permits JPEG codec/frame/scan structures only, or PNG IHDR/IDAT/IEND after dropping the pinned encoder's pHYs. Unexpected output metadata fails rather than being silently stripped/blessed. The exact final buffer is then independently fully decoded, checking oriented dimensions, MIME, 8-bit sRGB/channels, no metadata/gain map and bounded raw length. Only afterward is its final digest established. No later encoding/metadata mutation occurs.

## Resource and cancellation contract

At most **two shared photo-operation slots per process**, no waiting queue. A standalone derivative acquires its own slot; a complete fake workflow lends its existing opaque slot to its derivative and retains it through send/ack settlement. Slots cannot be forged or borrowed concurrently, and running child work prevents an early parent release. A 15-second monotonic derivative eligibility deadline covers database lookups, private reads, classification, encoding, final decode and revalidation. Each native timeout is ≤10 seconds and rounded down to remaining time; less than one native second remaining fails closed. Native timeout excludes libuv wait, so the outer deadline is also checked after every awaited stage.

Abort/deadline never promotes a late result. There is no timeout race that releases capacity early: the service awaits started I/O/native work until it settles, then frees its slot in `finally`. A stalled dependency that ignores abort can therefore occupy a slot longer than the eligibility deadline; a hard process-kill guarantee is not claimed. Signals/listeners/readers/native handles are cleaned up by their boundaries.

Raw verification is capped at 64 MiB. Native codecs, original/output buffers, the PNG filtering copy and caches can allocate before a size error; admitted/promoted encoded-size caps are not native allocation quotas, process-RSS limits or mobile-memory proof. Buffer references are operation-local, not securely zeroized. No derivative disk/database cache or provider association is introduced.

## Evidence and remaining gates

Generated regression cases cover metadata, all orientations, profile restrictions, exact alpha, named Q95 quality, container/digest identity, corruption, budget boundaries and injected output failures. PostgreSQL/in-memory-storage tests cover owner/retention/transaction ordering, native-stage edit/deletion/source/connection races, original preservation and deferred cleanup. Deterministic delayed native-style completions test cancellation/capacity; they do not prove native preemption. A generated solid image tests the exact 16M-pixel boundary on the test machine, not worst-case high-entropy memory safety.

The [retained offline research](photo-export-review.md) supplies independent Pillow/LittleCMS comparisons; source fixtures have [provenance](../src/test/fixtures/photo-privacy/README.md). Exact final checks/counts live in the implementation PR. No real provider test was authorized. Real URL grammar, unauthenticated download, specific ingestion, precise EPS limits/color/alpha, unknown-outcome recovery, real record/schema design and broader consent/transport remain separately gated. Stage 9B remains In Progress.
