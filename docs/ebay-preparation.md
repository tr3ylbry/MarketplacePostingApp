# Read-only eBay Sandbox preparation

This first Stage 9B slice prepares a review from an owned canonical listing. It does **not** upload photos, create inventory items/offers, publish, update or delete any eBay resource. No new tables, migrations or seller OAuth permissions are added. Stage 9B remains in progress.

## Explicit provider reads

Open `/listings/[id]/ebay` from a saved listing. Rendering reads the local listing and safe connection status only. There are no provider effects, polling or requests on ordinary local Save.

1. **Load eBay categories** requests the current `EBAY_US` category tree.
2. Browse its immediate branches and select an authoritative leaf category.
3. The server retrieves that leaf's item-aspect requirements and condition policy.
4. Choose a supported used condition and enter truthful required aspects. Brand/model may be prefilled from the owned listing; no identifier, exemption or provider ID is invented.
5. **Prepare eBay review** fetches requirements again and returns a validated review. It is always marked **not ready for remote staging**.

The server derives the owner from the authenticated session and requires an owned listing plus a locally verified, unexpired Sandbox seller connection before metadata access. It rechecks listing and connection versions afterward; an edit, reconnect or disconnect invalidates an in-flight result. No provider request runs inside a PostgreSQL transaction. Reviews/selections are transient UI state, not stored in browser Web Storage or PostgreSQL.

## Metadata and credential boundary

`EbayMetadataClient` pins `api.sandbox.ebay.com`, numeric category paths and `EBAY_US`. Redirects are forbidden; requests have 15-second timeouts, JSON validation and bounded decoded response sizes (64 KiB for tokens/default-tree references, 8 MiB for tree/aspect/condition metadata). Explicit gzip negotiation reduces transfer size; Node fetch decompresses the body before the byte cap is enforced. It checks tree/version, leaf and condition-policy identity before mapping allowlisted fields. Provider bodies, headers and credentials are never echoed in errors.

The official API has no root-only or paginated tree operation. The first root load retrieves the complete tree, checks at most 50,000 category nodes, depth 12 and 2,000 children per node, then discards descendants. Only one bounded root projection is cached in server memory. Every explicit browse checks the current tree ID/version; a change invalidates the projection. Concurrent full-tree loads share one flight, including serialization across different versions, so they do not multiply peak tree memory. Callers receive independent copies. Failed/partial trees are never cached. Branches/leaves still use official lazy subtree reads; there is no Redis, database cache or background refresh.

The byte cap bounds transient body buffers/JSON input; node/depth limits bound category traversal and the cache retains no recursive payload. They are not a general process-RSS quota. A future tree exceeding a budget fails safely and needs a deliberate compatibility review; the application never silently falls back to Production or removes the limits.

Taxonomy and ordinary used-condition metadata use a separate **application access token** requested through `client_credentials` with only `https://api.ebay.com/oauth/api_scope`. The token is cached in server memory with expiry skew and concurrent-request deduplication. It is not persisted or returned to the browser. Seller authorization-code tokens and refresh behavior remain unchanged. CI uses synthetic API-shaped fixtures and the real parser against an isolated fake; the separate real read-only evidence is recorded below.

## Pure mapping

The mapper accepts the canonical listing, a selection and fresh validated metadata. It produces a review containing a deterministic `mpa-ebay-` SKU based on immutable listing identity, the leaf/tree version, title, description, used-condition enum, validated aspects, positive USD decimal price and quantity one. Acquisition cost, contact data, other marketplace preferences, credentials and private image paths/URLs are excluded. Local photo counts are informational; bytes are not exported.

Titles over 80 characters, descriptions over 4000 characters and prices with more than two decimal places fail rather than being silently truncated or rounded. Selected aspects must exist in metadata and satisfy required fields, cardinality, length and selection membership. Duplicate/reserved names fail closed. This slice supports ordinary string aspects and a conservative used-condition allowlist. Number/date/range formats, conditional choices, refurbished permissions and condition descriptors remain unsupported; required unsupported fields block review.

The review is an allowlisted DTO, **not** an Inventory API request body or authorization to write remotely. It creates no `MarketplaceListing`, attempt, media or inventory record.

## Real Sandbox metadata verification — 2026-11-08

Two bounded sequences made **14 requests total**: two base-scope application-token exchanges and 12 metadata GETs (two default references, two full trees, four subtrees, two aspect reads and two condition-policy reads). The first measured the existing implementation; one final sequence checked the focused correction. All returned HTTP 200. There were no retries, seller consent/token operations or resource writes. No authenticated response or credential was saved to a file.

Final-sequence measurements:

| Operation | Decoded bytes | Request/body time |
| --- | ---: | ---: |
| Default tree reference | 50 | 1,055 ms |
| Complete tree | 4,460,684 | 1,114 ms |
| Music subtree | 108,208 | 605 ms |
| Selected pedal leaf | 339 | 292 ms |
| Leaf aspects | 21,221 | 556 ms |
| Leaf condition policy | 354 | 418 ms |

Tree version **134** contained **17,105 nodes**, depth **6**, and **34 root branches**. Full-tree JSON parsing took 14–15 ms across the two runs. Gzip was observed, but the full-tree response omitted Content-Length: its compressed transfer byte count was not measured. Header-reported compressed sizes were 6,020 bytes for the music subtree and 4,275 bytes for aspects; these differ from decoded body sizes. The diagnostic process used about 143–144 MiB RSS at the root measurement, including imports and in-memory evidence; this is not a Next.js load benchmark or an asserted application memory ceiling.

The 8 MiB decoded cap **did not fail** for this Sandbox tree. The confirmed inefficiency was repeatedly downloading the same full tree on root reload; bounded version-aware projection caching removes that repeat work. No parser schema relaxation was necessary. The actual pedal leaf had ten aspects, two required (Brand/Type), and four conditions, two within the used-condition allowlist. Observed omitted optional length/usage properties parsed correctly. The pure mapper produced a non-staging review from a synthetic listing and these actual requirements.

The real parser and cache were exercised against the exact responses retained only in diagnostic memory; repeated parser/cache checks made no further HTTP calls. This is provider-response compatibility evidence, not real browser seller/metadata interaction or remote staging. Existing browser/owner-isolation coverage remains fake-provider testing. No Production metadata was substituted. Large future trees, unsupported required formats and restricted refurbished conditions remain explicit limitations.

## Remaining Stage 9B work

- Read-only seller location, policy enrollment and business-policy readiness checks with a reviewed least-privilege scope expansion.
- A private-image export boundary and EPS transfer, including byte validation, retention and residual-copy limitations. Reverb's signed-URL ingestion architecture is not reused as an assumed EPS contract.
- Explicit Sandbox inventory staging with conservative SKU reconciliation, concurrency fencing and minimum safe cleanup. Inventory PUT replacement can affect associated offers; write safety must be reviewed first.
- Focused fake-provider coverage, followed by a separately approved real Sandbox plan specifying exact test resources and cleanup.

No real inventory, offer, EPS/media, policy, location or listing mutation is authorized by this slice. There is no background sync, live seller support or public application deployment.

Official contracts: [Taxonomy](https://developer.ebay.com/api-docs/commerce/taxonomy/overview.html), [Metadata](https://developer.ebay.com/api-docs/sell/metadata/overview.html), [application-token grant](https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html), [condition IDs and Inventory enums](https://www.developer.ebay.com/api-docs/sell/static/metadata/condition-id-values.html).
