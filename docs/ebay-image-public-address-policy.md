# Offline image address policy

This implements the approved, source-backed **numeric classifier only**. A `public-candidate` is eligible under this frozen address policy, **not safe to connect, reachable, authenticated, owned or authorized**. There is no resolver, connection/HTTP client, production/model wiring, diagnostic ledger, new operational command, dependency or migration. Normal EPS transport, real receipt/association admission and Inventory writes remain disabled; Stage 9B remains In Progress.

The [offline egress model](ebay-offline-image-egress-prototype.md) and its synthetic address catalog are unchanged. Their mocked DNS/peer/TLS/request and intent/outcome ports are still mocks. This module is not a replacement import in that model or in application composition.

## Interface and coverage

`classifyImageAddress(value, family, evaluationTime)` in [imagePublicAddressPolicy.ts](../src/infrastructure/ebay/imagePublicAddressPolicy.ts) accepts only a numeric address, numeric family `4` or `6`, and trusted integer Unix milliseconds. Its bounded frozen result contains `classification` (`public-candidate`, `blocked`, `unclassified`), a fixed reason/policy version, and canonical numeric address/family when parseable. It never accepts a URL, hostname, owner/session, prefix table or caller-selected policy version. No input is reflected when it is not a valid numeric address.

The future caller must supply current trusted time and enforce cancellation, monotonic elapsed deadlines, session/context validity and every separate send gate. Passing an old evaluation time does not authenticate an operation. This pure module is not that caller and cannot detect wall-clock rollback between calls.

| Source coverage | Treatment |
| --- | --- |
| IPv4 allocation table, all 256 distinct /8 records | Only ALLOCATED and LEGACY ordinary-unicast blocks (first octet 1–223) provide positive coverage. RESERVED and the documented UNALLOCATED status never provide coverage. The pinned table has 129 allocated, 92 legacy and 35 reserved rows. |
| IPv6 Global Unicast table, 51 records | Only its 36 ALLOCATED prefixes within 2000::/3 provide positive coverage. Its 15 RESERVED prefixes block. Unlisted space is unclassified, not default-public. |
| IPv4/IPv6 special-purpose tables, 25 records each | **Every match blocks**, including nested globally reachable exceptions and terminated registrations. The IPv4 two-prefix record expands to two separately blocked /32s. |
| Recognizable embedded notation | Mixed dotted IPv6 tails, IPv4-compatible/mapped numeric space and ISATAP-style interface IDs (`0000:5efe` or `0200:5efe` in interface groups) are conservatively refused. Registered NAT64, Teredo and 6to4 ranges are already blocked by the special-purpose table. |
| Everything else | Missing positive coverage, malformed/unsupported syntax, family mismatch, unavailable/tampered/unknown policy and invalid or ineligible time are NO-GO. |

Blocking takes precedence over every positive match, including a more-specific globally reachable special-purpose entry. Expected cross-table special-purpose overlays are not silently treated as contradictions or exceptions. Duplicate prefixes, overlapping/disagreeing allocation rows, unknown statuses/schemas and unresolved footnotes fail source processing.

Allocation means registry-level address-space coverage, not current routing, RIR/end-user assignment, endpoint ownership or absence of network translation. Numeric bits cannot identify arbitrary network-specific NAT64, tunneling/encapsulation, traffic routing or a destination's administrative trust. The recognizable-form restrictions above are explicit and finite; no exhaustive tunnel detector is claimed. Conservative exclusions may refuse legitimate destinations and must never trigger a fallback or weaker policy.

Runtime IPv4 uses strict four-octet decimal syntax: no shorthand, integer/octal/hex or leading zeros. IPv6 supports ordinary expanded/compressed/uppercase hexadecimal spelling and canonicalizes the first longest zero run of at least two groups. Dotted tails parse only to produce a blocked result. Whitespace/controls, zones, ports/brackets, prefixes and unsupported notation fail. Maximum runtime length is 45 characters. Numeric equivalence does not permit normalization or rewriting of an opaque image URL.

## Pinned provenance and integrity

Policy version: `iana-image-address-v1-2026-11-22`; normalization format: `1`. The [manifest](data/image-address-policy-v1/manifest.json) records exact URLs, actual per-source retrieval times, supplied registry update dates, exact-byte hashes, reviewed annotation hashes and row counts. The [four exact XML snapshots](data/image-address-policy-v1/) retain their original bytes, including notes and processing instructions. No WHOIS/RDAP, stylesheet, reference or entity is followed by the build tool.

| Official IANA index / structured XML | Supplied updated date | SHA-256 of exact XML |
| --- | --- | --- |
| [IPv4 Address Space](https://www.iana.org/assignments/ipv4-address-space/) / [XML](https://www.iana.org/assignments/ipv4-address-space/ipv4-address-space.xml) | 2025-10-10 | `013bf87df7b24401ab6143bcad83bd61eeaf0f9c976d2cf1aedcdd5795865222` |
| [IPv4 Special-Purpose](https://www.iana.org/assignments/iana-ipv4-special-registry/) / [XML](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xml) | 2025-10-09 | `37f334466c842387a8aee8d1ae7a6d5b2208ef27eb8964072538b73ee2f5b21d` |
| [IPv6 Global Unicast](https://www.iana.org/assignments/ipv6-unicast-address-assignments/) / [XML](https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.xml) | 2025-10-10 | `22f9a545e020ea6b9adea9ea0276f3157e32c838682459a45bfe7760de0aefc3` |
| [IPv6 Special-Purpose](https://www.iana.org/assignments/iana-ipv6-special-registry/) / [XML](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xml) | 2025-10-09 | `660acf0201b462b8d820605ba1cb20c4ed216acd883ee4a55a17453d73d4c3aa` |

Acquisition times range from **2026-11-22T20:31:27.970Z** to **2026-11-22T20:31:28.569Z**. There are 357 source records and 358 normalized prefixes. The deterministic normalized-data SHA-256 is:

`e1f0e0118b22d8985ec9095c201ab65893b32f3eae101ddab07696b9c1b90887`

Only public registry data is hashed. No capability, query, credential or private identity is accepted or fingerprinted.

The runtime validates the version, exact manifest shape/coverage, source identities, acquisition/update dates, bounded row coverage, normalized hash and manifest hash before compiling immutable numeric ranges. It has no filesystem access. Broken data produces `policy-unavailable`, never an eligible result. These hashes detect inconsistency relative to the reviewed manifest; they are not a signature against someone replacing both code and manifests. Git review and verified source acquisition remain the trust boundary.

## Footnotes and source disagreements

XML was chosen because it retains definitions, footnotes, nested references and supplied update dates alongside the records. The normalizer validates the actual four schemas, resolves note anchors, pins root/table annotations and record-linked notes/references, and refuses changes that do not match their reviewed hashes.

- IPv4 footnote 1 defines RESERVED/LEGACY/ALLOCATED/UNALLOCATED. Only the two positive statuses are eligible. Notes 2–4 and 6–13 identify special-purpose restrictions; their ranges are independently blocked by the special table. Note 5 records a historical reservation subsequently allocated; current allocation governs, subject to all blocks. Notes 14–18 describe multicast/reserved/broadcast space; the allocation rows are already nonpositive.
- IPv6's table note defines 2000::/3 and reserves unlisted space. Partial-IANA/6to4/documentation notes defer to the pinned special-purpose registry; every special match wins. Historical aggregation notes do not add ranges. Former 6bone/deprecated-Teredo space remains reserved/uncovered, never resurrected.
- Special-purpose footnotes permit or discuss protocol/routability exceptions. This application's approved policy declines all such exceptions, including more-specific positives and N/A/terminated rows; they remain blocked. The flags are checked for supported values, not used as an allow override.

No natural-language rule engine guesses what new prose means. Changed or unfamiliar notes require maintainer source/coverage review and a newly reviewed manifest. Do not simply update a checksum to make a failure disappear.

## Review cutoff and update procedure

Responsible reviewer: **project maintainer**. This snapshot becomes eligible only at the latest acquisition, **2026-11-22T20:31:28.569Z**, when all four sources exist. It becomes ineligible at the earliest acquisition plus 90 days, **2027-02-20T20:31:27.970Z**. Evaluation before the start, at/after the cutoff, with noninteger/nonfinite time or unavailable data fails closed. This ceiling does not guarantee that registry changes cannot occur sooner.

There is no refresh/updater, runtime download, automatic renewal or hand-edited deadline extension. For a future reviewed update:

1. Acquire all four official structured sources over verified HTTPS under the applicable authorization. Preserve exact bytes and actual individual acquisition times. Do not follow embedded links.
2. Review schema/status/footnote changes and positive/blocking coverage. Stop on unknown, contradictory or unsupported input; do not replace the policy with a guessed denylist.
3. Produce a new explicitly reviewed policy version/manifest with fresh provenance and annotation hashes; derive the start/cutoff from actual acquisitions. Changing only a date is not renewal.
4. Run the offline normalizer, all boundary/failure tests and repository checks, then independent review of source bytes, normalization and compatibility. No network or data mutation is needed at runtime.

The [offline normalizer](../scripts/build-image-address-policy.ts) reads only fixed public snapshot/manifest paths and the generated module. Reads reject symlinks and nonregular/empty/oversized files. It accepts at most 1 MiB per file and 4,096 combined rows/prefixes. UTF-8/XML/schema/depth, unsafe DTD/entity, missing/duplicate/contradictory entries, invalid dates, unknown flags/statuses, note anchors, hashes and row budgets are checked before output. Padded IANA `001/8` and the one comma-separated special row are supported **source formats**, not relaxed runtime syntax.

```sh
node --import tsx scripts/build-image-address-policy.ts --check
node --import tsx scripts/build-image-address-policy.ts --write
```

`--check` verifies byte-identical regeneration; `--write` validates everything before atomically replacing only the generated module. Neither mode fetches sources or renews a manifest. Invalid arguments/failure produce a fixed JSON category and nonzero exit. No partial generated output is accepted.

This public-data review cutoff changes no accepted media report/offboarding term or deadline. There is no purge, automatic retention renewal, safety-history erasure or fence release.

## Verification and remaining gates

The new suites use numeric fixtures, checked-in public bytes and external-I/O guards. Coverage includes every pinned prefix's first/last/adjacent addresses; independent bit-string reference classification; positive controls tied to source rows; nested exceptions; malformed/family/embedded inputs; exact acquisition/cutoff boundaries; version/data/source corruption; unsupported XML/status/notes; source budgets; deterministic regeneration and bounded diagnostics. Existing 184 model regressions remain unchanged. Actual counts/exits and exact-head CI belong in the PR/private records.

No running code imports this classifier. The pure format helpers and generated data are used only by the classifier, offline build tool and their tests. Tests establish conformity to the pinned conservative policy, not actual DNS, socket peer/TLS, anonymous access, exact on-wire target, image bytes/decode/visual identity, eBay compatibility or ownership.

Next separately reviewed gates remain: durable one-use diagnostic intent/outcome accounting; a disabled anonymous client that verifies all DNS answers, pins the actual peer and verifies TLS before HTTP bytes; an internal fresh-response handoff preserving opaque target bytes; bounded image verification; and explicit commit/content/request-budget approval for any experiment. The original capture stays unknown/unassociated, both fences/report remain intact and its 3/3 budget is exhausted. No old URL can be reconstructed. Usable receipt admission and Inventory policy are separate work.

The [milestone1 safe downloader](ebay-safe-image-downloader.md) now supplies an unwired resolver/pinned-TLS/anonymous-HTTP boundary with synthetic/local wire evidence. It does not grant request authority, wire this component, prove provider compatibility or admit media; milestone2 composition remains separate.
