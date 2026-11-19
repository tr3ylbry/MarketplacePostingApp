# Internal Inventory persistence — writes disabled

D1–D8 were explicitly approved November 19, 2026 after the [lifecycle design](ebay-inventory-lifecycle-design.md) merged. This implements local coordination/history only: no adapter, gateway, runtime composition, route, UI, job, purge command or ownership admission. Inventory PUT/DELETE and real EPS transport/admission remain disabled. Projections and acknowledgements always return `canStage: false`/`canDelete: false`; ownership is always `unproven`.

## Three ledgers and a derived projection

Migration `0010_ebay_inventory_persistence.sql` adds three tables and SQL transition guards:

| Ledger | Retained minimum |
| --- | --- |
| `ebay_inventory_resources` | Immutable owner, Sandbox seller pseudonym/identity version, deterministic SKU, historical listing ID; revision/monotonic hold; review/offboarding dates; nullable current owned listing/connection links. UNIQUE(environment, seller, SKU) is independent of owner, connection and local epoch. |
| `ebay_inventory_attempts` | Owner/resource, operation, consumed action/session hashes, exact listing/connection/configuration/grant versions, hashed lease capability, revision/state and optional immutable intent/payload/media digests. Unconditional UNIQUE(owner, action hash) preserves history. A database-generated ordinal orders same-millisecond attempts. |
| `ebay_inventory_evidence` | Append-only normalized observations, local acknowledgements, conflicts and private recovery evidence; bounded versioned envelope, canonical input fingerprint, captured revision and SQL-derived late marker. Composite foreign keys enforce owner/resource/attempt consistency. |

`projection(owner, listing)` is one local SELECT over the latest attempt and exact current owned listing/connection context. It returns only IDs, local state/hold and constant NO-GO fields; there is no second status cache. Edits, grant/version changes and reconnects hide stale context without activating older attempts. Deletion clears only current links; retained history survives. Detached links cannot be reassigned. Disconnect, identity/configuration invalidation and connection deletion also retire the anchor conservatively.

The repository has no browser caller. A later reviewed server entrypoint must supply authenticated owner/session identity. Successful upsert, matching payload/readback, SKU prefix, an operator assertion or synthetic response cannot admit ownership. There is no `confirmed` ownership column or override flag. Inventory units may share identical content: media content-deduplication rules are not copied.

## Claims, intents and acknowledgements

An unfenced claim has a 60-second local lease. Reclamation atomically retires an expired unfenced attempt and inserts a fresh ID/token with revision zero. Failure rolls back both changes. Old actions, context and token hashes remain immutable. A consumed action cannot move to another listing/operation; stale capabilities cannot fence, retire or alter the replacement.

`recordIntent` rechecks current owner/listing/connection/grant/session/lease versions and records an irreversible **local** coordination fence. It performs no transport and grants no permission to send. SQL immediately creates a seller-wide hold; expiry or acknowledgement cannot release it. Read-only local inspection remains available under holds.

`acknowledge` captures normalized facts, never raw provider bodies. Identical local acknowledgements return the same evidence ID without another insert/revision increment, including concurrent/lost-ack retries. SQL fingerprints normalized input before cumulative-budget reduction, preserving retry identity after overflow. Contradictory and late evidence accumulates; late evidence cannot activate stale projections or revise replacement attempts. Local `acknowledged` is neither transport certainty nor ownership.

Pre-intent collisions, stale/incomplete evidence and overflow create resource holds. Post-intent uncertainty/conflict, recreation and seller/history-integrity ambiguity create seller-wide holds. Holds only escalate. Recovery is owner-private append-only evidence; only exact expired unfenced claims can retire through version checks. There is no operational recovery service, ownership flag, uncertainty reset or hold-release method.

## Privacy and budgets

Application and SQL allowlists admit normalized enums, finite intervals, optional HTTP status/digests and typed opaque references. Unknown fields/malformed identifiers fail. No credentials, raw bodies, profile data, private paths, filenames, image bytes or signed capabilities are stored. Seller pseudonyms remain linkable personal data.

Application budgets: **64 KiB/envelope**, **200 characters/identifier**, **50/SKU**, and **250 related references across an inspection attempt**, including multiple envelopes. Overflow records `unknown`/`incomplete`, clears content/reference assertions and creates a hold; it cannot fabricate absence. These are application budgets, not eBay limits. Fingerprints identify local retries, not provenance. Persistent verbose diagnostics are omitted; a later feature and proposed 30/90-day limits require separate approval.

## Recorded policy obligations

Safety history remains while active, with annual review. First disconnect/administrative retirement records a twelve-calendar-month retention review date, seven-day private offboarding review deadline and thirty-day disposition deadline. SQL computes these once in UTC. Earlier required action takes precedence. No silent renewal, expiry or hold release exists.

These are **review obligations**, not automatic purge/erasure instructions. Review ownership, overdue handling, lawful minimization and required erasure remain operational work. Ordinary owner deletion is RESTRICTed, and history cannot be deleted/truncated. This does not justify indefinite refusal of required erasure. A separately approved erasure must preserve lawful minimum safety refusal or disable mutation capability **before** identifying history is removed. Missing/restored/erased history stays unproven/NO-GO. No capability-enable switch exists here.

## Transactions and concurrency

Claim/intent order: owned listing → connection → seller-scoped transaction advisory guard → resource → attempt → live session. No images are modified/locked. Existing repositories do not acquire this new guard. Evidence/recovery uses seller → resource → attempt, with no later listing/connection locks. Offboarding takes resource locks after connection, without acquiring advisory/listing/session locks in reverse. Listing deletion clears current links through foreign-key actions.

Transactions contain PostgreSQL operations only, with no provider/storage/native image work. SQL also protects consumed actions, immutable bindings/intents, revisions, ownership references, append-only evidence and monotonic holds. Arbitrary privileged SQL may deadlock and abort; it is not an alternate supported entrypoint. Administrators changing DDL can defeat these guards. Local locks cannot reserve eBay resources or solve external-client races.

## Verification and remaining gates

Set `TEST_DATABASE_URL` to a dedicated disposable local `_test` parent database. The suite creates a unique `marketplace_inventory_<random>_test` child, applies committed migrations, repeats migration safely, and drops the whole child. It never disables immutability for teardown or uses the real-media synthetic-admission namespace. Do not run development migrations for verification.

```sh
npx vitest run src/application/ebayInventoryPersistence.test.ts
npx vitest run --config vitest.integration.config.ts src/infrastructure/repositories/ebayInventory.integration.test.ts
npm run check
```

Coverage includes legitimate controls, permanent actions, successive/concurrent reclamation, rollback, stale workers, immutable SQL intents, duplicate/conflicting acknowledgements, late evidence, holds, recovery limits, detachment, owner-deletion refusal and budgets. Existing image/authentication/Reverb/media/Chromium suites remain required. No real provider acceptance occurs.

Version-pinned observation adapters/coverage, real provenance/incarnation evidence, enforceable external-client race policy, guarded cleanup, real-media admission/transport and separately authorized acceptance remain future gates. Stage 9B remains In Progress.
