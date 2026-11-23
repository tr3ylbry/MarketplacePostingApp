# Proposed single-fixture Sandbox acceptance — not authorized

This is preparation for the [internal diagnostic comparison](ebay-image-comparison.md), not an execution procedure or enabling switch. No command is provided because the authenticated M3 operational entry point does not exist. The old manual capture-only runner cannot perform M3. Review/merge of this implementation does not authorize execution.

## Prerequisites that need their own review/approval

1. Independently review the exact candidate head and its CI. Record the eventual reviewed execution commit/tree privately; a draft head is not yet reviewed or approved. Do not substitute a moving branch.
2. Separately implement/review a minimal operator composition around the existing internal workflow: genuine read-only Better Auth session validation, exact owner/session/seller/source/grant/configuration binding, safe credential access without implicit refresh, bounded private source reader, and safe result handling. No generic URL/owner/session DTO may supply authority. Normal app/UI/job integration is unnecessary and outside this preparation.
3. Privately verify trusted loopback HTTPS/session, intended local database and committed migration journal. Source contains migrations 0000–0012. Historical 0008–0011 application/cleanup is not fresh proof. **0012 diagnostic ledgers are source-required; development application is unverified and may be pending.** M3 adds no migration. No development database, credentials or schema was inspected/changed for this plan.
4. Recheck the approved public privacy notice and existing privacy/retention terms before any consent. A factual correction, publication, local setup or migration needs explicit authorization if not already covered. No notice change is included here.
5. Prepare one newly generated non-personal opaque RGB 500×600 PNG, ≤1 MiB, using a fresh 128-bit nonce and the exact v1 cue/marker/anchor pattern. Commit private source retention before processing. Record source/final-derivative identities separately in existing private bindings. The exact accepted submitted derivative is the reference. Test vectors and original discovery content must not be reused to bypass fences.

## Proposed request ceiling for separate owner approval

The diagnostic experiment itself permits **at most one fixed reviewed Sandbox `createImageFromFile` POST and one anonymous primary-image GET**. Failed requests count. Browser consent navigation and separately authorized local/GitHub/private-Blob preparation are distinct from eBay API requests, but still need their own covered authorization.

Because current live access/identity/scope readiness was not inspected, the smallest explicit approval package should separately enumerate these optional prerequisites:

| Phase | Maximum eBay API requests |
| --- | --- |
| One replacement Sandbox consent, if required: one code exchange | 1 |
| One authenticated Trading GetUser to bind the intended existing seller | 1 |
| One image-create POST | 1 |
| One anonymous primary-image GET | 1 |
| **Cumulative ceiling when both prerequisites are approved** | **4 total, including failures** |

If an independently verified existing connection needs neither prerequisite, explicitly approve a two-request path instead; do not silently move between budgets. Consent is exactly base scope plus `sell.inventory`, replacing readiness scopes, not silently combining grants. Wrong-seller/failed/cancelled consent must preserve prior credentials. Before capture require at least two minutes of access lifetime; stop rather than refresh. This document approves neither path.

## Boundaries, outcomes and cleanup

Use the existing exact HTTPS upload/image origins, raw opaque target/query policy, one bounded TCP DNS exchange and pinned TLS peer/hostname verification. No credentials/cookies/referrer to the image host. Preserve all URL/header/body/wire, five-second native, remaining original ten-second request, 30-second operation, lease/capacity and policy-cutoff limits. No retry, refresh, extra identity check, getImage, HEAD, redirects, alternate address/server, maximum-image fallback, download repetition or Production fallback.

Stop on any failed prerequisite, changed owner/session/seller/scope/version/content/configuration, insufficient lifetime, cancellation, unknown commit acknowledgement, DNS/TLS/peer issue, unsafe target, unsupported/corrupt response, geometry/orientation/marker/color/similarity failure, deadline/capacity failure or exhausted budget. A refused download does not authorize another request. Decoder uncertainty/mismatch does not trigger another upload, alternate transform or tolerance adjustment.

Report retrieval, full decode, geometry, orientation cue, marker, color, similarity and local acknowledgement separately. On success, retain only the existing bounded diagnostic evidence and safe private operator report; remote state remains unknown and `associated:false`. Lost response or acknowledgement stays conservative, with all action/source/derivative fences intact. Current SQL envelopes cannot store visual scores/outcomes; persistent visual evidence would need a separately approved contract. No usable-media receipt/association or Inventory permission follows a match.

After all native/network/database work actually settles, zero/discard operation-owned bytes and capability references. Guarded local fixture removal must use its **actual persisted retention deadline**. Global cleanup is permitted only if all due entries are proven to belong to this fixture; otherwise leave queued and report. Retain capture/verification safety history, fences and accepted Day-30/Day-90 review/disposition obligations; do not purge, renew or release them automatically. Preserve the intended connection. A generated remote copy may remain; expiry and local cleanup do not prove remote erasure.

A successful run would demonstrate that one fresh fixture, account/grant, observed primary URL and processing variant survived the reviewed pipeline under the exact approved recipe. It would not prove general EPS fidelity, all formats/metadata/profiles/alpha/resizes, stable URL semantics, long-term availability, lost-response recovery, remote erasure, ownership or production readiness.

Useful remaining clarification topics are precise enforced image limits, exact ICC/alpha/color behavior and recovery/deletion guarantees. Existing support statements are not measured acceptance evidence. No support message is sent by this plan.
