# Bounded diagnostic image comparison: milestone 3

This implemented internal boundary uses synthetic/local fixtures only. It extends the [Milestone 2 workflow](ebay-diagnostic-image-workflow.md) before downloaded-byte cleanup. There is no route, job, UI, manual-runner integration, enabling switch, provider operation or new migration. Normal EPS transport, real receipt/association admission and Inventory writes stay disabled. The original real capture remains unknown/unassociated, with permanent fences and its **3/3 budget exhausted**.

## Exact reference and independent claims

The workflow prepares a private, one-use reference from the **exact verified derivative buffer that will be submitted**, after committed source retention/derivation and before diagnostic reservation/fencing. Its digest must equal the existing derivative binding. Reference pixels remain private operation-local memory, correlated to the unique authenticated review operation and derivative identity. Neither original source pixels nor a regenerated approximation is the comparison reference. A reference alone is not authentication or provider provenance.

The new generated profile is a static, opaque 500×600 RGB PNG: asymmetric color regions/detail, a separate six-cell orientation cue, and a 144-cell marker (16 fixed prefix bits plus 128 fresh random bits). `generateVerificationFixture` creates pixels directly without fonts, SVG, files or storage. It is not wired to an operational command. The legacy manual capture fixture/command is unchanged and cannot run this workflow.

After one guarded retrieval actually settles, comparison borrows the same parent slot. Owner/session/context and original request deadlines are checked before processing and again after native work. Any changed/expired context discards even a local match. No database transaction spans processing. Only then are existing retrieval/settlement envelopes acknowledged. Unknown/lost acknowledgements do not cause requests to repeat.

The returned internal summary separates:

| Claim | Meaning |
| --- | --- |
| `retrieved` / network diagnostic | Bytes were returned by the reviewed downloader; this remains a known observation even if later comparison or acknowledgement fails. |
| `visual.decoding` | `passed` only after fully decoding accepted input to exact RGB pixels. Framing/codec failure cannot pass; unsupported/geometry refusal can remain `not-run`. |
| `visual.geometry` / `orientation` | Exact dimensions and the fixed separate orientation-cue samples agree. No rotation/mirror/crop search. This is a fixture-specific cue check, not general pose inference. |
| `visual.marker` | All expected marker cells from the exact derivative agree with adequate grayscale margin. |
| `visual.color` / `similarity` | Independent color-anchor and overall pixel-error checks pass. |
| `acknowledgement` | `not-attempted`, `recorded`, `overflow`, or `uncertain`; independent of retrieval/visual observations. `recorded` is local diagnostic acknowledgement, never remote ownership. |

Every result has `associated:false`; remote state remains unknown. Visual details/metrics are transient internal results, **not new SQL evidence fields**. The fixed four-envelope/2 KiB ledgers retain only existing network/cancellation/settlement facts. No URL, query fingerprint, returned-content hash, raw metadata, image bytes or visual score is persisted. Durable visual evidence, recovery or admission would require a separate contract review.

## Versioned profile and resource bounds

`IMAGE_COMPARISON_RECIPE` includes the actual pinned Sharp/libvips/LCMS versions, profile version, geometry and thresholds. These application restrictions are not confirmed eBay limits.

| Resource / interpretation | Enforced v1 limit |
| --- | --- |
| Encoded reference / response | Each at most 1 MiB, with the existing transport ceiling unchanged. |
| Geometry / pixels / channels | Exactly 500×600, 300,000 pixels, static 8-bit RGB, three channels; no alpha, grayscale, CMYK, HDR, palette or multiple frames. No resizing. |
| Structural metadata | At most 64 KiB encoded APP/COM or ancillary framing; at most 256 segments/chunks. Shared framing helpers additionally cap parsing at 4096 structures. |
| Native decoding | `failOn:warning`, `limitInputPixels:300000`, `limitInputChannels:3`, sequential read and safety features enabled. Fully decoded output is exactly 900,000 bytes. Metadata alone never passes. |
| Native eligibility | Reference preparation and returned-image comparison each at most five seconds, further shortened by original wall/monotonic context deadlines. Each native timeout rounds down to remaining seconds; less than one second refuses. |
| Whole operation / network | Existing 30-second whole-operation and 10-second GET/request bounds, leases, receipt/expiry and exclusive policy cutoff remain unchanged. Comparison uses the **remaining original request deadline**, not a new window. |
| Capacity | Existing two shared process-local slots, no queue. Reference prep, derivative, transport and comparison borrow sequentially, never reacquire a second slot. |

Both reference and returned raw buffers can coexist (1.8 MB per comparing operation), in addition to bounded encoded copies, derivative/transport buffers and unchanged upstream resources. This is not an RSS/native allocation quota. Codecs/libvips, metadata, caches and native scratch allocations can allocate before returning an error. No global Sharp cache/concurrency settings are changed.

Sharp's [input limits](https://sharp.pixelplumbing.com/api-constructor/) rely on metadata dimensions; framing checks before native work and exact metadata/output checks provide additional refusal layers. Its [native timeout](https://sharp.pixelplumbing.com/api-output/#timeout) excludes libuv queue wait. Eligibility is checked after every await and during pixel rows. Cancellation/timeout can return an **unsettled** inconclusive result while started native work retains capacity until its callback promise actually settles. Stream destruction or an early result is not settlement. No hard preemption, process-kill, physical erasure or hard real-time guarantee is claimed.

## Returned containers and color

Provider decoding is distinct from the [local derivative validator](photo-derivatives.md). It reuses bounded PNG/JPEG framing helpers, not the final-export container allowlist. It permits interlaced/multiple-IDAT PNG, baseline/progressive JPEG, bounded ordinary metadata and exact admitted sRGB signaling. It never assumes byte identity or our exact compression/container layout.

PNG must be RGB8 with no alpha/tRNS/animation. Standard sRGB, matching gamma/chromaticities, density/time and bounded plain Comment/Software text are allowed; compressed metadata, ICC, EXIF, XMP and unknown chunks are inconclusive. JPEG accepts bounded JFIF/comments, supported EXIF with orientation one and colorSpace absent or explicitly sRGB1, and only the exact already-reviewed 480-byte built-in sRGB ICC profile. Alternative valid profiles, non-default orientation, XMP, unknown APP data and ambiguous calibration remain unsupported. No arbitrary color transform or orientation repair is attempted. Native metadata must agree with framing; sRGB output is fully decoded, not copied as encoded bytes.

These conservative rules may reject legitimate provider outputs. ICC/alpha behavior and precise image processing remain unverified. Unsupported means inconclusive, never permission to loosen checks or fetch another variant.

## Frozen comparison rules

No threshold was derived from a real provider response. Decisions use unrounded numbers; report presentation may round them.

| Independent check | Passing rule |
| --- | --- |
| Geometry | Exact 500×600, no transformation search. |
| Orientation cue | All six fixed cell samples agree, grayscale confidence margin ≥72 from 128. |
| Marker identity | All 144 reference-derived cells agree, same margin ≥72; maximum per-cell RGB spread 20. |
| Color anchors | Four asymmetric anchor interiors: largest per-channel mean difference ≤10 on the 0–255 scale. |
| Overall similarity | RGB mean absolute error ≤8, RMSE ≤16, and worst 50×50 tile mean absolute error ≤22 over the fixed 10×12 grid. All must pass. |

Separate cue/marker tests deliberately change only one cell centre: overall similarity and color still pass, while identity/orientation fails. A perceptual score alone is insufficient. Missing detail can retain marker/cue identity yet fail similarity. Unrelated, swapped/missing markers, crop/resize, rotation/mirroring, major color changes and corrupt inputs cannot match. No alternative transform, query rewrite or maximum-image fallback is searched.

A random visible marker distinguishes these generated fixtures; it is not a cryptographic authenticity challenge. Someone able to copy/reproduce the pixels can copy the marker. Small/local changes outside sampled cells can remain within the numerical tolerances. One fixture cannot prove fidelity for arbitrary photos, all provider processing, account ownership, ingestion, metadata safety, availability or erasure. The private synthetic report records measured controls and limitations; independent Pillow vectors supplement tests sharing the pinned native codec.

## Verification and next gate

The local suite covers independent Pillow PNG/JPEG controls, re-encoding, full-decode corruption, geometry/channel/depth/metadata limits, forged/replayed references, unrounded boundaries, cancelled/expired late native work, shared capacity and the complete signed-session/SQL/local-wire flow. No private configuration or real provider is used. See the PR/private records for actual exits/counts and retained initial failures.

The [acceptance preparation](ebay-image-comparison-acceptance.md) is a proposal only. A future operator still needs separately reviewed trusted runtime/credential/session wiring; no executable M3 entry point exists. Real acceptance requires independent review, an exact approved commit, fresh content and a new explicit cumulative budget. This task neither runs that experiment nor grants admission.
