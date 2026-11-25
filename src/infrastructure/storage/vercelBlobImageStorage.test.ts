import { del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { VercelBlobImageStorage } from "./vercelBlobImageStorage";
import type { ImageUpload } from "../../application/imageStorage";

vi.mock("@vercel/blob", () => ({ del: vi.fn(), get: vi.fn(), head: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn(), put: vi.fn() }));
const storage = new VercelBlobImageStorage();
const upload: ImageUpload = { id: "4ea3182c-53f6-49ba-b208-aadf2e4d6e5b", listingId: "listing", pathname: "images/4ea3182c-53f6-49ba-b208-aadf2e4d6e5b/photo.png", filename: "photo.png", contentType: "image/png", size: 12, expiresAt: new Date(Date.now() + 300000).toISOString() };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_synthetic_fixture");
  vi.stubEnv("VERCEL_OIDC_TOKEN", ""); vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("VERCEL_BLOB_RETRIES", "0");
  vi.mocked(issueSignedToken).mockResolvedValue({ delegationToken: "server-only", clientSigningToken: "server-only-key", validUntil: Date.parse(upload.expiresAt) });
  vi.mocked(presignUrl).mockResolvedValue({ presignedUrl: "https://private.example/short-lived-capability" });
});
afterEach(() => { vi.unstubAllEnvs(); });
it("issues an exact-path private PUT with MIME/size/expiry limits, no overwrite, and no credential returned", async () => {
  expect(await storage.prepareUpload(upload)).toBe("https://private.example/short-lived-capability");
  expect(issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({ pathname: upload.pathname, operations: ["put"], validUntil: Date.parse(upload.expiresAt), maximumSizeInBytes: 12, allowedContentTypes: ["image/png"] }));
  expect(presignUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pathname: upload.pathname, operation: "put", access: "private", allowOverwrite: false, addRandomSuffix: false }));
  expect(vi.mocked(issueSignedToken).mock.calls[0][0]).toHaveProperty("token", "vercel_blob_rw_synthetic_fixture");
});
it("issues only a short-lived private GET with no cached application delivery", async () => {
  const before = Date.now(); await storage.createReadAccess(upload.pathname);
  const options = vi.mocked(issueSignedToken).mock.calls[0][0];
  expect(options.operations).toEqual(["get"]); expect(options.pathname).toBe(upload.pathname);
  expect(options.validUntil).toBeGreaterThanOrEqual(before + 60000); expect(options.validUntil).toBeLessThanOrEqual(Date.now() + 60000);
  expect(presignUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ access: "private", operation: "get", useCache: false }));
});
it("checks metadata and file signature and cancels the stream after a bounded prefix", async () => {
  vi.mocked(head).mockResolvedValue({ pathname: upload.pathname, size: 12, contentType: "image/png", uploadedAt: new Date("2026-01-01T00:00:00Z"), url: "https://private.example/object", downloadUrl: "https://private.example/object", contentDisposition: "inline", cacheControl: "private", etag: "etag" });
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])); }, cancel });
  vi.mocked(get).mockResolvedValue({ statusCode: 200, stream, headers: new Headers(), blob: { pathname: upload.pathname, size: 12, contentType: "image/png", uploadedAt: new Date(), url: "https://private.example/object", downloadUrl: "https://private.example/object", contentDisposition: "inline", cacheControl: "private", etag: "etag" } });
  expect(await storage.verifyUpload(upload)).toMatchObject({ pathname: upload.pathname, originalFilename: "photo.png", contentType: "image/png", size: 12 });
  expect(cancel).toHaveBeenCalled();
  await expect(storage.verifyUpload({ ...upload, size: 13 })).rejects.toThrow("does not match");
});
it("separately bounds private provider-ingestion capabilities to fifteen minutes", async () => {
  const before = Date.now(); await storage.signProviderReadAccess(upload.pathname, before + 900000);
  const options = vi.mocked(issueSignedToken).mock.calls[0][0];
  expect(options.operations).toEqual(["get"]); expect(options.pathname).toBe(upload.pathname);
  expect(options.validUntil).toBeGreaterThanOrEqual(before + 900000); expect(options.validUntil).toBeLessThanOrEqual(Date.now() + 900000);
  expect(presignUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ access: "private", operation: "get", useCache: false, validUntil: before + 900000 }));
});
it("rejects expired or excessive provider expiry without contacting Blob", async () => {
  for (const expiry of [Date.now() - 1, Date.now() + 1800000, NaN]) await expect(storage.signProviderReadAccess(upload.pathname, expiry)).rejects.toThrow();
  expect(issueSignedToken).not.toHaveBeenCalled(); expect(presignUrl).not.toHaveBeenCalled();
});
it("deletes only the supplied trusted storage identifier using server authentication", async () => {
  await storage.deleteObject(upload.pathname); expect(del).toHaveBeenCalledWith(upload.pathname, expect.objectContaining({ abortSignal: expect.anything() }));
});
it("reads private bytes through the SDK with cancellation and no signed capability", async () => {
  const source = { kind: "vercel-blob" as const, pathname: upload.pathname, originalFilename: upload.filename, contentType: "image/png" as const, size: 12, uploadedAt: new Date().toISOString() };
  vi.mocked(get).mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(12)); c.close(); } }), headers: new Headers(),
    blob: { pathname: source.pathname, size: 12, contentType: source.contentType, uploadedAt: new Date(), url: "https://private.example/object", downloadUrl: "https://private.example/object", contentDisposition: "inline", cacheControl: "private", etag: "etag" } });
  const signal = AbortSignal.timeout(1000); expect((await storage.readPrivateImage(source, signal)).length).toBe(12);
  expect(get).toHaveBeenCalledWith(source.pathname, { token: "vercel_blob_rw_synthetic_fixture", access: "private", useCache: false, abortSignal: signal });
  expect(issueSignedToken).not.toHaveBeenCalled(); expect(presignUrl).not.toHaveBeenCalled();
});
it("rejects missing private objects and malformed trusted pathnames without signing", async () => {
  const source = { kind: "vercel-blob" as const, pathname: upload.pathname, originalFilename: upload.filename, contentType: "image/png" as const, size: 12, uploadedAt: new Date().toISOString() };
  vi.mocked(get).mockResolvedValue(null); await expect(storage.readPrivateImage(source, AbortSignal.timeout(1000))).rejects.toThrow();
  vi.mocked(get).mockClear(); await expect(storage.readPrivateImage({ ...source, pathname: "https://attacker.invalid/object" }, AbortSignal.timeout(1000))).rejects.toThrow();
  expect(get).not.toHaveBeenCalled(); expect(presignUrl).not.toHaveBeenCalled();
});

const generatedUpload = { ...upload, filename: "generated.png", pathname: `images/${upload.id}/generated.png` };
const generatedBytes = () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
it("writes a generated fixture privately once with explicit injected credentials, no overwrite or multipart fallback", async () => {
  const instance = new VercelBlobImageStorage({ NODE_ENV:"test", BLOB_READ_WRITE_TOKEN: "explicit-synthetic-token" }), bytes = generatedBytes(), cancel = new AbortController();
  await instance.writeGeneratedFixture(generatedUpload, bytes, cancel.signal);
  expect(put).toHaveBeenCalledExactlyOnceWith(generatedUpload.pathname, bytes, expect.objectContaining({ token: "explicit-synthetic-token", access: "private", contentType: "image/png",
    addRandomSuffix: false, allowOverwrite: false, multipart: false, maximumSizeInBytes: 12, cacheControlMaxAge: 60 }));
  const signal = vi.mocked(put).mock.calls[0][2].abortSignal!;
  expect(signal.aborted).toBe(false); cancel.abort(); expect(signal.aborted).toBe(true);
  expect(issueSignedToken).not.toHaveBeenCalled(); expect(presignUrl).not.toHaveBeenCalled();
});
it.each([undefined, "1", "10", "00"])("refuses a generated write unless the real dedicated process disables SDK retries: %s", async retries => {
  vi.stubEnv("VERCEL_BLOB_RETRIES", retries);
  await expect(storage.writeGeneratedFixture(generatedUpload, generatedBytes(), AbortSignal.timeout(1000))).rejects.toThrow("Generated image setup is unavailable");
  expect(put).not.toHaveBeenCalled();
});
it.each(["name", "type", "size", "overflow", "signature", "path", "id", "expired", "cancelled", "credentials"])("refuses invalid generated %s before SDK access", async kind => {
  const candidate = { ...generatedUpload }, cancel = new AbortController(); let bytes = generatedBytes();
  if (kind === "name") candidate.filename = "another.png";
  if (kind === "type") candidate.contentType = "image/jpeg";
  if (kind === "size") candidate.size = 13;
  if (kind === "overflow") { bytes = Buffer.alloc(1_048_577); candidate.size = bytes.length; }
  if (kind === "signature") bytes[0] = 0;
  if (kind === "path") candidate.pathname = "https://synthetic.invalid/no";
  if (kind === "id") candidate.id = "not-an-id";
  if (kind === "expired") candidate.expiresAt = new Date(Date.now() - 1).toISOString();
  if (kind === "cancelled") cancel.abort();
  if (kind === "credentials") vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  await expect(storage.writeGeneratedFixture(candidate, bytes, cancel.signal)).rejects.toThrow();
  expect(put).not.toHaveBeenCalled(); expect(issueSignedToken).not.toHaveBeenCalled();
});
it("cancels an incomplete verification prefix through the caller signal and never treats it as verified", async () => {
  const cancel = new AbortController(), cancelled = vi.fn();
  vi.mocked(head).mockResolvedValue({ pathname: upload.pathname, size: 12, contentType: "image/png", uploadedAt: new Date() } as Awaited<ReturnType<typeof head>>);
  vi.mocked(get).mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ cancel: cancelled }), headers: new Headers(), blob: {} } as unknown as Awaited<ReturnType<typeof get>>);
  const pending = storage.verifyUpload(upload, cancel.signal);
  await vi.waitFor(() => expect(get).toHaveBeenCalledOnce()); cancel.abort();
  await expect(pending).rejects.toThrow(); expect(cancelled).toHaveBeenCalledOnce();
});
