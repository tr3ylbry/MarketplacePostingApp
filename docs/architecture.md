# System architecture

Marketplace Posting Assistant keeps one owner-controlled inventory and turns each item into marketplace-specific drafts. It is a Next.js application backed by PostgreSQL, with private image bytes in Vercel Blob. Reverb supports explicit draft creation, status checks, recovery and deletion; eBay, Craigslist and OfferUp/Facebook currently provide local previews only.

This describes the implemented V2 system through Stage 6, not a public-launch or future eBay design. Development validation uses a local application, GitHub OAuth, a development PRIVATE Blob store and Reverb Sandbox. There is no live-publishing action, background synchronization or deployment automation in the repository.

## System map

```text
Browser
  ├─ GitHub sign-in → Better Auth → PostgreSQL sessions
  └─ Next.js pages / explicit server actions
       ↓ session-derived owner + validated input
     Application services
       ├─ owner-scoped repositories → Drizzle → PostgreSQL
       ├─ image storage boundary → Vercel PRIVATE Blob
       └─ Reverb gateway → Sandbox (default) or configured Live host

Canonical Listing → pure marketplace mappers → preview fields / warnings
```

The arrows separate responsibilities, not independently deployed services. This is one application with small interfaces; it does not use microservices or a generic repository framework. Browser uploads go directly to Blob using a server-authorized capability. Reverb HTTP requests originate only from the server.

| Layer | Responsibility | Source |
| --- | --- | --- |
| Domain | Canonical data, USD Money, schemas and normalization; no React, Next.js or database dependency | [domain](../src/domain/) |
| Marketplace mappers | Pure validation and deterministic preview mapping; no network or persistence | [platforms](../src/platforms/) |
| UI / request boundary | Server-rendered reads, interactive forms, session checks and server actions | [app](../src/app/), [features](../src/features/) |
| Application | Listing, image and Reverb use cases; repository/gateway contracts | [application](../src/application/) |
| Infrastructure | SQL, row/domain mapping, provider HTTP and credential encryption | [infrastructure](../src/infrastructure/) |
| Compatibility | Validated V1/V2 browser data conversion for explicit import only | [storage](../src/storage/) |

[server.ts](../src/application/server.ts) and [reverbServer.ts](../src/application/reverbServer.ts) are server-only composition roots. They connect use cases to concrete infrastructure without importing those implementations into domain models or React forms.

## Data ownership and state

PostgreSQL is the source of truth for inventory, ownership, image metadata and saved integration state. Blob stores image bytes. Reverb is authoritative for its remote resource; a saved provider state is only the result of the last explicit check, not a live mirror.

Three states must not be conflated:

| Concept | Meaning | Example |
| --- | --- | --- |
| `Listing.status` | Local item's lifecycle | `draft`, `active`, `sold`, `archived` |
| `MarketplaceListing.status` | Generic publication record, including manually imported history | `draft`, `ready`, `published`, `sold`, `error`, `needs-renewal` |
| `providerState` / `providerCheckedAt` | Last observed provider state and actual check time | Reverb `draft`; application sentinel `missing`; null when unchecked |

A local save does not publish or update anything remotely. A generic `published` history record is not proof of a recent provider check. Non-draft Reverb states are retained as bounded provider values, not guessed mappings to “published.”

### Relational model

The [Drizzle schema](../src/infrastructure/db/schema.ts), [auth schema](../src/infrastructure/db/authSchema.ts) and [committed migrations](../drizzle/) define these areas:

| Tables | Purpose / relationship |
| --- | --- |
| `users`, `accounts`, `sessions`, `verifications` | Better Auth identities, OAuth accounts and database-backed session lifecycle |
| `listings` | Canonical item with required `owner_id` referencing the internal user |
| `listing_images` | Ordered child metadata: legacy filename or durable Blob pathname; optional provider-retention deadline |
| `marketplace_listings` | Child publication records, external identity and environment/shop context, last known provider state |
| `image_uploads` | Expiring upload reservations, not visible saved images |
| `image_cleanup` | Path-keyed deferred deletion ledger; intentionally survives parent deletion |
| `reverb_connections` | One encrypted credential and validated shop identity per owner/environment |
| `reverb_draft_requests` | Version-bound review, create lease and durable attempted-POST fence |
| `reverb_management_leases` | Short-lived coordination for explicit refresh/delete, not a job queue |

Listing children cascade on local deletion; cleanup intent is captured before that cascade. Deleting a user with listings is restricted. Image positions are unique within each listing, and durable paths are unique across images; foreign keys, indexes and checks reinforce ownership relationships, ordering, USD and finite amount constraints.

Optional item attributes and marketplace details use validated JSONB rather than one table per attribute. Money amounts use PostgreSQL numeric columns mapped explicitly to the domain's JavaScript-number model; this is not an accounting system. Text IDs preserve valid historical local identities. Ownership stays in the application/repository boundary, not a client-editable product attribute.

Creates/imports write the aggregate transactionally. Ordinary edits preserve images and require the expected `updatedAt` version; stale saves fail instead of overwriting newer changes. Image operations lock the owned parent briefly, maintain ordering and advance that version. Row/domain conversion is explicit in [listingMapping.ts](../src/infrastructure/repositories/listingMapping.ts).

## Security boundaries

- **Identity:** GitHub OAuth is handled by Better Auth. Protected pages/actions validate the database-backed session and derive the internal user ID on the server. Cookie caching is disabled; session cookies are HttpOnly, SameSite=Lax and Secure for HTTPS origins. Configured-origin and CSRF checks remain enabled. See [auth options](../src/auth/options.ts) and [session boundary](../src/auth/session.ts).
- **Authorization:** Services take a trusted owner ID; repositories scope parent reads/writes to that owner. Image access also checks the matching child/reservation. Knowing a listing/image ID does not grant access. PostgreSQL RLS is **not** enabled: application authorization is the boundary, and direct database access is privileged.
- **Validation:** Server mutations parse untrusted input using Zod/domain rules. Browser-submitted ownership cannot assign an owner, and ordinary saves/imports cannot attach arbitrary Blob paths. Canonical validity is separate from marketplace readiness.
- **Credentials:** Auth, database, Blob and Reverb encryption configuration is server-only. Reverb PATs are encrypted with AES-256-GCM under a dedicated key, with owner/environment as authenticated context. The user necessarily enters the PAT in the connection form; subsequent status responses expose safe metadata, not plaintext or ciphertext. Neither PATs nor signed image URLs belong in browser storage or logs.
- **Provider boundary:** Reverb's client pins the configured environment host, validates responses/links, disables redirects and applies timeouts. Browser input cannot choose a provider host or delete URL. Errors returned to the UI omit raw provider responses, SQL and secrets.

These controls do not make the application public-launch ready. Multi-instance abuse controls, sanitized operational monitoring, rotation/backup procedures and deployment configuration need a separate operational pass. No teams, roles or admin UI are implemented.

## Private images: metadata is not a public URL

1. An authenticated owner requests an upload reservation. The server generates image identity/path and grants an exact-path, MIME/size-constrained, five-minute PUT capability with overwrite disabled.
2. The browser uploads bytes directly to PRIVATE Blob. Finalization reads the reservation in a short transaction, verifies the remote object and image header outside PostgreSQL, then rechecks and commits metadata in a second short transaction.
3. A browser image read goes through the owner-authorized application route, which redirects to a 60-second signed GET. The durable record stores a pathname, not that URL.
4. External-provider ingestion uses a separate owner/listing/image boundary. Before signing a 15-minute GET, it durably extends `providerRetainUntil` to at least expiry plus one minute. Repeated capabilities never shorten retention. Ordinary browser reads do not extend it.
5. Removing an image/listing removes it from the product immediately. Physical deletion may wait: trusted paths and deadlines survive in `image_cleanup`. The explicit operator cleanup command claims a due entry, commits, deletes remotely, then acknowledges in another short transaction. Referenced images/live reservations are protected; failures remain retryable.

Signed URLs are bearer capabilities until expiry, not permanent public access. Recipients can share them and downloaded bytes cannot be revoked. Reverb keeps its ingested copies; deleting local photos does not delete those copies. Signature/header checks are not full malware scanning or EXIF removal. No cross-system transaction or automatic cleanup scheduler is claimed. See the [image operations and setup guide](../README.md#private-media-boundary) for limits, failure handling and operator commands.

## Reverb: explicit actions, conservative recovery

Pure preview mappers and the network integration are different boundaries. Visiting the Reverb listing page reads local data only—no automatic shop, taxonomy or status request, polling or `useEffect` fetch. Private image reads may still contact Blob; “no passive Reverb traffic” does not mean “no image network traffic.”

- **Load/prepare:** Loading explicitly fetches real shop/categories/conditions. Preparation revalidates selections against fresh provider data and saves an expiring, version-bound review. Shipping uses a real selected profile or the canonical USD rate for US_CON.
- **Create:** Reconcile the deterministic listing-derived SKU with `state=all` first. A valid existing draft can be adopted. Otherwise, record an attempted-POST fence before transmitting `publish=false`. Private photo capabilities are server-generated and sent only in the provider payload, never the review response.
- **Refresh:** An exact known ID refreshes state; a sole draft can be adopted when there is no active identity. Multiple matches and ID mismatches stop for manual resolution. Non-drafts must be managed on Reverb. Unlinked legacy posting history is preserved without blocking active reconciliation.
- **Delete:** Require an explicit confirmation, then a fresh exact-SKU/ID/draft check before one DELETE. A post-delete lookup determines the outcome, including after 404/timeout/5xx. Never blindly repeat an uncertain DELETE. Local listing, photos and connection remain.
- **Recreate:** Confirmed absence of a previously confirmed resource records `missing`, clears active external identity and resets the confirmed create fence. A new deliberate review can create one replacement after another SKU check. An ambiguous POST that was **never confirmed** stays fenced even when lookup returns zero matches.

Short leases and owner/listing/connection/version checks guard commits against stale workers. All Reverb HTTP and Blob signing run outside database transactions. A provider success followed by a database failure needs reconciliation, not a blind retry; this is conservative duplicate prevention, not a distributed exactly-once guarantee. There is no remote content update, auto-sync, live-publish action or background worker.

See [Reverb draft integration](reverb-drafts.md) for protocol details, conflict policy and Sandbox procedures.

## Verification and next boundary

Unit/component tests cover domain, mappers and explicit UI actions. PostgreSQL integration tests exercise real constraints, ownership, concurrency, leases and failure recovery. Chromium workflows use isolated fake Reverb/image services and real test database sessions; CI needs no personal provider credentials. Real GitHub OAuth, PRIVATE Blob and Reverb Sandbox smoke tests complement—not replace—those automated checks. See [validation commands](../README.md#validation); exact run results belong in the relevant PR.

Browser localStorage is retained only for deliberate validated legacy import; it is not inventory persistence. Import never silently deletes old browser data or assigns another user's records. Pre-auth database ownership migration is a separate explicit operator workflow, documented in the [README](../README.md#existing-pre-auth-database-listings).

Before adding eBay, preserve these boundaries: keep mapping pure; put HTTP in a separate gateway; validate ownership and provider identity server-side; distinguish local state from observed remote state; document uncertainty/recovery; and keep provider calls out of database transactions. Reverb's SKU/fence behavior is not evidence that another provider offers the same guarantees. eBay integration, public launch, background jobs, pagination and broader operational tooling remain future work—not features of this documentation stage.
