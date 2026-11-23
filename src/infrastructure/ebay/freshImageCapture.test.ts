// @vitest-environment node
import { randomUUID } from "node:crypto";
import { diagnosticImageWire, SYNTHETIC_PRIMARY } from "../../test/diagnosticImageWire";
import { acquirePhotoCapacity, releasePhotoCapacity } from "../../application/photoCapacity";
import { mediaSessionHash, realMediaDigest } from "../../application/ebayRealMedia";
import { observeFreshImage, downloadFreshImage, discardFreshImage, type FreshImageBinding } from "./freshImageCapture";
import { createCaptureClient, type CaptureRequest } from "./captureClient";
import { imageWireResponse } from "../../test/imageDownloaderFixtures";
vi.mock("server-only", () => ({}));
vi.mock("dotenv", () => { throw Error("Environment loading forbidden."); });
vi.mock("@vercel/blob", () => { throw Error("SDK forbidden."); });
vi.mock("pg", () => { throw Error("Database forbidden."); });
vi.mock("./imageAddressSetPolicy", async original => {
  const actual = await original<typeof import("./imageAddressSetPolicy")>();
  return { ...actual, inspectImageAddressSet: (...args: Parameters<typeof actual.inspectImageAddressSet>) => {
    const value = actual.inspectImageAddressSet(...args);
    return value.candidate ? { ...value, candidate: { address: "127.0.0.1", family: 4 as const } } : value;
  } };
});
let wire: Awaited<ReturnType<typeof diagnosticImageWire>>;
const owned: Array<ReturnType<typeof acquirePhotoCapacity>> = [], handles: unknown[] = [];
function lease() { const value = acquirePhotoCapacity(); owned.push(value); return value; }
function binding(): FreshImageBinding {
  const ownerId = randomUUID(), sessionId = randomUUID(), listingId = randomUUID(), imageId = randomUUID(), h = realMediaDigest("synthetic");
  return { operationId: randomUUID(), reservation: { id: randomUUID(), ownerId, actionHash: h, revision: 0,
    parent: { id: randomUUID(), ownerId, listingId, imageId, token: randomUUID(), revision: 1, actionHash: h, sessionHash: mediaSessionHash(ownerId, sessionId) } },
    context: { ownerId, listingId, imageId, listingVersion: new Date().toISOString(), connectionId: randomUUID(), connectionVersion: randomUUID(),
      configHash: h, grantHash: h, sellerKey: h, sourceVersion: h, imageOrder: 0, mediaGrant: true, accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    sessionId, sourceDigest: h, derivativeDigest: h, recipe: "synthetic-recipe", reviewUntil: new Date(Date.now() + 30_000).toISOString() };
}
async function observe(b = binding(), controller = new AbortController(), until = Date.now() + 20_000) {
  const capacity = lease();
  const value = await observeFreshImage(Buffer.from("synthetic PNG bytes"), "synthetic-only", b, { signal: controller.signal, capacity, until, monoUntil: performance.now() + 20_000 });
  handles.push(value.handle); return { ...value, binding: b, controller, capacity };
}
function options(value: Awaited<ReturnType<typeof observe>>) {
  const at = Date.now(); return { signal: value.controller.signal, capacity: value.capacity, intent: vi.fn(async () => ({
    deadlines: { session: at + 15_000, review: at + 15_000, context: at + 15_000, lease: at + 15_000, access: at + 15_000, refresh: at + 15_000, request: at + 15_000 },
    beforeRequest: async () => {},
  })) };
}
beforeEach(async () => { wire = await diagnosticImageWire(); });
afterEach(async () => { handles.forEach(discardFreshImage); handles.length = 0; owned.forEach(releasePhotoCapacity); owned.length = 0; await wire.close(); });
it("observes one native create, burns a private handle and preserves exact opaque bytes through one GET", async () => {
  const value = await observe(); expect(value.handle).not.toBeNull(); expect(JSON.stringify(value)).not.toContain("opaque=");
  const opts = options(value), op = await downloadFreshImage(value.handle, value.binding, opts), result = await op.result; await op.settled;
  expect(result.diagnostic).toMatchObject({ outcome: "retrieved", bytes: 4, unverified: true, associated: false });
  expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(1); expect(opts.intent).toHaveBeenCalledOnce();
  expect(wire.image.requests[0].toString()).toContain("GET " + SYNTHETIC_PRIMARY.split(".com")[1] + " HTTP/1.1\r\n");
  expect(wire.image.requests[0].toString()).not.toMatch(/authorization|cookie|referrer|synthetic-only/i);
  await expect(downloadFreshImage(value.handle, value.binding, opts)).rejects.toThrow("Image download refused.");
  result.data?.fill(0);
});
it.each(["forged", "cloned", "serialized", "operation", "owner", "session", "seller", "connection", "grant", "config", "source", "derivative", "recipe", "parent", "reservation", "revision"])("refuses %s handles/bindings without DNS or GET", async kind => {
  const value = await observe(), opts = options(value), bad = structuredClone(value.binding);
  expect(value.handle).not.toBeNull();
  let handle: unknown = value.handle;
  if (kind === "forged") handle = {};
  if (kind === "cloned") handle = structuredClone(value.handle);
  if (kind === "serialized") handle = JSON.parse(JSON.stringify(value.handle));
  if (kind === "operation") bad.operationId = randomUUID();
  if (kind === "owner") bad.context.ownerId = randomUUID();
  if (kind === "session") bad.sessionId = randomUUID();
  if (kind === "seller") bad.context.sellerKey = realMediaDigest("other");
  if (kind === "connection") bad.context.connectionVersion = randomUUID();
  if (kind === "grant") bad.context.grantHash = realMediaDigest("other");
  if (kind === "config") bad.context.configHash = realMediaDigest("other");
  if (kind === "source") bad.sourceDigest = realMediaDigest("other");
  if (kind === "derivative") bad.derivativeDigest = realMediaDigest("other");
  if (kind === "recipe") bad.recipe = "other";
  if (kind === "parent") bad.reservation.parent.id = randomUUID();
  if (kind === "reservation") bad.reservation.id = randomUUID();
  if (kind === "revision") bad.reservation.parent.revision++;
  await expect(downloadFreshImage(handle, bad, opts)).rejects.toThrow();
  expect(opts.intent).not.toHaveBeenCalled(); expect(wire.resolver.questions).toHaveLength(0); expect(wire.image.requests).toHaveLength(0);
  if (!["forged", "cloned", "serialized"].includes(kind)) await expect(downloadFreshImage(value.handle, value.binding, opts)).rejects.toThrow();
});
it.each(["cancelled", "disposed", "intent-lost-ack", "expiry"])("never restores a %s handoff", async kind => {
  const until = Date.now() + (kind === "expiry" ? 1000 : 20_000);
  const value = await observe(binding(), new AbortController(), until), opts = options(value);
  expect(value.handle).not.toBeNull();
  if (kind === "cancelled") value.controller.abort(); if (kind === "disposed") discardFreshImage(value.handle);
  if (kind === "intent-lost-ack") opts.intent.mockRejectedValue(new Error("SYNTHETIC-CAPABILITY"));
  if (kind === "expiry") await new Promise(resolve => setTimeout(resolve, Math.max(0, until - Date.now() + 20)));
  await expect(downloadFreshImage(value.handle, value.binding, opts)).rejects.toThrow("Image download refused.");
  await expect(downloadFreshImage(value.handle, value.binding, options(value))).rejects.toThrow();
  expect(wire.image.requests).toHaveLength(0);
});
it.each(["missing-primary", "maximum-only", "duplicate", "escaped-duplicate", "truncated", "oversized", "utf8", "unsafe", "expiry", "non-utc", "headroom", "redirect", "error", "headers"])("issues no usable handle for %s responses", async kind => {
  const good = () => ({ imageUrl: SYNTHETIC_PRIMARY, expirationDate: new Date(Date.now() + 3_600_000).toISOString() });
  wire.response.body = () => {
    if (kind === "missing-primary") return JSON.stringify({ expirationDate: good().expirationDate });
    if (kind === "maximum-only") return JSON.stringify({ maxDimensionImageUrl: SYNTHETIC_PRIMARY, expirationDate: good().expirationDate });
    if (kind === "duplicate") return '{"imageUrl":"a","imageUrl":"b"}';
    if (kind === "escaped-duplicate") return '{"imageUrl":"a","image\\u0055rl":"b"}';
    if (kind === "truncated") return '{"imageUrl":';
    if (kind === "oversized") return "x".repeat(65_537);
    if (kind === "unsafe") return JSON.stringify({ ...good(), imageUrl: "https://127.0.0.1/private" });
    if (kind === "expiry") return JSON.stringify({ ...good(), expirationDate: "2026-02-30T00:00:00Z" });
    if (kind === "non-utc") return JSON.stringify({ ...good(), expirationDate: "2027-01-01T00:00:00+01:00" });
    if (kind === "headroom") return JSON.stringify({ ...good(), expirationDate: new Date(Date.now() + 59_000).toISOString() });
    return JSON.stringify(good());
  };
  if (kind === "redirect") wire.response.status = 302; if (kind === "error") wire.response.status = 500;
  if (kind === "headers") wire.response.headers.push("X-Test", "a", "X-Test", "b");
  if (kind === "utf8") wire.response.send = (_q, res) => { res.writeHead(201, { "Content-Type": "application/json" }); res.end(Buffer.from([255])); };
  const value = await observe(); expect(value.handle).toBeNull(); expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(0);
  expect(JSON.stringify(value.report)).not.toMatch(/opaque=|image%41|signature|CAPABILITY/);
});
it("the legacy injectable capture seam returns structure only and cannot manufacture a handle", async () => {
  const fake = vi.fn(); const legacy = createCaptureClient(fake as unknown as CaptureRequest);
  expect(await legacy.capture(Buffer.alloc(0), "synthetic-only", new AbortController().signal)).not.toHaveProperty("handle");
  expect(fake).not.toHaveBeenCalled();
  await expect(downloadFreshImage({ report: { status: 201 }, url: SYNTHETIC_PRIMARY }, binding(), options(await observe()))).rejects.toThrow();
});
it.each(["wall", "monotonic"])("burns a handoff on %s clock rollback without starting intent", async kind => {
  const value = await observe(), opts = options(value); expect(value.handle).not.toBeNull();
  const clock = kind === "wall" ? vi.spyOn(Date, "now").mockReturnValue(Date.now() - 1000) : vi.spyOn(performance, "now").mockReturnValue(-1);
  try { await expect(downloadFreshImage(value.handle, value.binding, opts)).rejects.toThrow(); expect(opts.intent).not.toHaveBeenCalled(); }
  finally { clock.mockRestore(); }
  await expect(downloadFreshImage(value.handle, value.binding, options(value))).rejects.toThrow(); expect(wire.image.requests).toHaveLength(0);
});
it("cannot start DNS/GET after cancellation during an uncooperative intent promise", async () => {
  const value = await observe(); expect(value.handle).not.toBeNull(); const opts = options(value);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const good = opts.intent.getMockImplementation()!; opts.intent.mockImplementation(async () => { await gate; return good(); });
  const pending = downloadFreshImage(value.handle, value.binding, opts); value.controller.abort(); release();
  await expect(pending).rejects.toThrow(); expect(wire.resolver.questions).toHaveLength(0); expect(wire.image.requests).toHaveLength(0);
  await expect(downloadFreshImage(value.handle, value.binding, options(value))).rejects.toThrow();
});
it("retains capacity for an interrupted native response and leaves a later valid control possible", async () => {
  wire.response.send = (req, res) => { res.writeHead(201, { "Content-Type": "application/json", "Content-Length": "10000" }); res.write("{"); req.socket.destroy(); };
  const value = await observe(); expect(value.handle).toBeNull();
  wire.response.send = undefined; wire.response.body = () => JSON.stringify({ imageUrl: SYNTHETIC_PRIMARY, expirationDate: new Date(Date.now() + 3_600_000).toISOString() });
  const next = await observe(); expect(next.handle).not.toBeNull();
  wire.image.requests.length = 0; expect(imageWireResponse().length).toBeGreaterThan(0);
});
