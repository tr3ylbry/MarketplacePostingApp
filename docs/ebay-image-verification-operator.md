# Manual diagnostic image operator

This manual local-only entry point composes the [diagnostic workflow](ebay-diagnostic-image-workflow.md), [bounded downloader](ebay-safe-image-downloader.md) and [frozen comparison](ebay-image-comparison.md). Its shared internal runtime is also used by the opt-in [authenticated browser operator](local-browser-image-operator.md); the manual CLI retains its strict hidden-input contract. Ordinary pages/jobs do not start diagnostics. Normal EPS transport, real receipt/association admission and Inventory writes remain disabled. The original capture is unknown/unassociated, permanently fenced and **3/3 exhausted**. The later DNS-refused M3 attempt remains separately recorded and **4/4 exhausted**.

**No real execution is authorized by this document, a merge, a passing check or an approval flag.** Future execution needs a separately approved exact reviewed commit, fresh content, private prerequisites and cumulative request budget. Do not rerun a stopped attempt or generate replacement content to bypass uncertainty.

## Harmless modes

Use Node24 and the locked dependencies. Help and rehearsal import no dotenv, database/auth composition, Blob or eBay client. Rehearsal reuses the [owner-controlled hidden-input procedure](local-session-handoff.md); it reads no clipboard and does not validate a real cookie.

```bash
node --import tsx scripts/ebay-image-verification.ts --help
node --import tsx scripts/ebay-image-verification.ts --rehearse-input
```

The owner must perform native copy/paste; synthetic stream/PTY tests do not prove a live handoff. For a future authorized run, first complete the harmless native rehearsal and the existing genuine read-only `--check-session` procedure. Stop on failure. No session bridge, cookie argument, environment variable or cookie file is accepted.

The separate local fixture mode uses no private configuration, pools or provider clients:

```bash
node --conditions=react-server --import tsx scripts/ebay-image-verification.ts --fixture /ABSOLUTE/NEW/generated.png
```

Replace that path with a new owner-controlled output in an existing private directory. Exclusive creation and mode0600 protect existing files. Exit0 reports the source digest, exact deterministic derivative digest, fixture title, derivative recipe and comparison recipe; it prints no path or image bytes. The fresh opaque RGB500×600 PNG has128 random marker bits, orientation cues, color regions and detail. A failed/partial output must not be used or retried as an experiment. This mode prepares no listing, upload or provider request. Future private-Blob upload/setup requires its own covered approval through the existing private-image workflow.

## Operational preflight and exact pins

Only two operational modes exist: explicit verification and separate local cleanup. They require the executing script’s own repository root and a clean tracked checkout at the approved40-character commit. Required operational modules must already belong to that commit. Untracked source under scripts/src/drizzle—including ignored import shadows—is refused; the original root workspace remains untouched. Git, migrations and ignored configuration are resolved from the executing tree, never another caller-selected checkout. No branch name substitutes for the approved commit. The entry point checks again before loading operation code, before confirmation and after derivation, before the workflow's final SQL authorizations. No asynchronous Git/context read is inserted after those authorizations. Run from the repository root and keep the checkout/dependencies unchanged for the whole operation; source control and a remote service are not one atomic system.

Both modes use the existing exact `https://127.0.0.1:3000` auth origin and validated loopback PostgreSQL parser. The expected database name must match the connection URL and `current_database()`. Every one of the15 source migration hashes/timestamps0000–0014 must equal the actual journal, with no missing/extra/mismatched row. The operator never applies or repairs migrations. Earlier0008–0012 application is historical evidence; source-required0014 needs separately approved development application and fresh journal verification before a real run.

The diagnostic pools replace optional startup settings with fixed five-second statement/lock limits; the session pool additionally enforces read-only transactions. Both have five-second connection/query bounds. Client timeouts do not prove server work stopped or a commit failed; uncertainty cannot restore request allowance. Legacy manual/app configuration is unchanged. Genuine signed Better Auth GET validation uses `deferSessionRefresh`, disabled cookie cache and refresh, with Secure cookie naming. The workflow calls that API again through the same read-only reader. Submitted owner/session IDs are not authentication.

The owner pastes exactly one secure session cookie at the hidden prompt **after** it waits, following the handoff guide. Nothing reads a native/browser clipboard. No cookie/token/code may enter arguments, history, files, environment variables, screenshots or chat. The ignored configuration is loaded only in operational modes; synthetic tests pass an explicit clean environment instead.

For verification, the owned listing must have the exact generated fixture title, approved listing version and exactly one ordered private PNG ≤1MiB, with no pending uploads or remote publication. The existing Sandbox connection must have the approved stable seller and connection version, exact media scopes/configuration and at least two minutes of access lifetime. Immediately before confirmation, after the final asynchronous preflight and Git check, it requires150seconds: the two-minute margin plus the existing30second operation budget. This stricter local reserve neither refreshes credentials nor extends any deadline; it does not promise two minutes through arbitrarily delayed physical settlement. Refresh credentials must still be live. The independent eBay key must differ from auth/Reverb keys. No key is generated/replaced and no credential discovery, consent, GetUser or refresh client is constructed.

## Separately approved verification template

All uppercase values below are placeholders that must come from the reviewed private plan and actual owned fixture; they are not authority or approval. Source/final-derivative identities are distinct. Use the exact recipe printed for the approved fixture/runtime, without editing thresholds after observing a provider result.

```bash
node --conditions=react-server --import tsx scripts/ebay-image-verification.ts \
  --approve-one-post-one-get --reviewed-head REVIEWED_HEAD_SHA \
  --database EXPECTED_LOCAL_DATABASE --listing OWNED_FIXTURE_UUID --image OWNED_PHOTO_UUID \
  --listing-version APPROVED_ISO_VERSION --seller-key APPROVED_SELLER_HASH \
  --connection-version APPROVED_CONNECTION_UUID \
  --source-digest APPROVED_SOURCE_HASH --derivative-digest APPROVED_EXPORT_HASH \
  --comparison-recipe 'EXACT_APPROVED_RECIPE'
```

The workflow commits source retention before private byte access, verifies the approved exact derivative, authenticates/binds current context and fences upload before one fixed Sandbox POST. This manual entry retains the primary profile: only its native fresh-response handle can reach one anonymous primary-image GET. The separately composed browser operator uses the fixed [maximum-only profile](ebay-maximum-image-diagnostic.md), with no browser selector or fallback. The URL/query stays opaque and memory-only; no URL flag, constructor or getter is exposed by this command. Existing DNS/public-address, pinned TLS, redirect refusal, byte/header/body, deadline, cancellation and capacity controls remain unchanged. Native/network work holds no database transaction or row lock.

This command has **at most one POST plus one GET**, including failures, and no retry/refresh/HEAD/getImage/alternate URL/address/upload/Production path. If separately approved authorization prerequisites are needed, the existing single media-consent flow is separate: at most one code exchange and one authenticated GetUser make a cumulative ceiling of four requests. Successful media consent replaces readiness permissions. Do not silently switch between two- and four-request approvals. The operator itself performs zero OAuth/identity/refresh requests.

## Accounting, failures and settlement

Exit0 requires settled retrieval, a visual match, recorded local acknowledgement and consistent accounting. Exit1 stops without automatic retry. The bounded JSON separates retrieval, decode/geometry/orientation/marker/color/similarity, acknowledgement, operation settlement and request accounting. It contains no URLs/queries, credentials, private paths/filenames, raw responses or account/session identifiers. Content identities appear only in the generated-fixture binding output. Visual scores remain transient diagnostic/report data; SQL envelopes are unchanged and no receipt/association is created.

`postBudgetConsumed` and `getBudgetConsumed` describe this invocation's **committed request intents**, not proof that bytes reached the provider. A consumed slot counts against the ceiling even if dispatch is uncertain. Observed responses/statuses are separate: POST status comes only from the bounded native capture report; GET200 is reported only on actual bounded retrieval. Refused GET status stays unknown. If accounting cannot be read, both consumption values are null and the full two-request ceiling is uncertain; no remaining allowance or retry is inferred. A crash/lost acknowledgement leaves permanent action/source/derivative and request-intent history; restarting cannot reopen it. Independent processes using the same approved content serialize through the existing durable claims/fences, and simultaneous invocations in one process also refuse overlap. This is not a quota for unrelated content or external clients.

Any failed prerequisite, expired/changed binding, unsupported/unexpected response, mismatch, cancellation, capacity/deadline failure, lost acknowledgement or accounting uncertainty is a stop. SIGINT/SIGTERM cancel the operation; the tool waits for actual underlying settlement before clearing temporary buffers, discarding cookie references, closing pools or exiting. Native progress timeouts are not hard preemption/RSS quotas. A successful comparison remains unknown/unassociated diagnostic evidence, not remote ownership, general provider fidelity, usable-media admission or erasure.

## Separate guarded local cleanup

Use the same pins with `--cleanup-fixture` instead of `--approve-one-post-one-get`, **omitting** `--comparison-recipe`. This local mode requires explicit owner approval and genuine app authentication, but no eBay/Blob credentials or provider request. It verifies exactly one owned fixture/photo, matching immutable fenced content/history and metadata version, no pending upload/remote publication, and the actual persisted retention deadline. It refuses missing/changed/unproven history. Session time is checked with database wall time after blocking locks and again after local deletion; a late expiry/cancellation rolls the transaction back.

Before the deadline it returns `retained` and that deadline, changing nothing. Once due it removes only the guarded local listing/photo, detaches current projections and queues the existing private-object cleanup ledger, returning `queued` and its actual persisted `notBefore`. Fences, consumed actions, capture reports and diagnostic outcomes survive. A failed/uncertain cleanup is not retried automatically. It does **not** delete a Blob object or invoke global cleanup. Physical cleanup remains queued until separately covered operator verification proves every due entry belongs to this fixture; otherwise leave queued. Existing cleanup's live-reference/reservation/lease checks still apply. No record of `queued`, local deletion or expiry proves remote erasure; a generated remote copy may remain.

Accepted privacy/retention terms and Day30 review/Day90 disposition remain manual obligations, not purge/renewal/fence release. Offboarding must disable affected request paths before required erasure could reopen a namespace. This operator adds no recovery service, scheduler or erasure override.
