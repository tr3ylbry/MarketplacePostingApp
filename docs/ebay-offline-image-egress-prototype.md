# Offline image URL and egress policy prototype

This implements only the offline Option B model proposed in the [URL-contract review](ebay-image-url-contract-review.md). It is **not** a downloader, provider adapter, real response handoff, receipt validator, ownership claim or permission to make a network request. Normal EPS transport, real receipt/association admission and Inventory writes remain disabled. Stage 9B remains In Progress.

## Scope and entry points

- [URL policy](../src/application/offlineImageUrlPolicy.ts): bounded raw checks, a diagnostic accepted/refused decision and an internal opaque memory target. No request or URL fingerprint.
- [Address model](../src/application/offlineImageAddressModel.ts): explicit, versioned **synthetic positive catalog**, not a production public-address classifier.
- [Orchestration model](../src/application/offlineImageEgressPrototype.ts): synthetic response proofs, mock intent/outcome, mock resolution, mock connection/TLS and mock request sink. No real implementations of those ports exist here.

Nothing imports this model from application composition, routes, UI, CLI modes, jobs or provider clients. No dependencies, schema, migration, privacy notice, OAuth scope or existing capture/admission/fence implementation changes. Both source and derivative fences of the completed capture stay intact; that attempt remains unknown/unassociated. The old URLs are unavailable and its entire 3/3 request budget is exhausted.

## Proposed raw policy, not a verified eBay grammar

Only exact lowercase `https://i.sandbox.ebayimg.com/` authority is eligible in the model, effective TLS port 443 with no raw explicit port. Alternate/suffix/trailing-dot/uppercase hosts, IPs, user information including empty `@`, raw fragments including empty `#`, whitespace, controls/DEL and backslashes fail. Raw input is at most 8,192 visible ASCII bytes. The path has 1–16 nonempty segments, each≤512 raw bytes; literal dot segments/doubled separators fail. Exact parsed href must equal the raw string; normalization is refused, not repaired.

Every percent escape must have exactly two hex digits. In the path, encoded C0/DEL, backslash, percent, dot, slash, colon, question mark, fragment delimiter and at-sign fail. Other path escapes must still survive exact serialization unchanged. In the **opaque query**, encoded C0/DEL/backslash and percent (`%25`, including nested escapes) fail. Other encoded delimiters are uninterpreted data. No URLSearchParams, signature interpretation, sorting, duplicate folding, `+` conversion, removal or re-encoding occurs. Query order/case/duplicates/empty delimiters and accepted triplets remain exactly unchanged through the mock request target.

These restrictions can reject legitimate provider URLs, including explicit `:443`, nested query escapes or forms normalized by WHATWG serialization. That is a compatibility limit requiring a future decision, not evidence eBay rejects those forms. No literal path or identifier grammar was inferred from observed segment lengths. Only the primary field is modeled; maximum-image and Location fallbacks are refused.

## Synthetic provenance and privacy

Instance-bound WeakMap proofs bind invented owner/session/seller/connection/version/grant/configuration/attempt/action/source/derivative and three context deadlines. Proofs serialize as empty objects. Forged, copied, serialized, foreign-instance, stale, cancelled and replayed proofs fail. One attempt can issue once; each owner/action is bound at issuance and consumed synchronously before async work, including busy/rejected/uncertain outcomes. Expiry or refusal cannot move an action to another attempt. Changing a connection, context deadline or other binding fails rather than renewing authority.

Raw targets are held behind opaque internal handles, discarded on handoff/refusal/deadline, and never returned in diagnostic DTOs, errors, reports, fingerprints or ordinary caller options. Unused response proofs have logical expiry timers; one target handoff consumes its handle. The mock request sink alone receives the unchanged target in memory. Fixed diagnostics contain only simulation/real-request-disabled/association-disabled flags, a bounded reason and byte count. Mock exceptions are discarded, not reflected. No logger, file/DB sink or real capture handoff is added.

JavaScript strings, garbage collection, blocked event loops, mock-held references and process dumps prevent a promise of physical or hard-real-time memory erasure. Eligibility checks and logical disposal do not prove secrets have disappeared from RAM. The interface is internal to an offline model; dependency injection is not an authentication or network-security boundary.

Mock intent/outcome calls are **not durable persistence**. A failed intent/outcome never retries or reopens an action. Outcomes are modeled only after successful resource settlement and a final current-context/deadline check. Late timeout/cancellation cannot produce a successful outcome. A fresh instance/process has no durable history: resumability/crash-safe accounting still requires a separately reviewed contract. Do not connect these mocks to existing ledgers or reinterpret an old attempt.

## Address coverage and the mock connection boundary

`synthetic-positive-catalog-v1` uses hand-authored test verdicts for exactly `1.1.1.1`, `8.8.8.8` and canonical `2001:4860:4860::8888`. They are numeric fixture values, **not newly resolved/verified destinations**. Its declared source explicitly has no IANA registry snapshot. Every other valid or malformed address is unsupported and blocked. This avoids pretending an improvised short denylist is exhaustive, at the cost of intentionally excluding most public addresses.

Tests include private, loopback, link-local, unspecified, multicast, reserved/special-purpose, documentation, translation and IPv4-mapped IPv6 examples, including mapped positive IPv4 examples. None becomes eligible through mapping/aliasing. Family mismatches, empty/oversized answer sets and mixed positive/unsupported A/AAAA answers fail. All simulated answers are evaluated before selection; one canonical covered address is selected. A future actual classifier needs a separately reviewed source/version, full special-purpose coverage and maintenance policy. This catalog must never be used as a production allowlist.

The connect mock receives only that pinned address, 443 and exact Host/SNI. The request sink receives the **same connection resource**, only after peer-address, encryption, authorization, certificate-host, Host/SNI, no-pool/no-proxy and latest-context checks. There is one modeled lookup/connection/request, no alternate-address lookup, pooling or proxy fallback. Only fixed GET/Host/Accept/Accept-Encoding headers exist; caller credentials, Authorization/Proxy-Authorization, cookies and referrer have no forwarding path. A real client must independently prove DNS pinning, actual peer/TLS validation before HTTP bytes, unchanged on-wire target and ambient-proxy exclusion; mock assertions are not those proofs.

## Time, response and settlement budgets

- URL eligibility ends at the earliest of 30 seconds after synthetic response, session/review/context deadlines and strict UTC expiration minus 60 seconds. Missing/malformed/calendar-invalid/expired or insufficient expiry fails. Backwards/nonfinite/erroring clocks fail; no query-derived expiry or extension.
- One 10-second total modeled resolution/connect/TLS/body/outcome window, shortened by all existing deadlines; no additive phase windows. Cancellation aborts known resources immediately. Checks follow each async transition and precede the sink/outcome. There is no cross-system atomicity claim.
- At most 16 KiB / 128 header pairs, no duplicates or unsafe controls, only static PNG/JPEG MIME and identity/no encoding. Set-Cookie/trailer declarations, redirects, challenges, informational/upgrade/error statuses and malformed lengths fail. No HEAD/getImage/maximum-image/retry path.
- Streamed bytes count toward 1 MiB without trusting Content-Length; empty, oversized, mismatched or errored bodies fail. **No image decode, pixel/visual validation or usable association occurs.** A modeled byte count is not image acceptance.
- Existing shared two-slot/no-queue capacity is reused. Timeout returns a conservative diagnostic but cannot free started work until the mock resolver/connection/request/outcome and resource settlement actually finish. Uncooperative work can keep a slot indefinitely; it is not killed by assuming an abort succeeded. Settlement/close failure stays uncertain. These are model semantics, not real DNS/socket/native guarantees.

## Verification and remaining gates

The focused tests run in a clean source-only checkout with Vite env loading disabled. Per-file guards block fetch/DNS/TCP/TLS/UDP/HTTP, provider/DB/configuration access, process launch and private environment reads. An intentional guard negative control verifies actual interception. Invented secret markers check fixed diagnostics, opaque serialization and discarded errors; query values are not used as test names. No real cookie, native Terminal/clipboard, host resolution or provider resource is needed.

Coverage includes raw/normalization boundaries, exact query identity, legitimate controls, one-use/context isolation, uncertain intent/outcome, simulated mixed DNS/rebinding/peer/TLS mismatch, credential-free plans, redirect/challenge/retry refusal, bounded/chunked/error responses, clocks/expiry/cancellation and late settlement/capacity. Full repository validation uses synthetic configuration and isolated disposable services, never development data. Actual commands/exits/counts/CI belong in the PR and private records, not a claim this model passed real transport acceptance.

Next: independent review of this draft prototype. Further work requires separate approval for a real classifier/resolver/socket implementation, durable diagnostic intent/evidence design and any real-response handoff. A later live experiment needs a new reviewed commit/content/budget; no raw URL can be recovered from the old structural report. Accepted privacy/retention obligations and old deadlines remain unchanged. No provider experiment, real admission or Inventory-policy change is authorized by this prototype.
