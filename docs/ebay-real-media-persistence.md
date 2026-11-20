# Real media persistence foundation — transport disabled

**November 20 follow-up:** the separately authorized [capture-only discovery implementation](ebay-image-response-discovery.md) adds a manual pinned client, structural evidence channel and explicit discovery OAuth-profile preparation. It does not enable normal transport, real receipt/association admission or any real experiment. Earlier proposal/unimplemented wording below records its original checkpoint; later accepted privacy/persistence decisions remain effective.

This implements the persistence slice of the [reviewed real-media design](ebay-real-media-design.md): bounded records, repository transitions and SQL protections. The subsequent [internal fake-only workflow](ebay-fake-media-workflow.md) composes these transitions with authenticated review and accepted derivatives. Neither creates a real EPS resource or establishes real response/URL admission. The existing simulation table, recipe, constraints, fake transport and normal runtime composition are unchanged. **Real EPS stays hard-disabled; Stage 9B remains In Progress.** No route, server action, upload UI, real OAuth media profile, provider client or background job is added.

## Records and binding

Committed migration `0009_ebay_real_media` adds three distinct tables:

| Table | Purpose |
| --- | --- |
| `ebay_real_media_attempts` | Owned Sandbox context, stable seller/identity version, session/action hashes, exact listing/image/order/source snapshot, connection/config/grant versions, recipe, separate source/final-derivative identities, bounded output properties, revision/claim lease and immutable send intent |
| `ebay_real_media_receipts` | Append-only normalized, contract-versioned partial/complete/conflicting evidence with a fingerprint for idempotent local acknowledgement |
| `ebay_real_media_associations` | Current local image-to-receipt binding, guarded by SQL and repository freshness checks; no Inventory/offer/publication attachment |

The [repository](../src/infrastructure/repositories/drizzleEbayRealMediaRepository.ts) performs PostgreSQL operations only. The internal fake workflow supplies trusted authenticated session/action context; no production/browser entry point exists. Claim capabilities remain internal. Repository summaries contain only `state` and `associated`, never a lease token, digest, seller key, URL or credential; the fake workflow adds only `simulation: true`.

Source version is a SQL-computed SHA-256 of the exact persisted source-metadata tuple, with upload time represented as epoch; the raw pathname/filename is not copied into evidence. A separate grant fingerprint binds the persisted scope array. Actual source/derivative byte digests and the recipe come from the trusted future derivative caller; the repository validates their shape and context, **not image pixels or a claimed provider send**. Source bytes/native processing are not part of this persistence slice.

No image bytes, credentials, raw metadata/response, private path, original filename or signed capability is stored. Actual identity/readiness OAuth guards remain exact. Local photo preparation/persistence additionally recognizes the exact proposed synthetic media array; the workflow requires that profile without enabling real consent or a combined grant. Persisting an intent is not permission to upload.

## Claims, fences and outcomes

- Claims serialize under the existing owned parent/connection/image lock order. One `preparing` claim is active per owned photo. Every successfully consumed action remains bound to its original attempt, including after lease expiry.
- Reclamation requires a fresh action. In one transaction, revision/claim-hash CAS retires the expired **unfenced** attempt as `not-sent`, preserving its original action/session/context, and inserts a new attempt with a new ID/token and revision zero. The unconditional owner/action uniqueness constraint continues to protect all prior actions: none can be reused for the same or another photo after successive reclamations. Old IDs/tokens/revisions cannot fence, acknowledge or alter the replacement. If insertion/commit fails, retirement rolls back too. No schema change or action-history purge is needed.
- Claims commit max source retention through the existing five-minute preparation window plus one-minute margin. No storage, HTTP, OAuth or native operation runs in a transaction. Longer holds are preserved.
- Workflow guards compare a captured owned snapshot and live hashed-session binding inside short claim/fence transactions. `beforeSend` rechecks the current context, exact fenced claim/revision and session before the fake call. Session rows are shared-locked after listing/connection/image locks; there is no transaction across the send. Snapshot metadata stays internal and is not a permission to send.
- `fence` revalidates the latest parent/source/order/connection/grant, recipe and MIME before atomically storing the byte identities and send intent. Independent partial unique indexes bind `(Sandbox, seller, sourceDigest)` and `(Sandbox, seller, derivativeDigest)` once intent exists. Owner, image ID, connection and recipe are deliberately absent from these keys. New IDs/recipes/connections/owners cannot bypass a prior same-seller content fence; foreign conflicts are generic.
- A definitive pre-fence failure may become `not-sent`; another explicit action can claim again. A lost fence acknowledgement, crash or expired lease cannot clear a committed fence. No reset/purge/fence-release API exists.
- Compatible partial evidence remains `unknown`. A complete, nonconflicting, unexpired receipt can become `confirmed` and associated only for fresh matching bindings. Complete stale/capture-only outcomes are `residual`. Contradictory receipts remain append-only, invalidate the association and keep uncertainty. No later reply overwrites earlier evidence.
- Identical receipt acknowledgement is locally idempotent, including after a lost commit acknowledgement. A late response can record evidence without reopening a send lease; fresh association checks still apply. Repeating a DB acknowledgement is never a provider retry.
- Workflow acknowledgement guards also check the live session and reviewed snapshot. Response-only mode can retain complete late/cancelled evidence as residual while refusing association; it cannot bypass opaque proof admission. Standalone persistence APIs remain internal; current associations alone are never session/send authorization.
- `status` is owner-scoped and revalidates current bindings/expiry. A projection can become stale after an edit/reorder/disconnect; callers must use this guarded read rather than treat a raw association row as authorization. Stale confirmed state becomes residual and its association is removed. No background checks or provider calls occur.

## SQL protections and deletion

SQL triggers prevent changes to fenced bindings/content/send intent, fenced row deletion, receipt updates/deletion, and evidence-table truncation. Revisions must advance; complete states require receipt evidence. Association inserts/updates independently require the same owned source/listing/order, seller/connection/config/grant, complete nonconflicting receipt and future expiry with a 60-second safety margin. Composite foreign keys reject foreign-owner or wrong-attempt receipt bindings.

Only the current product association cascades with image/listing/connection deletion. Attempts, receipts and content fences do not. Normal image/listing deletion continues to use the existing retention-aware cleanup ledger; tests verify sources survive until due and unrelated objects remain untouched.

Owner references use **RESTRICT**. No account deletion/offboarding UI, evidence expiry or indefinite legal-retention policy is authorized. Minimal pseudonymous context/digests and receipt evidence remain until a separately reviewed offboarding policy exists. These are application/SQL safeguards, not protection against a database administrator changing DDL or disabling triggers. Test cleanup never disables protections or purges fenced rows.

## Response admission is closed

The [admission module](../src/infrastructure/ebay/realMediaEvidence.ts) has no real Location/EPS grammar: real admission always fails closed. A caller-supplied `validated` boolean, matching JSON shape, arbitrary URL or serialized proof cannot authorize acknowledgement.

The only current contract is explicitly `synthetic-real-media-v1`. It validates fixed `.invalid.test` fixture URLs independent of existing simulation URL grammar. Its opaque in-memory proof binds the actual database, owner and attempt. Issuance/use requires the test environment and an actual database named `marketplace_real_media_<24 hex characters>_test`; Vercel is rejected. SQL separately restricts synthetic receipt admission to that exact disposable-database namespace. Normal databases cannot admit these receipts. This is no runtime switch to a real contract: future real admission requires reviewed parser/URL rules and a migration extending the deliberately closed SQL contract.

Tests deliberately use different resource and visual IDs, so fake identity equality does not become a real EPS assumption. Only independently valid fields are retained. Malformed/ambiguous fields do not become usable associations. Unknown real URLs, authentication, redirects, precise limits/color/alpha, recovery and expiry semantics remain unresolved.

## Reproducible verification

Run normal repository checks with the documented dedicated local `TEST_DATABASE_URL`. The new integration suite requires the test role to have `CREATEDB` (as the existing Compose/CI PostgreSQL owner does). It validates the parent URL/database identity, creates one uniquely named **disposable child database**, applies all committed migrations, tests repeat migration, and drops that database after closing its pool. Existing development tables/data are never used for teardown. If that isolation cannot be established, the suite fails instead of weakening immutability or targeting another database.

Focused commands:

```sh
npx vitest run src/infrastructure/ebay/realMediaEvidence.test.ts
npx vitest run --config vitest.integration.config.ts src/infrastructure/repositories/ebayRealMedia.integration.test.ts
```

Coverage includes concurrent claims/content conflicts, consumed-action replay after replacement, successive/concurrent reclamations, retired-worker and rollback safety, cross-owner/seller isolation, recipe/reconnect/ID bypass attempts, fence and receipt commit failures, partial/conflicting/expired/late evidence, safe summaries, parent deletion/reorder/version races, normal retained-source cleanup, owner RESTRICT, direct SQL immutability and unchanged simulation constraints. All records/storage are synthetic; no provider or token operation occurs. Exact suite/CI counts belong in the implementation PR. The migration is committed and tested in disposable infrastructure; this work does not apply it to the development database.

## Remaining gates and next slice

The persistence-only slice is merged; the [fake-only grant/review/orchestration integration](ebay-fake-media-workflow.md) is the next reviewable implementation. It adds no migration or real transport. Real URL/expiry/egress rules, actual consent, resource/client limits, owner offboarding and controlled acceptance/discovery remain separate decisions. Keep the [normal versus capture-only plans](ebay-real-media-design.md#later-bounded-normal-acceptance--separate-approval-required) proposed and unexecuted. No real record here establishes ingestion, recovery, remote erasure or publishing eligibility.
