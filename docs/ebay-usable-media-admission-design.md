> **Approved implementation scope:** UM1–UM8 were subsequently approved only for the fake-only assessment, tests and focused PR. Durable URLs, encryption/keys, real admission and provider operations remain unapproved. The original reviewed proposal below is retained as decision history; its local/unpublished/preparation wording describes that earlier checkpoint. See the [implemented fake-only boundary](ebay-fake-usable-media-assessment.md) for current behavior.

# Usable-media receipt and association admission — Milestone 4 proposal

**Status: local, unpublished proposal; not approval or implementation.** Reviewed source baseline: `5d503314cff36f5438b7f410af88c14e60eb7909`, tree `5266a0ae97c4f2a52b99a6f471282da7bd028e4a`. Normal EPS transport, real receipt/association admission and Inventory writes remain disabled.

## Recommendation

Implement a small **fake-only admission assessment** next: independently require fresh response provenance, exact validated content, an explicit resource-identity policy, a named consumer/URL policy, sufficient lifetime and current authorization. Its positive result means eligible for the isolated fake test, never a real usable receipt, association or Inventory permission. Keep complete URLs/queries operation-local. Do not add a real proof issuer, migration, encrypted URL store, key, provider client, route or enabling flag in that slice.

For a later reusable product association, operation-local URLs are insufficient after settlement/restart. Prefer a separately reviewed, purpose-bound encrypted payload over plaintext receipt columns if durable reuse is actually required. That later choice needs its own consumer contract, privacy/retention/key design and SQL enforcement. It is not silently included in approval of the fake-only slice.

Do not unblock real admission merely by replacing the synthetic URL expressions or passing a diagnostic report to `acknowledge`. The existing diagnostics deliberately cannot enter that lifecycle.

## Current evidence and its limits

The latest owner-provided acceptance summary is corroborated by the current private M3 and Stage 9B records. One fresh generated fixture passed the maximum-field profile on this baseline: POST 201; anonymous GET 200; 6,198-byte PNG; fully decoded 500×600; orientation, marker, color and similarity passed. Final settlement and acknowledgement completed; logical diagnostic exit 0. All four request slots are exhausted. Guarded local fixture removal queued its private object; sign-out was verified and the launcher exited 0. Physical and remote deletion remain unproven.

This is **one-fixture, one-profile evidence**, not a general photo or Inventory acceptance result. It establishes neither universal original-size preservation nor a resource-ID grammar, URL longevity, recovery, erasure or eligibility of `maxDimensionImageUrl` for Inventory. The result remains `unknown`/unassociated with no usable receipt or association. Older primary-image geometry failures and DNS refusals remain separate history.

The current [maximum-field guide](ebay-maximum-image-diagnostic.md) records the reviewed Media OpenAPI distinction: `imageUrl` is described for listing use; `maxDimensionImageUrl` is the largest-dimension variant, without an original-dimension guarantee. That source description is not proof of Inventory ingestion. Official sources were **not refetched** for this offline proposal.

Historical wording in the [real-media design](ebay-real-media-design.md), [URL review](ebay-image-url-contract-review.md), [persistence guide](ebay-real-media-persistence.md) and [original acceptance proposal](ebay-image-comparison-acceptance.md) records earlier checkpoints. Their pending-download statements, primary-only plans and superseded proposed comparison tolerances are not the latest M3 result or accepted replacement rules. Reuse their safety boundaries, not their obsolete acceptance status. No old attempt, content, URL, budget or fence can be promoted or reused.

## Audit of the implemented boundary

| Boundary | Actual behavior at the reviewed baseline | Consequence for Milestone 4 |
| --- | --- | --- |
| [Real evidence admission](../src/infrastructure/ebay/realMediaEvidence.ts) | `admitRealMediaEvidence` always throws. The only issuer uses an opaque WeakMap proof bound to the actual disposable database, owner and attempt; test environment is required and Vercel is refused. Copying JSON or setting `validated:true` cannot issue it. | Retain the closed real entry. The legacy test proof is not a fresh authenticated-response, visual-validation or consumer-eligibility proof. |
| [Receipt schema](../src/infrastructure/db/ebayRealMediaSchema.ts), [0009](../drizzle/0009_ebay_real_media.sql) | Receipt contract is only `synthetic-real-media-v1` in the exact disposable-database namespace. Plaintext fields accept fixed `.invalid.test` fixtures. Complete synthetic evidence requires 201, synthetic resource/Location, primary URL and expiry. Resource and visual identifiers are independent. | These are fixture constraints, not real Location/URL grammar or safe storage for query-bearing capabilities. Do not copy maximum into primary or widen these checks to make a real response fit. |
| [Receipt acknowledgement and status](../src/infrastructure/repositories/drizzleEbayRealMediaRepository.ts) | Append-only partial/complete/conflicting receipts; identical fingerprints are idempotent. Fresh complete normal-operation evidence may associate in the isolated fake lifecycle; stale complete evidence becomes residual. Conflicts remove the association. Status revalidates locally and can detach a stale projection. | Receipt facts and current association are separate. Raw table rows, the word `confirmed`, and a previous status read are not authorization for another operation. |
| [Capture-only SQL](../drizzle/0011_sandbox_image_capture.sql) | Capture-only attempts cannot become confirmed/residual or admit a receipt. Structural reports are append-only and bounded; consumed capture actions cannot be deleted. | A successful capture or diagnostic is intentionally ineligible for promotion, including via direct SQL or a new profile/action. |
| [Fresh response handle](../src/infrastructure/ebay/freshImageCapture.ts) | Native fixed-endpoint observation issues a private one-use handle for its own selected fresh response field. It binds context, content and profile; exact URL/query stays in memory and is burned before asynchronous intent authorization. | Reuse this pattern, not a report/URL-to-proof constructor. A new real admission producer would require separate review and a fresh normal-operation contract; it must not retrofit this diagnostic handle. |
| [Diagnostic composition](../src/infrastructure/ebay/diagnosticImageWorkflow.ts) | Uses a capture-only parent, permanent upload/content fences and a separate verification reservation. Result always has `associated:false`. Full comparison and post-comparison context checks do not invoke receipt admission. | A copied `visual.match`, UI message or acknowledgement is not a usable-media certificate. |
| [Verification ledgers](../src/application/ebayImageVerificationPersistence.ts), [0012](../drizzle/0012_ebay_image_verification.sql), [0014](../drizzle/0014_maximum_image_verification.sql) | Immutable field/contract pairing, one verification per upload parent across profiles, consumed actions and bounded append-only outcomes. Visual measurements and complete URLs are not SQL evidence. | No second GET, new profile or receipt field may reopen an old parent. Do not add visual/URL data to these envelopes as an incidental schema change. |
| [Normal runtime](../src/infrastructure/ebay/mediaRuntime.ts), [Inventory planner](../src/application/ebayInventoryPlanner.ts), [Inventory decisions](../src/application/ebayInventoryDecisions.ts) | Normal runtime returns disabled. Planner accepts no image URL and always includes media/staging blockers. Inventory staging/deletion permissions remain false. | Admission design does not enable transport or Inventory. A future consumer needs its own explicit boundary. |

### Reuse limits that must be addressed before real admission

These are source-observed limitations of closed/test paths, not reproduced live defects or evidence against the completed M3 run:

- The legacy normal-operation repository accepts optional acknowledgement guards and captures some application timestamps before transactions/locks. Its SQL association guard checks current bindings, refresh expiry, receipt expiry and conflict, but does not itself require the initiating live session or access-token expiry. The newer capture/verification post-lock guards do not automatically cover a new normal admission transition. Future positive admission needs mandatory context guards and trusted wall time **after the last blocking lock**; transaction-start time and caller timestamps are insufficient.
- The base attempt trigger prevents deletion of fenced rows; the capture trigger additionally preserves unfenced consumed capture actions. Repository reclamation retains old action rows, but that alone is not a universal SQL prohibition on deleting an unfenced normal-operation row. Future production admission must preserve every consumed action in SQL as well as repository code. Do not copy the weaker test lifecycle or reclaim by overwriting its binding.
- The legacy proof correlates database/owner/attempt and parsed synthetic fields. It does not attest full decoding, selected URL, target consumer or completed native/network settlement. Its fingerprint includes synthetic URL fields; do not reuse that serialization to persist real URL/query fingerprints.
- There is no current real capability encryption, retirement/erasure representation or bounded real-admission evidence contract. Diagnostic envelope budgets do not automatically apply to arbitrary new receipt records. Existing AEAD token code is not approval to use credential keys for image URLs.

These gaps block opening the real boundary. The next fake-only assessment can model and test the required decisions without relaxing any current SQL guard. SQL transition changes and positive real admission need a later separately approved slice.

## What a usable receipt means

Use three distinct concepts:

1. **Evidence receipt:** immutable facts about one operation, including partial, late or conflicting observations. It proves only the claims actually established. A local receipt ID is not a provider resource ID or ownership assertion.
2. **Live-use capability:** a private, purpose-scoped handle to the exact eligible URL. Possession is necessary but not sufficient; the current owner/session/context and deadlines must authorize the named use. A durable receipt without a live eligible capability cannot supply a URL after restart.
3. **Current association:** a detachable projection from one owned photo/version/order to an eligible receipt for a specific consumer. It is not a grant, remote ownership, Inventory attachment or permission to send. Every consumer revalidates; deletion of this link never erases the evidence or fences.

Reject an undifferentiated `usable:true`. Eligibility must answer **usable by which server consumer, under which contract, until when, for which exact bindings?** Proposed first consumer is an isolated fake admission test only. No real Inventory consumer is approved by this proposal.

### Minimum evidence, independently established

All positive gates below are necessary. Partial facts can be retained conservatively without combining unrelated responses into a complete receipt.

| Claim | Minimum trustworthy source/binding | Insufficient substitute |
| --- | --- | --- |
| Fresh create provenance | Trusted fixed Sandbox create producer, bounded unambiguous 201 response and actual settlement; exact committed upload attempt/intent revision, authenticated seller/grant/configuration/connection, source and transmitted derivative identities; selected field fixed before upload | Caller-provided JSON, a status code, a fixture parser, structural report, signed-in account label or old M3 result |
| Exact URL correlation | Private handle issued inside that producer for the exact selected raw field from that same response; immutable operation/profile/consumer binding; no URL getter/selector supplied by a caller | A browser URL, reconstructed path, copied handle, matching-looking host or another co-returned field |
| Retrieved image validation | Bounded anonymous request through the reviewed raw-URL/DNS/all-address/peer/TLS policy; complete accepted framing and full decoding; named validation policy against the exact submitted derivative; original deadlines, cancellation and actual settlement honored | Header dimensions, MIME, Content-Length, similarity alone or a caller's `validated`/`match` flag |
| Resource identity | An explicit reviewed identity level and evidence. Attempt plus authenticated response establishes operation correlation. A provider resource ID requires independently supported field/Location grammar; keep it separate from image-path identity | Segment lengths, path suffixes, identical ID strings, a SKU prefix or the fact that image bytes match |
| Consumer URL eligibility | Source-backed approval of the exact field and URL contract for the named use. The field validated must be the field the consumer would use | Maximum-image diagnostic success, primary/maximum co-return, or listing-use wording treated as an Inventory guarantee |
| Lifetime | Strict finite provider expiry from that same response; original response/review/lease/policy windows; sufficient remaining time for the approved operation plus safety margin; trusted current wall time after locks and monotonic runtime checks | Expiry syntax alone, reported future availability, token lifetime substituted for image lifetime or a reset timeout |
| Current authorization | Genuine server-side authentication; exact owner, seller/environment, current connection/grant/configuration versions, original action/session binding for admission, listing/source/order/recipe/content versions, no conflict/overflow/unresolved uncertainty; final SQL authorization after all blocking reads | Submitted owner/session IDs, an old snapshot, an association row, operator assertion or proof object from another operation |
| Commit and use authority | One atomic local evidence/projection decision with revision checks and idempotent identity; known acknowledgement; fresh validation at each later authorized use | A network success with a lost commit, SQL row existence alone or another receipt acknowledgement used as new network permission |

The generated M3 validation policy is deliberately fixture-specific: its markers, fixed geometry and numerical thresholds are not an approved validator for arbitrary product photographs. Keep the frozen 500×600 policy in the first fake-only controls. A broader photo policy is a separate decision, not a relaxed fallback after a refusal.

Recording a valid future receipt would not clear its send/content fence. A fresh causally bound completion may establish only its approved receipt/association claims; the action and bytes remain consumed even after a positive association. A later conflict or expiry removes eligibility without reopening that history.

### Proposed proof and transaction sequence

- A future trusted producer would retain private response provenance and an image-validation completion proof in process-local registries, with copied/frozen immutable bindings. Only actual producer/decoder completion can issue these proofs. Serialization, `Object.freeze`, a type assertion or a public report cannot issue authority. The fake issuer remains test/disposable-DB restricted.
- Correlate the proofs to the same attempt, selected field/profile, consumer, exact submitted derivative and current review. A handle for a diagnostic/capture-only parent is categorically rejected. Missing identity or consumer evidence produces a safe refusal, not invented fields.
- Complete network/native work and the last potentially blocking context reads before admission. Then acquire short database locks in the established order: owned listing, connection, image, live session, parent attempt, verification when applicable, current association. Take `clock_timestamp()` and recheck every expiry/version after the final wait. Keep payload encryption/decryption, provider, storage and native work outside the transaction. Before a later network use, finish all asynchronous context work before its final SQL authorization, then check cancellation/deadlines synchronously; do not insert another snapshot wait after that authorization.
- Distinguish immutable evidence acknowledgement from positive projection. Late/cancelled/stale evidence can append bounded facts; it cannot activate an association, renew a lease or release uncertainty. No SQL expression can independently prove HTTP provenance or decoded pixels: SQL enforces bindings, allowed contracts, state, immutability, bounds and wall-clock validity; the trusted server producer supplies the external evidence. A privileged database administrator is outside these application/trigger guarantees.
- Use one stable local admission/acknowledgement identity per candidate. Concurrent identical acknowledgements serialize and return the recorded fact; contradictory facts invalidate eligibility without replacing history. Existing bounded identical **local** acknowledgement retries may be reused, at most two, while original rules remain valid. They never repeat derivation, POST, GET or another action. After restart/lost proof, do not reconstruct authority from rows or a report.
- Preserve the unavoidable final-local-check-to-network race for any later consumer. No locks span HTTP. Recheck eligibility at use/acknowledgement, abort when changes are observed and retain uncertainty; never promise cross-system atomicity or remote recall.

## URL/query decision and intended consumers

A query may be sensitive without being a proven signed token. Treat the entire path and query conservatively; do not invent parameter semantics, inspect signing schemes or rewrite it. The existing raw/parsed equality policy, exact reviewed image origin/port, no credentials/fragments/ambiguous encodings, pinned egress and resource limits remain in force for diagnostic retrieval. They are an application request policy, not a universal eBay URL grammar or consumer approval.

| Option | Utility and privacy | Restart/recovery and cost | Recommendation |
| --- | --- | --- | --- |
| A. Reject every query-bearing URL | Simple, avoids retaining a potential capability; cannot handle the query-bearing forms observed in current diagnostics | No query support or reusable reference; does not solve response/identity/consumer gaps | Do not describe this as current real admission or a universal provider rule. Keep real admission closed, but do not make query rejection the target design merely to fit old plaintext fixture columns. |
| B. Exact opaque URL in bounded operation-local memory | Already demonstrated for one maximum diagnostic. Only a fixed trusted server consumer can borrow it; no browser delivery, logging or persistence | Lost on completion, expiry, cancellation or restart. No durable rehydration or retry; receipt facts alone cannot recover it | **Use for the next fake-only slice.** It creates no durable real reusable association. Preserve the existing original operation window; no new lifetime. |
| C. Purpose-bound encrypted durable payload | Could support later server-only reuse if a named consumer is approved; ciphertext still needs access control and minimization | Requires explicit storage/erasure state, key lifecycle, constraints, restart authorization and failure tests; encryption cannot establish eligibility or remote erasure | Preferred over plaintext **if** durable product reuse becomes necessary, but design/approval and implementation are separate gates. Do not implement it in the next PR. |

### Consumer boundary

| Consumer | Allowed conclusion |
| --- | --- |
| Existing primary/maximum diagnostic | The fixed field may be downloaded once under its own explicit budget. Result remains unknown/unassociated, even on a match. |
| Proposed fake admission test | Synthetic eligibility only; no real proof issuer, usable URL DTO or production association. |
| Ordinary listing UI/private previews | Continue existing private-photo behavior. No returned eBay URL, proxy endpoint or browser capability is needed by this slice. |
| Future Inventory image consumer | Not approved. Requires its own field/identity/expiry/ingestion contract and authorization boundary. No `imageUrls` added to the planner and no PUT/DELETE permission. |

### Conditional durable-storage design, not implementation authority

If option C is separately selected, the minimum design must include:

- **Data separation:** immutable non-capability receipt facts and a detachable current association; the smallest erasable encrypted payload holding only the exact approved consumer URL, field and expiry. Do not retain every co-returned URL or raw response. Existing plaintext synthetic receipt columns and diagnostic envelopes stay unchanged. Avoid a generic capability vault, new workflow ledger or provider abstraction; choose the exact payload representation only when this storage slice is approved.
- **Encryption and keys:** authenticated encryption with fresh random nonce, explicit algorithm/key version and purpose separation. Bind the payload with authenticated data to immutable receipt/attempt, owner, Sandbox seller/environment, field/consumer contract and immutable context/content commitment. Do not use a mutable product link as the sole binding. Prefer a separately approved media-capability key purpose rather than blindly sharing the GitHub, Reverb or eBay-token key. Current token cipher has only key version 1; its existence supplies no rotation/retirement design. No key is retrieved, generated, changed or selected here.
- **Access:** only the server consumer holding fresh genuine owner authorization can request an internal one-use borrow. Validate ownership, context/version, intended purpose, conflict and expiry before decryption and immediately before use. No generic URL getter, browser/API serialization, admin ownership override, global search, analytics or error echo. Background reuse requires separate authorization and is absent initially.
- **Logging and equality:** omit raw URL/path/query and their fingerprints from logs, traces, error causes, browser data and ordinary receipts. Use a local candidate/decision ID plus approved non-capability facts for idempotency; do not reuse the synthetic fingerprint over plaintext URLs. A changed raw target for the same immutable decision is uncertainty/conflict, not normalization or a replacement value. Ciphertext is not permission and must not be copied into public DTOs.
- **Expiry:** eligibility ends at the earliest approved consumer deadline, provider expiry minus the existing 60-second margin, policy cutoff or authorization invalidation. A later use must have enough time for its entire reviewed budget. Missing, malformed or unsupported expiry is NO-GO. No implicit refresh, HEAD, re-download, URL renewal or re-upload follows expiry. A source-backed maximum supported expiry horizon and the real consumer's lifetime policy remain prerequisites for C; no unlimited horizon or invented eBay lifetime is accepted here.
- **Disconnect/erasure:** immediately deny further payload access and detach current use on disconnect, deletion, offboarding, key unavailability or changed grant/connection; reconnect does not reactivate it. Payload retirement must be terminal so a replayed acknowledgement cannot recreate erased ciphertext. The payload's deletion procedure/SLO, backup/key access and permitted diagnostic retention require explicit C approval. Accepted Day-30 review/Day-90 disposition duties for safety history are not an automatic payload purge policy or indefinite retention permission.
- **Failure:** tampering, wrong associated data/key, missing ciphertext or retired key means inaccessible/NO-GO, not plaintext fallback or new upload. Failed physical erasure remains reported and access-denied. Retain minimum non-capability consumed-action/content history; if required erasure removes the ability to enforce refusal, disable the affected mutation capability before erasure. Encryption, expiry and local deletion never prove remote deletion.

This resolves the next choice in favor of B without prematurely authorizing C. A persistent local association that cannot supply an eligible capability must be reported as unavailable/residual, not advertised as reusable media.

Admission must finish within its original operation/review/lease windows. A later use of a valid durable receipt would require a new genuine owner-session authorization and its own reviewed consumer deadline, without extending provider expiry or accepting a changed connection/grant. The original initiating session remains historical evidence, not a perpetual session or a replacement for new authentication. Discard operation-local URL references and zero owned buffers after actual settlement; JavaScript string disposal is not a guarantee of immediate memory erasure.

## Resource identity and contract gaps

Keep three identities distinct: the local attempt/receipt, the provider API resource when independently identifiable, and the image representation selected for a consumer. Authenticated co-return establishes response correlation, not an equality between their IDs. A valid image and opaque URL do not create a verified provider resource ID or deletion right.

**Recommended v1 default:** use the upload attempt plus fresh response only as a local correlation handle; leave provider identity explicitly unresolved unless its contract is supported. Permit fake candidate assessment with invented independent identities, but require a resolved identity policy and consumer eligibility before any real usable receipt/association. If a future URL-only consumer can safely operate without a stable API resource ID, approve that narrower identity level explicitly rather than fabricate a Location ID or silently call it verified ownership. The current synthetic complete-receipt rule must not be weakened incidentally to implement that exception.

| Gap | Known / missing | Blocks |
| --- | --- | --- |
| Location/resource identity | Earlier structural reports contain normalized components, not full raw values or a grammar. No retained evidence establishes all valid host/path/ID encodings, relative forms or a safe extraction rule. Upload and observed Location hosts need not match. | A real parser/verified-resource claim. Do not derive IDs from segment lengths, use image-path IDs as API IDs, construct URLs or fetch Location/getImage. |
| Consumer field | Maximum-field anonymous retrieval passed for one fixture. Existing Media descriptions do not establish maximum-field Inventory acceptance, and primary was not validated by that successful maximum GET. | Positive Inventory-purpose admission or substituting maximum for primary. Co-return does not transfer validation. |
| General image validation | Exact generated RGB fixture passed. Arbitrary photos, other geometry/formats/metadata/color/alpha and provider transformations remain outside that evidence. | General-purpose media admission. No threshold/geometry relaxation in this proposal. |
| Real expiry and recovery | A response timestamp is not an availability/erasure guarantee. Supported maximum lifetime, URL renewal and lost-response recovery remain unverified. | Durable-reuse lifetime/recovery policy. No automatic follow-up or reset. |
| Durable capability policy | No approved real payload representation, key lifecycle, physical erasure SLO or consumer access contract exists. | Option C implementation and reusable real associations. Does not block operation-local synthetic assessment. |
| Real transition enforcement | Existing receipt SQL is synthetic-only; new native proof, mandatory current session/expiry checks and post-lock positive-admission guards are absent. | Opening real admission. SQL/app gaps must be addressed together in a separately reviewed migration; do not edit applied migrations. |

These are not requests for another experiment or broad support exchange. The smallest later evidence task is a targeted source-backed identity/consumer-contract review using already retained authoritative material, or separately approved public documentation research if needed. A further live probe, ingestion test or support message would need its own concrete authorization; none is proposed as an automatic next action.

## Required failure and lifecycle behavior

| Event | Evidence / association behavior | Never infer |
| --- | --- | --- |
| Definitive failure before intent | Preserve consumed action; retire only the exact eligible unfenced claim by revision. Any later explicit action follows existing reclamation rules with a new attempt/token. | Reusable old action or deletion of consumed history |
| Lost response, timeout after intent or unknown dispatch | Preserve immutable intent and both content fences; bounded unknown evidence, no usable association. | Provider absence or permission to resend |
| Lost fence/GET/admission commit acknowledgement | Treat commitment as uncertain. Only the same bounded local acknowledgement/inspection may correlate known evidence; never repeat external work. No positive claim without a known valid commit/current eligibility. | Rollback, unused request allowance or a fresh action namespace |
| Late success after cancellation/deadline | Preserve bounded trustworthy late facts with correlation; no new positive projection. Actual native/network settlement still owns capacity until complete. | A late match restoring authority or cancellation proving erasure |
| Partial or contradictory evidence | Preserve facts append-only within approved bounds; incomplete/conflicting eligibility stays NO-GO and detaches a projection. Do not merge fields across responses/attempts. | A later response overwriting history or clearing uncertainty |
| Duplicate acknowledgement | Same decision/facts is idempotent and does not consume another evidence entry; concurrent callers serialize. Different facts for that identity refuse and record bounded conflict where possible. | Another GET/POST or association to another photo |
| Listing/image edit, reorder or deletion | Current association invalid/inaccessible or detached. Retention-aware local cleanup remains independent. Evidence, consumed actions and source/derivative fences survive. | A raw association row remaining usable or deletion permitting re-upload |
| Disconnect, changed scopes/configuration or reconnect | Deny live use; retain history. Same owner/seller after reconnect is not the original grant/connection version and does not automatically reactivate a receipt. | Ownership or usage authority restored by ID equality |
| Expired URL, lost in-memory handle or restart | Receipt may remain an historical fact but no live capability/usable association can be reconstructed. | Availability, renewal, permission to re-upload or recover a discarded URL |
| Erasure/offboarding | Detach access; follow accepted private review/disposition obligations. Retain minimum enforceable refusal, or disable the affected mutation capability before required identifying-history erasure. | Automatic cascaded safety-history erasure, fence release or remote erasure |
| Cross-owner collision | Generic refusal; no foreign IDs, URL, seller label or evidence disclosure. Same-seller source/derivative fences remain independent of owner, connection and recipe. | An operator assertion establishing remote ownership |

## Decision package

### Already accepted requirements — carry forward

| ID | Requirement |
| --- | --- |
| A1 | The latest M3 pass covers one generated maximum-field fixture only; all four slots are exhausted and every historical attempt remains unassociated. No retroactive promotion. |
| A2 | Permanent action/content fences, immutable intent/profile, one verification per upload parent, conservative uncertainty, bounded append-only facts and idempotent local acknowledgement remain. |
| A3 | Genuine owner/session authorization, exact seller/grant/configuration/version/content binding, trusted post-lock wall time, original deadlines, no network/native work under database locks, settlement-owned capacity and zeroization remain. |
| A4 | Exact reviewed opaque URL/egress safeguards are for their approved purpose; complete real URLs/queries currently stay operation-local and out of SQL/receipts/browser/logs. |
| A5 | Synthetic proof/database/SQL restrictions stay intact. No capture/diagnostic parent becomes a real receipt or association. |
| A6 | Existing privacy and R1–R4 review/offboarding terms remain accepted, including Day-30 review/Day-90 disposition obligations. They are not automatic purge/renewal/erasure/release instructions. Physical/remote erasure is unproven. |
| A7 | Normal EPS transport, real admission and Inventory writes remain disabled. Publishing this proposal, changing keys/schema or running another acceptance test needs separate approval. |

### New decisions — proposals requiring explicit approval

| ID | Recommended choice | Meaningful alternative / tradeoff |
| --- | --- | --- |
| UM1: claim model | Separate immutable evidence, live-use capability and consumer-specific current association. A real consumer must approve its exact identity/field/validation contract. | A generic complete/usable flag is smaller but conflates provenance, decoded content and Inventory eligibility; reject it. |
| UM2: URL handling | Option B for the next fake-only slice; no durable URL/query or capability fingerprint. Option C is a separately gated target only if persistent reuse is required. | C immediately enables a recoverable reference but adds unresolved storage, key, lifetime and erasure obligations. A rejects observed query forms without resolving admission. |
| UM3: identity | Local receipt/response correlation is explicit; unresolved provider identity or consumer eligibility blocks positive real admission. No Location parser or ID equivalence guessed. | Requiring a provider API ID even for every fake candidate is simpler conceptually but prevents testing the distinct identity levels. A future URL-only exception needs explicit consumer approval. |
| UM4: trusted proof | Private producer-issued, operation/context/field/consumer-bound evidence; no serialized DTO/report/validated flag as authority. Require mandatory final post-lock authorization for any later positive commit. | Extending the existing synthetic parser to real URLs is less code but supplies no external provenance/visual/consumer proof; reject it. |
| UM5: time and invalidation | For B, retain original operation windows, provider-expiry minus 60 seconds and existing policy cutoff; each later use requires its own fresh authorized budget, without extending the receipt. Disconnect/reconnect/changed context invalidates eligibility. | Persistent usability based only on recorded expiry is convenient but misses authorization and elapsed-lock races. Durable consumer horizons remain a separate C prerequisite. |
| UM6: bounded evidence | Model one stable admission decision per attempt and at most four distinct bounded non-capability fact envelopes of at most 2 KiB each; identical acknowledgements do not use budget. Overflow is incomplete/NO-GO. This is a proposed new receipt budget, not a claim about current receipt SQL or eBay. | Reusing unbounded synthetic receipt accumulation is flexible but leaves storage/conflict processing unbounded. No new ledger/schema in the first slice. |
| UM7: persistence/privacy | No encryption/key changes now. Before C, separately approve a minimal erasable payload, purpose/key/AAD/version rules, authorized consumers and an actual payload deletion/SLO/backup policy. Preserve immutable minimum history and terminal erasure refusal. | Reusing token keys/plaintext columns or applying Inventory retention would be faster but lacks purpose/erasure approval; reject it. |
| UM8: next implementation | Authorize only the fake-only assessment and preservation tests below, with all real permissions false; independently review it before any merge. | Combining real storage, migration, provider wiring or Inventory consumers would cross unresolved evidence and policy gates; defer. |

### Unresolved evidence is not waivable by approving UM1–UM8

The resource-identity/Location contract, intended consumer's primary-versus-maximum eligibility, general-photo validation and durable expiry/recovery evidence above still block their corresponding real features. Approval of the fake-only design does not assert those facts, approve C, choose a key or enable real admission.

## Smallest subsequent fake-only PR

**Scope:** one internal admission-assessment module and focused tests/docs, reusing existing bindings, opaque synthetic proof discipline, fake workflow and disposable database helper. Names such as `ebayUsableMediaAdmission.ts` are proposed, not existing APIs. Inputs are internal proof references and trusted snapshots, not URLs/owner/session assertions from a browser. The module reports bounded refusal reasons or `eligible-for-fake-association` with `simulation:true`, `realAdmission:false` and no real send/admission/Inventory permission. It does not itself insert a new-contract receipt or association.

Use a fixed synthetic consumer and generated M3-profile controls initially. Real consumer/identity policies are absent by construction. The test-only issuer must retain the existing test-environment plus actual-disposable-database checks for any proof used with persistence; no environment switch, public issuer or dependency-injected fake may create a real proof. Keep the legacy fake parser and its fixed URL grammar unchanged. An opaque-query control can be held only in synthetic operation-local memory; do not persist it in those legacy columns.

No new migration, table, ledger, provider gateway, downloader, encryption/key material, URL-rehydration store, UI/route, job, scope change or runtime call site. No edits to applied migrations, current normal-runtime gates or existing diagnostic result/state. Existing positive fake association controls may still exercise the existing synthetic contract; that is not a new real or maximum-field contract.

This assessment slice does not fix or certify the legacy normal-operation SQL timing/guard gaps listed above. In particular, its tests must not claim universal SQL protection of unfenced normal action history or session expiry after every lock wait. Those are mandatory acceptance tests for the later transactional admission slice before opening any real path.

### Acceptance tests for that PR

| Area | Meaningful controls and refusals |
| --- | --- |
| Proof origin | Legitimate synthetic producer/comparison chain is eligible for its fixed fake consumer; copied/serialized/forged proof, caller `validated`/`match`, wrong issuer, different instance and real/production context refuse. |
| Correlation | Same owner/session/seller/attempt/revision/config/grant/source/derivative/recipe/field/consumer succeeds synthetically. Change each independently and refuse; a valid proof for another response or co-returned field is insufficient. |
| Identity/consumer | Distinct invented API-resource and visual IDs remain independent. Missing/ambiguous identity policy, unapproved Inventory consumer and maximum-to-primary substitution refuse. No inferred ID/path grammar. |
| Validation | Existing generated 500×600 control can supply a synthetic completed validation proof; header-only, malformed, wrong geometry/marker/orientation/color/similarity, cancelled or unsettled work cannot. Existing frozen image tests remain unchanged. |
| Opaque query | Exact invented target/query retained only in memory; changed bytes, alternate field, unsafe syntax or expiry refuses. No rewriting, SQL write, raw log, URL/hash DTO or plaintext capability persistence. |
| Deadlines/context | Boundary and one-over expiry/operation/policy deadlines, elapsed waits, cancellation and version changes refuse. Use deterministic clocks in unit tests; use database wall time after demonstrated lock waits in isolated context-read tests. Do not claim that these assessment tests implement the later SQL positive-transition guard. |
| Idempotency/concurrency | Identical local decision acknowledgement remains stable; different facts conflict, parallel assessments cannot grant another network use, four-envelope/2 KiB limits hold, overflow remains NO-GO. No hidden retries or additional actions. |
| Existing SQL boundary | In uniquely disposable databases with committed migrations, retain a legitimate legacy synthetic receipt/association control. Reject real-looking contracts/URLs, wrong owner/database/attempt and capture-only/diagnostic parents. Keep immutable profile/intent, permanent parent/action and source/derivative fences intact. |
| Preservation | Rollback and lost-ack fixtures retain consumed actions/fences; late/conflicting evidence never upgrades the new assessment to real usable state. Listing/photo/connection detachment and owner RESTRICT preserve history. Reclamation requires a fresh action/new attempt; stale workers cannot affect it. |
| No authority/I/O | SDK/client construction fails tests; DNS,TCP,UDP,TLS,HTTP,Blob,OAuth and refresh are blocked except the explicitly isolated PostgreSQL test connection. No dotenv/private configuration, development data, cookie handoff or native terminal use. Runtime/admission/Inventory guards stay false. |

Use the existing isolated source/configuration and generated-fixture patterns. Databases must be uniquely disposable and dropped for teardown, not cleaned by disabling immutable-history protections. Include actual exit codes and distinguish focused checks, a complete successful repository check and exact-head CI when that future PR is authorized. No suite or CI run is authorized or credited by this proposal.

### Later gates, not bundled implementation

1. Review/approve this local proposal and the exact fake-only scope; keep real gates closed.
2. Implement/test/review the fake assessment PR. It establishes policy mechanics only.
3. Resolve the identity and named consumer contract from authoritative evidence. If durable use is required, separately approve C's concrete storage/key/expiry/erasure design and privacy implications before implementing it.
4. Separately implement producer-issued real proof and minimal receipt/association SQL changes together, still hard-disabled. Require fresh post-lock wall-time/session/access/refresh tests, direct-SQL rejection, transactional rollback, conflict/overflow/erasure tests and independent review. Never edit or convert historical diagnostic records.
5. Only after those gates, prepare a new exact-commit real admission acceptance proposal with fresh content, an explicit budget and cleanup. No current budget or discarded URL is reusable. Enabling normal transport and any Inventory consumer/writes remain separately authorized decisions.

## This document's validation and handling

This task is offline review/documentation only. Evidence is source inspection plus the latest owner-provided/private acceptance record, not a new reproduction or provider test. No runtime/schema/dependency/key or development-data change is included. Relative links, local heading references, whitespace and the complete one-file addition are checked locally; external source links are references, not network/reachability verification.

The proposal deliberately excludes private account/resource IDs, operational helper paths, configuration values, full returned URLs/queries, image bytes, source pins and private correspondence. No Notion update, publication, PR, commit or push is part of this delivery. Preserve historical evidence, queued cleanup, accepted obligations and all refs/workspace files. **Publication and the subsequent implementation require separate approval.**

Estimated progress remains **Stage 9B 80/100; overall project 72/100**. Those estimates reflect the completed one-fixture M3 acceptance, not Milestone 4 completion or a new acceptance result from this design.
