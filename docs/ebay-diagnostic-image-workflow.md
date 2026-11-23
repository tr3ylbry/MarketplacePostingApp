# Diagnostic image workflow: milestone 2

The [Milestone 3 extension](ebay-image-comparison.md) now prepares a private reference from the exact submitted derivative and performs bounded decode/visual comparison before downloaded-byte cleanup, with synthetic/local evidence only. Retrieval, visual results and local acknowledgement are distinct; visual metrics are not added to SQL evidence. Normal runtime and real admission remain disconnected; the [manual operator](ebay-image-verification-operator.md) is separately gated and has synthetic evidence only. The Milestone 2 transport/accounting claims below remain narrower than real-provider/image acceptance.

This server-only internal composition connects a newly observed create response to one diagnostic GET. It has no application route, UI, job or global enabling flag. The separate manual operator requires exact reviewed bindings and independent execution approval. The original capture-only workflow/command still returns structural evidence only. Normal EPS transport, real receipt/association admission and Inventory writes remain disabled.

The implementation is for independent review with synthetic identities, private-memory storage, disposable PostgreSQL and local wire fixtures. It does not prove actual eBay compatibility, decoded pixels, visual ingestion, remote ownership, usable media or erasure. The previous real capture remains unknown/unassociated with permanent fences/report/obligations and its **3/3 budget exhausted**; its unavailable URLs cannot be reconstructed or resumed.

## Sequence and trust boundaries

```mermaid
sequenceDiagram
  participant W as Internal workflow
  participant A as Better Auth
  participant D as Retained PostgreSQL history
  participant P as Private source and derivative
  participant C as Native response observer
  participant G as Safe downloader
  W->>A: Authenticate signed session; bind one-use review
  W->>D: Claim exact owned source and retain it
  W->>P: Derive and independently verify final bytes
  W->>D: Reserve diagnostic before immutable upload fence
  W->>D: Last snapshot, then combined parent/reservation authorization
  W->>C: One create POST after final bytes/time/cancellation checks
  C-->>W: Structural report and private fresh handle after actual settlement
  W->>D: Acknowledge structural capture
  W->>C: Burn handle synchronously
  C->>D: Commit exact GET intent; read conservative deadline window
  C->>G: Pass private primary target directly, borrowing parent capacity
  G->>G: Resolve all answers; pin one peer; verify TLS
  G->>W: Pre-request callback
  W->>A: Revalidate current signed session
  W->>D: Last context snapshot, then final post-lock SQL check
  G->>G: Synchronous deadlines/cancellation/peer/buffer checks; one GET
  G-->>W: Unverified bounded diagnostic and eventual actual settlement
  W->>D: Bounded original-binding outcome and settlement evidence
```

[createDiagnosticImageWorkflow](../src/infrastructure/ebay/diagnosticImageWorkflow.ts) accepts trusted server dependencies, including the actual Better Auth API and request headers. Prepare/confirm callers supply bounded local IDs and expected source/seller fingerprints, never an authenticated owner/session DTO, token, pathname or provider URL. Better Auth verifies the signed session with cookie caching and refresh disabled; a matching session row or opaque handle is insufficient. Exact owner/session, seller, connection/grant/configuration, listing/image/order/source versions and recipe are rechecked. The module creates no auth instance, SDK, token cipher, session bridge or credential-discovery path.

Reviews live in a private WeakMap and burn synchronously before asynchronous work. One factory permits one confirmation even on failure. Existing permanent action, parent, source and derivative protections survive replacement factories/process loss. The source-retention transaction commits before reading bytes. The existing accepted derivative service performs orientation/color/metadata and independent final-container checks; this capture-only diagnostic profile still requires the supported generated static 500×600 PNG, at most 1 MiB. It never uploads original bytes as a fallback. Source and final derivative identities remain distinct fields even if particular bytes happen to match.

The diagnostic reservation is committed after those identities are known and before upload fencing. The existing capture-only parent then becomes permanently unknown/fenced. An uncertain claim/reservation/fence/GET-intent acknowledgement stops the operation; it is never retried as provider permission. No transaction spans storage, native processing, DNS, TLS or HTTP.

## Fresh response and opaque capability

[freshImageCapture](../src/infrastructure/ebay/freshImageCapture.ts) uses the fixed native Sandbox create endpoint. It has no injectable `CaptureRequest` issuer, arbitrary response/URL-to-proof constructor, host/trust setting or generic URL getter. The legacy injectable capture client can still produce only its existing structural report. The new native path reuses [parseCaptureJson](../src/application/ebayCaptureReport.ts), the bounded duplicate-aware UTF-8/JSON parser, rather than a weaker second parser.

Only a complete 201 object with a safe primary `imageUrl` and strict calendar-valid UTC expiry can issue a handle, after request, response and socket closure. Response receipt wall/monotonic clocks are captured at bounded response completion. Interrupted/error/redirect/informational/duplicate/malformed/oversized responses, maximum-only data, insufficient expiry and unsafe URLs cannot supply a usable handle. Location and maximum URL remain structural observations only, with no inferred identifier relationship or fallback request.

The private WeakMap stores the exact primary URL, clocks and immutable operation/parent/revision/reservation/owner/session/seller/connection/grant/configuration/source/derivative/recipe binding. The frozen empty handle has no serialized URL. Consumption removes it synchronously before any intent await; failures, replay, foreign/mismatched bindings, cloning, serialization, cancellation, expiry and disposal cannot restore it. A short nonrenewable timer discards abandoned handles. There is no URL/query fingerprint, capability store, restart API or durable URL recovery.

The consume function exposes no arbitrary URL sink: private bytes flow directly to the safe downloader only after the supplied internal intent function acknowledges its SQL transition. That hook receives receipt/expiry times, not the URL. A handle correlates an observed response; it is neither authentication nor authorization. Local fixture responses establish code behavior, not genuine provider provenance.

## Time, locking and dispatch

Existing [verification ledgers and guards](ebay-image-verification-persistence.md) are reused without a schema migration or relaxed evidence contract. The repository's internal `window` method requires the exact fenced parent and expected diagnostic phase, reads context/deadline fields under the existing lock order, then performs authoritative SQL wall-time authorization after its last potentially blocking read. Deadline values are explicitly **floored** from PostgreSQL microseconds to JavaScript milliseconds; they are snapshots, never authorization or a substitute for full-precision SQL.

The complete operation retains the existing 30-second ceiling and shorter review/session/credential/lease/policy bounds. Upload retains its 10-second limit; GET retains one 10-second total window, further shortened by response receipt +30 seconds, provider expiry −60 seconds and every applicable database deadline. Phase transitions never renew the parent lease or extend an earlier bound. Wall and monotonic anomalies fail conservatively. The exclusive policy cutoff stays **2027-02-20T20:31:27.970Z**.

Before POST, the workflow completes the context/credential reads and parent check, then performs the combined post-lock parent/reservation authorization. That final `window(...,"prepared")` check binds the still-prepared exact reservation and fenced content, using the trusted time returned by `capture_media_authorize` in a materialized SQL expression. Closing the reservation or creating an unrelated intent after the earlier parent check stops POST. The workflow then synchronously checks final bytes, local configuration, cancellation and time. Before GET, DNS/TLS/HTTP socket attachment precedes the callback; that callback authenticates again, completes the last owned context snapshot and calls `checkIntentContext`. No asynchronous snapshot or credential read follows the final SQL authorization. The downloader then performs its synchronous cancellation/deadline/peer/unsolicited-byte checks before HTTP bytes. The final-check-to-network race remains unavoidable; no cross-system atomicity, exactly-once remote delivery, recall or remote erasure is claimed.

## Capacity, settlement and temporary data

One complete operation owns one of the existing **two process-local slots, no queue**. The derivative service, native observer and downloader borrow that exact opaque lease sequentially. They cannot overlap borrowing, forge a lease or reserve a second independent slot. Standalone derivatives/downloads retain their own acquisition behavior. A third operation refuses as busy.

Capacity is not a promise that simultaneous SQL transitions sharing one seller/listing succeed. Existing NOWAIT authorization rechecks can refuse such contention conservatively, without retry or fence release. The two-operation control overlaps complete operations at their pending pre-GET callbacks after earlier transitions finish; a separate control demonstrates the unchanged fail-closed upload contention rule.

Cancellation/deadline may return an early **unsettled** summary. The run still owns capacity until pending database/authentication promises, native sockets and downloader callbacks actually settle and bounded evidence recording finishes. Uncooperative work can retain a slot indefinitely; no forced release, replacement pool or background retry exists. `result` is not settlement; internal callers must await `settled` during teardown.

Temporary response/multipart/export/download buffers are operation-owned and cleared after their consumers settle; original private source bytes remain unchanged. The workflow records byte counts, clears the downloaded byte copy, and returns no pixels for accidental admission. Private URL references are discarded on consumption/cancellation/expiry/final cleanup. JavaScript strings, parser/native buffers and operating-system resources may outlive a logical reference; immediate physical erasure and hard real-time reclamation are not promised.

## Outcomes, uncertainty and retention

The workflow explicitly maps successful `retrieved` to a settled response with HTTP 200, because the existing client accepts only200. Refusals expose **null/unknown HTTP status** unless the client actually supplies one; no status is invented. Reasons map into the existing fixed vocabulary. Cancellation/unsettled observations, final settlement, contradictory/late facts and lost acknowledgements remain original-binding evidence. Current mutable revision is not substituted for immutable intent correlation.

Only identical local capture/outcome acknowledgements may retry, bounded to two attempts; POST/GET never retry. If all outcome acknowledgements remain uncertain, the summary reports `acknowledgement:uncertain`; `retrieved` still records the known network observation. Four distinct 2 KiB envelopes, idempotency-before-budget, append-only SQL guards and overflow remain unchanged. No URL, query/hash, remote identifier, path, filename, credential, response/header body, downloaded bytes or downloaded-content digest enters diagnostic persistence. Persisted reports/errors contain fixed categories and capped counts only; Milestone 3 visual summaries/metrics remain operation-local.

No result becomes a receipt, association, remote ownership claim or positive Inventory permission. Accepted privacy/retention policy and Day-30/Day-90 obligations remain review/disposition duties, not purge, renewal, fence release or automatic erasure. No operational recovery or purge service is added.

## Acceptance checklist and evidence limits

- Authenticated complete control: signed Better Auth session, retained original, accepted derivative, reservation-before-fence, exactly one local POST and one GET, exact raw target/query bytes, bounded outcomes, no receipts/associations, unchanged synthetic credentials and recovered capacity.
- Failure controls: forged/replayed/foreign reviews/handles/references, all meaningful uncertain-ack cuts, malformed create responses, changed context, no restart from retained records and zero GET when authorization/eligibility fails.
- Native/SQL timing: actual lock waits after the final context snapshot cross session, refresh, lease, review, policy and access deadlines. Policy fixtures shorten only the disposable cutoff and restore it. The genuine 35-second access case also crosses other shorter deadlines; existing persistence tests separately isolate individual expiry guards.
- Resource controls: two complete operations overlap, a third refuses, cancelled pending callbacks retain both slots, body cancellation produces compatible late settlement, and native failure paths preserve intent/fences. Existing standalone downloader/derivative/capture suites remain required.
- Privacy/history: bounded redacted evidence, immutable consumed actions/intent, duplicate acknowledgements, contradictory/late records and overflow; no positive admission or Inventory permission.

The test wire adapter asserts production destinations/options before substituting task-owned loopback fixtures. POST bytes are observed over local HTTP; download uses real local TCP DNS/TLS/HTTP with synthetic CA/port/address/peer substitutions outside production APIs. External network and SDK/config discovery are blocked. These tests do not establish actual upload-host TLS, public DNS/443/IPv6 routing, eBay URL availability, image decoding or real ingestion. Existing historical real observations remain structural only.

Run the focused suites and full repository check only with isolated synthetic configuration/disposable infrastructure. Exact counts, actual exits (including initial failures) and tested-head CI evidence belong in the PR/private project records. This milestone stops at one draft PR for independent review. Milestone 3 implementation and any new real experiment need separate authorization; no old request budget is revived.
