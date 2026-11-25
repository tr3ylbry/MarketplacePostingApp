// @vitest-environment node
import { assertOfflineGuards } from "./offlinePrototypeGuards";
import { createInjectedLocalOperatorFixturePreparer } from "../../scripts/local-image-operator-fixture";
import { generateVerificationFixture } from "../infrastructure/storage/verificationFixture";
import { photoTransformer, PHOTO_RECIPE } from "../infrastructure/storage/photoDerivative/transformPhoto";
import { realMediaDigest } from "../application/ebayRealMedia";
import type { PhotoDerivative, PhotoTransformer } from "../application/photoDerivative";
import type { Listing } from "../domain/listing";
import type { BlobImageSource } from "../domain/listingImage";
import type { ImageUpload, UploadInput } from "../application/imageStorage";
vi.mock("server-only", () => ({}));
const owner = "synthetic-owner", listingId = "11111111-1111-4111-8111-111111111111", imageId = "22222222-2222-4222-8222-222222222222";
const actor = () => ({ ownerId: owner, id: "synthetic-session", expiresAt: new Date(Date.now() + 60_000).toISOString() });
let original: Buffer, derivative: PhotoDerivative;
beforeAll(async () => {
  const generated = await generateVerificationFixture(); original = generated.bytes;
  derivative = await photoTransformer.transform(original, "image/png", AbortSignal.timeout(5_000), performance.now() + 5_000);
});
afterAll(() => { original.fill(0); derivative.bytes.fill(0); });
function fixture() {
  const order: string[] = [], controller = new AbortController();
  let saved: Listing | null = null, uploaded: Buffer | undefined;
  const source: BlobImageSource = { kind: "vercel-blob", pathname: `images/${imageId}/generated.png`, originalFilename: "generated.png",
    contentType: "image/png", size: original.length, uploadedAt: new Date().toISOString() };
  const upload: ImageUpload = { id: imageId, listingId, pathname: source.pathname, filename: "generated.png", contentType: "image/png", size: original.length, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const deps = {
    listings: {
      getById: vi.fn<(owner: string, listingId: string) => Promise<Listing | null>>(async () => { order.push("read-listing"); return saved; }),
      create: vi.fn(async (_owner: string, listing: Listing) => { order.push("create"); saved = listing; return listing; }),
    },
    images: {
      reserve: vi.fn<(owner: string, listingId: string, input: UploadInput) => Promise<ImageUpload>>(async () => { order.push("reserve"); return upload; }),
      finalize: vi.fn<(owner: string, listingId: string, imageId: string, source: BlobImageSource) => Promise<void>>(async () => { order.push("finalize"); saved = { ...saved!, updatedAt: "2026-01-01T00:00:01.000Z", images: [{ id: imageId, listingId, order: 0, source }] }; }),
    },
    storage: {
      writeGeneratedFixture: vi.fn<(upload: ImageUpload, bytes: Buffer, signal: AbortSignal) => Promise<void>>(async (_upload, bytes) => { order.push("write"); uploaded = Buffer.from(bytes); }),
      verifyUpload: vi.fn<(upload: ImageUpload, signal: AbortSignal) => Promise<BlobImageSource>>(async () => { order.push("verify"); return source; }),
      readPrivateImage: vi.fn<(source: BlobImageSource, signal: AbortSignal) => Promise<Buffer>>(async () => { order.push("read-source"); return Buffer.from(uploaded!); }),
    },
    generate: vi.fn<typeof generateVerificationFixture>(async () => ({ bytes: Buffer.from(original), sourceDigest: realMediaDigest(original) })),
    transformer: { transform: vi.fn<PhotoTransformer["transform"]>(async () => ({ ...derivative, bytes: Buffer.from(derivative.bytes) })) }, recipe: PHOTO_RECIPE,
  };
  const input = { listingId, signal: controller.signal, onContent: vi.fn<(sourceDigest: string, derivativeDigest: string) => Promise<void>>(async () => { order.push("pins"); }),
    authorizeContext: vi.fn(async () => { order.push("authorize"); }) };
  return { deps, input, controller, source, upload, order, prepare: createInjectedLocalOperatorFixturePreparer(deps) };
}
it("guards network, SDK, private files and database construction", assertOfflineGuards);
it("prepares one generated source through normal reservation, private verification and finalization boundaries", async () => {
  const f = fixture(), result = await f.prepare(actor(), f.input);
  expect(result).toEqual({ imageId, listingVersion: "2026-01-01T00:00:01.000Z" });
  expect(f.order).toEqual(["read-listing", "pins", "create", "authorize", "reserve", "authorize", "write", "authorize", "verify", "authorize", "read-source", "authorize", "finalize", "read-listing"]);
  expect(f.input.onContent).toHaveBeenCalledExactlyOnceWith(realMediaDigest(original), derivative.derivativeDigest);
  expect(f.deps.listings.create).toHaveBeenCalledWith(owner, expect.objectContaining({ id: listingId, title: `SANDBOX M3 Generated ${realMediaDigest(original).slice(0, 12)}`, images: [], status: "draft" }));
  expect(f.deps.images.reserve).toHaveBeenCalledWith(owner, listingId, { filename: "generated.png", contentType: "image/png", size: original.length });
  expect(f.deps.images.finalize).toHaveBeenCalledExactlyOnceWith(owner, listingId, imageId, f.source);
  expect((await f.deps.generate.mock.results[0].value).bytes.every((value: number) => value === 0)).toBe(true);
  expect((await f.deps.transformer.transform.mock.results[0].value).bytes.every((value: number) => value === 0)).toBe(true);
  expect((await f.deps.storage.readPrivateImage.mock.results[0].value).every((value: number) => value === 0)).toBe(true);
});
it("accepts the actual frozen generated-image and derivative implementations as a legitimate control", async () => {
  const f = fixture(); f.deps.generate.mockImplementation(generateVerificationFixture);
  f.deps.transformer.transform.mockImplementation(photoTransformer.transform);
  // The normal reservation captures the newly generated length; private reads
  // return exactly the submitted source rather than a guessed filename or URL.
  f.deps.images.reserve.mockImplementation(async (_owner: string, _listing: string, input: UploadInput) => {
    f.upload.size = input.size; f.source.size = input.size; return f.upload;
  });
  await expect(f.prepare(actor(), f.input)).resolves.toMatchObject({ imageId });
  expect(f.input.onContent.mock.calls[0]).toHaveLength(2);
  expect(f.input.onContent.mock.calls[0][0]).not.toBe(f.input.onContent.mock.calls[0][1]);
});
it.each(["cancelled", "expired", "invalid-owner", "invalid-listing"])("rejects %s context before generation or local/storage mutation", async kind => {
  const f = fixture(), a = actor(); if (kind === "cancelled") f.controller.abort();
  if (kind === "expired") a.expiresAt = new Date(Date.now() - 1).toISOString();
  if (kind === "invalid-owner") a.ownerId = "legacy-unclaimed";
  if (kind === "invalid-listing") f.input.listingId = "not-an-id";
  await expect(f.prepare(a, f.input)).rejects.toThrow();
  expect(f.deps.generate).not.toHaveBeenCalled(); expect(f.deps.listings.create).not.toHaveBeenCalled(); expect(f.deps.storage.writeGeneratedFixture).not.toHaveBeenCalled();
});
it("rejects an already existing owned listing before generating replacement content", async () => {
  const f = fixture(); f.deps.listings.getById.mockResolvedValue({ id: listingId } as Listing);
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.deps.generate).not.toHaveBeenCalled(); expect(f.input.onContent).not.toHaveBeenCalled();
});
it("rejects overlapping and successive calls for a consumed listing ID without regenerating or reuploading", async () => {
  const f = fixture(); let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  f.input.onContent.mockImplementation(async () => { await wait; });
  const first = f.prepare(actor(), f.input);
  await vi.waitFor(() => expect(f.input.onContent).toHaveBeenCalledOnce());
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  release(); await first;
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.deps.generate).toHaveBeenCalledOnce(); expect(f.deps.storage.writeGeneratedFixture).toHaveBeenCalledOnce();
});
it("does not regenerate after an uncertain failed create, even when the listing is not observable", async () => {
  const f = fixture(); f.deps.listings.create.mockRejectedValue(new Error("synthetic uncertain commit"));
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.deps.generate).toHaveBeenCalledOnce(); expect(f.deps.images.reserve).not.toHaveBeenCalled(); expect(f.deps.storage.writeGeneratedFixture).not.toHaveBeenCalled();
});
it("rechecks authoritative context after a delayed reservation and preserves consumed content when it is revoked", async () => {
  const f = fixture(); let release!: () => void, revoked = false, consumed: readonly [string, string] | undefined;
  const wait = new Promise<void>(resolve => { release = resolve; });
  f.input.onContent.mockImplementation(async (source, transformed) => { consumed = [source, transformed]; });
  f.input.authorizeContext.mockImplementation(async () => { if (revoked) throw new Error("Synthetic revoked context"); });
  f.deps.images.reserve.mockImplementation(async () => { await wait; return f.upload; });
  const preparation = f.prepare(actor(), f.input);
  await vi.waitFor(() => expect(f.deps.images.reserve).toHaveBeenCalledOnce());
  revoked = true; release();
  await expect(preparation).rejects.toThrow("Do not repeat");
  expect(consumed).toEqual([realMediaDigest(original), derivative.derivativeDigest]);
  expect(f.input.authorizeContext).toHaveBeenCalledTimes(2);
  expect(f.deps.storage.writeGeneratedFixture).not.toHaveBeenCalled(); expect(f.deps.images.finalize).not.toHaveBeenCalled();
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.deps.generate).toHaveBeenCalledOnce(); expect(f.deps.images.reserve).toHaveBeenCalledOnce();
});
it("does not reserve or write if context changes while the listing create is awaited", async () => {
  const f = fixture();
  f.input.authorizeContext.mockRejectedValueOnce(new Error("Synthetic changed connection version"));
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.input.onContent).toHaveBeenCalledOnce(); expect(f.deps.listings.create).toHaveBeenCalledOnce();
  expect(f.deps.images.reserve).not.toHaveBeenCalled(); expect(f.deps.storage.writeGeneratedFixture).not.toHaveBeenCalled();
});
it.each(["write", "verify", "read"] as const)("does not finalize or retry after authoritative context changes during %s", async stage => {
  const f = fixture(); let revoked = false;
  f.input.authorizeContext.mockImplementation(async () => { if (revoked) throw new Error("Synthetic revoked session or changed grant"); });
  if (stage === "write") {
    const write = f.deps.storage.writeGeneratedFixture.getMockImplementation()!;
    f.deps.storage.writeGeneratedFixture.mockImplementation(async (...args) => { await write(...args); revoked = true; });
  } else if (stage === "verify") {
    const verify = f.deps.storage.verifyUpload.getMockImplementation()!;
    f.deps.storage.verifyUpload.mockImplementation(async (...args) => { const value = await verify(...args); revoked = true; return value; });
  } else {
    const read = f.deps.storage.readPrivateImage.getMockImplementation()!;
    f.deps.storage.readPrivateImage.mockImplementation(async (...args) => { const value = await read(...args); revoked = true; return value; });
  }
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.input.onContent).toHaveBeenCalledOnce(); expect(f.deps.storage.writeGeneratedFixture).toHaveBeenCalledOnce();
  expect(f.deps.images.finalize).not.toHaveBeenCalled();
  if (stage === "write") expect(f.deps.storage.verifyUpload).not.toHaveBeenCalled();
  if (stage === "verify") expect(f.deps.storage.readPrivateImage).not.toHaveBeenCalled();
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.deps.generate).toHaveBeenCalledOnce(); expect(f.deps.storage.writeGeneratedFixture).toHaveBeenCalledOnce();
});
it.each(["pins", "write", "verify", "read", "finalize"] as const)("stops conservatively after %s failure with no automatic cleanup, replacement or second send", async stage => {
  const f = fixture(), failure = new Error("synthetic sensitive raw error");
  ({ pins: f.input.onContent, write: f.deps.storage.writeGeneratedFixture, verify: f.deps.storage.verifyUpload,
    read: f.deps.storage.readPrivateImage, finalize: f.deps.images.finalize }[stage]).mockRejectedValueOnce(failure);
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Generated image preparation stopped");
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.deps.generate).toHaveBeenCalledOnce();
  expect(f.deps.storage.writeGeneratedFixture.mock.calls.length).toBeLessThanOrEqual(1);
  if (stage === "pins") expect(f.deps.listings.create).not.toHaveBeenCalled();
  if (stage === "write") expect(f.deps.storage.verifyUpload).not.toHaveBeenCalled();
  if (stage === "verify" || stage === "read") expect(f.deps.images.finalize).not.toHaveBeenCalled();
});
it("requires exact private-source bytes before finalization and zeroes a mismatching read", async () => {
  const f = fixture(), changed = Buffer.from(original); changed[changed.length - 1] ^= 1;
  f.deps.storage.readPrivateImage.mockResolvedValue(changed);
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.deps.images.finalize).not.toHaveBeenCalled(); expect(changed.every(value => value === 0)).toBe(true);
});
it.each(["source-digest", "source-overflow", "derivative-digest", "recipe", "dimensions", "size"])("refuses a changed %s before content pins or storage starts", async kind => {
  const f = fixture();
  if (kind === "source-digest") f.deps.generate.mockResolvedValue({ bytes: Buffer.from(original), sourceDigest: "0".repeat(64) });
  if (kind === "source-overflow") { const bytes = Buffer.alloc(1_048_577); f.deps.generate.mockResolvedValue({ bytes, sourceDigest: realMediaDigest(bytes) }); }
  if (kind === "derivative-digest") f.deps.transformer.transform.mockResolvedValue({ ...derivative, bytes: Buffer.from(derivative.bytes), derivativeDigest: "0".repeat(64) });
  if (kind === "recipe") f.deps.recipe = "unreviewed-recipe";
  if (kind === "dimensions") f.deps.transformer.transform.mockResolvedValue({ ...derivative, bytes: Buffer.from(derivative.bytes), width: 501 });
  if (kind === "size") f.deps.transformer.transform.mockResolvedValue({ ...derivative, bytes: Buffer.from(derivative.bytes), size: derivative.size + 1 });
  await expect(f.prepare(actor(), f.input)).rejects.toThrow("Do not repeat");
  expect(f.input.onContent).not.toHaveBeenCalled(); expect(f.deps.listings.create).not.toHaveBeenCalled(); expect(f.deps.storage.writeGeneratedFixture).not.toHaveBeenCalled();
});
it("checks cancellation and session expiry after each awaited boundary without finalizing late", async () => {
  for (const kind of ["cancelled", "expired"] as const) {
    const f = fixture(), a = actor();
    f.deps.storage.verifyUpload.mockImplementation(async () => { if (kind === "cancelled") f.controller.abort(); else vi.spyOn(Date, "now").mockReturnValue(Date.parse(a.expiresAt) + 1); return f.source; });
    try { await expect(f.prepare(a, f.input)).rejects.toThrow("Do not repeat"); expect(f.deps.images.finalize).not.toHaveBeenCalled(); }
    finally { vi.mocked(Date.now).mockRestore?.(); }
  }
});
