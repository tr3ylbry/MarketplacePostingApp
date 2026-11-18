// @vitest-environment node
import { createRequire } from "node:module";
import { head } from "@vercel/blob";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import type { z } from "zod";

// Only pure schema functions and explicit synthetic SDK credentials. Never use
// the SDK's implicit OIDC/CLI discovery or refresh path in this test.
const require = createRequire(import.meta.url);
const oidcRequire = createRequire(require.resolve("@vercel/oidc"));
const config = oidcRequire("@vercel/cli-config") as typeof import("@vercel/cli-config");

it.each(["file", "keyring", "auto"])("preserves synthetic CLI config parsing and passthrough for %s storage", credStorage => {
  expect(config.parseGlobalConfig({ credStorage, telemetry: { enabled: false }, fixture: { retained: true } }))
    .toMatchObject({ credStorage, telemetry: { enabled: false }, fixture: { retained: true } });
  expect(config.parseAuthConfig({ token: "synthetic", refreshToken: "synthetic-refresh", expiresAt: 2_000_000_000, fixture: true }))
    .toMatchObject({ token: "synthetic", expiresAt: 2_000_000_000, fixture: true });
  expect(config.parseAuthFileConfig({ tokenSource: "env", token: "synthetic", fixture: true }))
    .toEqual({ token: "synthetic", fixture: true });
});
it("continues to reject malformed CLI config without reading any config files", () => {
  expect(() => config.parseAuthConfig({ expiresAt: "invalid" })).toThrow();
  expect(() => config.parseGlobalConfig({ credStorage: "unrecognized" })).toThrow();
  expect(() => config.parseGlobalConfig({ telemetry: { enabled: "invalid" } })).toThrow();
});
it.each(["max", "length"] as const)("checks the actual bundled Zod %s bound before reading oversized collection elements", bound => {
  // The published entry bundles Zod: resolving only its external dependency
  // would miss a stale bundled copy. Derive a probe from its exported schema.
  const object = config.authConfigSchema as z.ZodObject<{ token: z.ZodOptional<z.ZodString> }>;
  const array = object.shape.token.unwrap().array()[bound](1);
  let reads = 0;
  const oversized = Array<string>(16);
  for (let i = 0; i < oversized.length; i++) Object.defineProperty(oversized, i, { get() { reads++; return "synthetic"; } });
  expect(array.safeParse(oversized).success).toBe(false);
  expect(reads).toBe(0);
  expect(array.safeParse(["synthetic"]).success).toBe(true);
  expect(array.safeParse([42]).success).toBe(false);
});

it.each(["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree"])("bounds globparts expansion in the minimatch resolved by %s", owner => {
  const ownerRequire = createRequire(require.resolve(owner));
  const { Minimatch } = ownerRequire("minimatch") as typeof import("minimatch");
  // A small explicit expansion cap reproduces the missing guard without a
  // memory-exhaustion payload or timing-sensitive test.
  expect(() => new Minimatch("a/**/../b/c/**/../d/e/**/../f/g/end", { optimizationLevel: 2, braceExpandMax: 4 })).toThrow(RangeError);
  const normal = new Minimatch("src/**/*.{ts,tsx}", { dot: true });
  expect(normal.match("src/features/gallery.tsx")).toBe(true);
  expect(normal.match("src/.fixture/test.ts")).toBe(true);
  expect(normal.match("docs/guide.md")).toBe(false);
});

describe("unmocked Blob SDK with an in-memory HTTP dispatcher", () => {
  let agent: MockAgent;
  let original: ReturnType<typeof getGlobalDispatcher>;
  beforeEach(() => {
    original = getGlobalDispatcher(); agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
    vi.stubEnv("VERCEL_BLOB_API_URL", "https://blob.invalid.test");
  });
  afterEach(async () => { setGlobalDispatcher(original); await agent.close(); vi.unstubAllEnvs(); });
  it.each(["oidc", "static-token"])("preserves explicit %s authentication and metadata requests without provider traffic", async mode => {
    const token = mode === "oidc" ? "synthetic-oidc" : "vercel_blob_rw_synthetic_fixture";
    const pathname = "images/synthetic/photo.png";
    agent.get("https://blob.invalid.test").intercept({ method: "GET", path: "/?url=" + encodeURIComponent(pathname), headers: { authorization: "Bearer " + token } })
      .reply(200, { pathname, size: 12, contentType: "image/png", uploadedAt: "2026-01-01T00:00:00.000Z",
        url: "https://private.invalid.test/object", downloadUrl: "https://private.invalid.test/object" });
    const credentials = mode === "oidc" ? { oidcToken: token, storeId: "store_synthetic" } : { token };
    const result = await head(pathname, { ...credentials, abortSignal: AbortSignal.timeout(1000) });
    expect(result).toMatchObject({ pathname, size: 12, contentType: "image/png" });
    agent.assertNoPendingInterceptors();
  });
});
