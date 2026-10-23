import { del, get, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { VercelBlobImageStorage } from "./vercelBlobImageStorage";
import type { ImageUpload } from "../../application/imageStorage";

vi.mock("@vercel/blob", () => ({ del: vi.fn(), get: vi.fn(), head: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn() }));
const storage = new VercelBlobImageStorage();
const upload: ImageUpload = { id: "4ea3182c-53f6-49ba-b208-aadf2e4d6e5b", listingId: "listing", pathname: "images/4ea3182c-53f6-49ba-b208-aadf2e4d6e5b/photo.png", filename: "photo.png", contentType: "image/png", size: 12, expiresAt: new Date(Date.now() + 300000).toISOString() };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(issueSignedToken).mockResolvedValue({ delegationToken: "server-only", clientSigningToken: "server-only-key", validUntil: Date.parse(upload.expiresAt) });
  vi.mocked(presignUrl).mockResolvedValue({ presignedUrl: "https://private.example/short-lived-capability" });
});
it("issues an exact-path private PUT with MIME/size/expiry limits, no overwrite, and no credential returned", async () => {
  expect(await storage.prepareUpload(upload)).toBe("https://private.example/short-lived-capability");
  expect(issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({ pathname: upload.pathname, operations: ["put"], validUntil: Date.parse(upload.expiresAt), maximumSizeInBytes: 12, allowedContentTypes: ["image/png"] }));
  expect(presignUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pathname: upload.pathname, operation: "put", access: "private", allowOverwrite: false, addRandomSuffix: false }));
  expect(vi.mocked(issueSignedToken).mock.calls[0][0]).not.toHaveProperty("token");
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
  const before = Date.now(); await storage.createProviderReadAccess(upload.pathname);
  const options = vi.mocked(issueSignedToken).mock.calls[0][0];
  expect(options.operations).toEqual(["get"]); expect(options.pathname).toBe(upload.pathname);
  expect(options.validUntil).toBeGreaterThanOrEqual(before + 900000); expect(options.validUntil).toBeLessThanOrEqual(Date.now() + 900000);
  expect(presignUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ access: "private", operation: "get", useCache: false }));
});
it("deletes only the supplied trusted storage identifier using server authentication", async () => {
  await storage.deleteObject(upload.pathname); expect(del).toHaveBeenCalledWith(upload.pathname, expect.objectContaining({ abortSignal: expect.anything() }));
});
