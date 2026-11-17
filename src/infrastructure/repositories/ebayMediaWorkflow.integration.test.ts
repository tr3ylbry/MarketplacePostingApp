import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import sharp from "sharp";
import { authOptions } from "../../auth/options";
import { disposableRealMediaDatabase } from "../../test/disposableRealMediaDatabase";
import { testDatabaseUrl } from "../../test/testDatabase";
import { composeFakeMediaWorkflow, syntheticCreateReply } from "../../test/ebay/fakeRealMedia";
import { listingFixture } from "../../test/fixtures";
import { privacyFixture, solidPng } from "../../test/photoPrivacyFixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { createImageService } from "../../application/imageService";
import { createListingService } from "../../application/listingService";
import { EBAY_SCOPES, EBAY_READINESS_SCOPES } from "../../application/ebayConnection";
import { PROPOSED_MEDIA_SCOPES } from "../../application/ebayMediaGrant";
import { realMediaDigest, REAL_MEDIA_LEASE_MS, type RealMediaClaim, type RealMediaReviewGuard, type RealMediaContext } from "../../application/ebayRealMedia";
import { photoTransformer, PHOTO_RECIPE } from "../storage/photoDerivative/transformPhoto";
import { syntheticMediaEvidence, admitRealMediaEvidence } from "../ebay/realMediaEvidence";
import { mediaRuntime } from "../ebay/mediaRuntime";
import { cleanupImages } from "../storage/cleanupImages";
import * as schema from "../db/schema";

vi.mock("server-only", () => ({}));
const makeAuth = (db: NodePgDatabase<typeof schema>) => betterAuth({ ...authOptions(db, {
  BETTER_AUTH_URL: "http://127.0.0.1:3100", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), GITHUB_CLIENT_ID: "test-placeholder", GITHUB_CLIENT_SECRET: "test-placeholder",
}), plugins: [testUtils()] });
let isolated: Awaited<ReturnType<typeof disposableRealMediaDatabase>>, db: typeof isolated.db, auth: ReturnType<typeof makeAuth>;
let harness: Awaited<ReturnType<typeof composeFakeMediaWorkflow>>, storage: MemoryImageStorage, headers: Headers;
let owner: string, foreign: string, sessionId: string, listingId: string, imageId: string, config: string, recipe: string;
let lastReply: Buffer, captured: RealMediaClaim | undefined, guard: RealMediaReviewGuard | undefined;
const sourceBytes = privacyFixture("metadata.jpg"), transactions = new AsyncLocalStorage<boolean>();
const reader = { readPrivateImage: vi.fn() }, transformer = { transform: vi.fn(photoTransformer.transform) }, send = vi.fn();
const attempts = () => db.select().from(schema.ebayRealMediaAttempts).where(eq(schema.ebayRealMediaAttempts.ownerId, owner));
const receipts = () => db.select().from(schema.ebayRealMediaReceipts);
const associations = () => db.select().from(schema.ebayRealMediaAssociations).where(eq(schema.ebayRealMediaAssociations.ownerId, owner));
const prepare = (id = imageId) => harness.workflow.prepare(listingId, id);
const confirm = async (signal?: AbortSignal) => harness.workflow.confirm(await prepare(), signal);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function login(user = owner) { const login = await (await auth.$context).test.login({ userId: user }); headers = login.headers; sessionId = login.session.id; }
async function addPhoto(bytes = sourceBytes, type = "image/jpeg") {
  const images = createImageService(harness.images, storage);
  const upload = await images.prepare(owner, listingId, { filename: type === "image/png" ? "generated.png" : "generated.jpg", contentType: type, size: bytes.length });
  storage.objects.set(storage.uploads.get(upload.imageId)!.pathname, { bytes: Buffer.from(bytes), type });
  await images.finalize(owner, listingId, upload.imageId); return upload.imageId;
}
beforeAll(async () => { isolated = await disposableRealMediaDatabase(); db = isolated.db; auth = makeAuth(db); }, 30000);
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks(); captured = undefined; guard = undefined;
  const helpers = (await auth.$context).test;
  owner = (await helpers.saveUser(helpers.createUser())).id; foreign = (await helpers.saveUser(helpers.createUser())).id; await login();
  config = realMediaDigest("synthetic-media-config"); recipe = PHOTO_RECIPE; storage = new MemoryImageStorage();
  harness = await composeFakeMediaWorkflow(db, { reader, transformer, configHash: () => config, recipe: () => recipe, create: send,
    async session() { const s = await auth.api.getSession({ headers }); return s ? { ownerId: s.user.id, id: s.session.id, expiresAt: new Date(s.session.expiresAt).toISOString() } : null; },
  });
  listingId = (await harness.listings.create(owner, listingFixture())).id; imageId = await addPhoto();
  await db.insert(schema.ebayConnections).values({ ownerId: owner, id: randomUUID(), version: randomUUID(), configHash: config, status: "connected",
    sellerId: realMediaDigest("synthetic-seller-" + owner), sellerLabel: "Synthetic seller", connectedAt: new Date().toISOString(),
    access: { ciphertext: "synthetic-access", iv: "synthetic-iv", tag: "synthetic-tag", keyVersion: 1 },
    refresh: { ciphertext: "synthetic-refresh", iv: "synthetic-iv", tag: "synthetic-tag", keyVersion: 1 },
    accessExpiresAt: new Date(Date.now() + 7200000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(), scopes: [...PROPOSED_MEDIA_SCOPES] });
  const transaction = db.transaction.bind(db); vi.spyOn(db, "transaction").mockImplementation((...args) => transactions.run(true, () => transaction(...args)));
  const claim = harness.repository.claim.bind(harness.repository), fence = harness.repository.fence.bind(harness.repository);
  vi.spyOn(harness.repository, "claim").mockImplementation(async (...args) => { guard = args[1]; return claim(...args); });
  vi.spyOn(harness.repository, "fence").mockImplementation(async (...args) => { captured = await fence(...args); return captured; });
  reader.readPrivateImage.mockImplementation(async (source, signal) => {
    expect(transactions.getStore()).not.toBe(true); signal.throwIfAborted();
    const [row] = await db.select().from(schema.listingImages).where(eq(schema.listingImages.pathname, source.pathname));
    expect(Date.parse(row.providerRetainUntil!)).toBeGreaterThan(Date.now() + 300000);
    return Buffer.from(storage.objects.get(source.pathname)!.bytes);
  });
  transformer.transform.mockImplementation(async (...args) => { expect(transactions.getStore()).not.toBe(true); return photoTransformer.transform(...args); });
  send.mockImplementation(async (bytes, type, signal) => {
    expect(transactions.getStore()).not.toBe(true); signal.throwIfAborted();
    const row = (await attempts()).find(r => r.derivativeDigest === realMediaDigest(bytes));
    expect(row).toMatchObject({ state: "unknown", contentType: type, encodedSize: bytes.length, recipe: PHOTO_RECIPE }); expect(row!.postIntentAt).not.toBeNull();
    lastReply = syntheticCreateReply(); return lastReply;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { if (isolated) await isolated.close(); });

it("composes authenticated explicit review, real privacy derivative and committed fences with one synthetic send", async () => {
  const before = await harness.listings.getById(owner, listingId), connection = await harness.connections.connection(owner);
  const review = await prepare(); expect(send).not.toHaveBeenCalled(); expect(reader.readPrivateImage).not.toHaveBeenCalled(); expect(await attempts()).toHaveLength(0);
  const result = await harness.workflow.confirm(review); expect(result).toEqual({ state: "confirmed", associated: true, simulation: true });
  expect(Object.keys(result).sort()).toEqual(["associated", "simulation", "state"]); expect(JSON.stringify(result)).not.toMatch(/token|digest|seller|path|https|ciphertext/);
  expect(send).toHaveBeenCalledOnce(); const exported = send.mock.calls[0][0] as Buffer, metadata = await sharp(exported).metadata();
  expect(exported).not.toEqual(sourceBytes); expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
  const [attempt] = await attempts(); expect(attempt.sourceDigest).toBe(realMediaDigest(sourceBytes)); expect(attempt.derivativeDigest).toBe(realMediaDigest(exported));
  expect(await associations()).toHaveLength(1); expect(await db.select().from(schema.ebayRealMediaReceipts).where(eq(schema.ebayRealMediaReceipts.attemptId, attempt.id))).toHaveLength(1);
  expect([...storage.objects.values()][0].bytes).toEqual(sourceBytes); expect(await harness.listings.getById(owner, listingId)).toEqual(before);
  expect(await harness.connections.connection(owner)).toEqual(connection); expect(await db.select().from(schema.ebayMediaAttempts)).toEqual([]);
  expect(mediaRuntime()).toEqual({ enabled: false }); expect(() => admitRealMediaEvidence(JSON.parse(lastReply.toString()))).toThrow();
});
it("rejects copied/replayed reviews and serializes simultaneous fresh reviews into one send", async () => {
  const first = await prepare(), second = await prepare();
  await expect(harness.workflow.confirm({ ...first })).rejects.toMatchObject({ code: "stale" });
  const results = await Promise.allSettled([harness.workflow.confirm(first), harness.workflow.confirm(second)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(send).toHaveBeenCalledOnce();
  await expect(harness.workflow.confirm(first)).rejects.toMatchObject({ code: "stale" });
  await expect(confirm()).rejects.toMatchObject({ code: "blocked" }); expect(send).toHaveBeenCalledOnce();
});
it("reclaims a lost unfenced claim with a fresh review while retaining the original consumed action", async () => {
  const secondImage = await addPhoto(), oldReview = await prepare(), claim = harness.repository.claim.bind(harness.repository);
  let old: RealMediaClaim | undefined, input: RealMediaContext | undefined;
  vi.spyOn(harness.repository, "claim").mockImplementationOnce(async (...args) => { input = args[0]; old = await claim(...args); throw new Error("Claim committed but reply lost"); });
  await expect(harness.workflow.confirm(oldReview)).rejects.toMatchObject({ code: "unavailable" }); expect(send).not.toHaveBeenCalled();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + REAL_MEDIA_LEASE_MS + 1);
  expect(await confirm()).toMatchObject({ state: "confirmed", associated: true });
  const rows = await attempts(), retired = rows.find(r => r.id === old!.id)!;
  expect(rows).toHaveLength(2); expect(retired).toMatchObject({ state: "not-sent", actionHash: input!.actionHash, postIntentAt: null });
  await expect(harness.repository.claim({ ...input!, imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
  await expect(harness.workflow.confirm(oldReview)).rejects.toMatchObject({ code: "stale" });
  await expect(harness.repository.notSent(old!)).rejects.toMatchObject({ code: "stale" }); expect(send).toHaveBeenCalledOnce();
});
it.each([{ scopes: EBAY_SCOPES }, { scopes: EBAY_READINESS_SCOPES }, { scopes: [...PROPOSED_MEDIA_SCOPES, EBAY_READINESS_SCOPES[1]] }])("requires the exact proposed media profile, not $scopes", async ({ scopes }) => {
  await db.update(schema.ebayConnections).set({ scopes: [...scopes] }).where(eq(schema.ebayConnections.ownerId, owner));
  await expect(prepare()).rejects.toMatchObject({ code: "stale" }); expect(reader.readPrivateImage).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
it("binds the real signed Better Auth session and owner, including a new session for the same user", async () => {
  const review = await prepare(); await login(foreign);
  await expect(prepare()).rejects.toMatchObject({ code: "stale" }); await expect(harness.workflow.confirm(review)).rejects.toMatchObject({ code: "stale" });
  await login(owner); const another = await prepare(); await login(owner);
  await expect(harness.workflow.confirm(another)).rejects.toMatchObject({ code: "stale" }); expect(await attempts()).toHaveLength(0);
});
it.each(["session", "session-expired", "source", "connection", "grant"])("checks a %s change atomically inside claim after the application check", async kind => {
  const review = await prepare(), claim = harness.repository.claim.bind(harness.repository);
  vi.spyOn(harness.repository, "claim").mockImplementationOnce(async (...args) => { await change(kind); return claim(...args); });
  await expect(harness.workflow.confirm(review)).rejects.toMatchObject({ code: "stale" });
  expect(await attempts()).toHaveLength(0); expect(reader.readPrivateImage).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
async function change(kind: string) {
  if (kind === "session") await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  else if (kind === "session-expired") await db.update(schema.sessions).set({ expiresAt: new Date(0) }).where(eq(schema.sessions.id, sessionId));
  else if (kind === "edit") { const l = (await harness.listings.getById(owner, listingId))!; await harness.listings.update(owner, { ...l, title: "Changed synthetic listing", updatedAt: new Date(Date.parse(l.updatedAt) + 1).toISOString() }, l.updatedAt); }
  else if (kind === "image") await createImageService(harness.images, storage).remove(owner, listingId, imageId);
  else if (kind === "listing") await createListingService(harness.listings, storage).deleteListing(owner, listingId);
  else if (kind === "order") await db.update(schema.listingImages).set({ order: 5 }).where(eq(schema.listingImages.id, imageId));
  else if (kind === "source") await db.update(schema.listingImages).set({ byteSize: sourceBytes.length + 1 }).where(eq(schema.listingImages.id, imageId));
  else if (kind === "recipe") recipe += ";changed";
  else if (kind === "config") config = realMediaDigest("new configuration");
  else await db.update(schema.ebayConnections).set(kind === "grant" ? { scopes: [...EBAY_SCOPES] } : kind === "disconnect" ? { status: "disconnected" }
    : kind === "seller" ? { sellerId: realMediaDigest("different seller") } : { version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, owner));
}
it.each(["edit", "image", "listing", "order", "source", "connection", "disconnect", "seller", "grant", "config", "session", "session-expired", "recipe"])("discards actual derivative bytes after a concurrent %s change", async kind => {
  transformer.transform.mockImplementationOnce(async (...args) => { const result = await photoTransformer.transform(...args); await change(kind); return result; });
  expect(await confirm()).toEqual({ state: "not-sent", associated: false, simulation: true });
  expect(send).not.toHaveBeenCalled(); expect((await attempts())[0].postIntentAt).toBeNull();
});
it("rechecks session revocation inside the fence transaction", async () => {
  const fence = harness.repository.fence.bind(harness.repository);
  vi.spyOn(harness.repository, "fence").mockImplementationOnce(async (...args) => { await change("session"); return fence(...args); });
  expect(await confirm()).toMatchObject({ state: "not-sent" }); expect(send).not.toHaveBeenCalled(); expect((await attempts())[0].postIntentAt).toBeNull();
});
it.each(["session", "session-expired", "source", "connection", "recipe"])("keeps the committed fence when %s changes immediately before send", async kind => {
  const beforeSend = harness.repository.beforeSend.bind(harness.repository);
  vi.spyOn(harness.repository, "beforeSend").mockImplementationOnce(async (...args) => { await change(kind); return beforeSend(...args); });
  expect(await confirm()).toEqual({ state: "unknown", associated: false, simulation: true }); expect(send).not.toHaveBeenCalled();
  expect((await attempts())[0].postIntentAt).not.toBeNull();
});
it.each(["session", "session-expired"])("retains a complete receipt as residual if %s changes between application check and acknowledgement", async kind => {
  const ack = harness.repository.acknowledge.bind(harness.repository);
  vi.spyOn(harness.repository, "acknowledge").mockImplementationOnce(async (...args) => { await change(kind); return ack(...args); });
  expect(await confirm()).toMatchObject({ state: "residual", associated: false }); expect(await associations()).toHaveLength(0);
  const [attempt] = await attempts(); expect((await receipts()).filter(r => r.attemptId === attempt.id)).toHaveLength(1);
});
it("rejects a corrupted saved source without falling back to its original bytes", async () => {
  const corrupted = Buffer.from(sourceBytes.subarray(0, 40)), id = await addPhoto(corrupted);
  expect(await harness.workflow.confirm(await prepare(id))).toMatchObject({ state: "not-sent", associated: false });
  expect(send).not.toHaveBeenCalled();
  const source = (await harness.images.get(owner, listingId, id))!.source; if (source.kind !== "vercel-blob") throw new Error();
  expect(storage.objects.get(source.pathname)!.bytes).toEqual(corrupted);
});
it.each(["transport", "malformed", "oversized", "partial", "conflict", "http-error"])("preserves uncertainty and blocks another send for %s", async kind => {
  send.mockImplementationOnce(async () => {
    if (kind === "transport") throw new Error("private provider data"); if (kind === "malformed") return Buffer.from("not JSON");
    if (kind === "oversized") return Buffer.alloc(65537);
    return syntheticCreateReply(kind === "partial" ? { body: null } : kind === "conflict" ? { location: ["ambiguous", "duplicate"] } : { status: 500 });
  });
  expect(await confirm()).toEqual({ state: "unknown", associated: false, simulation: true });
  await expect(confirm()).rejects.toMatchObject({ code: "blocked" }); expect(send).toHaveBeenCalledOnce(); expect(await associations()).toHaveLength(0);
});
it("does not send when fence commit succeeded but its acknowledgement was lost", async () => {
  const fence = harness.repository.fence.bind(harness.repository);
  vi.spyOn(harness.repository, "fence").mockImplementationOnce(async (...args) => { await fence(...args); throw new Error("Lost commit acknowledgement"); });
  expect(await confirm()).toMatchObject({ state: "unknown" }); await expect(confirm()).rejects.toMatchObject({ code: "blocked" }); expect(send).not.toHaveBeenCalled();
});
it("acknowledges a lost receipt commit response idempotently without another send", async () => {
  const ack = harness.repository.acknowledge.bind(harness.repository);
  vi.spyOn(harness.repository, "acknowledge").mockImplementationOnce(async (...args) => { await ack(...args); throw new Error("Lost commit response"); });
  expect(await confirm()).toMatchObject({ state: "confirmed", associated: true });
  expect(send).toHaveBeenCalledOnce(); expect(await associations()).toHaveLength(1); const [row] = await attempts();
  expect((await receipts()).filter(r => r.attemptId === row.id)).toHaveLength(1);
});
it("never reposts after acknowledgement outage, even with a replacement image", async () => {
  vi.spyOn(harness.repository, "acknowledge").mockRejectedValue(new Error("Unavailable"));
  expect(await confirm()).toMatchObject({ state: "unknown" });
  const replacement = await addPhoto(); expect(await harness.workflow.confirm(await prepare(replacement))).toMatchObject({ state: "not-sent" });
  expect(send).toHaveBeenCalledOnce(); expect((await attempts()).filter(r => r.postIntentAt)).toHaveLength(1);
});
it("keeps contradictory evidence append-only after a successful workflow", async () => {
  expect(await confirm()).toMatchObject({ state: "confirmed" });
  const value = JSON.parse(lastReply.toString()); value.body.imageUrl = "https://eps-contract.invalid.test/photo/test_visual_" + "e".repeat(16) + ".png";
  const proof = await syntheticMediaEvidence(db, owner, captured!.id, value);
  expect(await harness.repository.acknowledge(captured!, proof, { guard: guard!, responseOnly: false })).toEqual({ state: "unknown", associated: false });
  expect((await receipts()).filter(r => r.attemptId === captured!.id)).toHaveLength(2); expect(await associations()).toHaveLength(0);
  await expect(confirm()).rejects.toMatchObject({ code: "blocked" }); expect(send).toHaveBeenCalledOnce();
});
it("holds shared capacity through ignored send cancellation and records late complete results as residual", async () => {
  const secondImage = await addPhoto(await solidPng(), "image/png"), thirdImage = await addPhoto(await solidPng(510, 600), "image/png");
  const a = deferred<Uint8Array>(), b = deferred<Uint8Array>(), c = new AbortController(); send.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const first = harness.workflow.confirm(await prepare(), c.signal), second = harness.workflow.confirm(await prepare(secondImage), c.signal), settled = Promise.all([first, second]);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2)); c.abort();
  await expect(harness.workflow.confirm(await prepare(thirdImage))).rejects.toMatchObject({ code: "busy" });
  const listing = (await harness.listings.getById(owner, listingId))!;
  await expect(harness.derivatives.derive(owner, listingId, listing.updatedAt, thirdImage)).rejects.toMatchObject({ code: "busy" });
  a.resolve(syntheticCreateReply()); b.resolve(syntheticCreateReply());
  expect((await settled).every(r => r.state === "residual" && !r.associated)).toBe(true);
  expect(await harness.derivatives.derive(owner, listingId, listing.updatedAt, thirdImage)).toHaveProperty("derivativeDigest");
});
it("preserves local-delete retention and cleanup retries without touching a foreign photo or erasing evidence", async () => {
  const foreignListing = (await harness.listings.create(foreign, listingFixture())).id, foreignPhoto = randomUUID(), foreignPath = "images/" + foreignListing + "/" + foreignPhoto + ".png";
  await db.insert(schema.listingImages).values({ id: foreignPhoto, listingId: foreignListing, order: 0, storageProvider: "vercel-blob", pathname: foreignPath,
    originalFilename: "generated.png", contentType: "image/png", byteSize: 1024, uploadedAt: new Date().toISOString() });
  storage.objects.set(foreignPath, { bytes: Buffer.alloc(1024), type: "image/png" });
  const source = (await harness.images.get(owner, listingId, imageId))!.source; if (source.kind !== "vercel-blob") throw new Error();
  send.mockImplementationOnce(async () => { await createListingService(harness.listings, storage).deleteListing(owner, listingId); expect(storage.objects.has(source.pathname)).toBe(true); return syntheticCreateReply(); });
  expect(await confirm()).toMatchObject({ state: "residual", associated: false }); expect(await harness.listings.getById(owner, listingId)).toBeNull();
  expect(await harness.connections.connection(owner)).not.toBeNull(); expect(await associations()).toHaveLength(0);
  const [entry] = await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, source.pathname));
  await cleanupImages(db, storage); expect(storage.objects.has(source.pathname)).toBe(true);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(entry.notBefore) + 1); storage.failDelete = true; await cleanupImages(db, storage);
  expect(storage.objects.has(source.pathname)).toBe(true); const [retry] = await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, source.pathname));
  expect(Date.parse(retry.notBefore)).toBeGreaterThan(Date.now()); storage.failDelete = false; vi.setSystemTime(Date.parse(retry.notBefore) + 1); await cleanupImages(db, storage);
  expect(storage.objects.has(source.pathname)).toBe(false); expect(storage.objects.has(foreignPath)).toBe(true);
  expect((await attempts())[0].postIntentAt).not.toBeNull(); expect((await receipts()).filter(r => r.attemptId === captured!.id)).toHaveLength(1);
});
it("refuses production, Vercel and ordinary test-database composition without weakening the proof namespace", async () => {
  const options = { session: async () => null, reader, configHash: () => config };
  vi.stubEnv("NODE_ENV", "production"); await expect(composeFakeMediaWorkflow(db, options)).rejects.toMatchObject({ code: "contract" });
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL", "1"); await expect(composeFakeMediaWorkflow(db, options)).rejects.toMatchObject({ code: "contract" });
  vi.stubEnv("VERCEL", "");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 1 });
  try { await expect(composeFakeMediaWorkflow(drizzle(pool, { schema }), options)).rejects.toMatchObject({ code: "contract" }); }
  finally { await pool.end(); }
  expect(send).not.toHaveBeenCalled(); expect(await db.select().from(schema.ebayMediaAttempts).where(and(eq(schema.ebayMediaAttempts.ownerId, owner)))).toHaveLength(0);
});
