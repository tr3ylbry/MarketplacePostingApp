# Next.js embedded Zod assessment

Reviewed November 17, 2026, against **unmerged PR #22 head `c13da7b3bd3455fd6b012d30a0e54dfec5f70244`** in a separate isolated checkout. This is a documentation-only follow-up, not a new development merge. Packages, framework files, application routes, OAuth, image handling and media fences are unchanged. Stage 9B remains In Progress; real EPS transport/admission stay disabled.

**Verdict: unresolved overall.** Production mode demonstrably excludes the examined development HTTP endpoints. Development requests can reach the older validator, subject to specific controls and remaining gaps. Parser traversal, reachable parsing and practical memory exhaustion are not interchangeable claims.

## Implementation and upstream provenance

The current [stable Next package](https://registry.npmjs.org/next/latest) remains **16.4.6**. Its [exact release package source](https://raw.githubusercontent.com/vercel/next.js/v16.4.6/packages/next/package.json) pins **Zod 3.25.76** and **MCP SDK 1.18.1**. The [release compilation tasks](https://raw.githubusercontent.com/vercel/next.js/v16.4.6/packages/next/taskfile.js) bundle Zod into `next/dist/compiled/zod` and externalize the compiled MCP SDK's Zod imports to it. The [manifest generator](https://raw.githubusercontent.com/vercel/next.js/v16.4.6/packages/next/taskfile-ncc.js) deliberately omits a version field. The installed compiled Zod file's SHA-256 matches the exact release tag's checked-in file. These are build/artifact provenance, not an exported runtime version or an inference from API names alone.

There are distinct surfaces:

| Implementation | Inputs and use |
| --- | --- |
| `next/dist/compiled/zod/index.cjs` | Next build/startup configuration and route-segment schemas; also compiled MCP tools/protocol and server-side DevTools configuration. |
| Compiled MCP SDK `server/mcp.js` | Imports the preceding validator; it is not an independently patched Zod copy. The registered initialize parser includes optional, unbounded `clientInfo.icons`. Next's own reviewed tool arguments are scalar/string fields. |
| `next/dist/compiled/next-devtools/index.js` | Another bundled pre-v4 implementation in the browser development bundle. Source dev-entry selection and server shim aliases restrict its ordinary inclusion to development; it has no independent runtime version field. No separate byte-for-byte version assertion is made for that browser bundle. |
| Application `zod@4.6.7` | Ordinary application/auth schemas and PR #22's repaired CLI-config bundle. This does **not** replace Next's compiled implementations. |

The [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) lists `<4.6.6`, but its linked [fix](https://github.com/colinhacks/zod/commit/a0ebf97) changes v4 array/map/set size checks. It does not establish a compatible Zod 3 replacement, a backport for Next's bundle, or an element cap for unbounded arrays. No supported stable Next correction was found in the checked release. A global Zod override, Zod 3→4 substitution, or hand edit to compiled framework files would not be a justified compatible fix.

## Development request boundaries

The source path is the raw Node listener → development router origin gate → hot-reloader middleware → framework handler. These run **before** ordinary route resolution and its proxy-body buffering. Application image/media limits do not bound these handlers.

### MCP

MCP is enabled by default in Next's config and registered by development hot reloaders. The [MCP middleware](https://raw.githubusercontent.com/vercel/next.js/v16.4.6/packages/next/src/server/mcp/get-mcp-middleware.ts) handles `/_next/mcp` and invokes `parseBody(req, 1024 * 1024)` before the compiled SDK: **1,048,576 bytes**, not an element or issue-count limit. Next's registered tools are not invoked by the initialize probes below. A separate 32-byte control of the same body parser accepted 14-byte JSON and rejected 52-byte JSON with **413**, without sending a large payload.

### DevTools configuration

The [DevTools middleware](https://raw.githubusercontent.com/vercel/next.js/v16.4.6/packages/next/src/next-devtools/server/devtools-config-middleware.ts) handles POST `/__nextjs_devtools_config`, collects body chunks, concatenates/parses JSON, then validates an object/record/scalar schema. **No preceding body-size cap was found in the inspected standard chain.** In the installed source, `router-server.js:401` runs the hot reloader before route resolution at 407; the proxy-body limit is applied later in `resolve-routes.js:125–126`. That later limit does not cover a request already consumed by this handler. Invalid panel records produce validation errors, not valid configuration writes. Only isolated synthetic invalid inputs were sent; no real developer settings were modified.

### Access controls are specific

Both repository development commands bind **127.0.0.1**. [Next's cross-site development gate](https://raw.githubusercontent.com/vercel/next.js/v16.4.6/packages/next/src/server/lib/router-utils/block-cross-site-dev.ts) protects `/_next` and `/__nextjs` prefixes and rejects foreign/opaque Origins. An earlier cross-site `no-cors` branch checks Referer even without Origin; outside that branch, absent-Origin requests are permitted. The configured hostname joins the **Origin/Referer** allowlist, not a request Host-header authentication check. This helps against browser cross-site requests; it is not authentication or a resource quota for arbitrary local clients. The SDK's own DNS-rebinding option is not enabled by Next's shown transport constructor. That fact alone does not demonstrate a browser bypass of the outer gate.

HMR upgrades also pass through the origin gate. The inspected WebSocket setup uses `noServer: true` and the compiled ws default 100 MiB `maxPayload`; that is a separate WebSocket byte bound, not a limit on these HTTP bodies, browser validator issue counts or total process memory. No WebSocket or large-payload exhaustion experiment was run.

## Bounded observed behavior

| Probe/control | Actual result |
| --- | --- |
| Compiled Zod `.max(1)` and `.length(1)`, 16 getter-backed strings | Rejected, **16 element reads** in each case. One valid string accepted; wrong element type rejected. |
| Actual DevTools schema, legitimate theme/panel dimensions | Accepted. |
| 16 invalid DevTools panel records | Rejected with **16 issues**; an array in place of the record is rejected with one issue. |
| Actual compiled SDK initialize handler, one valid synthetic icon | Accepted, protocol `2025-06-18`. |
| Same initialize handler, 16 invalid icons | Rejected with **16 issues**. This is an unbounded schema, not proof that the constrained-size fix applies to it. |
| Loopback development, foreign-origin MCP/config POST | **403 / 403**. |
| Loopback development, valid MCP initialize | **200**, JSON-RPC response. No tool invocation. |
| Loopback development, 16 invalid icons / panels over HTTP | **200 JSON-RPC error / 400** respectively. HTTP 200 is not authorization or parser success. |
| Normal production build, equivalent MCP/config requests | **404** for all examined requests: handlers are not registered in the production path. |

The payloads are synthetic and small. No authorization codes, credentials, provider data, private images or account details were supplied or printed. No practical memory exhaustion, RSS ceiling, concurrent-load safety, hostile native-client bound or universally safe deployment is claimed.

## Production is a separate observation

The installed router creates the development bundler only under `opts.dev`; the [hot-reloader source](https://raw.githubusercontent.com/vercel/next.js/v16.4.6/packages/next/src/server/dev/hot-reloader-turbopack.ts) registers these handlers in that path. Fresh loopback production startup returned sign-in **200**, unauthenticated inventory/integration **307** redirects, and all probed development endpoints **404**. V8 coverage nevertheless confirms **compiled Zod executes during normal production startup/request handling**; configuration validation uses repository-controlled inputs and loads the configuration module before validating it. Loaded code is not proof of a network path to its affected array parser.

The fresh shared-baseline production build's 18 NFT manifests and server/client chunks were inspected. No pre-v4 validator signature was identified in application chunks, but compiled Zod was still observed at runtime. Thus trace/path/signature absence cannot establish complete absence. Runtime coverage must include settled child processes and bundled-function attribution; the HTTP MCP response is direct evidence of handler execution even where a compiled SDK filename is not separately represented in coverage. No production deployment or real authenticated provider request was tested.

## Reproduce without an exhaustion payload

In an isolated checkout with the exact lockfile, this imports only the published validator and demonstrates its bounded behavior with legitimate controls; it does not load application configuration or contact any server:

```sh
node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { z } = require('next/dist/compiled/zod');
for (const bound of ['max', 'length']) {
  let reads = 0;
  const input = Array(16);
  for (let i = 0; i < input.length; i++)
    Object.defineProperty(input, i, { get() { reads++; return 'synthetic'; } });
  const schema = z.string().array()[bound](1);
  console.log({ bound, rejected: !schema.safeParse(input).success, reads,
    valid: schema.safeParse(['synthetic']).success,
    invalidRejected: !schema.safeParse([42]).success });
}
JS
```

Protocol probes used the compiled `McpServer`'s registered initialize parser directly and small HTTP initialize requests, never tools. This release-specific diagnostic inspection is not a product integration API. Development/production servers were isolated, synthetic-configured, listener-verified and stopped after testing. Do not repeat these probes against a personal server containing credentials or private data.

## Next decision

The shared unchanged runtime passed a fresh full `npm run check` with **exit 0**, **771 unit/component, 334 PostgreSQL integration and 15 Chromium workflows**, plus lint/typecheck/build. Full and production-only npm audits remain **exit 1**, four moderate Drizzle/esbuild entries, zero high; those reports do not inventory this embedded code. This follow-up changes no packages or application behavior and must remain draft/unmerged.

Reassess a supported Next release or a compatible vendor backport with the same probes and input-boundary review. The narrowly scoped upstream question is how Next will bound DevTools configuration HTTP input and protocol collection/error growth while retaining its Zod 3 contract. Separately deciding to disable unused MCP could remove one development endpoint, but would not fix compiled Zod or DevTools configuration; it is not silently done here. No support message is sent. Production attacker-controlled reachability and practical exhaustion remain unresolved, and the complete Zod concern is not closed.
