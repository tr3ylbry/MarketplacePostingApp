# Internal fake-only media workflow

**November 20 follow-up:** the separately authorized [capture-only discovery implementation](ebay-image-response-discovery.md) adds a manual pinned client, structural evidence channel and explicit discovery OAuth-profile preparation. It does not enable normal transport, real receipt/association admission or any real experiment. Earlier proposal/unimplemented wording below records its original checkpoint; later accepted privacy/persistence decisions remain effective.

This slice composes the accepted [photo derivative](photo-derivatives.md) and [real-media persistence](ebay-real-media-persistence.md) boundaries. It has **no route, server action, UI, production factory or runtime switch**. The existing normal media runtime still returns disabled, and real receipt admission still always rejects. This is simulated orchestration evidence, not eBay upload, ingestion or recovery acceptance. Stage 9B remains In Progress.

## Authentication, grant and one-use review

`createFakeMediaWorkflow` receives a trusted server authentication adapter; callers supply only listing/image IDs to `prepare`. The isolated integration harness uses real Better Auth signed cookies and database-backed sessions. Owner/session IDs never come from a form. PostgreSQL independently checks the matching, unexpired session row during guarded claim, fence, pre-send and association acknowledgement transactions; it stores only the session binding hash in attempts.

The **proposed**, synthetic-only media profile is exactly base `api_scope` plus `sell.inventory`, versioned as `sandbox-media-proposal-v1`. No readiness, account-write or unrelated permissions are silently added. Local derivative/persistence guards now recognize this exact array as well as their existing identity/readiness arrays. Actual OAuth profile selection, one-use OAuth state, callback and refresh validators are unchanged and still reject the proposed media array. There is no media-consent button or token operation. A future real consent decision must explain that this minimal grant can replace readiness permissions; a combined grant remains separately reviewed.

Preparation performs local session/owned-context checks only: no source read, native job, claim or send. Its opaque process-bound review captures owner/session, exact listing version, image/order/source-metadata fingerprint, recipe, seller, connection/configuration/grant versions and access expiry. Lifetime is at most five minutes, shortened for session/access expiry, and checked against both wall and monotonic clocks. Reviews hold no image bytes. Copying/serializing one, changing service instance or restarting the process makes it unusable. Confirmation consumes it synchronously before any await, including cancelled, stale and busy confirmations; another action needs a fresh review.

This deliberately internal object is **not a browser nonce protocol or a multi-process review store**. Any future route/UI needs a separately reviewed transportable confirmation mechanism. Durable consumed actions and content fences already survive process loss in PostgreSQL; losing the in-memory review never makes a fenced attempt replayable.

## Confirmation sequence

1. Acquire one shared process capacity lease and revalidate the live session and reviewed context.
2. Short transaction: compare the exact review, lock/recheck the live session, consume a fresh action, and commit max source retention for at least five minutes plus one minute. Expired unfenced attempts become `not-sent`; replacements have new IDs/tokens and retain all earlier action bindings.
3. Borrow the same capacity lease for the existing derivative service. Its trusted private reader, classifier, native encoder and final-byte inspection run outside transactions. Originals stay unchanged; actual source and final-export SHA-256 identities are computed independently. No original-byte fallback or derivative cache exists. The review binds which persisted source is read; byte identities are established during confirmation before the send fence.
4. Revalidate the session, snapshot, recipe/configuration and actual export digest/size/MIME. Commit the existing immutable seller/source and seller/derivative fences, with guarded review/session checks in that short transaction.
5. Recheck the current lease/revision/session/context in a short pre-send transaction, then session/cancellation/deadline and exact bytes immediately before **at most one in-memory fake create**. No transaction spans source/native/send work. The unavoidable final-check-to-send race is not presented as cross-system atomicity; observed late changes cannot gain an association.
6. Admit bounded synthetic response evidence using the existing opaque proof issuer, then acknowledge it against current bindings/session. The only acknowledgement retry is one retry of the **same local proof**, never another create, derivation or fence. No claim capability, token, path, digest or raw response is returned; the result is only `state`, `associated` and `simulation: true`.

Fresh reviews cannot clear committed fences, including after lost responses, lease expiry, reconnect, recipe changes or replacement image IDs. An uncertain fence commit stops before send. Claim-commit acknowledgement loss can leave an unfenced lease; only a fresh action after expiry can reclaim it, preserving the old action. Definitive pre-fence failures retain a `not-sent` action. Failures after possible intent/send remain unknown. Identical receipt acknowledgement is idempotent; partial/conflicting evidence stays append-only/uncertain.

Complete responses after cancellation, deadline, stale context or session revocation/expiry are response-only **residuals**, not current associations. A cancellation/change observed after the first acknowledgement also downgrades through the identical proof. Response-only mode can only reduce association eligibility; it cannot bypass receipt proof validation or create permission. Source/listing/connection deletion removes product bindings but preserves receipts/fences. Existing retention-aware cleanup and retry timing remain the only physical source-deletion mechanism; no remote-delete or erasure claim is made.

## Capacity, time and byte bounds

Standalone derivatives and complete fake operations share **two process slots, no queue**. An opaque slot cannot be forged or borrowed concurrently. Even an early parent release cannot free a running child's slot. The workflow keeps its reservation through source/native work, send/response settlement, proof admission and database acknowledgement.

The proposed whole-operation eligibility deadline is **30 seconds**, fake send/response **10 seconds**, and existing lease **60 seconds**. The derivative's original **15-second** eligibility deadline and per-native timeout of at most ten seconds/remaining budget are preserved. Abort or timeout never races unfinished work to release capacity early. Started work is awaited even if it ignores abort; such a dependency may hold its slot beyond the deadline. No native preemption, hard process-kill deadline, RSS quota or secure buffer zeroization is claimed.

Existing source/export caps (each 10 MiB), side/pixel/metadata admission and 64 MiB raw verification remain unchanged. The serialized synthetic response envelope is bounded to **64 KiB** with fatal UTF-8 decoding. It is a fixture representation, **not a real HTTP, multipart, header, duplicate-key or eBay JSON contract**. Real transport allocation/framing, header/body/egress limits and response/URL admission remain separate work. These are application proposals tested with fakes, not approved eBay limits.

## Isolation and reproducible evidence

`src/test/ebay/fakeRealMedia.ts` is the only composition. Before constructing it, `NODE_ENV` must be test, Vercel must be absent, and the **actual selected database** must match `marketplace_real_media_<24 hex>_test`. Original receipt issuance/use checks repeat the namespace/environment/owner/attempt validation, and SQL retains its existing synthetic-only contract. No guard or simulation constraint is relaxed. The fake generates independent resource/visual IDs under the existing `.invalid.test` grammar, never guessed real URLs. It has no HTTP client, provider credentials, URL retrieval or OAuth operation.

The PostgreSQL harness creates/drop-isolates its child database, uses generated non-personal source fixtures and in-memory image storage, and verifies real encoded/inspected derivative bytes and unchanged originals. Tests cover actual signed-session/owner isolation, exact grants, expiry/replay/concurrency, retained actions/reclamation, stale bindings at claim/native/fence/send/ack, cancellation and capacity settlement, partial/uncertain/conflicting/late receipts, lost acknowledgements, source retention and cleanup retries without foreign-object deletion. Transaction instrumentation asserts source/native/fake sends occur outside PostgreSQL transactions. Existing consumed-action and privacy suites remain in place.

```sh
npx vitest run src/application/ebayMediaGrant.test.ts src/application/photoCapacity.test.ts src/application/ebayMediaWorkflowService.test.ts
npx vitest run --config vitest.integration.config.ts src/infrastructure/repositories/ebayMediaWorkflow.integration.test.ts
npm run check
```

Use the dedicated local disposable `TEST_DATABASE_URL` described in the [persistence guide](ebay-real-media-persistence.md#reproducible-verification). Exact counts/exit codes/CI belong in the implementation PR. Existing Chromium workflows continue to verify normal Save/navigation and disabled real transport. The new internal workflow is covered at the isolated PostgreSQL/session/native boundary, **not through a new browser bypass**: the browser test database does not satisfy the immutable-receipt namespace, so no alias, test route or SQL exception is introduced to force that coverage.

## Remaining gates

Real OAuth consent/profile replacement, URL/expiry grammar, bounded HTTP/multipart/egress admission, precise provider color/alpha/limits, full native/multipart resource acceptance, owner offboarding, and bounded real acceptance/discovery remain unapproved or unverified as documented in the [design](ebay-real-media-design.md). No Inventory, offer, publication, background polling, account deletion or real-provider operation is included. Leave this implementation's PR draft and unmerged for review.
