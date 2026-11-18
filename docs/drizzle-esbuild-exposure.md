# Retained Drizzle/esbuild assessment

Reviewed November 17, 2026, against **unmerged PR #22 head `c13da7b3bd3455fd6b012d30a0e54dfec5f70244`**, not a new development merge. This documentation-only follow-up depends on that reviewed dependency graph. It changes no packages, migration capabilities, application code or provider configuration. Stage 9B remains In Progress; real EPS transport/admission stay disabled.

**Verdict: unresolved dependency advisory.** The package is installed; the vulnerable serving behavior was not found on the examined application paths. Those are separate findings, not a claim that every future use is safe.

## Supported versions and remediation decision

The [esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99) affects `<=0.24.2`; `0.25.0` fixes its development-server CORS behavior. Loopback binding alone does not fix that issue: a malicious website could read an affected local serve endpoint. The [0.25.0 release](https://github.com/evanw/esbuild/releases/tag/v0.25.0) is a breaking pre-1.0 update.

Current official registry declarations were rechecked:

| Package | Latest stable / required child |
| --- | --- |
| [drizzle-kit](https://registry.npmjs.org/drizzle-kit/latest) | `0.31.11`; `@esbuild-kit/esm-loader: ^2.5.5`, own `esbuild: ^0.25.4`, `tsx: ^4.21.0` |
| [esm-loader](https://registry.npmjs.org/@esbuild-kit/esm-loader/latest) | `2.6.5`; `@esbuild-kit/core-utils: ^3.3.2` |
| [core-utils](https://registry.npmjs.org/@esbuild-kit/core-utils/latest) | `3.3.2`; `esbuild: ~0.18.20` |

The affected leaf is **esbuild 0.18.20**. Drizzle's separate 0.25.12 and tsx/Vite's 0.28.2 copies are outside this advisory. There is no current stable update in the owning legacy range that removes or patches the affected chain. Do not force 0.25+ into `~0.18.20`, follow npm's suggested Drizzle 0.18.1 downgrade, remove migration tooling, or broadly omit optional dependencies used by native images. A future stable upstream loader removal is preferred; a loader migration or narrower production-packaging design needs separate review.

A second disposable install tested the supported `npm ci --omit=dev --omit=peer --ignore-scripts` option on **Node 24.14.1 / npm 11.16.0**. It exited 0 but **still installed Drizzle Kit/core-utils and retained all four moderate audit entries**; its audit exited 1. A generated 2×1 alpha-PNG native Sharp control passed and its platform binary remained installed. Thus peer omission is not a demonstrated remedy for this lockfile and is not adopted. A failed bare `require.resolve` on an export-restricted native package was not treated as proof the package was absent; its directory/binary and actual image operation were checked instead.

## Installed, bundled, loaded and reachable

| Boundary | Evidence | Limit of the evidence |
| --- | --- | --- |
| Installed | A fresh disposable `npm ci --omit=dev --ignore-scripts` exited 0 and installed `better-auth@1.7.12 → drizzle-kit@0.31.11 → esm-loader@2.6.5 → core-utils@3.3.2 → esbuild@0.18.20`. | Better Auth's optional peer graph affects npm's installation. `devOptional` does not mean absent from production. Skipping scripts is a graph probe, not a runnable native deployment proof. |
| Bundled/traced | A fresh normal production build and its 18 NFT manifests were inspected alongside server chunks. No legacy-loader/esbuild-0.18 path/signature was identified in application chunks. | Modules can be bundled without their original pathname; absence from a trace or a signature search cannot prove absence from the complete server installation. |
| Loaded/executed | V8 coverage of isolated loopback production startup, sign-in, unauthenticated protected routes and the bounded framework endpoint probes recorded **zero executed script entries** for Drizzle Kit, esm-loader and the legacy esbuild path. | This covers those requests only, not every authenticated action, optional command, deployment or future code path. No real provider was called. |
| Positive instrumentation control | An explicit isolated core-utils sync/async TypeScript transform loaded esbuild 0.18.20 and appeared in V8 coverage. Valid output evaluated to the expected constant; malformed TypeScript failed. Persistent/disk cache was disabled; the process still has an in-memory cache. | It demonstrates the detector can observe that package when used; it does not prove a patched esbuild version is compatible or test a serving exploit. |
| Vulnerable behavior | Inspected core-utils uses `transform`/`transformSync`, not esbuild's serve API. No application import/call supplying input to that serve API was found. | Installed presence is real; attacker-controlled reachability of the affected serving behavior remains unestablished. |

The installed Drizzle `bin.cjs` registers bundled tsx in `ensureTsxRegistered` (lines 15258–15275); it does not literally import the installed legacy loader. Its Studio `serve({fetch: app.fetch, ...})` at line 90159 is the Hono Node server, not `esbuild.serve`. Better Auth declares Drizzle Kit an optional peer; no Drizzle Kit import was found in the inspected Better Auth/Drizzle-adapter distributed runtime JS. These source observations explain the measured path, without turning an optional peer into proof of runtime execution or non-execution.

The production smoke returned sign-in **200** and unauthenticated inventory/integration **307** redirects. All framework development endpoints probed returned **404** in production. Listener inspection verified `127.0.0.1` only; temporary servers stopped. No authenticated storage/provider operation or development migration was attempted.

## Small reproducible controls

In an isolated checkout with the exact reviewed lockfile, the following exercises the installed legacy transform without starting a server, connecting to a database or reading credentials:

```sh
ESBK_DISABLE_CACHE=1 node --input-type=module <<'JS'
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const core = require('@esbuild-kit/core-utils');
for (const compile of [core.transformSync, core.transform]) {
  const result = await compile('export const value: number = 7;',
    '/synthetic-fixture.cts', { format: 'cjs' });
  const module = { exports: {} };
  vm.runInNewContext(result.code, { module, exports: module.exports }, { timeout: 1000 });
  assert.equal(module.exports.value, 7);
}
assert.throws(() => core.transformSync('const = ;', '/synthetic-invalid.cts'));
console.log('bounded transform controls passed');
JS
```

For runtime loading, `NODE_V8_COVERAGE` records actual executed scripts. Start only an isolated, synthetic-configured normal production build bound to `127.0.0.1`, exercise the small unauthenticated routes above, stop the complete owned process group, then collect coverage **after all children settle**. Compare against the explicit transform positive control. Do not infer no execution from a package-name grep alone; bundled modules and child processes require separate attribution.

## Validation and next decision

The fresh shared-baseline `npm run check` **actually exited 0**: lint/typecheck/build, **771 unit/component, 334 PostgreSQL integration and 15 Chromium workflows**, using only the dedicated disposable database and fake providers. No package/source correction was applied, so this is baseline preservation evidence. Full and production-only npm audits still exit **1** with the same **four moderate entries, zero high**: Drizzle Kit, esm-loader, core-utils and esbuild. The separate embedded-framework Zod question remains outside npm audit; it is not cleared by these counts.

Keep this follow-up draft and unmerged. The next dependency decision is to reassess a stable Drizzle/loader release that removes the legacy path, or separately approve a compatibility-tested loader/production-packaging change that preserves migrations and native image dependencies. Until then, retain the advisory rather than force a green audit. This assessment does not authorize real provider operations, EPS transport or deployment.
