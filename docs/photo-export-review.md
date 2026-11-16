# Offline photo-export review

Reviewed 2026-11-16 against PR #15 merge `c74b0caf45284756da97c8978fb43921892a65ec`. **Research and proposed decisions only:** no production sanitizer, real transport, scope change or provider operation was added. [The privacy policy](photo-export-privacy.md) remains unapproved; Stage 9B remains In Progress.

## Evidence and method

An offline prototype outside the application generated **33 synthetic sources**: 18 candidate fixtures and 15 policy-excluded diagnostic cases. Forty-two encoding attempts produced 27 candidate derivatives, 13 diagnostic outputs and two decoder rejections. No private images, storage, environment configuration, database or account was used.

Pinned Sharp 0.35.5/libvips 8.18.7/LittleCMS 2.19.1 transformed the images. Independent Pillow 12.2.0/libjpeg 6.2/LittleCMS 2.18 decoded the outputs and constructed EXIF-oriented, color-managed references. Separate Python inspection checked JPEG segments/thumbnail IFDs, PNG chunk lengths/CRCs, exact container endings, output sampling and synthetic metadata sentinels. Source and derivative SHA-256 identities were recorded separately. The retained owner review package contains the generator/prototype/verifier, original/output bytes, measurements, side-by-side HTML and previews; it is not an application dependency or production implementation.

The [Sharp output contract](https://sharp.pixelplumbing.com/api-output/#keepmetadata) describes default metadata stripping/sRGB conversion, but the encoded output was also inspected. [autoOrient](https://sharp.pixelplumbing.com/api-operation/#autoorient) considers EXIF, not XMP orientation. [Native timeout](https://sharp.pixelplumbing.com/api-output/#timeout) excludes time waiting for a libuv thread. These library properties do not prove a complete privacy boundary.

## Local observations

| Case | Measured result | Proposed consequence |
| --- | --- | --- |
| EXIF 1–8, including mirrors | Eight inverse-oriented sources match independent upright corner positions; output 640×480, JPEG PSNR 44.653–44.678 dB | Apply valid unambiguous EXIF before removal; validate swapped dimensions |
| GPS/owner/camera/date/serial/thumbnail/XMP/IPTC/comments/PNG text | All 27 candidate encodes lack tested identifying containers/sentinels; independent full decode/end/CRC checks pass; all 33 source hashes unchanged | Keep separate copies and inspect final encoded bytes; do not infer completeness from a metadata API alone |
| PNG resolution | Synthetic 300×150 DPI remains as pHYs `[11811,5906,1]`; an untagged source yields `[2834,2834,1]` | Default stripping is insufficient for a strict output allowlist; omit pHYs or generate one fixed approved value |
| RGB/grayscale and alpha PNG | Untagged pixels match exactly; semi-transparent edges and RGB under alpha=0 survive | No flattening; preserving pixels does not erase hidden/visible pixel information |
| Display P3 PNG to sRGB | Independent color-managed reference differs by at most 1/255 per channel | Supports a bounded color proposal, not arbitrary-profile correctness or admission of currently rejected PNG ICC |
| Invalid/conflicting metadata | Sharp encodes 13 excluded cases, including malformed EXIF/ICC, conflicting/XMP-only orientation, concatenated JPEG, CMYK and 16-bit PNG | A decoder is not the policy classifier; fail closed before transformation |
| Corrupt inputs | Truncated JPEG and corrupt PNG rejected by the library | Preserve originals; no original-byte export fallback |

Synthetic metadata is intentional and non-personal. The byte-preservation evidence concerns generated saved originals before/after processing, not recovered camera files. Metadata removal cannot redact faces, text, serial numbers or other information in pixels. Preserving straight alpha also preserves hidden RGB; any additional pixel-erasure policy needs explicit review.

## Quality and size tradeoff

PSNR compares independently decoded exports with the independently oriented/color-managed **decoded saved source**. It measures additional export loss, not total error against a camera scene. Values are fixture/encoder-specific; 35 dB remains a proposed named-fixture target, not a universal per-photo guarantee.

| Synthetic JPEG | Options | Output bytes | RGB PSNR dB |
| --- | --- | ---: | ---: |
| Chart, source 155,639 B | Q90 / 4:4:4 | 47,284 | 44.497 |
| Chart | Q95 / 4:4:4 | 66,130 | 48.661 |
| Fine mesh, source 525,342 B | Q85 / 4:4:4 | 168,238 | 31.919 |
| Fine mesh | Q90 / 4:4:4 | 198,134 | 35.023 |
| Fine mesh | Q95 / 4:4:4 | 257,047 | 40.789 |
| Fine mesh | Q90 / 4:2:0 | 96,603 | 14.507 |

**New recommendation for owner review:** prefer Q95/4:4:4 for initial export quality, accepting roughly 30–40% larger outputs in these samples. The original Q90 proposal is not silently approved or replaced; it remains a smaller-file alternative requiring explicit acceptance. No automatic quality reduction or repeated lossy re-encoding is proposed.

Compression-6 PNG with adaptive filtering reduced the RGB derivative from **202,122 to 29,657 B**, alpha PNG from **19,376 to 6,289 B**, with identical decoded pixels. Recommend explicitly enabling adaptive filtering. Lossless does not guarantee a smaller file: RGB source was 29,600 B and grayscale source 19,430 B versus an adaptive RGB-encoded grayscale derivative of 32,581 B. Hard output limits still apply.

## Resource and cancellation limits

Candidate fixtures were 640×480 (or inverse-oriented 480×640). Encodes including metadata/output inspection and file-write timing took approximately 1.9–7.6 ms on this Mac; this is not a throughput promise. A separate two-job 1600×1200 PNG sample took 12.17 ms. The prototype rejected a third concurrent job and returned its active count to zero. RSS rose from 67.5 MiB to a sampled 84.8 MiB; process high-water was 85.0 MiB, and immediate GC did not restore baseline.

Pre-abort prevented decode. For the in-flight sample, native work still fulfilled 7.83 ms after an abort/destroy request; its output was discarded. A future wall-clock deadline must govern result eligibility and retain the capacity reservation until native work settles. Do not promise instantaneous native termination or memory zeroization. Hard termination would require a separately justified isolation design.

Bounded probes checked input-size rejection, separate side/pixel checks and metadata-budget arithmetic. **Not verified:** worst-case 16M-pixel memory, native timeout at maximum size, hostile nested metadata parsing, stalled real storage, hard output-limit injection or cross-process limits. These are future implementation tests, not passed acceptance cases here. Existing 10 MiB/4096-side/16,777,216-pixel limits are application choices, not proven Sandbox API maxima.

## Contract and next decision

The earlier four-question follow-up was actually sent November 13: its Sent record and eBay's later Customer via Email history agree. No new message was sent during this review. The latest support reply confirms the 201 body/Location fields, but does not settle exact Sandbox Location/EPS URL grammar, unauthenticated download, specific visual ingestion, precise JPEG/PNG limits/color/alpha or lost-body recovery. [The media guide](ebay-private-media.md#contract-reconciliation--reviewed-2026-11-16) separates public, support, simulation and real evidence. General Sandbox caveats do not establish canned image ingestion.

After explicit privacy approval, the smallest recommended implementation is a **local server-only derivative boundary**, not a provider client, schema or upload UI. Start with the currently admitted JPEG/unprofiled-PNG subset, bounded metadata/orientation/profile exclusions, reviewed encoders, final-container/full-decode verification, separate actual-byte identity and cancellation tests. Do not copy the diagnostic prototype wholesale. Broader profile support, real URL validation, real-record schema, consent/transport and real EPS acceptance require separate review. PR #15's simulation constraints and synthetic URL grammar must not become real records automatically.
