# Next.js security maintenance

Reviewed on November 16, 2026. This is framework maintenance only; it does not enable a marketplace operation or constitute a public-launch security review.

## Version and compatibility

The previous lockfile and installation both used **Next.js 16.4.2**. The November 3 [security release 16.4.5](https://github.com/vercel/next.js/releases/tag/v16.4.5) fixes seven published moderate advisories. The current official [latest stable release](https://api.github.com/repos/vercel/next.js/releases/latest) and npm `latest` tag were independently checked: both identify **16.4.6**, released November 9. Its [release notes](https://github.com/vercel/next.js/releases/tag/v16.4.6) describe stable bug-fix backports, including response compression and development garbage collection; it is not the 16.5 canary feature line.

The manifest now requires `next: ^16.4.6`; the lockfile resolves exactly 16.4.6. Only Next.js, `@next/env` and its eight platform-specific optional SWC packages change. Existing React/React DOM 19.3.1 satisfy the target's published peer range (`^19.0.0`); Node 24 satisfies `>=20.9.0`. React, types, Sharp, auth, database tooling and other packages are unchanged. This patch within 16.4 needs no application migration/codemod or configuration workaround. See the official [upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) for a future API/version migration rather than applying unrelated codemods here.

## Dependency exposure versus application reachability

Version 16.4.2 falls in all seven published affected ranges. That establishes an affected dependency, not an observed exploit of this application. The following is a source/configuration assessment, not exploit testing:

| Official advisory | Required behavior and application observation |
| --- | --- |
| [GHSA-mfr8-8qww-v76h](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h) | Root-param-dependent `use cache` called directly and through `unstable_cache`. Neither API pattern is present in application source. |
| [GHSA-vc7v-qv4w-wrv8](https://github.com/vercel/next.js/security/advisories/GHSA-vc7v-qv4w-wrv8) | Nested Cache Components with delayed root-param dependencies. Cache Components are not enabled and application source contains no `use cache` functions. |
| [GHSA-vvgp-ww4w-46vf](https://github.com/vercel/next.js/security/advisories/GHSA-vvgp-ww4w-46vf) | Shared fallback-shell poisoning requires Cache Components and specific prerender/placeholder conditions. Cache Components are not enabled. |
| [GHSA-rhh4-g77r-r9qj](https://github.com/vercel/next.js/security/advisories/GHSA-rhh4-g77r-r9qj) | Binary arguments to `use cache` can collide across users. No such cache boundary is used for image bytes or other application data. |
| [GHSA-pc58-hwjq-p385](https://github.com/vercel/next.js/security/advisories/GHSA-pc58-hwjq-p385) | Unchanged fetched responses behind a pipelining HTTP/1.1 reverse proxy can have inconsistent framing. Application handlers construct responses; the private-image endpoint returns an authenticated redirect, not an upstream body. The documented local setup has no reverse proxy. |
| [GHSA-7qx7-33qx-rqx2](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2) | The self-hosted image optimizer can bypass disabled SVG processing. The gallery uses `Image unoptimized` with an owner-scoped read endpoint, and uploads reject SVG. That is not proof the framework optimizer endpoint is disabled or unreachable; patching remains necessary. |
| [GHSA-f3mh-rxg3-f5g2](https://github.com/vercel/next.js/security/advisories/GHSA-f3mh-rxg3-f5g2) | Sensitive cookies set through `NextResponse` in Edge routes can appear in a public header. Application routes use the default Node runtime; none opts into Edge. |

The patch removes the known affected version without changing these security boundaries. No exploit, public exposure or blanket absence of vulnerabilities is claimed. Reassess reachability if caching, image optimization, Edge runtime or proxying changes.

## Startup notices and verification

Earlier builds on 16.4.2 sometimes stopped with `SecurityFatalError` before normal/test server startup. The installed framework's agent upgrade assessment checked npm advisory ranges; its normal retry allowance was keyed by project, version, command and notice kind and lasted five minutes. An interrupted command's exit 1 never became a successful aggregate run merely because a later individual command passed. Those outcomes remain recorded in prior PRs/Notion history.

The 16.4.6 framework security assessment returned `affected: false`, `status: unaffected` against the npm advisory endpoint. No warning-policy, dismissal, retry-cache or security-check configuration is changed by this maintenance. Full verification must record the actual aggregate exit and check normal and isolated test builds for security notices; an unavailable advisory service must be reported separately, not called a clean assessment.

Use the [repository validation procedure](../README.md#validation), with only the dedicated disposable test database and fake storage/providers. Focused authentication/callback/gallery tests exercise the framework-facing paths, while the real-media admission and persistence regressions retain the consumed-action/reclamation guarantees. The full aggregate includes lint, typecheck, all unit/component and PostgreSQL tests, production build and Chromium workflows. Exact counts, exit codes and final-head CI belong in the maintenance PR. No real seller consent, provider call or development migration is part of verification.

The local maintenance validation's first full aggregate invocation exited **0**, without the earlier security notice in either the normal or isolated test build. A separate isolated development startup also returned the sign-in page over a verified `127.0.0.1`-only listener without a security notice; that temporary server was stopped. This verifies the local startup/check behavior, not real OAuth or provider acceptance.

## Remaining audit findings

Explicit npm audits before and after this patch exited **1** because unrelated advisories remain. The full audit snapshot changed from **18 entries (14 moderate, four high)** to **17 (13 moderate, four high)**; the Next.js entry disappeared. These are propagated package entries, not 17 independent vulnerabilities. The remaining underlying reports are esbuild [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), minimatch [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), and Zod [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

The esbuild chain is Drizzle Kit's legacy development loader. Minimatch propagates through lint/tooling dependencies. The high-severity constrained-collection memory report propagates through an older nested Zod in the Vercel Blob/OIDC/CLI-config chain; the application's direct Zod is newer, but that does not clear the separate nested dependency. Do not describe every remaining finding as development-only or the whole dependency tree as clean. Their complete application reachability and compatible remediation require separate review. No unrelated upgrade, override, forced audit fix or suggested breaking downgrade is included here. Keep development tooling local and review the production dependency artifact before any public launch.

## Review gate

[Maintenance PR #20](https://github.com/tr3ylbry/MarketplacePostingApp/pull/20) was subsequently owner-approved and merged at `233c7a7c9bb6dfc6839b6353ee4e4fcd29dd0e77`, with the reviewed tree unchanged. [Actual merge-push Validate](https://github.com/tr3ylbry/MarketplacePostingApp/actions/runs/44017508932) passed lint/typecheck/build, 708 unit/component, 287 PostgreSQL integration and 15 Chromium workflows before the separate fake-only branch was created. CI ran individual checks; the local maintenance aggregate exit 0 above is separate evidence. The [fake-only workflow](ebay-fake-media-workflow.md) is now implemented for draft-PR review and must not be merged automatically. Stage 9B remains In Progress; real EPS transport and real receipt admission remain disabled. Remaining unrelated audit findings above are not bundled into that work.
