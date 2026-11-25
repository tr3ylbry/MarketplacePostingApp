import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableVerificationDatabase } from "../../test/disposableVerificationDatabase";
import { listingFixture } from "../../test/fixtures";
import { LocalOperatorError } from "../../application/localImageOperator";
import { EBAY_DISCOVERY_SCOPES, type ConnectedValues } from "../../application/ebayConnection";
import { realMediaDigest, mediaSessionHash } from "../../application/ebayRealMedia";
import { DrizzleEbayRealMediaRepository } from "./drizzleEbayRealMediaRepository";
import { queueVerificationFixtureCleanup } from "../../../scripts/image-verification-cleanup";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleLocalImageOperatorRepository, type LocalOperatorActor } from "./drizzleLocalImageOperatorRepository";
import * as schema from "../db/schema";

vi.mock("dotenv", () => { throw Error("Private configuration forbidden"); });
vi.mock("../ebay/ebayClient", () => { throw Error("Provider construction forbidden"); });
vi.mock("@vercel/blob", () => { throw Error("Blob construction forbidden"); });
let isolated: Awaited<ReturnType<typeof disposableVerificationDatabase>>;
let db: typeof isolated.db, repo: DrizzleLocalImageOperatorRepository;
const table = schema.localImageOperatorActivations;
const envelope = { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 as const };
let actor: LocalOperatorActor, activation: string, seller: string, config: string, version: string;
const row = async () => (await repo.activation(activation, actor.ownerId))!;
const stamp = () => new Date(Date.now() + 3_600_000).toISOString();
const values = (): ConnectedValues => ({ sellerId: seller, sellerLabel: "Synthetic seller", access: envelope, refresh: envelope,
  accessExpiresAt: stamp(), refreshExpiresAt: stamp(), scopes: [...EBAY_DISCOVERY_SCOPES] });
async function consent() {
  const proxy = repo.consentRepository(activation, actor, (await row()).revision), state = realMediaDigest(randomUUID());
  await proxy.begin(actor.ownerId, realMediaDigest(actor.id), config, state, "2000-01-01T00:00:00.000Z", stamp(), EBAY_DISCOVERY_SCOPES);
  return { proxy, state };
}
async function connected() {
  const { proxy, state } = await consent();
  await proxy.consume(actor.ownerId, realMediaDigest(actor.id), config, state, new Date().toISOString());
  await repo.consumeCallbackIntent(activation, actor, state, "exchange");
  await repo.consumeCallbackIntent(activation, actor, state, "identity");
  await proxy.connect(actor.ownerId, (await row()).consentVersion!, values(), "2000-01-01T00:00:00.000Z");
  return row();
}
async function ready() {
  let active = await connected(); const listingId = randomUUID(), sourceDigest = realMediaDigest(randomUUID()), derivativeDigest = realMediaDigest(randomUUID());
  active = await repo.beginFixture(activation, actor, active.revision, listingId);
  active = await repo.pinFixtureContent(activation, actor, active.revision, { sourceDigest, derivativeDigest });
  const fixture = { ...listingFixture(), id: listingId, title: "SANDBOX M3 Generated " + sourceDigest.slice(0, 12) };
  await new DrizzleListingRepository(db).create(actor.ownerId, fixture);
  const imageId = randomUUID(), [listing] = await db.select().from(schema.listings).where(eq(schema.listings.id, listingId));
  await db.insert(schema.listingImages).values({ id: imageId, listingId, storageProvider: "vercel-blob", pathname: `images/${imageId}/generated.png`, originalFilename: "generated.png", contentType: "image/png", byteSize: 100, uploadedAt: new Date().toISOString(), order: 0 });
  return repo.finalizeFixture(activation, actor, active.revision, { imageId, listingVersion: listing.updatedAt });
}
beforeAll(async () => { isolated = await disposableVerificationDatabase(); db = isolated.db; repo = new DrizzleLocalImageOperatorRepository(db); }, 30000);
beforeEach(async () => {
  const ownerId = randomUUID(); actor = { ownerId, id: randomUUID(), expiresAt: stamp() }; activation = randomUUID(); seller = realMediaDigest(randomUUID()); config = realMediaDigest(randomUUID()); version = randomUUID();
  await db.insert(schema.users).values({ id: ownerId, name: "Synthetic owner", email: `${ownerId}@invalid.test` });
  await db.insert(schema.sessions).values({ id: actor.id, userId: ownerId, token: randomUUID(), expiresAt: new Date(actor.expiresAt) });
  const connectionId = randomUUID();
  await db.insert(schema.ebayConnections).values({ ownerId, id: connectionId, version, configHash: config, status: "connected", sellerId: seller, sellerLabel: "Synthetic seller", access: envelope, refresh: envelope,
    connectedAt: new Date().toISOString(), accessExpiresAt: stamp(), refreshExpiresAt: stamp(), scopes: ["https://api.ebay.com/oauth/api_scope"] });
  await repo.arm({ id: activation, ownerId, connectionId, initialConnectionVersion: version, sellerKey: seller, configHash: config, reviewedHead: "a".repeat(40), reviewedTree: "b".repeat(40), derivativeRecipe: "synthetic-derivative", comparisonRecipe: "synthetic-comparison", expiresAt: stamp() });
});
afterAll(async () => { if (isolated) await isolated.close(); });

it("migrates fresh and repeatedly without weakening retained ledgers", async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  const result = await isolated.pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
  expect(result.rows[0].n).toBe(14);
});
it("records exact immutable activation pins and manual Day-30/Day-90 obligations", async () => {
  const active = await row(); expect(active).toMatchObject({ phase: "armed", revision: 0, sessionHash: null, consentStartedAt: null, cleanupSessionHash: null });
  expect(Date.parse(active.reviewDueAt) - Date.parse(active.createdAt)).toBe(30 * 86400000);
  expect(Date.parse(active.dispositionDueAt) - Date.parse(active.createdAt)).toBe(90 * 86400000);
  await expect(db.update(table).set({ reviewedHead: "c".repeat(40), revision: 1 }).where(eq(table.id, activation))).rejects.toThrow();
  await expect(db.delete(table).where(eq(table.id, activation))).rejects.toThrow();
  await expect(db.delete(schema.users).where(eq(schema.users.id, actor.ownerId))).rejects.toThrow();
  await expect(isolated.pool.query("TRUNCATE local_image_operator_activations")).rejects.toThrow();
});
it("atomically consumes one consent while preserving old encrypted credentials until success", async () => {
  const [before] = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  const { proxy, state } = await consent(); const active = await row();
  expect(active).toMatchObject({ phase: "consent-pending", revision: 1, consentStateHash: state });
  const [after] = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  expect(after.access).toEqual(before.access); expect(after.refresh).toEqual(before.refresh); expect(after.scopes).toEqual(before.scopes); expect(after.version).toBe(active.consentVersion);
  expect(await repo.byStateHash(state)).toEqual(active);
  await expect(proxy.begin(actor.ownerId, realMediaDigest(actor.id), config, realMediaDigest("second"), stamp(), stamp(), EBAY_DISCOVERY_SCOPES)).rejects.toBeInstanceOf(LocalOperatorError);
  expect(await row()).toEqual(active);
});
it("serializes competing consent clicks and never obtains a second allowance", async () => {
  const results = await Promise.allSettled([consent(), consent()]); expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect((await row()).consentStartedAt).not.toBeNull();
  expect(await db.select().from(schema.ebayOauthStates).where(eq(schema.ebayOauthStates.ownerId, actor.ownerId))).toHaveLength(1);
});
it.each(["scope", "config", "session", "owner"])("rejects wrong %s before consuming consent", async kind => {
  const proxy = repo.consentRepository(activation, actor, 0);
  await expect(proxy.begin(kind === "owner" ? randomUUID() : actor.ownerId, realMediaDigest(kind === "session" ? randomUUID() : actor.id), kind === "config" ? realMediaDigest("other") : config,
    realMediaDigest("state"), stamp(), stamp(), kind === "scope" ? ["https://api.ebay.com/oauth/api_scope"] : EBAY_DISCOVERY_SCOPES)).rejects.toBeInstanceOf(LocalOperatorError);
  expect((await row()).revision).toBe(0);
});
it("requires consumed exact state, ordered intent and one-use exchange/identity", async () => {
  const { proxy, state } = await consent();
  await expect(repo.consumeCallbackIntent(activation, actor, state, "exchange")).rejects.toBeInstanceOf(LocalOperatorError);
  await proxy.consume(actor.ownerId, realMediaDigest(actor.id), config, state, new Date().toISOString());
  await expect(repo.consumeCallbackIntent(activation, actor, state, "identity")).rejects.toBeInstanceOf(LocalOperatorError);
  await repo.consumeCallbackIntent(activation, actor, state, "exchange");
  await expect(repo.consumeCallbackIntent(activation, actor, state, "exchange")).rejects.toBeInstanceOf(LocalOperatorError);
  await repo.consumeCallbackIntent(activation, actor, state, "identity");
  await expect(repo.consumeCallbackIntent(activation, actor, state, "identity")).rejects.toBeInstanceOf(LocalOperatorError);
  await proxy.connect(actor.ownerId, (await row()).consentVersion!, values(), stamp());
  expect((await row()).phase).toBe("connected");
  await expect(proxy.connect(actor.ownerId, (await row()).consentVersion!, values(), stamp())).rejects.toBeInstanceOf(LocalOperatorError);
});
it.each(["seller", "scope", "access", "refresh"])("rolls back %s mismatch without replacing credentials", async kind => {
  const { proxy, state } = await consent(); await proxy.consume(actor.ownerId, realMediaDigest(actor.id), config, state, new Date().toISOString());
  await repo.consumeCallbackIntent(activation, actor, state, "exchange"); await repo.consumeCallbackIntent(activation, actor, state, "identity");
  const before = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  const v = values(); if (kind === "seller") v.sellerId = realMediaDigest("other"); if (kind === "scope") v.scopes = ["https://api.ebay.com/oauth/api_scope"]; if (kind === "access") v.accessExpiresAt = new Date(Date.now() - 1000).toISOString(); if (kind === "refresh") v.refreshExpiresAt = new Date(Date.now() - 1000).toISOString();
  await expect(proxy.connect(actor.ownerId, (await row()).consentVersion!, v, stamp())).rejects.toBeInstanceOf(LocalOperatorError);
  expect(await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, actor.ownerId))).toEqual(before); expect((await row()).phase).toBe("consent-pending");
});
it("binds exactly one generated fixture and consumes concurrent run requests once", async () => {
  const active = await ready(), runner = randomUUID();
  const runs = await Promise.allSettled([repo.claimRun(activation, actor, active.revision, runner), repo.claimRun(activation, actor, active.revision, randomUUID())]);
  expect(runs.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const running = await row(); expect(running.phase).toBe("running"); expect(running.runStartedAt).not.toBeNull();
  await expect(repo.claimRun(activation, actor, running.revision, randomUUID())).rejects.toBeInstanceOf(LocalOperatorError);
  await expect(repo.pinFixtureContent(activation, actor, running.revision, { sourceDigest: realMediaDigest("replacement"), derivativeDigest: realMediaDigest("replacement") })).rejects.toBeInstanceOf(LocalOperatorError);
});
it("retains stopped cancellation and idempotent late settlement without reopening permission", async () => {
  let active = await ready(); const runner = randomUUID(); active = await repo.claimRun(activation, actor, active.revision, runner);
  await repo.requestCancel(activation, actor, active.revision); active = await repo.stop(activation, actor.ownerId);
  await db.delete(schema.sessions).where(eq(schema.sessions.id, actor.id));
  const settled = await repo.settle(activation, actor.ownerId, runner); expect(settled.phase).toBe("stopped"); expect(settled.cancelRequestedAt).toBe(active.cancelRequestedAt); expect(settled.settledAt).not.toBeNull();
  expect(await repo.settle(activation, actor.ownerId, runner)).toEqual(settled); expect(await repo.stop(activation, actor.ownerId)).toEqual(settled);
  await expect(repo.settle(activation, actor.ownerId, randomUUID())).rejects.toBeInstanceOf(LocalOperatorError);
});
it("refuses foreign owner/session and stale revisions without disclosing another row", async () => {
  const active = await connected();
  expect(await repo.activation(activation, randomUUID())).toBeNull();
  await expect(repo.beginFixture(activation, { ...actor, ownerId: randomUUID() }, active.revision, randomUUID())).rejects.toBeInstanceOf(LocalOperatorError);
  const extra = randomUUID(); await db.insert(schema.sessions).values({ id: extra, userId: actor.ownerId, token: randomUUID(), expiresAt: new Date(stamp()) });
  await expect(repo.beginFixture(activation, { ...actor, id: extra }, active.revision, randomUUID())).rejects.toBeInstanceOf(LocalOperatorError);
  await expect(repo.beginFixture(activation, actor, active.revision - 1, randomUUID())).rejects.toBeInstanceOf(LocalOperatorError);
});
it.each(["session", "access", "refresh", "version", "listing"])("fails run after %s changes and preserves pins", async kind => {
  const active = await ready();
  if (kind === "session") await db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.sessions.id, actor.id));
  if (kind === "access") await db.update(schema.ebayConnections).set({ accessExpiresAt: new Date(Date.now() - 1).toISOString() }).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  if (kind === "refresh") await db.update(schema.ebayConnections).set({ refreshExpiresAt: new Date(Date.now() - 1).toISOString() }).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  if (kind === "version") await db.update(schema.ebayConnections).set({ version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  if (kind === "listing") await db.update(schema.listings).set({ updatedAt: sql`clock_timestamp()+interval '1 second'` }).where(eq(schema.listings.id, active.listingId!));
  await expect(repo.claimRun(activation, actor, active.revision, randomUUID())).rejects.toBeInstanceOf(LocalOperatorError); expect(await row()).toEqual(active);
});
it.each(["session", "access", "refresh"])("does not backdate SQL guards or authorize across a blocking lock past %s expiry", async kind => {
  const active = await ready();
  if (kind === "session") await db.update(schema.sessions).set({ expiresAt: new Date(Date.now() + 450) }).where(eq(schema.sessions.id, actor.id));
  if (kind === "access") await db.update(schema.ebayConnections).set({ accessExpiresAt: new Date(Date.now() + 450).toISOString() }).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  if (kind === "refresh") await db.update(schema.ebayConnections).set({ refreshExpiresAt: new Date(Date.now() + 450).toISOString() }).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  const blocker = await isolated.pool.connect(); await blocker.query("BEGIN"); await blocker.query("SELECT id FROM listings WHERE id=$1 FOR UPDATE", [active.listingId]);
  let finished = false; const pending = repo.claimRun(activation, actor, active.revision, randomUUID()).finally(() => { finished = true; }); const rejection = expect(pending).rejects.toBeInstanceOf(LocalOperatorError);
  try { await new Promise(r => setTimeout(r, 550)); expect(finished).toBe(false); await blocker.query("COMMIT"); await rejection; } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  expect(await row()).toEqual(active);
  await expect(db.update(table).set({ phase: "running", runStartedAt: "2000-01-01T00:00:00.000Z", runnerId: randomUUID(), revision: active.revision + 1, updatedAt: "2000-01-01T00:00:00.000Z" }).where(and(eq(table.id, activation), eq(table.revision, active.revision)))).rejects.toThrow();
  expect(await row()).toEqual(active);
});
it("keeps history on connection/product deletion and refuses cleanup without exact settled fence", async () => {
  let active = await ready(); const runner = randomUUID(); await repo.claimRun(activation, actor, active.revision, runner); active = await repo.settle(activation, actor.ownerId, runner);
  await expect(repo.beginCleanup(activation, actor, active.revision)).rejects.toBeInstanceOf(LocalOperatorError);
  await db.delete(schema.listings).where(eq(schema.listings.id, active.listingId!)); await db.delete(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  expect(await row()).toEqual(active); expect(await repo.fixtureRetentionUntil(activation, actor.ownerId)).toBeNull();
});

it("authorizes fixture storage only with current post-lock session/grant context", async () => {
  let active = await connected(); const listingId = randomUUID(), sourceDigest = realMediaDigest(randomUUID()), derivativeDigest = realMediaDigest(randomUUID());
  active = await repo.beginFixture(activation, actor, active.revision, listingId);
  active = await repo.pinFixtureContent(activation, actor, active.revision, { sourceDigest, derivativeDigest });
  await expect(repo.authorizeFixture(activation, actor)).rejects.toBeInstanceOf(LocalOperatorError);
  await new DrizzleListingRepository(db).create(actor.ownerId, { ...listingFixture(), id: listingId, title: "SANDBOX M3 Generated " + sourceDigest.slice(0, 12) });
  expect(await repo.authorizeFixture(activation, actor)).toEqual(active);
  await db.update(schema.ebayConnections).set({ refreshExpiresAt: new Date(Date.now() - 1).toISOString() }).where(eq(schema.ebayConnections.ownerId, actor.ownerId));
  await expect(repo.authorizeFixture(activation, actor)).rejects.toBeInstanceOf(LocalOperatorError);
  expect(await row()).toEqual(active);
});
it("permits only settled exact-fence cleanup under a fresh same-owner session and keeps acknowledgement idempotent", async () => {
  let active = await ready(); const runner = randomUUID(); active = await repo.claimRun(activation, actor, active.revision, runner);
  const media = new DrizzleEbayRealMediaRepository(db), binding = await media.snapshot(actor.ownerId, active.listingId!, active.imageId!);
  const guard = { binding, sessionId: actor.id, leaseDeadline: new Date(Date.now() + 30_000).toISOString() };
  const claim = await media.claim({ ownerId: actor.ownerId, listingId: active.listingId!, imageId: active.imageId!, listingVersion: new Date(active.listingVersion!).toISOString(), sessionHash: mediaSessionHash(actor.ownerId, actor.id), actionHash: realMediaDigest(randomUUID()), configHash: config, recipe: active.derivativeRecipe, operation: "capture-only" }, guard);
  await media.fence(claim, { sourceDigest: active.sourceDigest!, derivativeDigest: active.derivativeDigest!, recipe: active.derivativeRecipe, width: 500, height: 600, size: 100, contentType: "image/png" }, guard);
  active = await repo.settle(activation, actor.ownerId, runner);
  await expect(repo.beginCleanup(activation, actor, active.revision)).rejects.toBeInstanceOf(LocalOperatorError);
  // Synthetic elapsed-retention fixture; immutable media history is untouched.
  await db.update(schema.listingImages).set({ providerRetainUntil: new Date(Date.now() - 1000).toISOString() }).where(eq(schema.listingImages.id, active.imageId!));
  await db.delete(schema.sessions).where(eq(schema.sessions.id, actor.id));
  const fresh = { ...actor, id: randomUUID() }; await db.insert(schema.sessions).values({ id: fresh.id, userId: actor.ownerId, token: randomUUID(), expiresAt: new Date(stamp()) });
  active = await repo.beginCleanup(activation, fresh, active.revision);
  expect(active.cleanupSessionHash).toBe(mediaSessionHash(actor.ownerId, fresh.id));
  expect(active.sessionHash).not.toBe(active.cleanupSessionHash);
  const cleanup = await queueVerificationFixtureCleanup(db, fresh, { head: active.reviewedHead, database: isolated.name, listing: active.listingId!, image: active.imageId!, listingVersion: new Date(active.listingVersion!).toISOString(), seller: active.sellerKey, connectionVersion: active.connectedVersion!, sourceDigest: active.sourceDigest!, derivativeDigest: active.derivativeDigest! }, new AbortController().signal);
  expect(cleanup.status).toBe("queued"); active = await repo.recordCleanup(activation, actor.ownerId, cleanup.notBefore);
  expect(active.phase).toBe("cleanup-queued"); expect(await repo.recordCleanup(activation, actor.ownerId, cleanup.notBefore)).toEqual(active);
  await expect(repo.recordCleanup(activation, actor.ownerId, stamp())).rejects.toBeInstanceOf(LocalOperatorError);
  await expect(repo.claimRun(activation, fresh, active.revision, randomUUID())).rejects.toBeInstanceOf(LocalOperatorError);
  expect(await db.select().from(schema.ebayRealMediaAttempts).where(eq(schema.ebayRealMediaAttempts.id, claim.id))).toHaveLength(1);
  expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);
});
