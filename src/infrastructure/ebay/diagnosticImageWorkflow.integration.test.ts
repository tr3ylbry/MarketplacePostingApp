import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import tls from "node:tls";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { diagnosticImageWire, SYNTHETIC_PRIMARY } from "../../test/diagnosticImageWire";
import { imageWireResponse } from "../../test/imageDownloaderFixtures";
import * as nativeComparison from "../storage/diagnosticImageDecode";
import { disposableVerificationDatabase } from "../../test/disposableVerificationDatabase";
import { authOptions } from "../../auth/options";
import { listingFixture } from "../../test/fixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { createImageService } from "../../application/imageService";
import { createPhotoDerivativeService } from "../../application/photoDerivativeService";
import { acquirePhotoCapacity, releasePhotoCapacity } from "../../application/photoCapacity";
import { EBAY_DISCOVERY_SCOPES } from "../../application/ebayConnection";
import { realMediaDigest, type RealMediaClaim, type RealMediaReviewGuard } from "../../application/ebayRealMedia";
import type { VerificationReference, VerificationEnvelope } from "../../application/ebayImageVerificationPersistence";
import { generateVerificationFixture as generateCaptureFixture } from "../storage/verificationFixture";
import { photoTransformer, PHOTO_RECIPE } from "../storage/photoDerivative/transformPhoto";
import { DrizzleEbayImageVerificationRepository } from "../repositories/drizzleEbayImageVerificationRepository";
import { DrizzleEbayRealMediaRepository } from "../repositories/drizzleEbayRealMediaRepository";
import { DrizzleMediaCaptureRepository } from "../repositories/drizzleMediaCaptureRepository";
import { DrizzleListingRepository } from "../repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../repositories/drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "../repositories/drizzleEbayConnectionRepository";
import { createDiagnosticImageWorkflow, type DiagnosticImageDependencies, type DiagnosticImageOperation } from "./diagnosticImageWorkflow";
import { mediaRuntime } from "./mediaRuntime";
import { admitRealMediaEvidence } from "./realMediaEvidence";
import * as schema from "../db/schema";

vi.mock("server-only", () => ({}));
vi.mock("dotenv", () => { throw Error("Private environment forbidden."); });
vi.mock("@vercel/blob", () => { throw Error("Real storage forbidden."); });
vi.mock("./ebayClient", () => { throw Error("Provider gateway forbidden."); });
vi.mock("./tokenCipher", () => { throw Error("Real credential construction forbidden."); });
vi.mock("./imageAddressSetPolicy", async original => {
  const actual = await original<typeof import("./imageAddressSetPolicy")>();
  return { ...actual, inspectImageAddressSet: (...args: Parameters<typeof actual.inspectImageAddressSet>) => {
    const value = actual.inspectImageAddressSet(...args);
    return value.candidate ? { ...value, candidate: { address: "127.0.0.1", family: 4 as const } } : value;
  } };
});
let isolated: Awaited<ReturnType<typeof disposableVerificationDatabase>>, db: typeof isolated.db;
const makeAuth = (database: typeof db) => betterAuth({ ...authOptions(database, { BETTER_AUTH_URL: "https://127.0.0.1:3000",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), GITHUB_CLIENT_ID: "synthetic", GITHUB_CLIENT_SECRET: "synthetic" }),
  session: { expiresIn: 604800, updateAge: 86400, deferSessionRefresh: true, cookieCache: { enabled: false } }, plugins: [testUtils()] });
let auth: ReturnType<typeof makeAuth>, headers: Headers, owner: string, foreign: string, sessionId: string, listingId: string, imageId: string, seller: string;
let wire: Awaited<ReturnType<typeof diagnosticImageWire>>, storage: MemoryImageStorage, source: Awaited<ReturnType<typeof generateCaptureFixture>>;
let media: DrizzleEbayRealMediaRepository, verification: DrizzleEbayImageVerificationRepository, evidence: DrizzleMediaCaptureRepository;
let listings: DrizzleListingRepository, images: DrizzleImageRepository, connections: DrizzleEbayConnectionRepository;
let deps: DiagnosticImageDependencies, workflow: ReturnType<typeof createDiagnosticImageWorkflow>, claim: RealMediaClaim | undefined;
let ref: VerificationReference | undefined, guard: RealMediaReviewGuard | undefined;
const config = realMediaDigest("synthetic-diagnostic-config"), transactions = new AsyncLocalStorage<boolean>();
const operations: DiagnosticImageOperation[] = [];
const a = schema.ebayRealMediaAttempts, v = schema.ebayImageVerifications, e = schema.ebayImageVerificationOutcomes;
const parents = () => db.select().from(a).where(eq(a.ownerId, owner));
const reservations = () => db.select().from(v).where(eq(v.ownerId, owner));
const events = () => db.select().from(e).where(eq(e.ownerId, owner));
async function login(user = owner) { const s = await (await auth.$context).test.login({ userId: user }); headers = s.headers; sessionId = s.session.id; }
async function addPhoto() {
  const service = createImageService(images, storage), p = await service.prepare(owner, listingId, { filename: "generated.png", contentType: "image/png", size: source.bytes.length });
  storage.objects.set(storage.uploads.get(p.imageId)!.pathname, { bytes: Buffer.from(source.bytes), type: "image/png" });
  await service.finalize(owner, listingId, p.imageId); return p.imageId;
}
async function prepare() { return workflow.prepare(listingId, imageId, seller, source.sourceDigest); }
async function begin(signal?: AbortSignal) { const op = workflow.confirm(await prepare(), signal); operations.push(op); return op; }
async function complete(signal?: AbortSignal) { const op = await begin(signal), result = await op.result; await op.settled; return result; }
async function noAdmission() {
  expect(await db.select().from(schema.ebayRealMediaReceipts)).toEqual([]);
  expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);
  expect(mediaRuntime()).toEqual({ enabled: false }); expect(() => admitRealMediaEvidence({})).toThrow();
}
beforeAll(async () => { isolated = await disposableVerificationDatabase(); db = isolated.db; auth = makeAuth(db); }, 30_000);
beforeEach(async () => {
  wire = await diagnosticImageWire(Number(new URL(process.env.TEST_DATABASE_URL!).port || 5432));
  await db.execute(sql`DROP TRIGGER IF EXISTS aaa_diagnostic_short_parent ON public.ebay_real_media_attempts`);
  await db.execute(sql`DROP TRIGGER IF EXISTS aaa_diagnostic_short_review ON public.ebay_image_verifications`);
  const h = (await auth.$context).test; owner = (await h.saveUser(h.createUser())).id; foreign = (await h.saveUser(h.createUser())).id;
  await login(); seller = realMediaDigest(owner); claim = undefined; ref = undefined; guard = undefined;
  media = new DrizzleEbayRealMediaRepository(db); verification = new DrizzleEbayImageVerificationRepository(db); evidence = new DrizzleMediaCaptureRepository(db);
  listings = new DrizzleListingRepository(db); images = new DrizzleImageRepository(db); connections = new DrizzleEbayConnectionRepository(db);
  storage = new MemoryImageStorage(); source = await generateCaptureFixture(); listingId = (await listings.create(owner, listingFixture())).id; imageId = await addPhoto();
  await db.insert(schema.ebayConnections).values({ ownerId: owner, id: randomUUID(), version: randomUUID(), configHash: config, status: "connected", sellerId: seller,
    sellerLabel: "Synthetic", scopes: [...EBAY_DISCOVERY_SCOPES], access: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 },
    refresh: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 }, connectedAt: sql`clock_timestamp()`,
    accessExpiresAt: sql`clock_timestamp()+interval '1 hour'`, refreshExpiresAt: sql`clock_timestamp()+interval '1 day'` });
  const tx = db.transaction.bind(db); vi.spyOn(db, "transaction").mockImplementation((...args) => transactions.run(true, () => tx(...args)));
  const take = media.claim.bind(media), fence = media.fence.bind(media), reserve = verification.reserveVerification.bind(verification);
  vi.spyOn(media, "claim").mockImplementation(async (...args) => { guard = args[1]; claim = await take(...args); return claim; });
  vi.spyOn(media, "fence").mockImplementation(async (...args) => { claim = await fence(...args); return claim; });
  vi.spyOn(verification, "reserveVerification").mockImplementation(async (...args) => { ref = await reserve(...args); return ref; });
  const derivative = createPhotoDerivativeService(listings, images, connections, { async readPrivateImage(p, signal) {
    expect(transactions.getStore()).not.toBe(true); signal.throwIfAborted();
    const row = (await db.select().from(schema.listingImages).where(eq(schema.listingImages.pathname, p.pathname)))[0];
    expect(Date.parse(row.providerRetainUntil!)).toBeGreaterThan(Date.now());
    return Buffer.from(storage.objects.get(p.pathname)!.bytes);
  } }, photoTransformer, config);
  deps = { auth: auth.api, headers: async () => headers, repository: media, verification, evidence, derive: derivative.derive,
    configHash: () => config, recipe: () => PHOTO_RECIPE, credential: vi.fn(async () => { expect(transactions.getStore()).not.toBe(true); return "synthetic-only"; }) };
  workflow = createDiagnosticImageWorkflow(deps);
  wire.response.dispatch = () => { expect(transactions.getStore()).not.toBe(true); };
  wire.response.before = async (request, bytes) => {
    const boundary = /boundary=(.+)$/.exec(request.headers["content-type"]!)![1];
    const prefix = bytes.indexOf("\r\n\r\n") + 4, suffix = Buffer.byteLength(`\r\n--${boundary}--\r\n`);
    const digest = realMediaDigest(bytes.subarray(prefix, -suffix)), parent = (await parents()).find(p => p.derivativeDigest === digest);
    expect(parent).toMatchObject({ state: "unknown", operation: "capture-only", revision: 1 });
    expect((await reservations()).find(v => v.uploadAttemptId === parent!.id)).toMatchObject({ phase: "prepared", parentPreparingRevision: 0 });
  };
});
afterEach(async () => {
  operations.forEach(op => op.cancel()); await Promise.all(operations.map(op => op.settled)); operations.length = 0;
  await wire.close();
});
afterAll(async () => { if (isolated) await isolated.close(); });

it("migrates repeatably and completes authenticated native POST→intent→GET with permanent accounting, privacy and settled capacity", async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  const original = Buffer.from(source.bytes), before = await connections.connection(owner), order: string[] = [];
  const snapshot = media.snapshot.bind(media), upload = evidence.authorize.bind(evidence), get = verification.checkIntentContext.bind(verification);
  vi.spyOn(media, "snapshot").mockImplementation(async (...args) => { const value = await snapshot(...args); order.push("snapshot"); return value; });
  vi.spyOn(evidence, "authorize").mockImplementation(async (...args) => { await upload(...args); order.push("upload-auth"); });
  vi.spyOn(verification, "checkIntentContext").mockImplementation(async (...args) => { expect(order[order.length - 1]).toBe("snapshot"); await get(...args); order.push("get-auth"); });
  const dispatch = wire.response.dispatch;
  wire.response.dispatch = method => { dispatch(method); if (method === "POST") expect(order[order.length - 1]).toBe("upload-auth"); };
  const result = await complete();
  expect(result).toMatchObject({ state: "unknown", associated: false, retrieved: true, reason: "completed", settlement: "settled", diagnostic: { outcome: "retrieved", bytes: 4, unverified: true, associated: false } });
  expect(order[order.length - 1]).toBe("get-auth"); expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(1); expect(wire.resolver.questions).toHaveLength(2);
  const raw = wire.image.requests[0].toString(); expect(raw).toContain("GET " + SYNTHETIC_PRIMARY.split(".com")[1] + " HTTP/1.1\r\n"); expect(raw).not.toMatch(/authorization|cookie|referer|synthetic-only/i);
  expect(source.bytes).toEqual(original); expect(await connections.connection(owner)).toEqual(before);
  expect(deps.credential).toHaveBeenCalledOnce();
  const [parent] = await parents(), [row] = await reservations(); expect(parent.postIntentAt).not.toBeNull(); expect(row).toMatchObject({ phase: "intent-recorded", parentPreparingRevision: 0 });
  expect(await events()).toHaveLength(2); expect((await events()).find(e => e.envelope.event === "response")?.envelope).toMatchObject({ event: "response", httpStatus: 200 });
  expect(JSON.stringify(await events())).not.toMatch(/opaque|image%41|CAPABILITY|synthetic-only|pathname|ciphertext/);
  expect(JSON.stringify(result)).not.toMatch(/opaque|image%41|seller|token|session|sourceDigest|derivativeDigest|pathname/); await noAdmission();
  const one = acquirePhotoCapacity(), two = acquirePhotoCapacity(); expect(() => acquirePhotoCapacity()).toThrow(); releasePhotoCapacity(one); releasePhotoCapacity(two);
});
it.each(["cookie", "tampered", "expired", "revoked", "foreign-session", "review-copy", "wrong-seller", "wrong-source"])("rejects %s authentication/review context without sending", async kind => {
  const review = await prepare();
  if (kind === "cookie") headers = new Headers(); if (kind === "tampered") headers = new Headers({ cookie: "__Secure-better-auth.session_token=not-signed" });
  if (kind === "expired") await db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, sessionId));
  if (kind === "revoked") await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  if (kind === "foreign-session") await login(foreign);
  if (kind === "wrong-seller") await db.update(schema.ebayConnections).set({ sellerId: realMediaDigest("other") }).where(eq(schema.ebayConnections.ownerId, owner));
  if (kind === "wrong-source") await db.update(schema.listingImages).set({ originalFilename: "changed.png" }).where(eq(schema.listingImages.id, imageId));
  if (kind === "review-copy") expect(() => workflow.confirm({ ...review })).toThrow();
  else { const op = workflow.confirm(review); operations.push(op); expect((await op.result).retrieved).toBe(false); await op.settled; }
  expect(wire.posts).toHaveLength(0); expect(wire.image.requests).toHaveLength(0); await noAdmission();
});
it.each(["claim-before", "claim-lost-ack", "derive", "reserve-before", "reserve-lost-ack", "fence-before", "fence-lost-ack", "capture-evidence", "intent-before", "intent-lost-ack", "window-after-intent", "final-check"])("stops at %s without resuming requests or clearing consumed history", async cut => {
  if (cut === "claim-before") vi.mocked(media.claim).mockRejectedValue(new Error("synthetic"));
  if (cut === "claim-lost-ack") { const original = vi.mocked(media.claim).getMockImplementation()!; vi.mocked(media.claim).mockImplementation(async (...args) => { await original(...args); throw Error("lost acknowledgement"); }); }
  if (cut === "derive") deps.derive = async () => { throw Error("synthetic"); };
  if (cut === "reserve-before") vi.mocked(verification.reserveVerification).mockRejectedValue(new Error("synthetic"));
  if (cut === "reserve-lost-ack") { const original = vi.mocked(verification.reserveVerification).getMockImplementation()!; vi.mocked(verification.reserveVerification).mockImplementation(async (...args) => { await original(...args); throw Error("lost acknowledgement"); }); }
  if (cut === "fence-before") vi.mocked(media.fence).mockRejectedValue(new Error("synthetic"));
  if (cut === "fence-lost-ack") { const original = vi.mocked(media.fence).getMockImplementation()!; vi.mocked(media.fence).mockImplementation(async (...args) => { await original(...args); throw Error("lost acknowledgement"); }); }
  if (cut === "capture-evidence") vi.spyOn(evidence, "record").mockRejectedValue(new Error("synthetic"));
  if (cut === "intent-before") vi.spyOn(verification, "recordRequestIntent").mockRejectedValue(new Error("synthetic"));
  if (cut === "intent-lost-ack") { const original = verification.recordRequestIntent.bind(verification); vi.spyOn(verification, "recordRequestIntent").mockImplementation(async (...args) => { await original(...args); throw Error("lost acknowledgement"); }); }
  if (cut === "window-after-intent") { const original = verification.window.bind(verification); vi.spyOn(verification, "window").mockImplementation(async (...args) => { if (args[2] === "intent-recorded") throw Error("synthetic"); return original(...args); }); }
  if (cut === "final-check") vi.spyOn(verification, "checkIntentContext").mockRejectedValue(new Error("synthetic"));
  const result = await complete(); expect(result.retrieved).toBe(false); expect(wire.image.requests).toHaveLength(0);
  expect(wire.posts.length).toBe(["capture-evidence", "intent-before", "intent-lost-ack", "window-after-intent", "final-check"].includes(cut) ? 1 : 0);
  const retained = await parents();
  if (["fence-lost-ack", "capture-evidence", "intent-before", "intent-lost-ack", "window-after-intent", "final-check"].includes(cut)) expect(retained[0]).toMatchObject({ state: "unknown", postIntentAt: expect.any(String) });
  if (cut === "intent-lost-ack") expect((await reservations())[0].requestIntentAt).not.toBeNull();
  if (cut.includes("lost-ack")) expect(retained.length).toBeGreaterThan(0);
  if (cut === "reserve-lost-ack") expect(await reservations()).toHaveLength(1);
  await noAdmission();
});
it.each(["capture", "outcome"])("retries only an identical local %s acknowledgement, never POST/GET", async kind => {
  if (kind === "capture") { const original = evidence.record.bind(evidence); let lost = true; vi.spyOn(evidence, "record").mockImplementation(async (...args) => { await original(...args); if (lost) { lost = false; throw Error("lost"); } }); }
  else { const original = verification.recordOutcome.bind(verification); let lost = true; vi.spyOn(verification, "recordOutcome").mockImplementation(async (...args) => { const value = await original(...args); if (lost) { lost = false; throw Error("lost"); } return value; }); }
  expect((await complete()).retrieved).toBe(true); expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(1); expect(await events()).toHaveLength(2);
});
it("does not claim acknowledged success after all outcome acknowledgements are lost", async () => {
  const original = verification.recordOutcome.bind(verification); vi.spyOn(verification, "recordOutcome").mockImplementation(async (...args) => { await original(...args); throw Error("lost"); });
  const result = await complete(); expect(result).toMatchObject({ retrieved: true, acknowledgement: "uncertain", associated: false, reason: "unavailable" });
  expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(1); expect((await events()).length).toBeGreaterThan(0);
});
it.each(["review-replay", "restart", "changed-source-id"])("never resumes a fenced operation after %s", async kind => {
  const review = await prepare(), op = workflow.confirm(review); operations.push(op); expect((await op.result).retrieved).toBe(true); await op.settled;
  if (kind === "review-replay") expect(() => workflow.confirm(review)).toThrow();
  else { if (kind === "changed-source-id") imageId = await addPhoto(); workflow = createDiagnosticImageWorkflow(deps); expect((await complete()).retrieved).toBe(false); }
  expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(1); expect((await parents()).some(p => p.postIntentAt !== null)).toBe(true); await noAdmission();
});
it.each(["missing-primary", "unsafe", "duplicate", "truncated", "oversized"])("preserves upload fences and creates no GET intent on %s native create evidence", async kind => {
  wire.response.body = () => kind === "missing-primary" ? '{"maxDimensionImageUrl":"https://not-used.invalid/x"}' : kind === "unsafe" ? JSON.stringify({ imageUrl: "https://127.0.0.1/x", expirationDate: new Date(Date.now() + 3_600_000).toISOString() }) : kind === "duplicate" ? '{"imageUrl":"x","imageUrl":"y"}' : kind === "truncated" ? "{" : "x".repeat(65_537);
  expect((await complete()).retrieved).toBe(false); expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(0);
  expect((await parents())[0].postIntentAt).not.toBeNull(); expect((await reservations())[0].requestIntentAt).toBeNull(); await noAdmission();
});
it("retains bounded contradictory/late evidence with idempotency and overflow, without dispatching again", async () => {
  await complete(); const [row] = await reservations();
  const retainedRef = { ...ref!, parent: claim!, revision: 1 };
  const different: VerificationEnvelope = { version: "diagnostic-verification-v1", event: "response", reason: "bounded-response", settlement: "settled", httpStatus: 200, bytes: 5, exceeded: false, mime: "image/png" };
  const one = await verification.recordOutcome(retainedRef, { intentRevision: 1, envelope: different });
  expect(await verification.recordOutcome(retainedRef, { intentRevision: 1, envelope: different })).toEqual(one);
  await verification.recordOutcome(retainedRef, { intentRevision: 1, envelope: { ...different, event: "cancelled", reason: "cancelled", settlement: "unsettled", httpStatus: null, bytes: 0, mime: null } });
  expect(await verification.recordOutcome(retainedRef, { intentRevision: 1, envelope: { ...different, event: "failure", reason: "transport", httpStatus: null } })).toMatchObject({ overflow: true });
  expect(await events()).toHaveLength(4); expect(await verification.status(owner, row.id)).toMatchObject({ conflict: true, overflow: true, associated: false });
  expect(await verification.status(foreign, row.id)).toBeNull(); await expect(verification.checkIntentContext(retainedRef, guard!)).rejects.toThrow();
  expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(1); await noAdmission();
});
it.each([false, true])("shares exactly two complete-operation slots through pending authorization and settlement (cancel=%s)", async cancel => {
  const firstImage = imageId, firstDigest = source.sourceDigest;
  source = await generateCaptureFixture(); const secondImage = await addPhoto(), secondDigest = source.sourceDigest;
  const first = createDiagnosticImageWorkflow(deps), second = createDiagnosticImageWorkflow(deps), third = createDiagnosticImageWorkflow(deps);
  const ra = await first.prepare(listingId, firstImage, seller, firstDigest), rb = await second.prepare(listingId, secondImage, seller, secondDigest), rc = await third.prepare(listingId, firstImage, seller, firstDigest);
  const original = verification.checkIntentContext.bind(verification);
  let release!: () => void, entered = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(verification, "checkIntentContext").mockImplementation(async (...args) => { entered++; await gate; await original(...args); });
  // Overlap complete operations at the pending-authorization phase. Existing
  // NOWAIT upload rechecks deliberately refuse shared-row contention; capacity
  // is not a promise that simultaneous SQL transitions on one seller succeed.
  const a = first.confirm(ra); operations.push(a); let b: DiagnosticImageOperation | undefined;
  try {
    for (let i = 0; i < 300 && entered < 1; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(entered).toBe(1); b = second.confirm(rb); operations.push(b);
    for (let i = 0; i < 300 && entered < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(entered).toBe(2);
    if (cancel) { a.cancel(); b.cancel(); await Promise.all([a.result, b.result]); }
    const c = third.confirm(rc); operations.push(c); expect((await c.result).reason).toBe("busy"); await c.settled;
    expect(wire.posts).toHaveLength(2); expect(wire.image.requests).toHaveLength(0);
    expect(() => acquirePhotoCapacity()).toThrow();
  } finally { release(); }
  const results = await Promise.all([a.result, b!.result]); await Promise.all([a.settled, b!.settled]);
  expect(results.every(value => value.retrieved === !cancel)).toBe(true); expect(wire.image.requests).toHaveLength(cancel ? 0 : 2);
  const one = acquirePhotoCapacity(), two = acquirePhotoCapacity(); releasePhotoCapacity(one); releasePhotoCapacity(two);
  expect((await parents()).filter(p => p.postIntentAt !== null)).toHaveLength(2); await noAdmission();
});
it("keeps existing NOWAIT upload contention fail-closed without retrying or releasing content fences", async () => {
  const original = evidence.authorize.bind(evidence); let refused = false;
  vi.spyOn(evidence, "authorize").mockImplementation(async (...args) => {
    const blocker = await isolated.pool.connect(); await blocker.query("BEGIN");
    try { await blocker.query("SELECT id FROM listings WHERE id=$1 FOR UPDATE", [listingId]);
      await expect(original(...args)).rejects.toThrow(); refused = true; throw Error("Expected NOWAIT contention");
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });
  expect((await complete()).retrieved).toBe(false); expect(refused).toBe(true);
  expect(wire.posts).toHaveLength(0); expect(wire.image.requests).toHaveLength(0); expect((await parents())[0].postIntentAt).not.toBeNull(); await noAdmission();
});
it("records cancellation during actual body streaming and compatible late settlement without positive HTTP claims", async () => {
  const cancel = new AbortController();
  wire.response.image = socket => { socket.write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 10000\r\nConnection: close\r\n\r\nx"); cancel.abort(); };
  const op = await begin(cancel.signal), early = await op.result; expect(early).toMatchObject({ retrieved: false, settlement: "unsettled", reason: "cancelled" });
  await op.settled; expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(1);
  const saved = await events(); expect(saved.some(x => x.envelope.event === "cancelled")).toBe(true); expect(saved.some(x => x.envelope.event === "settlement" && x.late)).toBe(true);
  expect(saved.every(x => x.envelope.httpStatus === null)).toBe(true); expect(await verification.status(owner, ref!.id)).toMatchObject({ conflict: false, associated: false }); await noAdmission();
});
it.each(["before-confirm", "during-derive", "after-upload-auth", "after-response", "before-intent"])("stops cancellation at %s and never creates a late GET", async cut => {
  const controller = new AbortController();
  if (cut === "during-derive") { const original = deps.derive; deps.derive = async (...args) => { const value = await original(...args); controller.abort(); return value; }; }
  if (cut === "after-upload-auth") { const original = evidence.authorize.bind(evidence); vi.spyOn(evidence, "authorize").mockImplementation(async (...args) => { await original(...args); controller.abort(); }); }
  if (cut === "after-response") wire.response.before = async () => { controller.abort(); };
  if (cut === "before-intent") { const original = evidence.record.bind(evidence); vi.spyOn(evidence, "record").mockImplementation(async (...args) => { await original(...args); controller.abort(); }); }
  const review = await prepare(); if (cut === "before-confirm") controller.abort();
  const op = workflow.confirm(review, controller.signal); operations.push(op); expect((await op.result).retrieved).toBe(false); await op.settled;
  expect(wire.posts).toHaveLength(["after-response", "before-intent"].includes(cut) ? 1 : 0); expect(wire.image.requests).toHaveLength(0);
  if (["after-upload-auth", "after-response", "before-intent"].includes(cut)) expect((await parents())[0].postIntentAt).not.toBeNull();
  await noAdmission();
});
it.each(["disconnect", "connection-version", "config", "grant", "image", "session"])("preserves response/fences but refuses GET when %s changes after POST", async kind => {
  wire.response.before = async () => {
    if (kind === "disconnect") await connections.disconnect(owner);
    if (kind === "connection-version") await db.update(schema.ebayConnections).set({ version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, owner));
    if (kind === "config") await db.update(schema.ebayConnections).set({ configHash: realMediaDigest("changed") }).where(eq(schema.ebayConnections.ownerId, owner));
    if (kind === "grant") await db.update(schema.ebayConnections).set({ scopes: [EBAY_DISCOVERY_SCOPES[0]] }).where(eq(schema.ebayConnections.ownerId, owner));
    if (kind === "image") await listings.delete(owner, listingId);
    if (kind === "session") await login();
  };
  const result = await complete(); expect(result.retrieved).toBe(false); expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(0);
  expect((await parents())[0].postIntentAt).not.toBeNull(); expect(await events()).not.toHaveLength(0); await noAdmission();
});
it("floors database microseconds in the integration deadline snapshot and changes no reservation fields", async () => {
  const original = verification.window.bind(verification); let inspected = false;
  vi.spyOn(verification, "window").mockImplementation(async (...args) => {
    const before = (await isolated.pool.query("SELECT row_to_json(v)::text AS row FROM ebay_image_verifications v WHERE id=$1", [args[0].id])).rows[0].row;
    const result = await original(...args);
    const check = (await isolated.pool.query("SELECT $2::numeric=floor(extract(epoch FROM least(v.lease_until,a.lease_until))*1000) AS lease,$3::numeric=floor(extract(epoch FROM coalesce(v.request_deadline,v.lease_until))*1000) AS request FROM ebay_image_verifications v JOIN ebay_real_media_attempts a ON a.id=v.upload_attempt_id WHERE v.id=$1", [args[0].id, result.lease, result.request])).rows[0];
    expect(check).toEqual({ lease: true, request: true });
    expect((await isolated.pool.query("SELECT row_to_json(v)::text AS row FROM ebay_image_verifications v WHERE id=$1", [args[0].id])).rows[0].row).toBe(before);
    inspected = true; return result;
  });
  expect((await complete()).retrieved).toBe(true); expect(inspected).toBe(true);
});
it.each(["closed", "intent-recorded"])("does not POST if the diagnostic reservation becomes %s after parent authorization", async phase => {
  const original = evidence.authorize.bind(evidence);
  vi.spyOn(evidence, "authorize").mockImplementation(async (...args) => {
    await original(...args);
    if (phase === "closed") await verification.closePrepared({ ...ref!, parent: claim! }, "cancelled");
    else await verification.recordRequestIntent({ ...ref!, parent: claim! }, guard!, { responseReceivedAt: new Date().toISOString(), providerExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  });
  expect((await complete()).retrieved).toBe(false); expect(wire.posts).toHaveLength(0); expect(wire.image.requests).toHaveLength(0);
  expect((await parents())[0].postIntentAt).not.toBeNull(); expect((await reservations())[0].phase).toBe(phase); await noAdmission();
});
it.each(["lost-response", "unsupported-response", "unsolicited", "peer"])("retains immutable GET intent and refuses %s without a retry", async kind => {
  if (kind === "lost-response") wire.response.image = socket => { socket.destroy(); };
  if (kind === "unsupported-response") wire.response.image = socket => { socket.end("HTTP/1.1 302 Found\r\nLocation: https://not-used.invalid/x\r\nContent-Length: 0\r\n\r\n"); };
  if (kind === "peer") {
    const native = vi.mocked(tls.connect).getMockImplementation()!;
    vi.mocked(tls.connect).mockImplementation(((...args: Parameters<typeof tls.connect>) => {
      const socket = Reflect.apply(native, tls, args) as tls.TLSSocket;
      Object.defineProperty(socket, "remoteAddress", { get: () => "127.0.0.2" }); return socket;
    }) as typeof tls.connect);
  }
  if (kind === "unsolicited") {
    const native = vi.mocked(tls.connect).getMockImplementation()!;
    let client: tls.TLSSocket | undefined;
    vi.mocked(tls.connect).mockImplementation(((...args: Parameters<typeof tls.connect>) => {
      client = Reflect.apply(native, tls, args) as tls.TLSSocket; return client;
    }) as typeof tls.connect);
    const original = verification.checkIntentContext.bind(verification);
    vi.spyOn(verification, "checkIntentContext").mockImplementation(async (...args) => {
      for (const socket of wire.image.sockets) if (socket instanceof tls.TLSSocket) socket.write("HTTP/1.1");
      for (let i = 0; i < 500 && !client?.readableLength; i++) await new Promise(resolve => setTimeout(resolve, 2));
      expect(client?.readableLength).toBeGreaterThan(0); await original(...args);
    });
  }
  const result = await complete(); expect(result.retrieved).toBe(false); expect(wire.posts).toHaveLength(1);
  expect(wire.image.requests).toHaveLength(["lost-response", "unsupported-response"].includes(kind) ? 1 : 0);
  expect((await reservations())[0].requestIntentAt).not.toBeNull(); expect((await parents())[0].postIntentAt).not.toBeNull();
  expect((await events()).every(e => e.envelope.httpStatus === null)).toBe(true); await noAdmission();
});
it.each(["session", "refresh", "lease", "review", "policy", "access"])("refuses %s expiry across a demonstrated final post-snapshot database lock wait", async kind => {
  let deadline: string;
  const policy = (await isolated.pool.query("SELECT pg_get_functiondef('public.image_verification_policy_cutoff()'::regprocedure) AS definition")).rows[0].definition as string;
  if (kind === "session") {
    deadline = (await isolated.pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2200 milliseconds' WHERE id=$1 RETURNING expires_at", [sessionId])).rows[0].expires_at.toISOString();
  } else if (kind === "refresh" || kind === "access") {
    const column = kind === "refresh" ? "refresh_expires_at" : "access_expires_at";
    // The genuine access test honors the existing30s review headroom. Other
    // deadlines also expire while this longer wait remains blocked; focused
    // persistence tests separately isolate each expiry guard.
    deadline = (await isolated.pool.query(`UPDATE ebay_connections SET ${column}=clock_timestamp()+$2*interval '1 millisecond' WHERE owner_id=$1 RETURNING ${column} AS at`, [owner, kind === "access" ? 35_000 : 2200])).rows[0].at.toISOString();
  } else if (kind === "lease" || kind === "review") {
    const parent = kind === "lease";
    await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION public.test_diagnostic_short() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.${parent ? "lease_until" : "review_until"}:=clock_timestamp()+interval '2200 milliseconds';RETURN NEW;END $$`));
    await db.execute(sql.raw(`CREATE TRIGGER aaa_diagnostic_short_${parent ? "parent" : "review"} BEFORE INSERT ON public.${parent ? "ebay_real_media_attempts" : "ebay_image_verifications"} FOR EACH ROW EXECUTE FUNCTION public.test_diagnostic_short()`));
    deadline = "";
  } else {
    const cutoff = (await isolated.pool.query("SELECT to_char((clock_timestamp()+interval '2200 milliseconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at")).rows[0].at;
    await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION public.image_verification_policy_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT '${cutoff}'::timestamptz $$`));
    deadline = cutoff;
  }
  const original = verification.checkIntentContext.bind(verification); let waited = false, liveBefore = false;
  vi.spyOn(verification, "checkIntentContext").mockImplementation(async (...args) => {
    if (kind === "lease" || kind === "review") deadline = (await isolated.pool.query(`SELECT ${kind === "lease" ? "lease_until" : "review_until"} AS at FROM ebay_image_verifications WHERE id=$1`, [args[0].id])).rows[0].at.toISOString();
    const blocker = await isolated.pool.connect(); await blocker.query("BEGIN"); let pending: Promise<void> | undefined;
    try {
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT id FROM listings WHERE id=$1 FOR UPDATE", [listingId]);
      liveBefore = (await isolated.pool.query("SELECT clock_timestamp()<$1::timestamptz AS live", [deadline])).rows[0].live;
      pending = original(...args); const caught = pending.then(() => true, () => false);
      for (let n = 0; n < 200; n++) { const q = await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))", [pid]); if (q.rows[0].n) { waited = true; break; } await new Promise(resolve => setTimeout(resolve, 5)); }
      expect(waited).toBe(true); expect(liveBefore).toBe(true);
      await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '50 milliseconds')", [deadline]);
      await blocker.query("COMMIT"); expect(await caught).toBe(false);
      throw Error("Final authorization refused after real expiry");
    } finally { await blocker.query("ROLLBACK"); blocker.release(); if (pending) await pending.catch(() => {}); }
  });
  try {
    const result = await complete(); expect(result.retrieved).toBe(false); expect(waited && liveBefore).toBe(true);
    expect(wire.posts).toHaveLength(1); expect(wire.image.requests).toHaveLength(0); expect((await parents())[0].postIntentAt).not.toBeNull();
    await noAdmission();
  } finally { if (kind === "policy") await db.execute(sql.raw(policy)); }
}, 45_000);

it.each(["png","jpeg","different-marker","corrupt","mirror","crop"])("composes full guarded retrieval→decode→comparison for %s without admission",async kind=>{
 const before=Buffer.from(source.bytes),original=wire.response.before;let returned:Buffer|undefined,mime:"image/png"|"image/jpeg"="image/png";
 wire.response.before=async(req,body)=>{
  await original(req,body);const boundary=/boundary=(.+)$/.exec(req.headers["content-type"]!)![1];
  const exact=body.subarray(body.indexOf("\r\n\r\n")+4,-Buffer.byteLength(`\r\n--${boundary}--\r\n`));
  if(kind==="jpeg"){returned=await sharp(exact).jpeg({quality:85,chromaSubsampling:"4:2:0",progressive:true}).toBuffer();mime="image/jpeg";}
  else if(kind==="different-marker")returned=(await generateCaptureFixture()).bytes;
  else if(kind==="corrupt")returned=Buffer.from([137,80,78,71]);
  else if(kind==="mirror")returned=await sharp(exact).flop().png().toBuffer();
  else if(kind==="crop")returned=await sharp(exact).extract({left:10,top:10,width:480,height:580}).resize(500,600).png().toBuffer();
  else returned=await sharp(exact).png({compressionLevel:9,progressive:true}).toBuffer();
 };
 wire.response.image=socket=>{expect(returned).toBeDefined();socket.end(imageWireResponse(returned!,"",mime));};
 const decode=nativeComparison.decodeDiagnosticImage;
 const spy=vi.spyOn(nativeComparison,"decodeDiagnosticImage").mockImplementation((...args)=>{expect(transactions.getStore()).not.toBe(true);return decode(...args);});
 try{
  const result=await complete();expect(result).toMatchObject({retrieved:true,acknowledgement:"recorded",associated:false,state:"unknown",reason:"completed"});
  expect(result.visual?.verdict).toBe(["png","jpeg"].includes(kind)?"match":kind==="corrupt"?"inconclusive":"mismatch");
  if(kind==="png"||kind==="jpeg")expect(result.visual).toMatchObject({decoding:"passed",geometry:"passed",marker:"passed",color:"passed",similarity:"passed",associated:false});
  expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);expect(source.bytes).toEqual(before);
  expect((await parents())[0].postIntentAt).not.toBeNull();expect(await events()).toHaveLength(2);
  expect(JSON.stringify(await events())).not.toMatch(/marker|metrics|recipe|opaque|digest|image%41/);await noAdmission();
 }finally{spy.mockRestore();returned?.fill(0);}
});

it.each(["cancelled","context","expiry","lost-ack"])("retains fences and facts on %s during/after native comparison",async kind=>{
 const original=wire.response.before;let returned:Buffer|undefined;
 wire.response.before=async(req,body)=>{await original(req,body);const boundary=/boundary=(.+)$/.exec(req.headers["content-type"]!)![1];returned=Buffer.from(body.subarray(body.indexOf("\r\n\r\n")+4,-Buffer.byteLength(`\r\n--${boundary}--\r\n`)));};
 wire.response.image=socket=>socket.end(imageWireResponse(returned!));
 let entered=false,resolve!:(v:Buffer)=>void;const pending=new Promise<Buffer>(r=>{resolve=r;}),decode=nativeComparison.decodeDiagnosticImage;let calls=0;
 const spy=vi.spyOn(nativeComparison,"decodeDiagnosticImage").mockImplementation(async(...args)=>{if(++calls===2){entered=true;return pending;}return decode(...args);});
 if(kind==="lost-ack"){const ack=verification.recordOutcome.bind(verification);vi.spyOn(verification,"recordOutcome").mockImplementation(async(...args)=>{await ack(...args);throw Error("lost");});}
 const op=await begin();let settled=false;void op.settled.then(()=>{settled=true;});
 try{
  for(let n=0;n<300&&!entered;n++)await new Promise(r=>setTimeout(r,5));expect(entered).toBe(true);
  if(kind==="cancelled"){op.cancel();const early=await op.result;expect(early.reason).toBe("cancelled");expect(early.visual?.verdict).toBe("inconclusive");expect(settled).toBe(false);}
  if(kind==="context")await connections.disconnect(owner);
  if(kind==="expiry")await db.update(schema.sessions).set({expiresAt:new Date(Date.now()-1)}).where(eq(schema.sessions.id,sessionId));
  const pixels=await sharp(returned!).raw().toBuffer();resolve(pixels);
  const result=await op.result;await op.settled;
  if(kind==="lost-ack")expect(result).toMatchObject({retrieved:true,acknowledgement:"uncertain",visual:{verdict:"match"},associated:false});
  else expect(result.visual?.verdict).toBe("inconclusive");
  expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);expect((await parents())[0].postIntentAt).not.toBeNull();
  expect((await reservations())[0].requestIntentAt).not.toBeNull();await noAdmission();
 }finally{resolve(Buffer.alloc(900_000));await op.settled;spy.mockRestore();returned?.fill(0);}
});
