// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createFakeMediaWorkflow } from "./ebayMediaWorkflowService";
import { FAKE_MEDIA_OPERATION_MS, FAKE_MEDIA_RESPONSE_BYTES, FAKE_MEDIA_SEND_MS, type FakeMediaDependencies, type LiveMediaSession } from "./ebayMediaWorkflow";
import { realMediaDigest, RealMediaError, type RealMediaSnapshot } from "./ebayRealMedia";
import type { PhotoDerivative } from "./photoDerivative";
import { acquirePhotoCapacity, releasePhotoCapacity } from "./photoCapacity";
import { PRIVATE_IMAGE_REVIEW_MS } from "./ebayPrivateImages";

let now: number, mono: number, actor: LiveMediaSession | null, binding: RealMediaSnapshot, config: string, recipe: string;
const repository = { snapshot: vi.fn(), claim: vi.fn(), fence: vi.fn(), beforeSend: vi.fn(), notSent: vi.fn(), acknowledge: vi.fn() };
const deps = { repository, session: vi.fn(), configHash: () => config, recipe: () => recipe, derive: vi.fn(), create: vi.fn(), admit: vi.fn() } satisfies FakeMediaDependencies;
let workflow: ReturnType<typeof createFakeMediaWorkflow>, photo: PhotoDerivative;
let fenced: Set<string>, fencedPhotos: Set<string>;
const response = () => new TextEncoder().encode('{"synthetic":"bounded"}');
const prepare = (image = "photo") => workflow.prepare("listing", image);
const unknown = { state: "unknown", associated: false, simulation: true };
const notSent = { state: "not-sent", associated: false, simulation: true };
const residual = { state: "residual", associated: false, simulation: true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); now = Date.parse("2026-11-16T10:00:00Z"); mono = 0; fenced = new Set(); fencedPhotos = new Set();
  config = realMediaDigest("synthetic-config"); recipe = "synthetic-recipe-v1";
  actor = { ownerId: "workflow-owner", id: "live-session", expiresAt: new Date(now + 3600000).toISOString() };
  binding = { ownerId: actor.ownerId, listingId: "listing", imageId: "photo", listingVersion: new Date(now).toISOString(), connectionId: "connection",
    connectionVersion: "version", configHash: config, grantHash: realMediaDigest("media-grant"), sellerKey: realMediaDigest("seller"),
    sourceVersion: realMediaDigest("source-metadata"), imageOrder: 0, mediaGrant: true, accessExpiresAt: new Date(now + 3600000).toISOString() };
  photo = { bytes: Buffer.from("synthetic export bytes"), sourceDigest: realMediaDigest("synthetic original"), derivativeDigest: realMediaDigest("synthetic export bytes"),
    recipe, contentType: "image/png", size: 22, width: 500, height: 600 };
  photo.size = photo.bytes.length;
  deps.session.mockImplementation(async () => actor ? { ...actor } : null);
  repository.snapshot.mockImplementation(async (owner, listingId, imageId) => {
    if (owner !== binding.ownerId) throw new RealMediaError("stale"); return { ...binding, listingId, imageId };
  });
  repository.claim.mockImplementation(async value => {
    if (fencedPhotos.has(value.imageId)) throw new RealMediaError("blocked");
    return { id: randomUUID(), token: randomUUID(), revision: 0, ownerId: value.ownerId, listingId: value.listingId, imageId: value.imageId,
      sessionHash: value.sessionHash, actionHash: value.actionHash };
  });
  repository.fence.mockImplementation(async c => { fenced.add(c.id); fencedPhotos.add(c.imageId); return { ...c, revision: 1 }; });
  repository.beforeSend.mockResolvedValue(undefined);
  repository.notSent.mockImplementation(async c => { if (fenced.has(c.id)) throw new RealMediaError("stale"); return { state: "not-sent", associated: false }; });
  repository.acknowledge.mockImplementation(async (_c, _p, options) => ({ state: options?.responseOnly ? "residual" : "confirmed", associated: !options?.responseOnly }));
  deps.derive.mockResolvedValue(photo); deps.create.mockResolvedValue(response()); deps.admit.mockResolvedValue(Object.freeze({}));
  workflow = createFakeMediaWorkflow(deps, () => new Date(now), () => mono);
});
afterEach(() => { vi.restoreAllMocks(); });

it("requires explicit review/confirm and returns only safe status; copies/replay/another instance fail closed", async () => {
  const review = await prepare(); expect(deps.derive).not.toHaveBeenCalled(); expect(deps.create).not.toHaveBeenCalled();
  await expect(workflow.confirm({ ...review })).rejects.toMatchObject({ code: "stale" });
  await expect(createFakeMediaWorkflow(deps).confirm(review)).rejects.toMatchObject({ code: "stale" });
  const result = await workflow.confirm(review); expect(result).toEqual({ state: "confirmed", associated: true, simulation: true });
  expect(Object.keys(result).sort()).toEqual(["associated", "simulation", "state"]);
  expect(JSON.stringify(result)).not.toMatch(/digest|token|claim|seller|path|https|credential/);
  expect(deps.create).toHaveBeenCalledWith(photo.bytes, "image/png", expect.any(AbortSignal));
  expect(repository.claim.mock.invocationCallOrder[0]).toBeLessThan(deps.derive.mock.invocationCallOrder[0]);
  expect(repository.fence.mock.invocationCallOrder[0]).toBeLessThan(repository.beforeSend.mock.invocationCallOrder[0]);
  expect(repository.beforeSend.mock.invocationCallOrder[0]).toBeLessThan(deps.create.mock.invocationCallOrder[0]);
  await expect(workflow.confirm(review)).rejects.toMatchObject({ code: "stale" }); expect(deps.create).toHaveBeenCalledOnce();
});
it("burns a review synchronously under concurrent confirmation", async () => {
  const review = await prepare(), outcomes = await Promise.allSettled([workflow.confirm(review), workflow.confirm(review)]);
  expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(deps.create).toHaveBeenCalledOnce();
});
it.each(["expired", "monotonic-expiry", "session", "session-expired", "owner", "revoked", "config", "recipe", "version", "source", "order", "seller", "grant", "connection", "access"])("rejects changed %s before claim and burns the review", async kind => {
  const review = await prepare();
  if (kind === "expired") now += PRIVATE_IMAGE_REVIEW_MS + 1;
  if (kind === "monotonic-expiry") mono += PRIVATE_IMAGE_REVIEW_MS + 1;
  if (kind === "session") actor!.id = "another-session";
  if (kind === "session-expired") actor!.expiresAt = new Date(now - 1).toISOString();
  if (kind === "owner") actor!.ownerId = "foreign-owner";
  if (kind === "revoked") actor = null;
  if (kind === "config") config = realMediaDigest("new-config");
  if (kind === "recipe") recipe += ";changed";
  if (kind === "version") binding.listingVersion = new Date(now + 1).toISOString();
  if (kind === "source") binding.sourceVersion = realMediaDigest("changed source");
  if (kind === "order") binding.imageOrder++;
  if (kind === "seller") binding.sellerKey = realMediaDigest("changed seller");
  if (kind === "grant") binding.grantHash = realMediaDigest("changed grant");
  if (kind === "connection") binding.connectionVersion = "reconnected";
  if (kind === "access") binding.accessExpiresAt = new Date(now + 1000).toISOString();
  await expect(workflow.confirm(review)).rejects.toMatchObject({ code: "stale" });
  await expect(workflow.confirm(review)).rejects.toMatchObject({ code: "stale" }); expect(repository.claim).not.toHaveBeenCalled();
});
it("requires the exact synthetic media grant and sufficient access lifetime", async () => {
  binding.mediaGrant = false; await expect(prepare()).rejects.toMatchObject({ code: "stale" });
  binding.mediaGrant = true; binding.accessExpiresAt = new Date(now + FAKE_MEDIA_OPERATION_MS).toISOString();
  await expect(prepare()).rejects.toMatchObject({ code: "stale" }); expect(deps.create).not.toHaveBeenCalled();
});
it.each(["cancel", "source", "bad-bytes", "bad-recipe", "native-error"])("leaves an unsent record and never falls back to originals after %s during derivation", async kind => {
  const controller = new AbortController(), review = await prepare();
  deps.derive.mockImplementationOnce(async () => {
    if (kind === "cancel") controller.abort(); if (kind === "source") binding.sourceVersion = realMediaDigest("changed");
    if (kind === "bad-bytes") photo.bytes[0] ^= 1; if (kind === "bad-recipe") photo.recipe = "other";
    if (kind === "native-error") throw new Error("private source path Bearer token"); return photo;
  });
  expect(await workflow.confirm(review, controller.signal)).toEqual(notSent); expect(deps.create).not.toHaveBeenCalled();
  expect(repository.fence).not.toHaveBeenCalled();
});
it.each(["changed", "fence-commit-uncertain", "pre-send", "transport", "malformed", "oversized", "ack-unavailable"])("retains uncertainty without repost for %s after fencing starts", async kind => {
  const review = await prepare(), fence = repository.fence.getMockImplementation()!;
  if (kind === "changed") repository.fence.mockImplementationOnce(async (...a) => { const c = await fence(...a); actor = null; return c; });
  if (kind === "fence-commit-uncertain") repository.fence.mockImplementationOnce(async (...a) => { await fence(...a); throw new Error("commit acknowledgement lost"); });
  if (kind === "pre-send") repository.beforeSend.mockRejectedValueOnce(new RealMediaError("stale"));
  if (kind === "transport") deps.create.mockRejectedValueOnce(new Error("private response"));
  if (kind === "malformed") deps.admit.mockRejectedValueOnce(new Error("raw provider body"));
  if (kind === "oversized") deps.create.mockResolvedValueOnce(new Uint8Array(FAKE_MEDIA_RESPONSE_BYTES + 1));
  if (kind === "ack-unavailable") repository.acknowledge.mockRejectedValue(new Error("database unavailable"));
  expect(await workflow.confirm(review)).toEqual(unknown);
  expect(deps.create.mock.calls.length).toBeLessThanOrEqual(1);
  actor = { ownerId: binding.ownerId, id: "live-session", expiresAt: new Date(now + 3600000).toISOString() };
  await expect(workflow.confirm(await prepare())).rejects.toMatchObject({ code: "blocked" });
  expect(deps.create.mock.calls.length).toBeLessThanOrEqual(1);
});
it("retries only the identical local acknowledgement after a lost commit response", async () => {
  const acknowledge = repository.acknowledge.getMockImplementation()!;
  repository.acknowledge.mockImplementationOnce(async (...args) => { await acknowledge(...args); throw new Error("lost response"); });
  expect(await workflow.confirm(await prepare())).toMatchObject({ state: "confirmed", associated: true });
  expect(repository.acknowledge).toHaveBeenCalledTimes(2); expect(repository.acknowledge.mock.calls[0][1]).toBe(repository.acknowledge.mock.calls[1][1]);
  expect(deps.create).toHaveBeenCalledOnce(); expect(deps.admit).toHaveBeenCalledOnce();
});
it.each(["cancel", "deadline", "review-expired", "session", "source", "mutated-buffer"])("captures complete late %s evidence as residual, never a current association", async kind => {
  const c = new AbortController(); deps.create.mockImplementationOnce(async () => {
    if (kind === "cancel") c.abort(); if (kind === "deadline") mono += FAKE_MEDIA_OPERATION_MS + 1;
    if (kind === "review-expired") now += PRIVATE_IMAGE_REVIEW_MS + 1;
    if (kind === "session") actor = null; if (kind === "source") binding.sourceVersion = realMediaDigest("changed");
    if (kind === "mutated-buffer") photo.bytes[0] ^= 1; return response();
  });
  expect(await workflow.confirm(await prepare(), c.signal)).toEqual(residual); expect(repository.acknowledge.mock.calls[0][2].responseOnly).toBe(true);
});
it("downgrades a cancellation observed after the first acknowledgement without another fake send", async () => {
  const c = new AbortController(), acknowledge = repository.acknowledge.getMockImplementation()!;
  repository.acknowledge.mockImplementationOnce(async (...args) => { const result = await acknowledge(...args); c.abort(); return result; });
  expect(await workflow.confirm(await prepare(), c.signal)).toEqual(residual);
  expect(repository.acknowledge).toHaveBeenCalledTimes(2); expect(deps.create).toHaveBeenCalledOnce();
});
it("holds complete-operation capacity through cancelled native-style settlement", async () => {
  const a = deferred<PhotoDerivative>(), b = deferred<PhotoDerivative>(), c = new AbortController();
  deps.derive.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const first = workflow.confirm(await prepare("a"), c.signal), second = workflow.confirm(await prepare("b"), c.signal);
  const settled = Promise.all([first, second]); await vi.waitFor(() => expect(deps.derive).toHaveBeenCalledTimes(2)); c.abort();
  await expect(workflow.confirm(await prepare("c"))).rejects.toMatchObject({ code: "busy" });
  expect(() => acquirePhotoCapacity()).toThrow(); a.resolve(photo); b.resolve(photo);
  expect(await settled).toEqual([notSent, notSent]); expect(deps.create).not.toHaveBeenCalled();
  const lease = acquirePhotoCapacity(); releasePhotoCapacity(lease);
});
it("holds slots until ignored send cancellation settles and rejects a late HTTP-deadline response", async () => {
  const a = deferred<Uint8Array>(), b = deferred<Uint8Array>(), http = new AbortController(), original = AbortSignal.timeout;
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === FAKE_MEDIA_SEND_MS ? http.signal : original(ms));
  deps.create.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const first = workflow.confirm(await prepare("a")), second = workflow.confirm(await prepare("b"));
  const settled = Promise.all([first, second]); await vi.waitFor(() => expect(deps.create).toHaveBeenCalledTimes(2)); http.abort();
  await expect(workflow.confirm(await prepare("c"))).rejects.toMatchObject({ code: "busy" }); expect(() => acquirePhotoCapacity()).toThrow();
  a.resolve(response()); b.resolve(response()); expect(await settled).toEqual([residual, residual]);
  const lease = acquirePhotoCapacity(); releasePhotoCapacity(lease);
});
it("does not start work for a pre-aborted confirmation and releases capacity even for an invalid signal", async () => {
  const c = new AbortController(); c.abort(); await expect(workflow.confirm(await prepare(), c.signal)).rejects.toMatchObject({ code: "stale" });
  await expect(workflow.confirm(await prepare(), {} as AbortSignal)).rejects.toMatchObject({ code: "unavailable" });
  expect(repository.claim).not.toHaveBeenCalled(); const lease = acquirePhotoCapacity(); releasePhotoCapacity(lease);
});
