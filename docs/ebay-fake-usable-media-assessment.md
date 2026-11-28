# Fake-only usable-media admission assessment

This implements only the approved UM1–UM8 fake-assessment scope from the [reviewed admission design](ebay-usable-media-admission-design.md). It has no runtime call site, route, UI, provider client, downloader, migration, database write, encryption or durable URL store. A positive assessment is **`eligible-for-fake-association`**, with `simulation:true`, `realAdmission:false`, `associated:false`, `canStage:false` and `canDelete:false`. It does not create a receipt or association, including a new synthetic contract in SQL.

The completed real M3 maximum-field test remains a one-generated-fixture result. Its four request slots are exhausted; no historical diagnostic, parent, URL or content is promoted by this implementation. Normal EPS transport, real admission and Inventory writes remain disabled. Stage 9B stays In Progress, estimated 80/100; the overall project estimate remains 72/100.

## Producer, proofs and current context

The internal [factory](../src/infrastructure/ebay/fakeUsableMediaAdmission.ts) requires `NODE_ENV=test`, rejects Vercel and reads the actual database identity. Only the existing `marketplace_real_media_<24 hex>_test` namespace is accepted; a submitted database name or environment flag is insufficient. Unit tests mock that inspection boundary; PostgreSQL tests use an actual uniquely disposable child database.

Trusted test composition supplies a session reader, an owner-scoped current snapshot and one bounded **in-memory fixture observation**. This is not a new HTTP/provider gateway. The observation supplies fake raw response bytes/headers, the exact reference derivative and returned bytes/target. It accepts no `validated`, `match` or settlement flag. The producer runs once per factory, binds the selected field before observing, parses bounded unambiguous response data, checks independent synthetic resource identity, preserves the exact selected target/query, and performs the existing full native reference/comparison pipeline. A header or DTO cannot establish a visual pass.

The producer copies and subsequently clears its owned buffers without mutating fixture originals. It uses the unchanged 500×600 generated RGB policy, native decode/comparison rules, 1 MiB encoded bounds, 64 KiB create-body bound, header bounds, five-second native eligibility and shared settlement-owned capacity. Its 30-second original operation window is shortened by current session/access/refresh/review/lease, provider expiry minus 60 seconds and the existing policy cutoff. Cancellation does not release capacity before the started fixture/native work actually settles. It does not claim hard native preemption or immediate memory erasure.

`produce()` returns a frozen empty opaque object. Its private registry holds immutable non-capability claim facts and context; no URL getter, target sink, provider request or URL fingerprint is exposed. Complete synthetic URLs/queries are used only in the producer's operation-local variables and discarded before returning the proof. The query-bearing synthetic representation grammar is private to this in-memory test consumer. It does not broaden the unchanged legacy receipt parser or SQL URL grammar, and maximum is never copied into primary.

`assess(proof)` consumes that exact reference before any asynchronous read. Copied, serialized, forged, reused and other-factory proofs refuse. The fixed fake consumer and identity policy are distinct from any real Inventory/resource contract. Current authorization comes from the trusted session/snapshot adapters, never assessment arguments. Session validation occurs again after the potentially blocking snapshot; current clocks and all captured deadlines/bindings are checked after the reads. Cross-owner/session, changed action/attempt/revision/content/profile/consumer and stale context cannot gain eligibility.

These are **assessment checks**, not a new transactional SQL admission guard. The documented legacy normal-operation session/timing/unfenced-history gaps remain. No real producer proof, general-photo validation or Inventory field eligibility has been implemented or certified.

## Immutable facts and a detachable eligibility view

`assess` returns a safe summary and a second opaque evidence reference. Image/provenance/identity/URL claim facts remain frozen. No account, session, resource, source pin, raw error or capability is returned. `currentAssociation:"not-created"` is literal; there is no product association write.

`status(evidence)` revalidates the current trusted context and original windows. An observed context invalidation retires the in-memory eligibility view; restoring an old version does not reactivate it. A prior positive summary is not permission or a durable current projection.

`acknowledge(evidence, bytes)` models bounded **local in-memory** acknowledgement only. It is not a database ledger, network request or production receipt writer:

- The strict `fake-admission-fact-v1` envelope allows only fixed kind/outcome/reason categories. The existing bounded duplicate-key/fatal-UTF-8 JSON parser is reused; private/unknown fields refuse and are not reflected.
- At most four distinct facts and 2,048 input bytes per envelope, including whitespace. Canonically identical valid facts are idempotent and consume no new entry, even with concurrent calls in the same instance.
- Conflicting facts, invalid envelopes and overflow retire eligibility. The fifth fact is not retained beyond the bound; overflow/conflict remain conservative refusal facts, not complete evidence. Later acknowledgements cannot erase those flags.
- Late facts can still be correlated/acknowledged, but fresh context/deadline checks prevent an expired or revoked eligibility result. Acknowledgement cannot manufacture a validation pass or grant another producer invocation.
- This state is process-local and intentionally nonrecoverable. Restarting loses the handles/facts; it creates no real send/admission authority and does not reopen any durable action/content fence. No cross-process acknowledgement guarantee is claimed.

## Preserved boundaries and verification

The existing [synthetic issuer](../src/infrastructure/ebay/realMediaEvidence.ts), fixed fixture parser, database restrictions and all committed SQL remain unchanged. New assessment proof references are not registered with the receipt issuer and fail its acknowledgement boundary. Capture-only/diagnostic parents remain forbidden for receipts. Existing positive fixed-grammar controls are still synthetic and do not attest an authenticated provider response.

Tests use generated data, blocked provider/SDK construction and network/private-file guards. Unit tests check actual frozen comparison, proof isolation/replay, every context binding, field/query correlation, failed/partial validation, original expiry, cancellation/capacity, four-fact and exact 2 KiB limits, conflict/idempotency, and no capability logging/hashing. PostgreSQL tests use signed synthetic Better Auth sessions and uniquely disposable databases; they verify read-only assessment behavior, real lock waits spanning session/access/refresh expiry, legacy positive controls, continued SQL rejection of real-looking/query URLs and capture-only receipts, detachment, reconnect invalidation and owner RESTRICT. Existing media persistence regressions additionally cover reclamation, stale workers, rollback, late/conflicting evidence and permanent fences.

Focused commands, only in the documented isolated test environment:

```sh
npx vitest run src/infrastructure/ebay/fakeUsableMediaAdmission.test.ts
npx vitest run --config vitest.integration.config.ts src/infrastructure/ebay/fakeUsableMediaAdmission.integration.test.ts src/infrastructure/repositories/ebayRealMedia.integration.test.ts
```

The PR records actual commands, exits, complete `npm run check` and exact-head CI evidence, including failed attempts. Synthetic successes remain separate from the prior real M3 acceptance. No development migrations, real configuration/sessions, provider/image-host/DNS/Blob/OAuth operations, support messages or new experiment are authorized by these commands.

Remaining real gates are unchanged: resource/Location identity, consumer-specific primary/maximum eligibility, arbitrary-photo validation, durable expiry/recovery and any separately approved encrypted payload/key/erasure design. A later production proof and SQL transition require independent review together. This slice supplies none of those permissions.
