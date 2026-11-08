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

`EbayMetadataClient` pins `api.sandbox.ebay.com`, numeric category paths and `EBAY_US`. Redirects are forbidden; requests have 15-second timeouts, JSON validation and bounded response sizes (64 KiB for tokens, 8 MiB for metadata). It checks tree/version, leaf and condition-policy identity before mapping allowlisted fields. Provider bodies, headers and credentials are never echoed in errors.

Taxonomy and ordinary used-condition metadata use a separate **application access token** requested through `client_credentials` with only `https://api.ebay.com/oauth/api_scope`. The token is cached in server memory with expiry skew and concurrent-request deduplication. It is not persisted or returned to the browser. Seller authorization-code tokens and refresh behavior remain unchanged. There is no new real provider acceptance claim; CI uses synthetic API-shaped fixtures and the real parser against an isolated fake.

## Pure mapping

The mapper accepts the canonical listing, a selection and fresh validated metadata. It produces a review containing a deterministic `mpa-ebay-` SKU based on immutable listing identity, the leaf/tree version, title, description, used-condition enum, validated aspects, positive USD decimal price and quantity one. Acquisition cost, contact data, other marketplace preferences, credentials and private image paths/URLs are excluded. Local photo counts are informational; bytes are not exported.

Titles over 80 characters, descriptions over 4000 characters and prices with more than two decimal places fail rather than being silently truncated or rounded. Selected aspects must exist in metadata and satisfy required fields, cardinality, length and selection membership. Duplicate/reserved names fail closed. This slice supports ordinary string aspects and a conservative used-condition allowlist. Number/date/range formats, conditional choices, refurbished permissions and condition descriptors remain unsupported; required unsupported fields block review.

The review is an allowlisted DTO, **not** an Inventory API request body or authorization to write remotely. It creates no `MarketplaceListing`, attempt, media or inventory record.

## Remaining Stage 9B work

- Read-only seller location, policy enrollment and business-policy readiness checks with a reviewed least-privilege scope expansion.
- A private-image export boundary and EPS transfer, including byte validation, retention and residual-copy limitations. Reverb's signed-URL ingestion architecture is not reused as an assumed EPS contract.
- Explicit Sandbox inventory staging with conservative SKU reconciliation, concurrency fencing and minimum safe cleanup. Inventory PUT replacement can affect associated offers; write safety must be reviewed first.
- Focused fake-provider coverage, followed by a separately approved real Sandbox plan specifying exact test resources and cleanup.

No real inventory, offer, EPS/media, policy, location or listing mutation is authorized by this slice. There is no background sync, live seller support or public application deployment.

Official contracts: [Taxonomy](https://developer.ebay.com/api-docs/commerce/taxonomy/overview.html), [Metadata](https://developer.ebay.com/api-docs/sell/metadata/overview.html), [application-token grant](https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html), [condition IDs and Inventory enums](https://www.developer.ebay.com/api-docs/sell/static/metadata/condition-id-values.html).
