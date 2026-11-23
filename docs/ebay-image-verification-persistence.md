# Diagnostic image-verification persistence

The [Milestone 3 comparison](ebay-image-comparison.md) adds transient full-decode/visual outcomes in the internal caller. It changes neither these ledgers/envelopes nor their admission rules. Visual scores, returned hashes and bytes are not persisted; any future durable visual-evidence contract needs separate review.

This internal foundation records one-use diagnostic accounting. The repository has **no runtime entry point, network client, model wiring or response-proof issuer**. The [milestone2 internal workflow](ebay-diagnostic-image-workflow.md) now composes it with authenticated context, native fresh-response handoff and the bounded downloader, while remaining disconnected from normal application/manual entry points. A reservation, committed intent, successful context check or HTTP-shaped outcome is not permission to request an image, provider provenance, remote ownership, decoded-image acceptance or a usable association.

Normal EPS transport, real receipt/association admission and Inventory writes remain disabled. The prior capture remains unknown/unassociated with its original fences, report, review deadlines and exhausted request budget. Missing historical URLs cannot be reconstructed or used by this foundation.

## Records and permanent consumption

Migration `0012_ebay_image_verification.sql` adds exactly two tables and their SQL guards:

| Ledger | Essential contents and constraints |
| --- | --- |
| `ebay_image_verifications` | Local ID, owner, retained upload parent, local action hash, expected source/final-derivative digests, original preparing revision, fixed contract/policy tuple, phase/revision, nonrenewable deadlines, immutable intent times, overflow latch and new-record review obligations. Composite owner/parent FK with RESTRICT; unconditional unique parent and owner/action constraints. |
| `ebay_image_verification_outcomes` | Owned reservation, immutable intent revision (1, or null when no intent exists), strict bounded envelope, canonical fingerprint, database recorded time, late and protocol-conflict facts. Composite owner/reservation FK with RESTRICT; unique canonical acknowledgement. Append-only, including direct SQL UPDATE/DELETE/TRUNCATE refusal. |

Environment, stable seller, initiating session hash, listing/image/order/source version, connection/grant/configuration and recipe are inherited from the immutable retained upload parent. No new bearer token is stored. The internal caller supplies the existing parent claim token for comparison with its retained hash. IDs/revisions and a session row do not authenticate anyone; genuine Better Auth validation remains the responsibility of a future trusted server caller. There is no such caller in this slice.

Reserve only while the exact owned parent is **capture-only/preparing/unfenced**, after local source and accepted derivative identities are known. There is one reservation ever per parent and one permanent consumption per owner/action. Closing, expiry, process loss, an uncertain commit or another action cannot reclaim, replace, move or resume it. An already fenced capture cannot enroll retrospectively, including the old completed capture.

## Internal operations

| Operation | Local effect |
| --- | --- |
| `reserveVerification` | Atomically insert prepared/revision 0 under current owned context; permanently consume action and parent. |
| `recordRequestIntent` | Exact CAS prepared → intent-recorded/revision 1. Require the parent's exact next fenced revision, unknown state, original content identities and live context. Stamp all intent/deadline fields together, or roll everything back. |
| `checkIntentContext` | Read-only locked revalidation after the last potentially blocking context read. No renewal, credential construction, new intent or send permission. Outcomes/overflow prohibit a fresh current-intent check. |
| `window` | Internal read-only deadline snapshot, with PostgreSQL microseconds explicitly floored to JavaScript milliseconds. Existing SQL wall-time authorization follows all blocking reads; the returned numbers do not replace the final guard. |
| `closePrepared` | Exact CAS to a fixed closed reason. Repeating the same acknowledged closure is inert. Never reset an intent or release history. |
| `recordOutcome` | Append strictly bounded original-binding evidence, including late/cancelled/contradictory facts. Exact retries return the original evidence identity before checking the distinct-record budget. |
| `status` | Owner-scoped phase/hasOutcome/late/conflict/overflow/detached flags and literal `associated:false`. No URL, secret, identity label, private binding, ownership or positive send flag. Missing/foreign rows are absent; they are not reconstructed. |

Request phase remains prepared, closed or intent-recorded. There is no complete/confirmed/retryable state. Late evidence uses immutable intent correlation, rather than demanding the newest mutable row revision; future/foreign references are rejected. It cannot change intent, renew deadlines, activate a projection or affect another reservation.

A cancellation followed by compatible late settlement is late evidence, not automatically a contradiction. Distinct settled non-null HTTP claims that disagree on status, bytes, MIME or overflow remain conflicting. A network-response claim without intent is protocol-conflict evidence, closing a prepared operation without inventing an intent. All observations remain unverified diagnostics.

## Contract, time and locking

The fixed SQL allow-tuple is primary `imageUrl`, method GET, contract `diagnostic-image-get-v1`, policy `iana-image-address-v1-2026-11-22`, normalized hash `e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887`. Its validity begins at the reviewed snapshot time `2026-11-22T20:31:28.569Z` and ends **exclusively** at `2027-02-20T20:31:27.970Z`. Unknown/stale tuples refuse. No mutable registry, lookup or automatic policy renewal is added; a new snapshot needs a reviewed migration/contract update. The numeric classifier itself remains unchanged and unwired.

Lock ordering follows existing media persistence: owned listing → connection → image → live session → upload parent → verification → outcome. Reservation uses nonblocking namespaced local-ID and owner/action guards to avoid a uniqueness wait after authorization. SQL context rechecks use NOWAIT, failing closed for statements with a conflicting lock order. Parent locking covers the owned FK and unique-parent check. All blocking repository reads precede final SQL authorization; no provider, storage, decoding or other native operation runs in a transaction.

SQL reuses the existing exact capture authorization function **after every potentially blocking lock**, using PostgreSQL `clock_timestamp()`. Caller timestamps and transaction-start `now()` cannot authorize a transition. Full database microsecond precision is retained. Two observations within one JavaScript millisecond are not assumed equal or used as causal proof.

The preparation lease is at most 30 seconds, shortened by parent/review/session/access/refresh/policy deadlines. At intent, response receipt must be finite, no later than the trusted database clock. The exact fenced parent revision establishes local sequence; its existing millisecond-rounded timestamp is not treated as a microsecond causal clock. Effective use ends at the earliest of all those deadlines, receipt +30 seconds, or finite provider expiry −60 seconds. Total request deadline is at most 10 seconds from intent, shortened by the same bounds. Missing/invalid/insufficient times refuse atomically. These are application limits, not provider availability guarantees.

The read-only final guard performs its authoritative check after its last blocking read. The new internal workflow additionally consumes an operation-local native fresh-response handle, checks cancellation/elapsed deadlines immediately before first HTTP bytes and composes at-most-one dispatch with settlement-aware capacity. Synthetic/local tests establish that code path, not actual provider provenance/compatibility. No asynchronous context snapshot follows final authorization. No cross-system atomicity, exactly-once network delivery, recall or remote erasure is claimed.

## Strict evidence and privacy

At most **four distinct envelopes**, each at most **2 KiB of canonical PostgreSQL JSON text**. Fixed keys only: version, event, reason, claimed settlement, optional HTTP status (100–599), byte count (0–1 MiB), exceeded flag and optional PNG/JPEG MIME. Identifiers are bounded to 200 characters; content/action/fingerprint hashes are 64 lowercase hex. There are no arrays or free-text diagnostic fields.

No URL, query, URL-derived fingerprint, remote ID, raw response/header, private path, filename, credential, image bytes or downloaded-content hash is permitted. The existing source/final-derivative identities and canonical **allowed-envelope** fingerprint are local bindings, not response provenance. The fingerprint excludes server recording time.

Exact acknowledgement retries consume no new revision, record, deadline or budget, even after the budget is full. The fifth valid distinct envelope latches overflow monotonically without replacing the first four. Its payload is not retained; the bounded acknowledgement reports it was not retained. Malformed/extra/oversized input is rejected without persisting it. Overflow/conflict remains conservative; no last-write-wins or automatic clearance exists.

## Retention, deletion and operational obligations

Each new reservation records maintainer necessity/access review at database creation +30 days and owner disposition at +90 days. Existing upload/capture dates and accepted privacy/retention obligations are unchanged. These dates are obligations, **not** automatic purge, renewal, erasure, request permission or fence release. There is no verbose diagnostics store, scheduler, recovery service or erasure endpoint.

Minimum consumed-action/parent/binding/intent/uncertainty history must survive while needed for replay safety. Continued lawful minimum retention requires explicit justification and a fixed next review within twelve months of disposition. Offboarding freezes further manual authorization; private acknowledgement within seven days and disposition within thirty days (sooner when required) remain manual responsibilities. This code does not perform those reviews or claim they happened.

Listing/image/connection deletion or reconnect detaches the derived current context; retained parent/child/outcomes do not cascade. Original-binding late evidence may still append. Owner deletion is refused through RESTRICT and immutable history guards. Lease/provider expiry and local fixture cleanup do not prove remote erasure or authorize history deletion.

Ordinary missing history is NO-GO. SQL cannot remember an administrator-erased unfenced reservation or protect against disabled triggers/DDL. A separately reviewed disposition must retain adequate minimum safety history/tombstones, or disable **all affected mutation and diagnostic request paths, including manual capture, before erasure** could reopen a namespace. No automatic reset or operator ownership flag is provided; Inventory retention policy is not silently imported.

## Verification and limits

The unit and PostgreSQL suites use synthetic configuration/records only. The new helper accepts only an explicit query-free loopback test URL, checks the actual database identity, creates a uniquely named `marketplace_verification_<24 hex>_test` child, migrates all committed migrations fresh and repeatably, then drops the child database. It never disables immutability for cleanup or targets development data. The test role needs CREATEDB, as the existing CI PostgreSQL owner has.

Focused verification covers legitimate lifecycle controls, permanent parent/action consumption, concurrent claims/acknowledgements, immutable bindings/intent, exact policy boundaries, real lock waits across context/deadline expiry, old transactions/backdated timestamps, full-precision observations, rollback/lost acknowledgements, late/contradictory evidence, budgets, owner isolation and retained deletion/reconnect history. External network and SDK/configuration guards forbid provider traffic.

For lock-wait testing of the distant February cutoff, a disposable-database fixture temporarily substitutes a **strictly earlier wall-time cutoff**, then restores the exact committed function. The real cutoff is separately tested at its actual before/at boundary. This is not a production clock override or proof a real February wait elapsed. No production policy, history guard or deadline is extended/disabled.

Run with synthetic isolated configuration:

```sh
npx vitest run src/application/ebayImageVerificationPersistence.test.ts
npx vitest run --config vitest.integration.config.ts src/infrastructure/repositories/ebayImageVerification.integration.test.ts
npm run check
```

Actual exits/counts and exact-head CI belong in the PR and private project records. Passing these persistence tests proves local accounting only. The [milestone2 integration](ebay-diagnostic-image-workflow.md) adds native response-to-download composition and synthetic/local wire evidence. Actual provider compatibility/provenance, decoding/visual ingestion, association admission and any future exact-commit/content/budget experiment remain separate gates. No real request or experiment is authorized by this guide.

The [milestone1 safe downloader](ebay-safe-image-downloader.md) supplies the resolver/pinned-TLS/anonymous-HTTP primitive used only by the internal diagnostic composition. It does not grant request authority, enable normal transport, prove provider compatibility or admit media.
