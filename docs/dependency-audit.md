# Dependency audit and bounded remediation

Reviewed November 17, 2026, from development merge `341ed1b702b1c7e3b7fcdc9f984b6f9c557a139d`. This is dependency maintenance, not public-launch approval or real-provider acceptance. Stage 9B remains In Progress; real EPS transport and receipt admission remain disabled.

## Advisory and installed-copy inventory

The initial `npm audit --json` exited **1**, reporting **17 propagated package entries: 13 moderate and four high**, from three underlying advisories. After the changes below, both the full audit and `npm audit --omit=dev --json` still exit **1**, reporting **four moderate entries, no high entries**. Audit success is not claimed. These counts describe npm's dependency inventory, not all embedded code or an exploit count.

| Advisory | Affected / first patched | Installed copies before this change |
| --- | --- | --- |
| [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | `<4.6.6` / `4.6.6` | `@vercel/cli-config/node_modules/zod@4.1.11`, plus **4.1.11 embedded in CLI-config's published main entry**. Direct/application/auth Zod is 4.6.7. Next's separate embedded pre-v4 implementation requires the qualification below. |
| [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `>=7.0.0 <11.0.1` / `11.0.1` | One deduplicated `minimatch@10.2.6`, resolved by ESLint, config-array and TypeScript ESLint's typescript-estree. |
| [esbuild GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99) | `<=0.24.2` / `0.25.0` | `@esbuild-kit/core-utils/node_modules/esbuild@0.18.20`. Other installed copies, 0.25.12 through Drizzle and 0.28.2 through tsx/Vite, are outside this advisory's affected range. |

## Zod: production dependency, narrower observed input boundary

The path is `@vercel/blob@2.8.2 → @vercel/oidc@3.8.10 → @vercel/cli-config@0.3.1 → zod@4.1.11`. It is a production dependency, not merely a developer command. The [private storage adapter](../src/infrastructure/storage/vercelBlobImageStorage.ts) calls the SDK server-side for signing, metadata, private reads and deletion. Blob's `resolveBlobAuth` tries OIDC before the environment-token fallback; merely configuring that fallback does **not** establish that CLI discovery is unreachable. OIDC's `token.js`/`token-util.js` can read local CLI configuration during refresh. Its main entry also loads the bundled validator.

The inspected CLI auth/global configuration schemas contain scalar/object/union fields and passthrough keys, not array/map/set constraints. No path was found from listing fields, image bytes or browser-supplied data into the affected constrained-collection parsing. Local configuration and provider/CLI refresh paths are a different trust boundary. No application memory-exhaustion exploit was demonstrated, and no real refresh/provider test was performed. The [upstream fix](https://github.com/colinhacks/zod/commit/a0ebf97) checks collection-size bounds before visiting elements; it is not a universal input/memory cap for unconstrained schemas.

### Selected correction

Stable OIDC 3 ends at 3.8.10 and pins CLI-config **exactly** to 0.3.1. Blob's newer 2.9.0 still requests OIDC `^3.6.1`; upgrading Blob alone would not repair this path. OIDC 4/CLI-config 0.4 would cross major/pre-1.0 minor boundaries and is unnecessary here.

A **single version-scoped override** replaces only `@vercel/oidc@3.8.10 → @vercel/cli-config` with [published CLI-config 0.3.8](https://registry.npmjs.org/@vercel/cli-config/0.3.8). This intentionally replaces the parent's exact pin, within CLI-config's existing 0.3 patch line. It is not a global Zod or OIDC override. The patched artifact declares `zod: ^4.6.6`, resolves to the existing 4.6.7, and **also embeds 4.6.7**. A dependency-only Zod override would have left the old embedded implementation behind.

Comparison found no removed exports. Synthetic auth/global configuration, passthrough fields, token-source stripping, storage modes and malformed-input rejection remain compatible. An array built from the actual bundled exported schema visited all 16 getter-backed elements before the patch; the patched entry rejects the same oversized constrained collection with **zero element reads**. Exact-length and valid/invalid-element controls cover the same boundary without a large denial-of-service payload.

Remove this override once Blob's supported OIDC dependency requires a patched CLI-config itself. Its exact parent-version selector deliberately does not force this child into future OIDC versions; re-review that edge when the parent changes. No Blob SDK, application Zod, auth library or real OAuth profile is upgraded here.

### Embedded framework qualification — unresolved

Next.js 16.4.6 separately ships `next/dist/compiled/zod/index.cjs`, with a pre-v4 API and no version in its package metadata. A bounded probe confirms that `.max(1)` rejects a 16-element array **but still visits all 16 elements**. Next configuration and middleware-segment schemas import that module. The compiled MCP SDK imports it as well; `next/dist/compiled/next-devtools/index.js` contains another embedded pre-v4 implementation, whose exact version/behavior is not independently established here.

These artifacts are outside the npm-managed Zod edges and are not cleared by this override or by zero high audit entries. The advisory's broad affected range and the continued traversal warrant separate framework/maintainer review. Attacker-controlled production reachability and practical resource exhaustion have **not** been demonstrated. Project configuration is normally repository-controlled; that observation does not prove every framework/development surface safe. The current stable Next release remains 16.4.6. Do not monkey-patch its compiled validator, substitute Zod 4 into a Zod 3 API, or claim the underlying Zod concern is fully closed. Review an upstream correction or a focused deployment/input-boundary assessment separately.

## minimatch: use the patched tooling owners

The three dependency paths are `eslint → minimatch`, `eslint → @eslint/config-array → minimatch`, and `typescript-eslint → @typescript-eslint/typescript-estree → minimatch`; the other propagated TypeScript ESLint entries share that subtree. Inputs are lint CLI/configuration globs and optional TypeScript project-selection globs, not listing/image data. The inspected callers use `{dot: true}` without `optimizationLevel`, whose default is 1; this advisory's amplification needs level 2 or above. No application runtime import or matching lower-trust application source was found. This bounds the observed exposure, rather than dismissing tooling categorically.

[ESLint 10.15.0](https://github.com/eslint/eslint/releases/tag/v10.15.0) and [TypeScript ESLint 8.73.0](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.73.0) are supported minor updates within the existing root majors. They and config-array 0.23.6 accept minimatch `^11.0.5`; the lockfile resolves **11.0.9** for all three owners. Node 24 and the existing TypeScript version satisfy their engines/peers. No cross-major minimatch override, lint-rule relaxation, configuration rewrite or unrelated upgrade is used. Lockfile changes to their internal packages, ignore/semver/brace-expansion and the new matcher helper belong to that dependency closure.

Regression checks resolve minimatch from each actual owner, verify that a small explicit expansion cap rejects the `**/..` amplification case, and retain normal brace/dot-file matching controls. Programmatic ESLint comparison preserves the same selection and zero messages for all **242 pre-existing files**; the new regression file is additional. This is more specific than only testing a version number.

## esbuild: retained, with explicit remaining decision

The separate [retained Drizzle/esbuild assessment](drizzle-esbuild-exposure.md) adds fresh production-install, normal-build and executed-runtime evidence against this unmerged PR #22 baseline. It leaves packages unchanged and the advisory unresolved; installed presence, bundling, execution and vulnerable serving behavior are reported separately.

The unresolved path is `drizzle-kit@0.31.11 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2 → esbuild@0.18.20`. The audit's four moderate entries are exactly **drizzle-kit, @esbuild-kit/esm-loader, @esbuild-kit/core-utils and esbuild**. Their installed versions are unchanged.

Core-utils invokes `transform`/`transformSync`, not the affected esbuild development-server API. The current Drizzle CLI registers bundled tsx rather than importing this legacy loader. Its Studio `serve({fetch: app.fetch, ...})` is a separate Hono server, not esbuild's serve implementation. No project esbuild `serve` usage or route carrying browser data into it was found. No server/exploit was started to test this advisory. Loopback binding by itself would **not** mitigate the advisory's malicious-website/CORS scenario if an affected serve path were introduced.

Do not call the affected package absent from production: a fresh isolated **`npm ci --omit=dev --ignore-scripts`** succeeds and still installs this chain through Better Auth 1.7.12's optional Drizzle peer graph. The lock entries are `devOptional`, not strictly `dev`. A production-install graph is different from a deployed/loaded route artifact; review both. Skipping install scripts for this graph probe does not prove that directory is a runnable native-image deployment.

The fresh normal production build has **18 NFT tracing manifests**. They contain no direct file entries for CLI-config, legacy esbuild, minimatch or the named Next compiled-Zod/devtools directories. However, application server chunks **do contain CLI-config and OIDC code**, demonstrating why absence of a package pathname in a trace is not proof of absence: dependencies can be bundled. The chunk with CLI-config includes Zod version 4.6.7; no legacy-loader or pre-v4 Zod signature was found in the inspected application chunks. This is a bounded build-artifact observation, not proof that the complete Next server installation never loads its compiled validators, nor evidence about a deployed system. No deployment was made.

Stable Drizzle Kit remains 0.31.11, core-utils requires `~0.18.20`, and esbuild's [0.25.0 release](https://github.com/evanw/esbuild/releases/tag/v0.25.0) is a breaking pre-1.0 update. The audit suggests downgrading Drizzle to 0.18.1; that is not a safe fix for this repository's migration/tooling contract. Leave this dependency unchanged. Separate options are an upstream stable loader removal, a deliberately reviewed loader/esbuild migration, or production packaging that excludes genuinely unused optional tooling. Do not broadly omit optional dependencies (native image packages also rely on them) or force an esbuild override to make audit green.

## Verification and limits

[Compatibility regressions](../src/infrastructure/storage/dependencyCompatibility.test.ts) use only pure config parsers and explicit synthetic SDK credentials with an in-memory Undici dispatcher that disables network connections. They do not validate implicit OIDC discovery, CLI credential I/O, refresh, or a real Blob request. Existing adapter tests, authentication, private-image retention/cleanup and media-action/fence regressions remain required. All database checks use the separate disposable test database, never development migrations.

Reproduce with `npm ci`, `npm ls esbuild minimatch zod --all`, `npm audit --json`, `npm audit --omit=dev --json`, the focused regression file, and the [full repository check](../README.md#validation). An audit exit **1** is expected while the esbuild entries remain. Full local aggregate exit codes, actual test counts, fresh production-route tracing and exact-head CI are recorded separately in the maintenance PR; none substitutes for the others. This work is not a comprehensive audit of every vendored library or every future deployment.
