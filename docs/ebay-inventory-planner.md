# Internal Inventory Item planning — writes disabled

This bounded Stage 9B slice adds a **pure local planner and safety decisions**, not Inventory staging. There is no runtime composition, HTTP client, database change, route, action, UI, OAuth grant or provider write. Existing preparation `canStage` flags remain false. Real EPS transport and receipt admission remain disabled; Stage 9B remains In Progress.

## Contract and mapping

Reviewed November 18, 2026 against the official [Inventory OpenAPI 1.18.5](https://developer.ebay.com/api-docs/master/sell/inventory/openapi/3/sell_inventory_v1_oas3.json) and [condition ID/enum table](https://www.developer.ebay.com/api-docs/sell/static/metadata/condition-id-values.html). Inventory PUT replaces the complete item and can affect associated listings. DELETE can remove related offers/listings and group membership. Offer enumeration supports pagination and filters; a filtered result cannot establish complete absence.

The [planner](../src/application/ebayInventoryPlanner.ts) reuses `mapEbayPreparation` and `ebaySku`, preserving canonical validation, selected leaf/aspects and the supported used-condition mapping. Its proposed item subset is:

| Inventory Item field | Source |
| --- | --- |
| `availability.shipToLocationAvailability.quantity` | Existing quantity-one preparation convention |
| `condition` | Validated numeric condition selection mapped to the existing Inventory enum |
| `product.title` | Validated canonical title |
| `product.description` | Canonical plain text escaped for the HTML-capable field; no silent truncation |
| `product.aspects` | Existing metadata-validated string-array dictionary |

The contract's aspect name/value bounds are additionally enforced (40/50 characters). The OpenAPI describes the aspect dictionary and supplies an object example despite typing it as `string`; the planner uses that documented dictionary, not a JSON-encoded string. Encoded descriptions must still fit the existing 4,000-character bound. No catalog identifiers, condition descriptors, MPN/model field, package data or video IDs are invented. Category-specific eligibility and any additional required fields still need a later review.

SKU is separate path identity. Category/tree/condition metadata are snapshot bindings outside the item. Price, marketplace, format, policies, merchant location and shipping choices belong to later Offer work and are not mapped here. Acquisition cost, contact preference fields, credentials, original filenames and private storage paths are excluded. Owner-entered title/description/aspect text is preserved as content; this is not PII detection/redaction of free text.

## Logical photos and snapshot inputs

`planEbayInventory(input, now)` accepts a canonical listing, authoritative normalized requirements/selection, captured/current connection bindings, metadata validity interval, per-photo source bindings and normalized media observations. Time is explicit; there is no clock, randomness, I/O or mutation. Results are detached from inputs.

The binding includes owner, listing/version, Sandbox seller, connection/version, configuration and grant fingerprints. Photo bindings additionally carry image ID, persisted order and source-version fingerprint. A later trusted caller must obtain these from owner-scoped repositories and validated provider contracts. Comparing two supplied snapshots **does not prove** authentication, source bytes, current database state or permission.

Photos are sorted by persisted order without changing input arrays or silently dropping extras. The initial application subset requires 1–24 durable private JPEG/PNG sources; this is not a universal provider/category limit or proof of image acceptance. Missing, legacy/unsupported, duplicate, extra or mismatched source bindings block the plan.

Media observations contain no URL. `reported-confirmed` is a normalized caller assertion for pure comparison tests, **not receipt admission**. A missing, unverified, expired, future-dated or mismatched observation produces an explicit blocker. Even matching synthetic observations leave `media-admission-disabled` and `staging-disabled`; `canStage` is always false. There are no real receipts/associations, invented EPS URLs or an allowlist. Ordered logical references remain outside `inventoryItem`; no `imageUrls` request array or sendable request is constructed.

## Conservative decisions

The [decision functions](../src/application/ebayInventoryDecisions.ts) accept a captured binding, normalized observation and explicit time. Observations describe the exact SKU, complete all-marketplace/format offer enumeration, listing/group state, prior-write/reconciliation state, ownership evidence and media freshness. A future adapter must establish each assertion; these types do not establish provider absence or durability.

| Function | Meaning and refusal rules |
| --- | --- |
| `assessInventoryPreflight` | Refuses every existing SKU, including matching app-owned content; initial staging is not replacement. Missing/stale/unverified media, mismatched context, incomplete reads and prior confirmed/uncertain writes remain blocked or require review. Fresh absence still returns `external-create-race`. |
| `assessInventoryReconciliation` | Can describe an exactly bound, reportedly app-owned matching item as `consistent`, or a complete fresh absence as `observed-absent`. Matching name/payload is insufficient for adoption. Uncertain writes, unfinished reconciliation, conflicting content or missing ownership do not become confirmed. No fence/history is reset. |
| `assessInventoryCleanup` | Requires matching reported durable ownership and prior confirmed write even to describe cleanup evidence. Related or incompletely enumerated resources block. A present, otherwise clean item still returns `external-delete-race`. Observed absence needs no DELETE and does not erase history. |

Every decision returns `canStage: false` and `canDelete: false`, including legitimate consistency controls. Reasons are bounded codes; no raw provider data is returned. Cleanup intentionally does not require usable photo URLs: expired media is not authority to delete an Inventory Item.

There is no implemented conditional-create or atomic no-offers/delete guarantee against another eBay client. No input switch can declare that race solved. Local locks or a freshly empty GET cannot reserve a remote SKU. There is no simulated journal, retry, adoption, cleanup operation or claim of persistence guarantees. These functions do not replace future authenticated session, durable attempt/content fences, ownership proof, complete observation adapters or commit-time version checks.

## Verification and remaining gates

Run the focused synthetic controls:

```sh
npx vitest run src/application/ebayInventoryPlanner.test.ts src/application/ebayInventoryDecisions.test.ts
```

Tests cover mapping/Offer separation, malformed metadata/listings, condition/aspect restrictions, escaped descriptions, deterministic detached output, order/source/media/version mismatches, absent and known-item controls, incomplete pagination/state, uncertain writes, naming/payload non-ownership, contradictory evidence and external create/delete races. Existing preparation/private-media/fake-workflow regressions and full repository checks must remain green. No new PostgreSQL/browser boundary was added, so those existing suites provide regression preservation rather than invented planner persistence coverage.

Before real staging: separately review durable seller/SKU ownership and attempts/tombstones, read/reconciliation adapters and pagination, external-client race policy, safe cleanup design, actual EPS URL/expiry/ingestion evidence, category-specific requirements, explicit write grant/confirmation, final-byte/media binding and real acceptance budgets. The [future write design](ebay-next-slices.md#separate-future-pr-guarded-inventory-item-staging) remains proposed. This planner authorizes none of those operations.

The separate [proposed durable Inventory lifecycle](ebay-inventory-lifecycle-design.md) specifies those ownership/history/reconciliation/cleanup boundaries and recommends NO-GO for automatic PUT/DELETE under unresolved external-client races. Its newer-release versus legacy-OpenAPI evidence gap does not retroactively turn this guide's dated 1.18.5 review into current-version acceptance. No persistence, adapter or permission is implemented by that design.
