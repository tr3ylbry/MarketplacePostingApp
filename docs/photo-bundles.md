# Local photo bundles

Download Photo Bundle creates a local, uncompressed ZIP of saved private photos. It does not create or update marketplace resources. It preserves image bytes, including any embedded metadata; [export privacy sanitization](photo-export-privacy.md) remains proposed, not implemented.

## Limits and selection

- **32 MiB (33,554,432 bytes)** of unique needed source photos.
- **64 MiB (67,108,864 bytes)** for the complete archive, including repeated folder payloads, UTF-8 path bytes, headers and directory records.
- Existing per-photo upload limits remain unchanged: 10 MiB each, up to 40 saved images.

A single plan determines which photos are needed and the exact ZIP size before any bundle photo GET. It uses saved photo identity, not filename, and preserves saved order. Legacy filename-only entries have no bytes and are omitted. Photos beyond every selected folder limit are not downloaded.

Current application folder limits are eBay 24, Craigslist 24, Reverb 25, OfferUp 12 and Facebook Marketplace 10, in that order. They are application behavior, not newly verified provider requirements. A photo included in several folders counts once toward source bytes but once per folder toward archive bytes. Two different image IDs with the same filename remain distinct ordered photos.

For each entry, planning includes its payload, 30-byte local header, 46-byte central record and its encoded path twice; the end record adds 22 bytes. Sizes, arithmetic, entry counts, encoded path lengths and ZIP32 offsets are checked. ZIP64 is not supported. No-target/empty and oversized plans return an actionable error, with no image GETs and no partial archive. To retry an oversized bundle, remove or reduce photos, or save fewer selected marketplaces. The app does not silently drop selected photos or split downloads.

## Reading, responsiveness and memory

The browser downloads only needed photos, sequentially, through the existing authenticated owner-scoped image route. Each response is counted while reading and must match its trusted saved size exactly. A short, excessive or failed body stops the operation and releases the reader; Content-Length alone is not trusted. Each photo gets one owned byte buffer and one CRC pass, reused by all its ZIP entries. There is no intermediate File/response Blob or payload-sized copy pass before ZIP construction.

Copies and CRC processing yield after at most 256 KiB of application work; directory assembly yields every four entries. The browser scheduler is used when available, with a timer-task fallback. A resolved Promise alone would not allow painting. Progress is announced through the existing status region.

The caps are conservative **application limits**, not a universal safe-RAM guarantee. Needed buffers remain until assembly; the final Blob still represents the entire archive. Native Blob storage/copies, network chunks, page/image-decoding state and runtime overhead are browser-dependent. Garbage collection and URL revocation do not promise immediate RSS reduction or byte zeroization. Streaming to a real file sink, compression, worker transport and per-marketplace download selection are outside this change.

## Cancellation and download lifecycle

Cancel photo bundle remains available while photo controls are busy. It aborts the operation's fetches, pending stream reads and yielding CPU work. Navigation/unmount aborts the same operation; no later archive or download may be initiated. A synchronous operation guard prevents overlapping runs. Work has a two-minute deadline after planning/loading the bundle module; timeout returns a recoverable error. Completion, cancellation and failure return focus to the bundle button while the gallery remains mounted.

After successful download initiation, the temporary anchor is removed and its object URL is revoked after the existing one-second handoff interval. Cancellation/unmount after a successful click preserves that interval so it does not intentionally shorten download handoff; cleanup then runs without updating unmounted UI. A failure before successful handoff, including a synchronous click exception, revokes immediately. Cleanup is idempotent and removes its timer/listener/handle. “Photo bundle prepared” reports initiation, not confirmation that the operating system saved the file. Automated native-download coverage is Chromium; other browsers still need normal download acceptance.

## Deterministic names

Ordinary short names retain the previous folder and numbered-photo format. Title and photo stems use the existing ASCII normalization, now limited to 120 characters after examining at most the first 512 input characters. Long titles do not mutate the saved listing. The download filename preserves a safe short original title (up to 120 UTF-8 bytes); otherwise it uses that bounded stem.

Photo names must meet the existing 255-character metadata limit and cannot contain slashes, backslashes, ASCII control characters or DEL. The original final extension is retained only if it is at most 64 UTF-8 bytes and has no unsupported path/filename punctuation (`: * ? " < > |`); otherwise the operation asks for a rename. This avoids silently changing an image's extension. Non-ASCII extensions have the UTF-8 flag in both local and central headers. Constructed paths are relative, cannot traverse parents and are checked against ZIP field limits. Older extractors or long destination paths can impose stricter filesystem limits.

## Verification and evidence boundaries

Unit/component tests exercise exact/over-limit accounting, unused-image exclusion, one source read/CRC per identity, shared payload buffers, stream size/failure/cancellation, task opportunities, unmount/timeout/repeated clicks, URL handoff/exception cleanup and ZIP32/Unicode/long-name bounds. A test-only central-directory reader verifies local headers, order, data and Node's independent native CRC. Chromium downloads generated fixtures and checks their full archive contents, cancellation/navigation and click-failure recovery using isolated storage and the disposable test database.

The earlier investigation's 40 × 10 MiB/all-folder exposure (400 MiB downloaded, 950 MiB repeated payload) was calculated, not allocated. New bounded measurements and exact-head validation results belong in the PR and existing private Stage 9B ZIP follow-up; no benchmark subsystem or large fixture is committed. These tests do not prove universal mobile memory safety or implement metadata removal/EPS transfer. Stage 9B remains In Progress and EPS remains blocked.
