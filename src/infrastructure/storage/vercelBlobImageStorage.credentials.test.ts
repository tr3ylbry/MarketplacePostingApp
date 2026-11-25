// @vitest-environment node
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { getVercelOidcToken } from "@vercel/oidc";
import { issueSignedToken } from "@vercel/blob";
import { VercelBlobImageStorage } from "./vercelBlobImageStorage";
import type { ImageUpload } from "../../application/imageStorage";

// Exercise the real SDK, but never its credential stores or network. Even a
// swallowed discovery error is a test failure through the call-count assertion.
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn(() => { throw new Error("Implicit discovery forbidden"); }) }));
const storage = new VercelBlobImageStorage();
const staticToken = "vercel_blob_rw_synthetic_fixture", oidcToken = "synthetic-oidc";
const pathname = "images/11111111-1111-4111-8111-111111111111/photo.png";
const upload: ImageUpload = { id: "11111111-1111-4111-8111-111111111111", listingId: "synthetic-listing", pathname, filename: "photo.png", contentType: "image/png", size: 12, expiresAt: new Date(Date.now() + 300000).toISOString() };
const source = { kind: "vercel-blob" as const, pathname, originalFilename: upload.filename, contentType: "image/png" as const, size: 12, uploadedAt: "2026-01-01T00:00:00.000Z" };
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
let agent: MockAgent, original: ReturnType<typeof getGlobalDispatcher>;
beforeEach(() => {
  original = getGlobalDispatcher(); agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  vi.stubEnv("VERCEL_BLOB_API_URL", "https://blob.invalid.test");
  vi.stubEnv("VERCEL_BLOB_RETRIES", "0");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", ""); vi.stubEnv("VERCEL_OIDC_TOKEN", ""); vi.stubEnv("BLOB_STORE_ID", "");
  vi.mocked(getVercelOidcToken).mockClear();
});
afterEach(async () => { setGlobalDispatcher(original); await agent.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function configure(mode: string) {
  if (mode === "static") vi.stubEnv("BLOB_READ_WRITE_TOKEN", staticToken);
  else { vi.stubEnv("VERCEL_OIDC_TOKEN", oidcToken); vi.stubEnv("BLOB_STORE_ID", "store_synthetic"); }
  return mode === "static" ? staticToken : oidcToken;
}
function signing(token: string, operations: string[], validUntil: number) {
  const scope = { pathname, operations, validUntil, ...(operations[0] === "put" ? { maximumSizeInBytes: 12, allowedContentTypes: ["image/png"] } : {}) };
  const grant = { delegationToken: Buffer.from(JSON.stringify({ ...scope, storeId: "store_synthetic" })).toString("base64url") + ".synthetic-proof", clientSigningToken: "synthetic-signing-key", validUntil };
  agent.get("https://blob.invalid.test").intercept({ method: "POST", path: "/signed-token", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(scope) }).reply(200, grant);
}
it.each(["static", "oidc"])("signs private uploads and both read lifetimes with explicit %s credentials without discovery", async mode => {
  const token = configure(mode), providerExpiry = Date.now() + 900000;
  signing(token, ["put"], Date.parse(upload.expiresAt));
  const put = new URL(await storage.prepareUpload(upload));
  expect(put.searchParams.get("pathname")).toBe(pathname); expect(put.searchParams.get("vercel-blob-allow-overwrite")).toBe("false");
  // Only the lifetime is frozen; SDK signing/authorization remain real.
  const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
  signing(token, ["get"], now + 60000); const browser = new URL(await storage.createReadAccess(pathname));
  signing(token, ["get"], providerExpiry); const provider = new URL(await storage.signProviderReadAccess(pathname, providerExpiry));
  clock.mockRestore();
  expect(browser.origin).toBe("https://synthetic.private.blob.vercel-storage.com"); expect(browser.searchParams.get("cache")).toBe("0");
  expect(provider.origin).toBe(browser.origin);
  for (const url of [put, browser, provider]) { expect(url.href).not.toContain(token); expect(url.href).not.toContain("synthetic-signing-key"); }
  expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
it("proves the SDK's implicit discovery path is intercepted by the test harness", async () => {
  configure("static"); signing(staticToken, ["put"], Date.parse(upload.expiresAt));
  // Deliberate negative control: only this direct SDK call omits credentials.
  // The intercepted discovery throws; the SDK then uses the synthetic env token.
  await issueSignedToken({ pathname, operations: ["put"], validUntil: Date.parse(upload.expiresAt), maximumSizeInBytes: 12, allowedContentTypes: ["image/png"] });
  expect(getVercelOidcToken).toHaveBeenCalledOnce(); agent.assertNoPendingInterceptors();
});
it.each(["static", "oidc"])("verifies, reads and deletes private objects with explicit %s credentials", async mode => {
  const token = configure(mode), headers = { authorization: `Bearer ${token}` };
  agent.get("https://blob.invalid.test").intercept({ method: "GET", path: "/?" + new URLSearchParams({ url: pathname }), headers }).reply(200, {
    pathname, contentType: "image/png", size: 12, uploadedAt: source.uploadedAt, etag: "synthetic-etag", contentDisposition: "inline", cacheControl: "private",
    url: "https://synthetic.private.blob.vercel-storage.com/" + pathname, downloadUrl: "https://synthetic.private.blob.vercel-storage.com/" + pathname,
  });
  agent.get("https://synthetic.private.blob.vercel-storage.com").intercept({ method: "GET", path: "/" + pathname + "?cache=0", headers }).reply(200, bytes, { headers: { "Content-Type": "image/png", "Content-Length": "12" } }).times(2);
  agent.get("https://blob.invalid.test").intercept({ method: "POST", path: "/delete", headers, body: JSON.stringify({ urls: [pathname] }) }).reply(200, {});
  expect(await storage.verifyUpload(upload)).toEqual(source);
  expect(await storage.readPrivateImage(source, AbortSignal.timeout(1000))).toEqual(bytes);
  await storage.deleteObject(pathname);
  expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
const invalid = [
  {}, { BLOB_STORE_ID: "store_synthetic" }, { VERCEL_OIDC_TOKEN: oidcToken },
  { BLOB_READ_WRITE_TOKEN: "bad\nvalue" }, { BLOB_READ_WRITE_TOKEN: "bad value" }, { BLOB_READ_WRITE_TOKEN: "x".repeat(16001) },
  { VERCEL_OIDC_TOKEN: oidcToken, BLOB_STORE_ID: "store_" }, { VERCEL_OIDC_TOKEN: oidcToken, BLOB_STORE_ID: "untrusted.example" },
];
it.each(invalid)("rejects incomplete or malformed credentials before any SDK/discovery call %#", async env => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const operations = [() => storage.prepareUpload(upload), () => storage.verifyUpload(upload), () => storage.createReadAccess(pathname),
    () => storage.signProviderReadAccess(pathname, Date.now() + 60000), () => storage.readPrivateImage(source, AbortSignal.timeout(1000)), () => storage.deleteObject(pathname),
    () => storage.writeGeneratedFixture({ ...upload, filename: "generated.png", pathname: `images/${upload.id}/generated.png` }, bytes, AbortSignal.timeout(1000))];
  for (const operation of operations) await expect(operation()).rejects.toThrow("Private image storage is unavailable");
  expect(getVercelOidcToken).not.toHaveBeenCalled();
});
it("preserves configured OIDC preference when both complete credential modes exist", async () => {
  configure("static"); configure("oidc");
  agent.get("https://blob.invalid.test").intercept({ method: "POST", path: "/delete", headers: { authorization: `Bearer ${oidcToken}` } }).reply(200, {});
  await storage.deleteObject(pathname); expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
it("does not discover, refresh or switch credentials after an explicit credential is rejected", async () => {
  configure("static"); configure("oidc");
  const requests = vi.spyOn(agent, "dispatch");
  agent.get("https://blob.invalid.test").intercept({ method: "POST", path: "/delete", headers: { authorization: `Bearer ${oidcToken}` } }).reply(401, { error: { code: "not_allowed", message: "Synthetic rejection" } });
  await expect(storage.deleteObject(pathname)).rejects.toThrow();
  expect(requests).toHaveBeenCalledOnce(); expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
it.each(["metadata", "bytes"])("preserves exact %s validation with explicit credentials", async kind => {
  configure("static"); const headers = { authorization: `Bearer ${staticToken}` };
  if (kind === "metadata") {
    agent.get("https://blob.invalid.test").intercept({ method: "GET", path: "/?" + new URLSearchParams({ url: pathname }), headers }).reply(200, { pathname, contentType: "image/png", size: 13, uploadedAt: source.uploadedAt });
    await expect(storage.verifyUpload(upload)).rejects.toThrow("does not match");
  } else {
    agent.get("https://synthetic.private.blob.vercel-storage.com").intercept({ method: "GET", path: "/" + pathname + "?cache=0", headers }).reply(200, Buffer.alloc(13), { headers: { "Content-Type": "image/png", "Content-Length": "13" } });
    await expect(storage.readPrivateImage(source, AbortSignal.timeout(1000))).rejects.toThrow("could not be verified");
  }
  expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
it("captures one explicit credential context across both verification requests", async () => {
  configure("static");
  agent.get("https://blob.invalid.test").intercept({ method: "GET", path: "/?" + new URLSearchParams({ url: pathname }), headers: { authorization: `Bearer ${staticToken}` } }).reply(() => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_other_replacement");
    return { statusCode: 200, data: { pathname, contentType: "image/png", size: 12, uploadedAt: source.uploadedAt } };
  });
  agent.get("https://synthetic.private.blob.vercel-storage.com").intercept({ method: "GET", path: "/" + pathname + "?cache=0", headers: { authorization: `Bearer ${staticToken}` } }).reply(200, bytes, { headers: { "Content-Type": "image/png", "Content-Length": "12" } });
  expect(await storage.verifyUpload(upload)).toEqual(source);
  expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
it("resolves credentials lazily without requiring them for construction", async () => {
  const instance = new VercelBlobImageStorage(); expect(getVercelOidcToken).not.toHaveBeenCalled();
  configure("static"); agent.get("https://blob.invalid.test").intercept({ method: "POST", path: "/delete", headers: { authorization: `Bearer ${staticToken}` } }).reply(200, {});
  await instance.deleteObject(pathname);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_synthetic_replacement");
  agent.get("https://blob.invalid.test").intercept({ method: "POST", path: "/delete", headers: { authorization: "Bearer vercel_blob_rw_synthetic_replacement" } }).reply(200, {});
  await instance.deleteObject(pathname); expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
it("keeps aborted/private-source and provider-expiry guards ahead of SDK access", async () => {
  configure("static"); const cancel = new AbortController(); cancel.abort();
  await expect(storage.readPrivateImage(source, cancel.signal)).rejects.toThrow();
  await expect(storage.readPrivateImage({ ...source, pathname: "https://attacker.invalid/object" }, AbortSignal.timeout(1000))).rejects.toThrow();
  for (const expiry of [NaN, Date.now() - 1, Date.now() + 1800000]) await expect(storage.signProviderReadAccess(pathname, expiry)).rejects.toThrow();
  expect(getVercelOidcToken).not.toHaveBeenCalled();
});
it.each(["static", "oidc"])("performs a single private generated PUT with explicit %s credentials and no implicit discovery", async mode => {
  const token = configure(mode), generatedPath = `images/${upload.id}/generated.png`, requests = vi.spyOn(agent, "dispatch");
  agent.get("https://blob.invalid.test").intercept({ method: "PUT", path: "/?" + new URLSearchParams({ pathname: generatedPath }),
    headers: { authorization: `Bearer ${token}`, "x-vercel-blob-access": "private", "x-add-random-suffix": "0", "x-allow-overwrite": "0", "x-content-type": "image/png" } })
    .reply(200, { pathname: generatedPath, contentType: "image/png", url: "https://synthetic.private.blob.vercel-storage.com/ignored", downloadUrl: "https://synthetic.private.blob.vercel-storage.com/ignored", contentDisposition: "inline", etag: "synthetic" });
  await storage.writeGeneratedFixture({ ...upload, filename: "generated.png", pathname: generatedPath }, bytes, AbortSignal.timeout(1000));
  expect(requests).toHaveBeenCalledOnce(); expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
it("does not retry or fall back after an uncertain generated PUT failure", async () => {
  configure("static"); const generatedPath = `images/${upload.id}/generated.png`, requests = vi.spyOn(agent, "dispatch");
  agent.get("https://blob.invalid.test").intercept({ method: "PUT", path: "/?" + new URLSearchParams({ pathname: generatedPath }) })
    .reply(503, { error: { code: "service_unavailable", message: "Synthetic uncertainty" } });
  await expect(storage.writeGeneratedFixture({ ...upload, filename: "generated.png", pathname: generatedPath }, bytes, AbortSignal.timeout(1000))).rejects.toThrow();
  expect(requests).toHaveBeenCalledOnce(); expect(getVercelOidcToken).not.toHaveBeenCalled(); agent.assertNoPendingInterceptors();
});
