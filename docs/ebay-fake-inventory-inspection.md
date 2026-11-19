# Internal fake-only Inventory inspection and refusal

This composes the [Inventory persistence](ebay-inventory-persistence.md), [pure planner](ebay-inventory-planner.md) and decision functions into an internal simulated inspection. The approved D1–D8 boundary and PR #27's post-lock PostgreSQL wall-time guards remain unchanged. Stage 9B remains In Progress. **Inventory PUT/DELETE and real EPS transport/receipt admission remain disabled.**

There is no route, server action, UI, production factory, runtime-enable switch, background job, dependency, schema or migration change. The observer has only `inspect`; it has no create, PUT, DELETE, upload, publication, OAuth or token-refresh operation. No real eBay, Reverb, Blob or EPS calls are made.

## Local preparation and one-use confirmation

The only composition is `src/test/ebay/fakeInventoryInspection.ts`. It requires `NODE_ENV=test`, no Vercel environment, and checks **the actual selected database** against `marketplace_inventory_<24 hex>_test`. The check repeats on local snapshot/claim/evidence operations, not merely an environment-variable assertion. The integration harness uses signed Better Auth cookies and database-backed sessions through a trusted server adapter; its read-only `disableRefresh` query avoids silently renewing expiry fixtures. Production authentication/OAuth behavior is unchanged.

Preparation takes a listing ID only, loads its authenticated owner's local listing, Sandbox connection, session and photo metadata, then derives seller, deterministic SKU and version/grant bindings. It makes no observation or claim. The opaque review retains only binding/fingerprint/expiry data, not listing contents, filenames, private paths, credentials or image bytes. It is process/service-instance bound and valid for at most five minutes, shortened by session/refresh-credential expiry and checked with wall and monotonic clocks. Copying, serialization, another session/owner/service or process restart cannot make it reusable.

Confirmation deletes the review synchronously before any await, including cancelled/stale/busy calls. It acquires one of two shared process slots without a queue, revalidates the exact owner/session/listing/connection/photo context, and claims **inspect only** through the existing repository. It never calls `recordIntent` or creates an irreversible mutation fence. PostgreSQL's current-time/ownership/version/consumed-action checks remain authoritative after lock waits.

## Fixture observations, decisions and evidence

One in-memory observation returns `inventory-inspection-fixture-v1`: one to three normalized samples, each with item/content classification, optional content digest, synthetic offer-completeness assertion, listing/group state, typed opaque related references and a bounded warning code. Samples may represent external create, offer/group/content change or same-SKU recreation interleavings. **They are not an atomic snapshot.** This is not an eBay HTTP response, pagination/status contract, group-omission rule or proof of cross-model listing coverage. The default fixture leaves unresolved coverage unknown/incomplete. Explicit complete controls are synthetic assertions only.

The workflow invokes the existing planner with reused synthetic category/condition/aspect fixtures and server-derived photo bindings. Media is always unverified; no fake receipt satisfies real media admission. Existing preflight, reconciliation and cleanup decisions produce reasons, not authority. The returned object is limited to bounded state/reason/check-time fields and constants:

```text
simulation: true
ownership: unproven
canStage: false
canDelete: false
```

Matching content, apparent absence, a synthetic success or local database acknowledgement never establishes remote ownership. The summary omits SKU/seller/claim identities, payloads, private attributes, paths, URLs, credentials and digests.

Evidence is appended through the existing owner/attempt-scoped repository and unchanged ledger. There is one bounded inspection batch, never an automatic re-observation. Lost database acknowledgements permit at most one retry of the **identical local envelope/capability**, relying on its existing fingerprint idempotency; uncertainty never starts another inspection automatically. Contradictory/late samples stay historical. Stale/cancelled results use conservative recovery evidence and holds rather than activating a fresh acknowledgement. A change after an acknowledgement appends recovery evidence; it cannot erase history or release a hold. Listing/connection version changes and deletion detach stale product projections as before. This is not an operational recovery service.

## Limits, cancellation and settlement

Collection lengths are checked before traversing or copying oversized samples/references. The fixture permits at most **three samples**, **250 related references across the batch**, **200-character identifiers** and **64 KiB normalized data**; scalar lengths are checked before regex/serialization. These are application budgets, not eBay limits. Overflow/malformed input becomes unknown/incomplete. Known conflict/recreation warnings are preserved; an unread oversized batch becomes integrity ambiguity, never clean absence. Existing SQL budgets and holds still apply independently.

The whole operation has at most ten seconds of eligibility, further shortened by the actual PostgreSQL claim lease, reviewed session/credential expiry and caller cancellation. A test may shorten this budget, never extend it. Abort signals are passed to the fake observer. The workflow awaits observation and database settlement before releasing capacity, even when an observer ignores abort. It does not claim hard preemption or guaranteed memory/time termination of an uncooperative dependency. Rejected or cancelled reviews remain consumed; any later attempt needs a fresh explicit review/action. Expired unfenced reclamation preserves every earlier action and rejects stale workers.

All observation work is outside database transactions. The existing repository owns short transactions and PostgreSQL wall time; there is no injectable database clock or weakened immutable-history guard.

## Reproducible verification and remaining gates

Use the existing uniquely disposable Inventory database helper and dedicated local test PostgreSQL. Tests drop child databases rather than disable guards. Generated private-photo metadata, synthetic seller/token envelopes and fixture metadata remain isolated; no private source bytes are read or exported.

```sh
npx vitest run src/application/ebayInventoryInspection.test.ts
npx vitest run --config vitest.integration.config.ts src/infrastructure/repositories/ebayInventoryInspection.integration.test.ts
npm run check
```

Coverage includes signed-session/owner isolation, one-use replay/concurrency, stale reviews, real session lock waits, actual lease deadlines, cancellation/capacity settlement, edits/deletion/disconnect/reconnect, lost/duplicate/conflicting acknowledgements, rollback, retained actions/reclamation, evidence bounds and synthetic external-client interleavings. Instrumentation checks zero real network calls and no observation inside PostgreSQL transactions. Existing PR #27 expiry and lifecycle tests remain required.

This proves local orchestration/refusal behavior under a declared fake contract. Real Inventory read adapters, current API/version/pagination/group/listing coverage, remote provenance/incarnation identity, external-client race policy, guarded cleanup, real media transport/admission, operational offboarding/erasure and separately authorized acceptance remain unresolved or separate work. Keep this slice's PR draft and unmerged for independent review.
