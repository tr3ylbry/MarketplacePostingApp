import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableRealMediaDatabase } from "../../test/disposableRealMediaDatabase";
import { listingFixture } from "../../test/fixtures";
import { createImageService } from "../../application/imageService";
import { createListingService } from "../../application/listingService";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { cleanupImages } from "../storage/cleanupImages";
import { DrizzleImageRepository } from "./drizzleImageRepository";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleEbayRealMediaRepository } from "./drizzleEbayRealMediaRepository";
import { syntheticMediaEvidence, admittedMediaReceipt, admitRealMediaEvidence } from "../ebay/realMediaEvidence";
import { realMediaDigest, REAL_MEDIA_LEASE_MS, type RealMediaClaim, type RealMediaContent } from "../../application/ebayRealMedia";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import * as schema from "../db/schema";

let isolated: Awaited<ReturnType<typeof disposableRealMediaDatabase>>;
let db: typeof isolated.db, listings: DrizzleListingRepository, repository: DrizzleEbayRealMediaRepository;
let owner: string, foreign: string, listingId: string, imageId: string, secondImage: string, now: Date;
const config = realMediaDigest("synthetic-config"), recipe = "photo-export-v1;synthetic-persistence-test";
const a = schema.ebayRealMediaAttempts, r = schema.ebayRealMediaReceipts, s = schema.ebayRealMediaAssociations;
const current = () => listings.getById(owner, listingId);
const record = async (id: string) => (await db.select().from(a).where(eq(a.id, id)))[0];
const receiptRows = (id: string) => db.select().from(r).where(eq(r.attemptId, id));
const associationRows = (id: string) => db.select().from(s).where(eq(s.attemptId, id));
const content = (): RealMediaContent => ({ sourceDigest: realMediaDigest("source-" + owner), derivativeDigest: realMediaDigest("export-" + owner), recipe, contentType: "image/png", size: 1024, width: 500, height: 600 });
const raw = (overrides = {}) => ({ status: 201, location: "https://media-contract.invalid.test/image/test_resource_" + "a".repeat(16),
  body: { imageUrl: "https://eps-contract.invalid.test/photo/test_visual_" + "b".repeat(16) + ".png", expirationDate: new Date(now.getTime() + 3600000).toISOString() }, ...overrides });
const proof = (claim: RealMediaClaim, value = raw()) => syntheticMediaEvidence(db, claim.ownerId, claim.id, value);
const request = async (overrides = {}) => ({ ownerId: owner, listingId, imageId, listingVersion: (await current())!.updatedAt,
  sessionHash: realMediaDigest("session-" + owner), actionHash: realMediaDigest(randomUUID()), configHash: config, recipe, ...overrides });
const claim = async (overrides = {}) => repository.claim(await request(overrides));
async function fence(overrides: Record<string, unknown> = {}) { const c = await claim(overrides); return repository.fence(c, { ...content(), recipe: typeof overrides.recipe === "string" ? overrides.recipe : recipe }); }
async function addImage(listing = listingId, order = 0) {
  const id = randomUUID();
  await db.insert(schema.listingImages).values({ id, listingId: listing, storageProvider: "vercel-blob", pathname: "images/" + listing + "/" + id + ".png",
    originalFilename: "synthetic.png", contentType: "image/png", byteSize: 1024, uploadedAt: now.toISOString(), order });
  return id;
}
async function connect(user: string, seller = realMediaDigest("seller-" + user)) {
  await db.insert(schema.ebayConnections).values({ ownerId: user, id: randomUUID(), version: randomUUID(), configHash: config, status: "connected", sellerId: seller,
    sellerLabel: "Synthetic account", access: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 },
    refresh: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 }, connectedAt: now.toISOString(),
    accessExpiresAt: new Date(now.getTime() + 7200000).toISOString(), refreshExpiresAt: new Date(now.getTime() + 86400000).toISOString(), scopes: [...EBAY_SCOPES] });
}
beforeAll(async () => { isolated = await disposableRealMediaDatabase(); db = isolated.db; listings = new DrizzleListingRepository(db); }, 30000);
beforeEach(async () => {
  now = new Date(); owner = randomUUID(); foreign = randomUUID(); repository = new DrizzleEbayRealMediaRepository(db, () => now);
  await db.insert(schema.users).values([owner, foreign].map(id => ({ id, name: "Synthetic test owner", email: id + "@example.invalid" })));
  listingId = (await listings.create(owner, listingFixture())).id; imageId = await addImage(); secondImage = await addImage(listingId, 1); await connect(owner);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { if (isolated) await isolated.close(); });

it("applies the committed migration repeatably in a fresh disposable database with empty real tables", async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  expect((await db.execute(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('ebay_real_media_attempts','ebay_real_media_receipts','ebay_real_media_associations')`)).rows[0].n).toBe(3);
  expect(await db.select().from(a)).toHaveLength(0);
});
it("commits a snapshot and max source retention without changing listings, credentials or simulation", async () => {
  const before = await current(), connections = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner));
  await db.update(schema.listingImages).set({ providerRetainUntil: new Date(now.getTime() + 7200000).toISOString() }).where(eq(schema.listingImages.id, imageId));
  const c = await claim(), row = await record(c.id);
  expect(row).toMatchObject({ state: "preparing", ownerId: owner, environment: "sandbox", postIntentAt: null, recipe });
  expect(row.claimHash).toBe(realMediaDigest(c.token)); expect(row).not.toHaveProperty("pathname");
  expect((await current())).toEqual(before);
  expect(await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner))).toEqual(connections);
  expect(await db.select().from(schema.ebayMediaAttempts)).toEqual([]);
  const [photo] = await db.select().from(schema.listingImages).where(eq(schema.listingImages.id, imageId));
  expect(Date.parse(photo.providerRetainUntil!)).toBe(now.getTime() + 7200000);
});
it("serializes concurrent claims and returns only a generic blocked result to the loser", async () => {
  const value = await request(); const results = await Promise.allSettled([repository.claim(value), repository.claim({ ...value, actionHash: realMediaDigest(randomUUID()) })]);
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  const failed = results.find(x => x.status === "rejected") as PromiseRejectedResult; expect(failed.reason).toMatchObject({ code: "blocked" });
});
it("reclaims only an expired unfenced lease and rejects stale token/revision/session/action", async () => {
  const old = await claim(); now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  const fresh = await claim(); expect(fresh.id).not.toBe(old.id); expect(fresh.revision).toBe(0);
  expect(await record(old.id)).toMatchObject({ state: "not-sent", revision: old.revision + 1, actionHash: old.actionHash, postIntentAt: null });
  await expect(repository.fence(old, content())).rejects.toMatchObject({ code: "stale" });
  await expect(repository.notSent(old)).rejects.toMatchObject({ code: "stale" });
  await expect(repository.acknowledge(old, {})).rejects.toMatchObject({ code: "stale" });
  for (const altered of [{ ...fresh, revision: fresh.revision + 1 }, { ...fresh, token: old.token }, { ...fresh, sessionHash: realMediaDigest("other") }, { ...fresh, actionHash: old.actionHash }])
    await expect(repository.fence(altered, content())).rejects.toMatchObject({ code: "stale" });
  expect((await repository.fence(fresh, content())).revision).toBe(fresh.revision + 1);
});
it("allows a new explicit action after not-sent, never reuses the consumed action", async () => {
  const value = await request(), c = await repository.claim(value); expect(await repository.notSent(c)).toEqual({ state: "not-sent", associated: false });
  await expect(repository.claim(value)).rejects.toMatchObject({ code: "blocked" });
  expect(await claim()).toHaveProperty("id");
});
it("recovers a lost claim acknowledgement after lease expiry without a send intent", async () => {
  const first = await claim(); now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  const next = await claim(); expect(next.id).not.toBe(first.id); expect((await record(next.id)).postIntentAt).toBeNull();
  expect(await record(first.id)).toMatchObject({ state: "not-sent", actionHash: first.actionHash, postIntentAt: null });
  await expect(claim({ actionHash: first.actionHash, imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
});
it("rolls back a failed fence transaction and never allows notSent to undo an ambiguously committed fence", async () => {
  const c = await claim(), transaction = db.transaction.bind(db);
  const fault = vi.spyOn(db, "transaction").mockImplementationOnce(callback => transaction(async tx => { await callback(tx); throw new Error("Injected before commit"); }));
  await expect(repository.fence(c, content())).rejects.toMatchObject({ code: "unavailable" }); fault.mockRestore();
  expect((await record(c.id)).postIntentAt).toBeNull();
  await repository.fence(c, content()); // Simulate success followed by a lost commit acknowledgement.
  await expect(repository.notSent(c)).rejects.toMatchObject({ code: "stale" });
  now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS * 3);
  await expect(claim()).rejects.toMatchObject({ code: "blocked" }); expect((await record(c.id)).state).toBe("unknown");
});
it.each(["source", "derivative", "recipe", "reconnect"])("blocks a duplicate %s under a different image ID", async kind => {
  await fence(); if (kind === "reconnect") await db.update(schema.ebayConnections).set({ version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, owner));
  const nextRecipe = kind === "recipe" ? recipe + ";new-version" : recipe;
  const c = await claim({ imageId: secondImage, recipe: nextRecipe });
  const data = { ...content(), recipe: nextRecipe, ...(kind === "derivative" ? { sourceDigest: realMediaDigest("different source") } : { derivativeDigest: realMediaDigest("different export") }) };
  await expect(repository.fence(c, data)).rejects.toMatchObject({ code: "blocked" }); expect((await record(c.id)).postIntentAt).toBeNull();
});
it("preserves seller content fences across application owners without disclosing prior records", async () => {
  const first = await fence(), seller = (await record(first.id)).sellerKey;
  await db.update(schema.ebayConnections).set({ status: "disconnected", sellerId: null, version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, owner));
  const target = await listings.create(foreign, listingFixture()), photo = await addImage(target.id); await connect(foreign, seller);
  const c = await claim({ ownerId: foreign, listingId: target.id, imageId: photo, listingVersion: target.updatedAt, sessionHash: realMediaDigest("foreign session") });
  await expect(repository.fence(c, content())).rejects.toMatchObject({ code: "blocked" });
  await expect(repository.status(foreign, first.id)).rejects.toMatchObject({ code: "stale" });
});
it("allows unrelated owners/sellers to fence the same synthetic content independently", async () => {
  await fence(); const target = await listings.create(foreign, listingFixture()), photo = await addImage(target.id); await connect(foreign);
  const c = await claim({ ownerId: foreign, listingId: target.id, imageId: photo, listingVersion: target.updatedAt });
  expect(await repository.fence(c, content())).toHaveProperty("id");
});
it("atomically fences concurrent identical content from different photos", async () => {
  const first = await claim(), second = await claim({ imageId: secondImage });
  const results = await Promise.allSettled([repository.fence(first, content()), repository.fence(second, content())]);
  expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1); expect((results.find(x => x.status === "rejected") as PromiseRejectedResult).reason.code).toBe("blocked");
});
it("denies foreign ownership, wrong configuration and stale listing before claiming", async () => {
  for (const change of [{ ownerId: foreign }, { configHash: realMediaDigest("wrong") }, { listingVersion: "2000-01-01T00:00:00.000Z" }])
    await expect(claim(change)).rejects.toMatchObject({ code: "stale" });
});
it.each(["listing", "image", "reorder", "source", "connection", "grant", "disconnect"])("rejects a changed %s before fence", async kind => {
  const c = await claim(); await change(kind);
  await expect(repository.fence(c, content())).rejects.toMatchObject({ code: "stale" }); expect((await record(c.id)).postIntentAt).toBeNull();
});
async function change(kind: string) {
  if (kind === "listing") await db.delete(schema.listings).where(eq(schema.listings.id, listingId));
  else if (kind === "image") await db.delete(schema.listingImages).where(eq(schema.listingImages.id, imageId));
  else if (kind === "reorder") await db.update(schema.listingImages).set({ order: 3 }).where(eq(schema.listingImages.id, imageId));
  else if (kind === "source") await db.update(schema.listingImages).set({ pathname: "images/" + listingId + "/" + randomUUID() + ".png" }).where(eq(schema.listingImages.id, imageId));
  else await db.update(schema.ebayConnections).set(kind === "grant" ? { scopes: [] } : kind === "disconnect" ? { status: "disconnected" } : { version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, owner));
}
it("keeps real admission closed, rejects forged evidence and binds opaque proofs to DB/owner/attempt", async () => {
  const c = await fence(); await expect(repository.acknowledge(c, { validated: true, ...raw() })).rejects.toMatchObject({ code: "contract" });
  expect(() => admitRealMediaEvidence(raw())).toThrow(); const p = await proof(c);
  expect(() => admittedMediaReceipt(p, "marketplace_test", owner, c.id)).toThrow();
  expect(() => admittedMediaReceipt(p, "marketplace_real_media_" + "a".repeat(24) + "_test", owner, randomUUID())).toThrow();
  await expect(repository.acknowledge({ ...c, ownerId: foreign }, p)).rejects.toMatchObject({ code: "stale" });
  await expect(repository.acknowledge(c, structuredClone(p))).rejects.toMatchObject({ code: "contract" });
  vi.stubEnv("NODE_ENV", "production"); await expect(syntheticMediaEvidence(db, owner, c.id, raw())).rejects.toMatchObject({ code: "contract" });
});
it("preserves partial fields then confirms a compatible complete receipt, without public sensitive fields", async () => {
  const c = await fence(); const partial = await proof(c, raw({ body: null }));
  expect(await repository.acknowledge(c, partial)).toEqual({ state: "unknown", associated: false });
  expect((await receiptRows(c.id))[0]).toMatchObject({ location: raw().location, imageUrl: null, level: "partial" });
  const p = await proof(c); expect(await repository.acknowledge(c, p)).toEqual({ state: "confirmed", associated: true });
  expect(await repository.acknowledge(c, await proof(c))).toEqual({ state: "confirmed", associated: true });
  expect(await receiptRows(c.id)).toHaveLength(2); expect(await associationRows(c.id)).toHaveLength(1);
  const status = await repository.status(owner, c.id); expect(Object.keys(status).sort()).toEqual(["associated", "state"]);
  expect(JSON.stringify(status)).not.toMatch(/token|digest|https|seller|source|claim|ciphertext/);
});
it("preserves contradictory immutable receipts and removes the usable association", async () => {
  const c = await fence(); await repository.acknowledge(c, await proof(c));
  const different = raw({ body: { ...raw().body, imageUrl: "https://eps-contract.invalid.test/photo/test_visual_" + "c".repeat(16) + ".png" } });
  expect(await repository.acknowledge(c, await proof(c, different))).toEqual({ state: "unknown", associated: false });
  expect(await receiptRows(c.id)).toHaveLength(2); expect(await associationRows(c.id)).toHaveLength(0);
  expect(await repository.acknowledge(c, await proof(c))).toEqual({ state: "unknown", associated: false });
});
it("keeps expired, malformed and non-201 response fields unknown without another send", async () => {
  const c = await fence();
  const value = raw({ body: { ...raw().body, expirationDate: "2000-01-01T00:00:00.000Z" } });
  expect(await repository.acknowledge(c, await proof(c, value))).toEqual({ state: "unknown", associated: false });
  expect((await receiptRows(c.id))[0].expiresAt).not.toBeNull();
  await expect(claim()).rejects.toMatchObject({ code: "blocked" });
});
it("late response-only acknowledgement cannot reopen the send lease or skip current binding checks", async () => {
  const c = await fence(); now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  expect(await repository.acknowledge(c, await proof(c))).toEqual({ state: "confirmed", associated: true });
  await change("connection"); expect(await repository.acknowledge(c, await proof(c))).toEqual({ state: "residual", associated: false });
  await expect(repository.fence(c, content())).rejects.toMatchObject({ code: "stale" });
});
it.each(["listing", "image", "reorder", "source", "connection", "grant", "disconnect"])("records complete stale %s outcomes as residual, preserving evidence", async kind => {
  const c = await fence(), p = await proof(c); await change(kind);
  expect(await repository.acknowledge(c, p)).toEqual({ state: "residual", associated: false });
  expect(await receiptRows(c.id)).toHaveLength(1); expect((await record(c.id)).postIntentAt).not.toBeNull();
});
it("capture-only evidence cannot acquire a current association", async () => {
  const c = await fence({ operation: "capture-only" }); expect(await repository.acknowledge(c, await proof(c))).toEqual({ state: "residual", associated: false });
});
it("detects later deletion/expiry in a local status read without erasing a receipt or fence", async () => {
  const c = await fence(); await repository.acknowledge(c, await proof(c)); await change("image");
  expect(await associationRows(c.id)).toHaveLength(0); expect(await repository.status(owner, c.id)).toEqual({ state: "residual", associated: false });
  expect(await receiptRows(c.id)).toHaveLength(1);
});
it("treats a lost receipt commit as unknown, then acknowledges the same response idempotently after a lost success acknowledgement", async () => {
  const c = await fence(), p = await proof(c), transaction = db.transaction.bind(db);
  const fault = vi.spyOn(db, "transaction").mockImplementationOnce(callback => transaction(async tx => { await callback(tx); throw new Error("Injected before receipt commit"); }));
  await expect(repository.acknowledge(c, p)).rejects.toMatchObject({ code: "unavailable" }); fault.mockRestore();
  expect(await receiptRows(c.id)).toHaveLength(0); expect((await record(c.id)).state).toBe("unknown");
  await repository.acknowledge(c, p); // Success returned by DB but lost by its caller.
  expect(await repository.acknowledge(c, p)).toEqual({ state: "confirmed", associated: true }); expect(await receiptRows(c.id)).toHaveLength(1);
});
it("protects fenced identities/content and receipts against direct SQL UPDATE, DELETE and TRUNCATE", async () => {
  const c = await fence(); await repository.acknowledge(c, await proof(c));
  for (const field of ["source_digest", "derivative_digest", "owner_id", "seller_key", "recipe", "session_hash", "action_hash", "claim_hash", "listing_id", "connection_version"]) {
    await expect(db.execute(sql.raw('UPDATE ebay_real_media_attempts SET "' + field + '" = \'tampered\', revision=revision+1 WHERE id=\'' + c.id + "'"))).rejects.toThrow();
  }
  await expect(db.execute(sql`UPDATE ebay_real_media_attempts SET post_intent_at=NULL, revision=revision+1 WHERE id=${c.id}`)).rejects.toThrow();
  await expect(db.delete(a).where(eq(a.id, c.id))).rejects.toThrow();
  await expect(db.delete(r).where(eq(r.attemptId, c.id))).rejects.toThrow();
  await expect(db.update(r).set({ imageUrl: raw().body.imageUrl }).where(eq(r.attemptId, c.id))).rejects.toThrow();
  await expect(db.execute(sql`TRUNCATE ebay_real_media_receipts CASCADE`)).rejects.toThrow();
  expect(await receiptRows(c.id)).toHaveLength(1); expect((await record(c.id)).postIntentAt).not.toBeNull();
});
it("SQL rejects stale/foreign association writes and owner deletion while evidence survives product/connection deletion", async () => {
  const c = await fence(); await repository.acknowledge(c, await proof(c)); const [association] = await associationRows(c.id);
  await expect(db.update(s).set({ ownerId: foreign }).where(eq(s.imageId, imageId))).rejects.toThrow();
  await change("reorder"); await expect(db.update(s).set({ createdAt: now.toISOString() }).where(eq(s.imageId, imageId))).rejects.toThrow();
  await db.delete(schema.listings).where(eq(schema.listings.id, listingId)); await db.delete(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner));
  expect(await associationRows(c.id)).toHaveLength(0); expect(await receiptRows(c.id)).toHaveLength(1);
  await expect(db.delete(schema.users).where(eq(schema.users.id, owner))).rejects.toThrow(); expect(await record(c.id)).toHaveProperty("ownerId", owner);
  expect(association.attemptId).toBe(c.id);
});
it("does not relax the existing simulation-only constraints", async () => {
  await expect(db.insert(schema.ebayMediaAttempts).values({ id: randomUUID(), ownerId: owner, environment: "sandbox", simulation: false,
    sellerId: realMediaDigest(owner), listingId, imageId, listingVersion: now.toISOString(), connectionId: randomUUID(), connectionVersion: randomUUID(), configHash: config,
    sourceMetadataHash: realMediaDigest("source"), transformationVersion: "generated-fixture-v1", state: "preparing", leaseToken: randomUUID(),
    createdAt: now.toISOString(), updatedAt: now.toISOString() })).rejects.toThrow();
});
it.each([
  { status: 400 }, { status: 401 }, { status: 403 }, { status: 429 }, { status: 500 },
  { body: "malformed body" }, { location: undefined }, { location: ["https://media-contract.invalid.test/image/test_resource_" + "a".repeat(16), "duplicate"] }
])("retains uncertainty for synthetic incomplete/error evidence %j", async changes => {
  const c = await fence(); const result = await repository.acknowledge(c, await proof(c, raw(changes)));
  expect(result).toEqual({ state: "unknown", associated: false }); expect(await receiptRows(c.id)).toHaveLength(1);
  await expect(claim()).rejects.toMatchObject({ code: "blocked" });
});
it("cannot turn a MIME mismatch or unsupported recipe into a send intent", async () => {
  const c = await claim(); await expect(repository.fence(c, { ...content(), contentType: "image/jpeg" })).rejects.toMatchObject({ code: "stale" });
  await expect(repository.fence(c, { ...content(), recipe: recipe + ";changed" })).rejects.toMatchObject({ code: "stale" });
  expect((await record(c.id)).postIntentAt).toBeNull();
});
it("does not let an action migrate to another image when its unfenced lease expires", async () => {
  const value = await request(); await repository.claim(value); now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  await expect(repository.claim({ ...value, imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
});
it("expiry or recreating a connection cannot clear a seller/content fence", async () => {
  const c = await fence(); await repository.acknowledge(c, await proof(c)); now = new Date(now.getTime() + 7200000);
  expect(await repository.status(owner, c.id)).toEqual({ state: "residual", associated: false });
  await db.delete(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner)); await connect(owner);
  const next = await claim({ imageId: secondImage }); await expect(repository.fence(next, content())).rejects.toMatchObject({ code: "blocked" });
});
it("SQL cannot label an unknown attempt complete without receipt evidence or insert a receipt before intent", async () => {
  const c = await fence(); await expect(db.execute(sql`UPDATE ebay_real_media_attempts SET state='confirmed',revision=revision+1 WHERE id=${c.id}`)).rejects.toThrow();
  await repository.acknowledge(c, await proof(c)); const [receipt] = await receiptRows(c.id);
  const unsent = await claim({ imageId: secondImage });
  await expect(db.insert(r).values({ ...receipt, id: randomUUID(), attemptId: unsent.id })).rejects.toThrow();
  await expect(db.insert(r).values({ ...receipt, id: randomUUID(), contractVersion: "unreviewed-real-contract" })).rejects.toThrow();
  await expect(db.insert(r).values({ ...receipt, id: randomUUID(), resourceId: null, fingerprint: realMediaDigest("invalid location") })).rejects.toThrow();
});
it.each(["image", "listing"])("preserves the existing physical retention/cleanup boundary on normal %s deletion", async kind => {
  const storage = new MemoryImageStorage(), images = new DrizzleImageRepository(db), c = await fence();
  await repository.acknowledge(c, await proof(c));
  const source = (await images.get(owner, listingId, imageId))!.source; if (source.kind !== "vercel-blob") throw new Error();
  storage.objects.set(source.pathname, { bytes: Buffer.alloc(1024), type: "image/png" });
  const other = await listings.create(foreign, listingFixture()), photo = await addImage(other.id), otherSource = (await images.get(foreign, other.id, photo))!.source;
  if (otherSource.kind !== "vercel-blob") throw new Error(); storage.objects.set(otherSource.pathname, { bytes: Buffer.alloc(1024), type: "image/png" });
  if (kind === "image") await createImageService(images, storage).remove(owner, listingId, imageId);
  else await createListingService(listings, storage).deleteListing(owner, listingId);
  const [ledger] = await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, source.pathname));
  expect(Date.parse(ledger.notBefore)).toBeGreaterThanOrEqual(now.getTime() + 360000);
  await cleanupImages(db, storage); expect(storage.objects.has(source.pathname)).toBe(true);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(ledger.notBefore) + 1); await cleanupImages(db, storage);
  expect(storage.objects.has(source.pathname)).toBe(false); expect(storage.objects.has(otherSource.pathname)).toBe(true);
  expect(await receiptRows(c.id)).toHaveLength(1); expect((await record(c.id)).postIntentAt).not.toBeNull();
  expect(await listings.getById(foreign, other.id)).not.toBeNull();
});
it("retains consumed action A after fresh action B reclaims its expired photo", async () => {
  const actionA = await request(), old = await repository.claim(actionA);
  now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  const replacement = await claim();
  await expect(repository.claim({ ...actionA, imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
  await expect(repository.claim(actionA)).rejects.toMatchObject({ code: "blocked" });
  expect((await record(old.id)).actionHash).toBe(actionA.actionHash);
  expect(replacement.id).not.toBe(old.id);
});
it("requires a fresh action even when the original unfenced lease expires", async () => {
  const value = await request(), first = await repository.claim(value);
  now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1); const before = await record(first.id);
  await expect(repository.claim(value)).rejects.toMatchObject({ code: "blocked" });
  expect(await record(first.id)).toEqual(before);
  expect((await claim()).id).not.toBe(first.id);
});
it("preserves every consumed binding across successive reclamations and rejects all retired workers", async () => {
  const requests = [], claims: RealMediaClaim[] = [];
  for (let i = 0; i < 4; i++) {
    const value = await request(); requests.push(value); claims.push(await repository.claim(value));
    if (i < 3) now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  }
  expect(new Set(claims.map(c => c.id)).size).toBe(4);
  const latest = claims[3], before = await record(latest.id);
  for (let i = 0; i < 3; i++) {
    const old = claims[i], retired = await record(old.id);
    expect(retired).toMatchObject({ state: "not-sent", actionHash: requests[i].actionHash, sessionHash: requests[i].sessionHash,
      claimHash: realMediaDigest(old.token), revision: old.revision + 1, leaseUntil: null, postIntentAt: null });
    await expect(repository.claim(requests[i])).rejects.toMatchObject({ code: "blocked" });
    await expect(repository.claim({ ...requests[i], imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
    for (const stale of [old, { ...old, revision: retired.revision }, { ...latest, token: old.token }, { ...latest, actionHash: old.actionHash }]) {
      await expect(repository.fence(stale, content())).rejects.toMatchObject({ code: "stale" });
      await expect(repository.notSent(stale)).rejects.toMatchObject({ code: "stale" });
      await expect(repository.acknowledge(stale, {})).rejects.toMatchObject({ code: "stale" });
    }
  }
  expect(await record(latest.id)).toEqual(before);
  const fenced = await repository.fence(latest, content()), p = await proof(fenced);
  expect(await repository.acknowledge(fenced, p)).toEqual({ state: "confirmed", associated: true });
  expect(await repository.acknowledge(fenced, p)).toEqual({ state: "confirmed", associated: true });
  expect(await receiptRows(fenced.id)).toHaveLength(1);
});
it("allows only one fresh concurrent replacement while preserving the retired action", async () => {
  const original = await claim(); now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  const values = [await request(), await request()];
  const results = await Promise.allSettled(values.map(value => repository.claim(value)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "blocked" });
  const rows = await db.select().from(a).where(eq(a.ownerId, owner));
  expect(rows).toHaveLength(2); expect(rows.filter(r => r.state === "preparing")).toHaveLength(1);
  expect(await record(original.id)).toMatchObject({ state: "not-sent", actionHash: original.actionHash });
  await expect(claim({ actionHash: original.actionHash, imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
  const loser = values[results.findIndex(r => r.status === "rejected")];
  expect(await repository.claim({ ...loser, imageId: secondImage })).toHaveProperty("actionHash", loser.actionHash);
});
it.each([false, true])("rejects a replay racing a fresh reclamation in either call order (%s)", async replayFirst => {
  const actionA = await request(), original = await repository.claim(actionA);
  now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  const fresh = await request(), replay = { ...actionA, imageId: secondImage };
  const values = replayFirst ? [replay, fresh] : [fresh, replay];
  const results = await Promise.allSettled(values.map(value => repository.claim(value)));
  expect(results[replayFirst ? 0 : 1]).toMatchObject({ status: "rejected", reason: { code: "blocked" } });
  expect(results[replayFirst ? 1 : 0].status).toBe("fulfilled");
  expect(await record(original.id)).toMatchObject({ actionHash: actionA.actionHash, state: "not-sent" });
});
it("consumes a concurrent fresh action for only one photo and retains the earlier action", async () => {
  const original = await claim(); now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  const actionB = await request();
  const results = await Promise.allSettled([repository.claim(actionB), repository.claim({ ...actionB, imageId: secondImage })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "blocked" });
  for (const photo of [imageId, secondImage]) await expect(repository.claim({ ...actionB, imageId: photo })).rejects.toMatchObject({ code: "blocked" });
  expect((await record(original.id)).actionHash).toBe(original.actionHash);
  await expect(claim({ actionHash: original.actionHash, imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
});
it("rolls retirement and replacement back together if the claim commit fails", async () => {
  const original = await claim(); now = new Date(now.getTime() + REAL_MEDIA_LEASE_MS + 1);
  const before = await record(original.id), [photoBefore] = await db.select().from(schema.listingImages).where(eq(schema.listingImages.id, imageId));
  const value = await request(), transaction = db.transaction.bind(db);
  const fault = vi.spyOn(db, "transaction").mockImplementationOnce(callback => transaction(async tx => { await callback(tx); throw new Error("Injected claim commit failure"); }));
  await expect(repository.claim(value)).rejects.toMatchObject({ code: "unavailable" }); fault.mockRestore();
  expect(await record(original.id)).toEqual(before);
  expect(await db.select().from(a).where(eq(a.ownerId, owner))).toHaveLength(1);
  const [photoAfter] = await db.select().from(schema.listingImages).where(eq(schema.listingImages.id, imageId)); expect(photoAfter).toEqual(photoBefore);
  expect((await repository.claim(value)).id).not.toBe(original.id);
  await expect(claim({ actionHash: original.actionHash, imageId: secondImage })).rejects.toMatchObject({ code: "blocked" });
});
