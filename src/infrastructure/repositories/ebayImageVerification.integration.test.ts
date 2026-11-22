import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { disposableVerificationDatabase } from "../../test/disposableVerificationDatabase";
import { listingFixture } from "../../test/fixtures";
import { EBAY_DISCOVERY_SCOPES } from "../../application/ebayConnection";
import { realMediaDigest, mediaSessionHash, type RealMediaClaim, type RealMediaReviewGuard } from "../../application/ebayRealMedia";
import { IMAGE_VERIFICATION_POLICY, type VerificationReference, type VerificationEnvelope } from "../../application/ebayImageVerificationPersistence";
import { DrizzleEbayImageVerificationRepository } from "./drizzleEbayImageVerificationRepository";
import { DrizzleEbayRealMediaRepository } from "./drizzleEbayRealMediaRepository";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { mediaRuntime } from "../ebay/mediaRuntime";
import { admitRealMediaEvidence } from "../ebay/realMediaEvidence";
import * as schema from "../db/schema";

vi.mock("@vercel/blob", () => { throw new Error("Provider construction forbidden."); });
vi.mock("../ebay/ebayClient", () => { throw new Error("Provider construction forbidden."); });
vi.mock("dotenv", () => ({ config() { throw new Error("Private environment loading forbidden."); } }));
const forbidden = vi.fn(() => { throw new Error("External network forbidden."); });
let isolated: Awaited<ReturnType<typeof disposableVerificationDatabase>>, db: typeof isolated.db;
let repository: DrizzleEbayImageVerificationRepository, media: DrizzleEbayRealMediaRepository, listings: DrizzleListingRepository;
let owner: string, foreign: string, sessionId: string, parent: RealMediaClaim, guard: RealMediaReviewGuard;
let content: { sourceDigest: string; derivativeDigest: string; recipe: string; contentType: "image/png"; size: number; width: number; height: number };
const v = schema.ebayImageVerifications, e = schema.ebayImageVerificationOutcomes, a = schema.ebayRealMediaAttempts;
const config = realMediaDigest("synthetic-verification-config");
const message = "Diagnostic persistence refused or unavailable.";
const response: VerificationEnvelope = { version: "diagnostic-verification-v1", event: "response", reason: "bounded-response", settlement: "settled", httpStatus: 200, bytes: 17, exceeded: false, mime: "image/png" };
const cancelled: VerificationEnvelope = { ...response, event: "cancelled", reason: "cancelled", settlement: "unsettled", httpStatus: null, bytes: 0, mime: null };
async function time(offset = 0): Promise<string> {
  const r = await isolated.pool.query("SELECT to_char((clock_timestamp()+$1*interval '1 millisecond') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at", [offset]);
  return r.rows[0].at;
}
async function addParent(user = owner) {
  const listing = await listings.create(user, listingFixture()), imageId = randomUUID();
  await db.insert(schema.listingImages).values({ id: imageId, listingId: listing.id, storageProvider: "vercel-blob", pathname: "synthetic-owned/" + imageId,
    originalFilename: "synthetic-file.png", contentType: "image/png", byteSize: 17, uploadedAt: sql`clock_timestamp()`, order: 0 });
  const binding = await media.snapshot(user, listing.id, imageId), localGuard = { binding, sessionId, leaseDeadline: await time(30_000) };
  const claim = await media.claim({ ownerId: user, listingId: listing.id, imageId, listingVersion: binding.listingVersion, configHash: config, recipe: "synthetic-recipe-v1",
    actionHash: realMediaDigest(randomUUID()), sessionHash: mediaSessionHash(user, sessionId), operation: "capture-only" }, localGuard);
  return { claim, guard: localGuard, content: { sourceDigest: realMediaDigest("source:" + imageId), derivativeDigest: realMediaDigest("derivative:" + imageId), recipe: "synthetic-recipe-v1", contentType: "image/png" as const, size: 17, width: 500, height: 600 } };
}
async function reserve(overrides: Partial<Parameters<typeof repository.reserveVerification>[0]> = {}) {
  return repository.reserveVerification({ parent, guard, actionHash: realMediaDigest(randomUUID()), sourceDigest: content.sourceDigest,
    derivativeDigest: content.derivativeDigest, reviewUntil: await time(20_000), policy: IMAGE_VERIFICATION_POLICY, ...overrides });
}
async function fence(ref: VerificationReference) { parent = await media.fence(parent, content, guard); return { ...ref, parent }; }
async function intent(ref: VerificationReference) {
  return repository.recordRequestIntent(ref, guard, { responseReceivedAt: await time(), providerExpiresAt: await time(3_600_000) });
}
const row = async (id: string) => (await db.select().from(v).where(eq(v.id, id)))[0];
const events = async (id: string) => db.select().from(e).where(eq(e.verificationId, id));
async function snapshot(id: string) { return (await isolated.pool.query("SELECT row_to_json(v)::text AS value FROM ebay_image_verifications v WHERE id=$1", [id])).rows[0]?.value; }
beforeAll(async () => {
  vi.stubGlobal("fetch", forbidden);
  vi.spyOn(http, "request").mockImplementation(forbidden); vi.spyOn(https, "request").mockImplementation(forbidden);
  vi.spyOn(http, "get").mockImplementation(forbidden); vi.spyOn(https, "get").mockImplementation(forbidden);
  vi.spyOn(dns, "lookup").mockImplementation(forbidden); vi.spyOn(dns.promises, "lookup").mockImplementation(forbidden);
  isolated = await disposableVerificationDatabase(); db = isolated.db;
}, 30_000);
beforeEach(async () => {
  await db.execute(sql`DROP TRIGGER IF EXISTS aaa_verification_short_lease ON public.ebay_image_verifications`);
  owner = randomUUID(); foreign = randomUUID(); sessionId = randomUUID();
  await db.insert(schema.users).values([owner, foreign].map(id => ({ id, name: "Synthetic owner", email: id + "@example.invalid" })));
  await db.insert(schema.sessions).values({ id: sessionId, token: randomUUID(), userId: owner, expiresAt: new Date(Date.now() + 3_600_000) });
  await db.insert(schema.ebayConnections).values({ ownerId: owner, id: randomUUID(), version: randomUUID(), configHash: config, status: "connected", sellerId: realMediaDigest(owner), sellerLabel: "Synthetic",
    scopes: [...EBAY_DISCOVERY_SCOPES], access: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 }, refresh: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 },
    connectedAt: sql`clock_timestamp()`, accessExpiresAt: sql`clock_timestamp()+interval '1 hour'`, refreshExpiresAt: sql`clock_timestamp()+interval '1 day'` });
  repository = new DrizzleEbayImageVerificationRepository(db); media = new DrizzleEbayRealMediaRepository(db); listings = new DrizzleListingRepository(db);
  const fresh = await addParent(); parent = fresh.claim; guard = fresh.guard; content = fresh.content;
});
afterEach(() => { if (vi.isMockFunction(db?.transaction)) vi.mocked(db.transaction).mockRestore(); expect(forbidden).not.toHaveBeenCalled(); });
afterAll(async () => { if (isolated) await isolated.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("migrates fresh/repeatably and completes one local intent/outcome without a receipt or network permission", async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  const ref = await intent(await fence(await reserve()));
  const before = await snapshot(ref.id); await repository.checkIntentContext(ref, guard); expect(await snapshot(ref.id)).toBe(before);
  const result = await repository.recordOutcome(ref, { intentRevision: 1, envelope: response });
  expect(result).toMatchObject({ late: false, overflow: false, associated: false });
  expect(await repository.status(owner, ref.id)).toEqual({ phase: "intent-recorded", hasOutcome: true, late: false, conflict: false, overflow: false, detached: false, associated: false });
  await expect(repository.checkIntentContext(ref, guard)).rejects.toThrow(message);
  expect((await db.select().from(a).where(eq(a.id, parent.id)))[0]).toMatchObject({ state: "unknown", operation: "capture-only", sourceDigest: content.sourceDigest, derivativeDigest: content.derivativeDigest });
  expect(await db.select().from(schema.ebayRealMediaReceipts)).toEqual([]); expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);
  expect(mediaRuntime()).toEqual({ enabled: false }); expect(() => admitRealMediaEvidence({})).toThrow();
});
it("records Day30/Day90 obligations and bounded deadlines using full database precision", async () => {
  const ref = await reserve();
  const result = await isolated.pool.query("SELECT review_due_at=created_at+interval '30 days' AS review,disposition_due_at=created_at+interval '90 days' AS disposition,lease_until<=created_at+interval '30 seconds' AS lease,lease_until<=review_until AS cap FROM ebay_image_verifications WHERE id=$1", [ref.id]);
  expect(result.rows[0]).toEqual({ review: true, disposition: true, lease: true, cap: true });
  const fenced = await fence(ref);
  // Two observation times in one millisecond bucket remain distinct database
  // instants. No assumption about the random microseconds of the fence clock.
  await isolated.pool.query("SELECT pg_sleep(0.003)");
  const times = (await isolated.pool.query("SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS first,to_char((t+interval '100 microseconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS second FROM (SELECT date_trunc('milliseconds',clock_timestamp())-interval '1 millisecond'+interval '100 microseconds' AS t) x")).rows[0];
  await repository.recordRequestIntent(fenced, guard, { responseReceivedAt: times.first, providerExpiresAt: await time(3_600_000) });
  const same = await isolated.pool.query("SELECT date_trunc('milliseconds',v.response_received_at)=date_trunc('milliseconds',$2::timestamptz) AS same_bucket,v.response_received_at<>$2::timestamptz AS distinct_times,v.request_deadline<=v.request_intent_at+interval '10 seconds' AS deadline FROM ebay_image_verifications v WHERE v.id=$1", [ref.id, times.second]);
  expect(same.rows[0]).toEqual({ same_bucket: true, distinct_times: true, deadline: true });
});
it.each(["already-fenced", "closed-parent", "normal-parent"])("refuses retrospective or wrong-operation enrollment: %s", async kind => {
  if (kind === "already-fenced") parent = await media.fence(parent, content, guard);
  if (kind === "closed-parent") await media.notSent(parent);
  if (kind === "normal-parent") { await media.notSent(parent); const b = guard.binding; parent = await media.claim({ ownerId: owner, listingId: parent.listingId, imageId: parent.imageId, listingVersion: b.listingVersion, configHash: config, recipe: content.recipe, sessionHash: parent.sessionHash, actionHash: realMediaDigest(randomUUID()) }); }
  await expect(reserve()).rejects.toThrow(message);
  expect(await db.select().from(v).where(eq(v.ownerId, owner))).toEqual([]);
});
it("never replaces a closed parent reservation or moves a consumed action to another parent", async () => {
  const ref = await reserve(); await repository.closePrepared(ref, "cancelled"); const before = await snapshot(ref.id);
  await repository.closePrepared(ref, "cancelled"); expect(await snapshot(ref.id)).toBe(before);
  await expect(reserve()).rejects.toThrow(message);
  const next = await addParent(); parent = next.claim; guard = next.guard; content = next.content;
  await expect(reserve({ actionHash: ref.actionHash })).rejects.toThrow(message);
  expect((await reserve()).id).not.toBe(ref.id);
  expect(await snapshot(ref.id)).toBe(before);
});
it("serializes simultaneous same-parent and same-action claims without orphan history", async () => {
  const first = await Promise.allSettled([reserve(), reserve()]); expect(first.filter(x => x.status === "fulfilled")).toHaveLength(1);
  const next = await addParent(), another = await addParent(), hash = realMediaDigest(randomUUID());
  const make = (p: typeof next) => reserve({ parent: p.claim, guard: p.guard, sourceDigest: p.content.sourceDigest, derivativeDigest: p.content.derivativeDigest, actionHash: hash });
  const both = await Promise.allSettled([make(next), make(another)]); expect(both.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(v).where(eq(v.ownerId, owner))).toHaveLength(2);
});
it("serializes competing intent/closure and rejects replay without changing a committed intent", async () => {
  const ref = await fence(await reserve());
  const settled = await Promise.allSettled([intent(ref), repository.closePrepared(ref, "cancelled")]);
  expect(settled.filter(x => x.status === "fulfilled")).toHaveLength(1);
  const before = await snapshot(ref.id); await expect(intent(ref)).rejects.toThrow(message); expect(await snapshot(ref.id)).toBe(before);
});
it("uses generic cross-owner errors and restrictive composite owner relationships", async () => {
  const ref = await reserve(), before = await snapshot(ref.id);
  const bad = { ...ref, ownerId: foreign, parent: { ...ref.parent, ownerId: foreign } };
  expect(await repository.status(foreign, ref.id)).toBeNull();
  await expect(repository.closePrepared(bad, "cancelled")).rejects.toThrow(message);
  await expect(repository.recordOutcome(bad, { intentRevision: null, envelope: cancelled })).rejects.toThrow(message);
  await expect(reserve({ parent: { ...parent, ownerId: foreign } })).rejects.toThrow(message);
  await expect(db.insert(e).values({ id: randomUUID(), verificationId: ref.id, ownerId: foreign, intentRevision: null, envelope: cancelled, fingerprint: realMediaDigest("fake"), recordedAt: sql`clock_timestamp()`, late: false, protocolConflict: false })).rejects.toThrow();
  expect(await snapshot(ref.id)).toBe(before); expect(await events(ref.id)).toEqual([]);
});
it.each(["token", "action", "session", "image", "parent", "future-child-revision", "future-parent-revision"])("refuses an altered internal reference: %s", async kind => {
  const ref = await reserve(), bad = structuredClone(ref), before = await snapshot(ref.id);
  if (kind === "token") bad.parent.token = randomUUID(); if (kind === "action") bad.actionHash = realMediaDigest("other");
  if (kind === "session") bad.parent.sessionHash = realMediaDigest("other"); if (kind === "image") bad.parent.imageId = randomUUID();
  if (kind === "parent") bad.parent.id = randomUUID(); if (kind === "future-child-revision") bad.revision++;
  if (kind === "future-parent-revision") bad.parent.revision++;
  await expect(repository.recordOutcome(bad, { intentRevision: null, envelope: cancelled })).rejects.toThrow(message); expect(await snapshot(ref.id)).toBe(before);
});
it.each(["source", "derivative", "parent-revision"])("rejects a mismatched frozen upload binding: %s", async kind => {
  const ref = await reserve({ ...(kind === "source" ? { sourceDigest: realMediaDigest("wrong") } : {}), ...(kind === "derivative" ? { derivativeDigest: realMediaDigest("wrong") } : {}) });
  const ready = await fence(ref); if (kind === "parent-revision") ready.parent = { ...ready.parent, revision: 0 };
  const before = await snapshot(ref.id); await expect(intent(ready)).rejects.toThrow(message); expect(await snapshot(ref.id)).toBe(before);
});
it("keeps lost-ack evidence idempotent before the four-envelope budget and latches overflow once", async () => {
  const ref = await intent(await fence(await reserve())), transaction = db.transaction.bind(db);
  const fault = vi.spyOn(db, "transaction").mockImplementationOnce(async callback => { await transaction(callback); throw new Error("Synthetic commit acknowledgement lost"); });
  await expect(repository.recordOutcome(ref, { intentRevision: 1, envelope: response })).rejects.toThrow(message); fault.mockRestore();
  const before = await snapshot(ref.id), saved = (await events(ref.id))[0];
  const ack = await repository.recordOutcome(ref, { intentRevision: 1, envelope: response }); expect(ack.evidenceId).toBe(saved.id); expect(await snapshot(ref.id)).toBe(before);
  for (const status of [201, 400, 500]) await repository.recordOutcome(ref, { intentRevision: 1, envelope: { ...response, httpStatus: status } });
  const full = await snapshot(ref.id); expect(await repository.recordOutcome(ref, { intentRevision: 1, envelope: response })).toEqual(ack); expect(await snapshot(ref.id)).toBe(full);
  const extra = { intentRevision: 1 as const, envelope: { ...response, httpStatus: 503 } };
  expect(await repository.recordOutcome(ref, extra)).toEqual({ evidenceId: null, late: true, overflow: true, associated: false });
  const overflow = await snapshot(ref.id); await repository.recordOutcome(ref, extra); expect(await snapshot(ref.id)).toBe(overflow);
  expect(await events(ref.id)).toHaveLength(4); expect(await repository.status(owner, ref.id)).toMatchObject({ conflict: true, overflow: true, associated: false });
});
it("serializes duplicate local outcomes and preserves the original acknowledgement revision", async () => {
  const ref = await intent(await fence(await reserve()));
  const ack = await Promise.all([repository.recordOutcome(ref, { intentRevision: 1, envelope: response }), repository.recordOutcome(ref, { intentRevision: 1, envelope: response })]);
  expect(ack[0]).toEqual(ack[1]); expect(await events(ref.id)).toHaveLength(1); expect((await row(ref.id)).revision).toBe(2);
});
it("retains cancellation then compatible late settlement without inventing a contradiction", async () => {
  const ref = await intent(await fence(await reserve()));
  await repository.recordOutcome(ref, { intentRevision: 1, envelope: cancelled });
  await expect(repository.checkIntentContext(ref, guard)).rejects.toThrow(message);
  const late = await repository.recordOutcome(ref, { intentRevision: 1, envelope: response }); expect(late.late).toBe(true);
  expect(await repository.status(owner, ref.id)).toMatchObject({ phase: "intent-recorded", late: true, conflict: false, associated: false });
});
it("keeps response-without-intent as protocol evidence and never creates a request intent", async () => {
  const ref = await reserve(); await repository.recordOutcome(ref, { intentRevision: null, envelope: response });
  expect(await repository.status(owner, ref.id)).toMatchObject({ phase: "closed", conflict: true, associated: false });
  expect((await row(ref.id)).requestIntentAt).toBeNull(); await expect(intent(await fence(ref))).rejects.toThrow(message);
});
it("rejects an incorrect immutable outcome intent reference without requiring latest mutable revision", async () => {
  const ref = await intent(await fence(await reserve()));
  await expect(repository.recordOutcome(ref, { intentRevision: null, envelope: response })).rejects.toThrow(message);
  await repository.recordOutcome(ref, { intentRevision: 1, envelope: cancelled });
  await repository.recordOutcome(ref, { intentRevision: 1, envelope: response });
  expect(await events(ref.id)).toHaveLength(2);
});
it.each(["listing", "connection", "disconnect", "reconnect", "image"])("detaches %s while preserving history and permitting only original late evidence", async kind => {
  const ref = await intent(await fence(await reserve()));
  if (kind === "listing") await listings.delete(owner, parent.listingId);
  if (kind === "connection") await db.delete(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, owner));
  if (kind === "disconnect") await db.update(schema.ebayConnections).set({ status: "disconnected", access: null, refresh: null }).where(eq(schema.ebayConnections.ownerId, owner));
  if (kind === "reconnect") await db.update(schema.ebayConnections).set({ version: randomUUID() }).where(eq(schema.ebayConnections.ownerId, owner));
  if (kind === "image") await db.delete(schema.listingImages).where(eq(schema.listingImages.id, parent.imageId));
  const before = await snapshot(ref.id); await expect(repository.checkIntentContext(ref, guard)).rejects.toThrow(message); expect(await snapshot(ref.id)).toBe(before);
  expect(await repository.recordOutcome(ref, { intentRevision: 1, envelope: response })).toHaveProperty("late", true);
  expect(await repository.status(owner, ref.id)).toMatchObject({ detached: true, associated: false });
});
it("retains history under owner/parent deletion refusal and direct SQL immutability guards", async () => {
  const ref = await intent(await fence(await reserve())); await repository.recordOutcome(ref, { intentRevision: 1, envelope: response });
  await expect(db.delete(schema.users).where(eq(schema.users.id, owner))).rejects.toThrow();
  await expect(db.delete(v).where(eq(v.id, ref.id))).rejects.toThrow(); await expect(db.delete(a).where(eq(a.id, parent.id))).rejects.toThrow();
  await expect(db.delete(e).where(eq(e.verificationId, ref.id))).rejects.toThrow();
  await expect(db.execute(sql`TRUNCATE public.ebay_image_verifications CASCADE`)).rejects.toThrow(); await expect(db.execute(sql`TRUNCATE public.ebay_image_verification_outcomes`)).rejects.toThrow();
  await expect(db.update(e).set({ envelope: { ...response, bytes: 19 } }).where(eq(e.verificationId, ref.id))).rejects.toThrow();
  for (const patch of [{ actionHash: realMediaDigest("new") }, { uploadAttemptId: randomUUID() }, { expectedSourceDigest: realMediaDigest("new") }, { leaseUntil: sql`clock_timestamp()+interval '1 hour'` }, { reviewDueAt: sql`clock_timestamp()+interval '1 year'` }, { phase: "prepared" }, { requestIntentAt: sql`clock_timestamp()` }]) {
    await expect(db.update(v).set({ ...patch, revision: (await row(ref.id)).revision + 1 }).where(eq(v.id, ref.id))).rejects.toThrow();
  }
});
it("never reconstitutes a missing reservation or emits private paths/digests in status/errors", async () => {
  const ref = await reserve(); expect(await repository.status(owner, randomUUID())).toBeNull();
  await expect(repository.recordOutcome({ ...ref, id: randomUUID() }, { intentRevision: null, envelope: cancelled })).rejects.toThrow(message);
  const text = JSON.stringify(await repository.status(owner, ref.id));
  for (const value of ["synthetic-owned", "synthetic-file", ref.parent.token, content.sourceDigest, content.derivativeDigest, ref.actionHash, "sendEligible", "ownership"]) expect(text).not.toContain(value);
});
it.each(["contractVersion", "addressPolicyVersion", "addressPolicyDataHash"])("refuses an unapproved policy tuple field %s", async key => {
  await expect(reserve({ policy: { ...IMAGE_VERIFICATION_POLICY, [key]: "unknown" } })).rejects.toThrow(message);
  expect(await db.select().from(v).where(eq(v.ownerId, owner))).toEqual([]);
});
it.each(["extra", "url", "oversized", "bytes", "status"])("rejects invalid evidence in application and SQL: %s", async kind => {
  const ref = await reserve(); let raw: unknown = { ...response, [kind]: "PRIVATE-MARKER" };
  if (kind === "oversized") raw = { ...response, reason: "x".repeat(2049) }; if (kind === "bytes") raw = { ...response, bytes: 1_048_577 }; if (kind === "status") raw = { ...response, httpStatus: 600 };
  await expect(repository.recordOutcome(ref, { intentRevision: null, envelope: raw as VerificationEnvelope })).rejects.toThrow(message);
  await expect(db.execute(sql`INSERT INTO public.ebay_image_verification_outcomes(id,verification_id,owner_id,intent_revision,envelope,fingerprint,late,protocol_conflict,recorded_at) VALUES (${randomUUID()},${ref.id},${owner},NULL,${JSON.stringify(raw)}::jsonb,${realMediaDigest("pending")},false,false,clock_timestamp())`)).rejects.toThrow();
  expect(await events(ref.id)).toEqual([]);
});

async function shortLease() {
  await db.execute(sql`CREATE OR REPLACE FUNCTION public.test_verification_short_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_id=TG_ARGV[0] THEN NEW.lease_until:=least(NEW.lease_until,clock_timestamp()+interval '1200 milliseconds'); END IF; RETURN NEW; END $$`);
  await db.execute(sql.raw(`CREATE TRIGGER aaa_verification_short_lease BEFORE INSERT ON public.ebay_image_verifications FOR EACH ROW EXECUTE FUNCTION public.test_verification_short_lease('${owner}')`));
}
async function waitLocked(blockSql: string, params: string[], operation: () => Promise<unknown>, until: string) {
  const blocker = await isolated.pool.connect(); await blocker.query("BEGIN"); let pending: Promise<boolean> | undefined;
  try {
    await blocker.query(blockSql, params); pending = operation().then(() => true, () => false);
    let waiting = false;
    for (let i = 0; i < 120; i++) { const q = await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"); if (q.rows[0].n > 0) { waiting = true; break; } await new Promise(r => setTimeout(r, 5)); }
    expect(waiting).toBe(true); await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '80 milliseconds')", [until]);
    await blocker.query("COMMIT"); expect(await pending).toBe(false);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); blocker.release(); if (pending) await pending; }
}
async function earlyPolicy() {
  expect(isolated.name).toMatch(/^marketplace_verification_[a-f0-9]{24}_test$/);
  const original = (await isolated.pool.query("SELECT pg_get_functiondef('public.image_verification_policy_cutoff()'::regprocedure) AS definition")).rows[0].definition;
  const until = await time(1200); expect(Date.parse(until)).toBeLessThan(Date.parse("2027-02-20T20:31:27.970Z"));
  if (!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(until)) throw new Error("Invalid synthetic fixture time.");
  // Stricter fixture only: no production clock override or extension, and no
  // history/immutability guard disabled. Exact committed definition restored.
  await isolated.pool.query(`CREATE OR REPLACE FUNCTION public.image_verification_policy_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT '${until}'::timestamptz $$`);
  return { until, restore: () => isolated.pool.query(original) };
}
it.each(["lease", "review", "session", "access", "refresh", "policy"].flatMap(deadline => ["listing", "connection", "session", "parent", "verification"].map(lock => ({ deadline, lock }))))("rejects $deadline expiry across a real $lock lock wait and rolls back every intent field", async ({ deadline, lock }) => {
  if (deadline === "lease") await shortLease();
  const reserved = await reserve(deadline === "review" ? { reviewUntil: await time(1200) } : {}), ref = await fence(reserved);
  let until = (await isolated.pool.query("SELECT lease_until::text AS at FROM ebay_image_verifications WHERE id=$1", [ref.id])).rows[0].at;
  let policy: Awaited<ReturnType<typeof earlyPolicy>> | undefined;
  if (["session", "access", "refresh"].includes(deadline)) {
    if (deadline === "session") await db.update(schema.sessions).set({ expiresAt: sql`clock_timestamp()+interval '1200 milliseconds'` }).where(eq(schema.sessions.id, sessionId));
    else await db.execute(sql`UPDATE public.ebay_connections SET ${sql.raw(deadline === "access" ? "access_expires_at" : "refresh_expires_at")}=clock_timestamp()+interval '1200 milliseconds' WHERE owner_id=${owner}`);
    until = deadline === "session" ? (await isolated.pool.query("SELECT expires_at::text AS at FROM sessions WHERE id=$1", [sessionId])).rows[0].at : (await isolated.pool.query(`SELECT ${deadline}_expires_at::text AS at FROM ebay_connections WHERE owner_id=$1`, [owner])).rows[0].at;
    guard = { ...guard, binding: await media.snapshot(owner, parent.listingId, parent.imageId) };
  }
  if (deadline === "policy") { policy = await earlyPolicy(); until = policy.until; }
  const before = await snapshot(ref.id);
  try {
    const target = {
      listing: ["SELECT id FROM listings WHERE id=$1 FOR UPDATE", parent.listingId],
      connection: ["SELECT owner_id FROM ebay_connections WHERE owner_id=$1 FOR UPDATE", owner],
      session: ["SELECT id FROM sessions WHERE id=$1 FOR UPDATE", sessionId],
      parent: ["SELECT id FROM ebay_real_media_attempts WHERE id=$1 FOR UPDATE", parent.id],
      verification: ["SELECT id FROM ebay_image_verifications WHERE id=$1 FOR UPDATE", ref.id],
    }[lock]!;
    await waitLocked(target[0], [target[1]], () => intent(ref), until);
    expect(await snapshot(ref.id)).toBe(before); expect(await events(ref.id)).toEqual([]);
  } finally { if (policy) await policy.restore(); }
});
it.each(["session", "access", "refresh"])("read-only final guard rechecks %s after its last blocking verification read", async deadline => {
  const ref = await intent(await fence(await reserve()));
  if (deadline === "session") await db.update(schema.sessions).set({ expiresAt: sql`clock_timestamp()+interval '1200 milliseconds'` }).where(eq(schema.sessions.id, sessionId));
  else await db.execute(sql`UPDATE public.ebay_connections SET ${sql.raw(deadline === "access" ? "access_expires_at" : "refresh_expires_at")}=clock_timestamp()+interval '1200 milliseconds' WHERE owner_id=${owner}`);
  guard = { ...guard, binding: await media.snapshot(owner, parent.listingId, parent.imageId) };
  const until = await time(1300), before = await snapshot(ref.id);
  await waitLocked("SELECT id FROM ebay_image_verifications WHERE id=$1 FOR UPDATE", [ref.id], () => repository.checkIntentContext(ref, guard), until);
  expect(await snapshot(ref.id)).toBe(before); expect(await events(ref.id)).toEqual([]);
});
it("rejects a backdated intent inside an old transaction after genuine lease expiry", async () => {
  await shortLease(); const ref = await fence(await reserve()), before = await snapshot(ref.id), connection = await isolated.pool.connect();
  try {
    await connection.query("BEGIN"); await connection.query("SELECT now()");
    await isolated.pool.query("SELECT pg_sleep_until(lease_until+interval '80 milliseconds') FROM ebay_image_verifications WHERE id=$1", [ref.id]);
    await expect(connection.query("UPDATE ebay_image_verifications SET phase='intent-recorded',revision=revision+1,request_intent_at='2000-01-01',response_received_at=clock_timestamp(),provider_expires_at=clock_timestamp()+interval '1 hour',updated_at='2000-01-01' WHERE id=$1", [ref.id])).rejects.toThrow();
    await connection.query("ROLLBACK"); expect(await snapshot(ref.id)).toBe(before);
  } finally { await connection.query("ROLLBACK").catch(() => {}); connection.release(); }
});
it("never reclaims an expired reservation and permits compatible late outcomes after expiry", async () => {
  await shortLease(); const ref = await intent(await fence(await reserve()));
  await isolated.pool.query("SELECT pg_sleep_until(lease_until+interval '80 milliseconds') FROM ebay_image_verifications WHERE id=$1", [ref.id]);
  await expect(reserve()).rejects.toThrow(message); await expect(repository.checkIntentContext(ref, guard)).rejects.toThrow(message);
  expect(await repository.recordOutcome(ref, { intentRevision: 1, envelope: response })).toHaveProperty("late", true);
  expect(await repository.status(owner, ref.id)).toMatchObject({ phase: "intent-recorded", conflict: false, associated: false });
});
it("keeps an uncertain committed intent consumed and rolls back rejected local transactions", async () => {
  const ref = await fence(await reserve()), transaction = db.transaction.bind(db);
  const rollback = vi.spyOn(db, "transaction").mockImplementationOnce(callback => transaction(async tx => { await callback(tx); throw new Error("Synthetic rollback"); }));
  const before = await snapshot(ref.id); await expect(intent(ref)).rejects.toThrow(message); rollback.mockRestore(); expect(await snapshot(ref.id)).toBe(before);
  const lost = vi.spyOn(db, "transaction").mockImplementationOnce(async callback => { await transaction(callback); throw new Error("Synthetic acknowledgement lost"); });
  await expect(intent(ref)).rejects.toThrow(message); lost.mockRestore(); expect((await row(ref.id)).phase).toBe("intent-recorded");
  await expect(intent(ref)).rejects.toThrow(message); await expect(reserve()).rejects.toThrow(message);
  expect(await events(ref.id)).toEqual([]);
});

it("uses the exact fixed policy window, including its full-precision cutoff", async () => {
  const at = async (instant: string, version = IMAGE_VERIFICATION_POLICY.addressPolicyVersion) => (await isolated.pool.query("SELECT image_verification_profile_valid($1,$2,$3,$4::timestamptz) AS valid", [IMAGE_VERIFICATION_POLICY.contractVersion, version, IMAGE_VERIFICATION_POLICY.addressPolicyDataHash, instant])).rows[0].valid;
  expect(await at("2026-11-22T20:31:28.569000Z")).toBe(true);
  expect(await at("2026-11-22T20:31:28.568999Z")).toBe(false);
  expect(await at("2027-02-20T20:31:27.969999Z")).toBe(true);
  expect(await at("2027-02-20T20:31:27.970000Z")).toBe(false);
  expect(await at("infinity")).toBe(false);
  expect(await at(await time(), "unknown" as typeof IMAGE_VERIFICATION_POLICY.addressPolicyVersion)).toBe(false);
});
it.each(["session", "access", "refresh", "review", "parent-lease", "policy"])("reservation rechecks %s after waiting for its parent lock", async deadline => {
  let until = await time(1200), policy: Awaited<ReturnType<typeof earlyPolicy>> | undefined;
  if (deadline === "session") await db.update(schema.sessions).set({ expiresAt: new Date(until) }).where(eq(schema.sessions.id, sessionId));
  if (deadline === "access" || deadline === "refresh") await db.execute(sql`UPDATE public.ebay_connections SET ${sql.raw(deadline + "_expires_at")}=${until}::timestamptz WHERE owner_id=${owner}`);
  if (deadline === "parent-lease") {
    await media.notSent(parent);
    const binding = await media.snapshot(owner, parent.listingId, parent.imageId);
    guard = { binding, sessionId, leaseDeadline: until };
    parent = await media.claim({ ownerId: owner, listingId: parent.listingId, imageId: parent.imageId, listingVersion: binding.listingVersion, configHash: config, recipe: content.recipe, actionHash: realMediaDigest(randomUUID()), sessionHash: mediaSessionHash(owner, sessionId), operation: "capture-only" }, guard);
  }
  if (deadline === "policy") { policy = await earlyPolicy(); until = policy.until; }
  guard = { ...guard, binding: await media.snapshot(owner, parent.listingId, parent.imageId) };
  try {
    await waitLocked("SELECT id FROM ebay_real_media_attempts WHERE id=$1 FOR UPDATE", [parent.id], () => reserve(deadline === "review" ? { reviewUntil: until } : {}), until);
    expect(await db.select().from(v).where(eq(v.ownerId, owner))).toEqual([]);
  } finally { if (policy) await policy.restore(); }
});
it.each(["lease", "review", "policy"])("read-only final guard rejects %s expiry during its last blocking read", async deadline => {
  if (deadline === "lease") await shortLease();
  const ref = await intent(await fence(await reserve(deadline === "review" ? { reviewUntil: await time(1200) } : {})));
  let policy: Awaited<ReturnType<typeof earlyPolicy>> | undefined;
  let until = (await isolated.pool.query("SELECT lease_until::text AS at FROM ebay_image_verifications WHERE id=$1", [ref.id])).rows[0].at;
  if (deadline === "policy") { policy = await earlyPolicy(); until = policy.until; }
  const before = await snapshot(ref.id);
  try { await waitLocked("SELECT id FROM ebay_image_verifications WHERE id=$1 FOR UPDATE", [ref.id], () => repository.checkIntentContext(ref, guard), until); expect(await snapshot(ref.id)).toBe(before); }
  finally { if (policy) await policy.restore(); }
});
it.each(["future", "before-upload", "stale-response", "insufficient-expiry"])("refuses invalid observation timing without partial intent: %s", async kind => {
  const ref = await fence(await reserve()), before = await snapshot(ref.id);
  const times = { responseReceivedAt: await time(), providerExpiresAt: await time(3_600_000) };
  if (kind === "future") times.responseReceivedAt = await time(60_000);
  if (kind === "before-upload") times.responseReceivedAt = "2000-01-01T00:00:00Z";
  if (kind === "stale-response") times.responseReceivedAt = await time(-31_000);
  if (kind === "insufficient-expiry") times.providerExpiresAt = await time(59_000);
  await expect(repository.recordRequestIntent(ref, guard, times)).rejects.toThrow(message); expect(await snapshot(ref.id)).toBe(before);
});
it.each(["seller", "grant", "config", "source", "order", "listing", "session"])("rejects a changed inherited binding before intent: %s", async kind => {
  const ref = await fence(await reserve()), before = await snapshot(ref.id);
  if (kind === "seller") await db.update(schema.ebayConnections).set({ sellerId: realMediaDigest("different") }).where(eq(schema.ebayConnections.ownerId, owner));
  if (kind === "grant") await db.update(schema.ebayConnections).set({ scopes: [EBAY_DISCOVERY_SCOPES[0]] }).where(eq(schema.ebayConnections.ownerId, owner));
  if (kind === "config") await db.update(schema.ebayConnections).set({ configHash: realMediaDigest("different") }).where(eq(schema.ebayConnections.ownerId, owner));
  if (kind === "source") await db.update(schema.listingImages).set({ byteSize: 18 }).where(eq(schema.listingImages.id, parent.imageId));
  if (kind === "order") await db.update(schema.listingImages).set({ order: 1 }).where(eq(schema.listingImages.id, parent.imageId));
  if (kind === "listing") await db.update(schema.listings).set({ updatedAt: sql`clock_timestamp()+interval '1 second'` }).where(eq(schema.listings.id, parent.listingId));
  if (kind === "session") await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  await expect(intent(ref)).rejects.toThrow(message); expect(await snapshot(ref.id)).toBe(before);
  expect(await repository.recordOutcome(ref, { intentRevision: null, envelope: cancelled })).toHaveProperty("late", true);
  expect(await repository.status(owner, ref.id)).toMatchObject({ detached: true, associated: false });
});
it("retains consumed reservation history after rollback and lost commit acknowledgement", async () => {
  const actionHash = realMediaDigest(randomUUID()), transaction = db.transaction.bind(db);
  const rollback = vi.spyOn(db, "transaction").mockImplementationOnce(callback => transaction(async tx => { await callback(tx); throw new Error("Synthetic rollback"); }));
  await expect(reserve({ actionHash })).rejects.toThrow(message); rollback.mockRestore(); expect(await db.select().from(v).where(eq(v.ownerId, owner))).toEqual([]);
  const lost = vi.spyOn(db, "transaction").mockImplementationOnce(async callback => { await transaction(callback); throw new Error("Synthetic acknowledgement lost"); });
  await expect(reserve({ actionHash })).rejects.toThrow(message); lost.mockRestore();
  const rows = await db.select().from(v).where(eq(v.ownerId, owner)); expect(rows).toHaveLength(1);
  await expect(reserve({ actionHash })).rejects.toThrow(message); await expect(reserve()).rejects.toThrow(message);
  const next = await addParent(); parent = next.claim; guard = next.guard; content = next.content;
  await expect(reserve({ actionHash })).rejects.toThrow(message); expect((await reserve()).id).not.toBe(rows[0].id);
});
