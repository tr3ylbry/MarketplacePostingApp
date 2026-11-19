import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableInventoryDatabase } from "../../test/disposableInventoryDatabase";
import { listingFixture } from "../../test/fixtures";
import { inventoryDigest, INVENTORY_LEASE_MS, type InventoryClaimInput, type InventoryEvidence } from "../../application/ebayInventoryPersistence";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import { DrizzleEbayInventoryRepository } from "./drizzleEbayInventoryRepository";
import * as schema from "../db/schema";

let isolated: Awaited<ReturnType<typeof disposableInventoryDatabase>>;
let db: typeof isolated.db, listings: DrizzleListingRepository, repository: DrizzleEbayInventoryRepository;
let owner: string, foreign: string, listingId: string, sessionId: string, now: Date;
const config = inventoryDigest("synthetic-inventory-config");
const r = schema.ebayInventoryResources, a = schema.ebayInventoryAttempts, e = schema.ebayInventoryEvidence;
const attempt = async (id: string) => (await db.select().from(a).where(eq(a.id, id)))[0];
const resource = async (id: string) => (await db.select().from(r).where(eq(r.id, id)))[0];
const evidence = async (id: string) => db.select().from(e).where(eq(e.attemptId, id));
const intent = () => ({ payloadDigest: inventoryDigest("item"), mediaManifestDigest: inventoryDigest("photos") });
function envelope(overrides: Partial<InventoryEvidence> = {}): InventoryEvidence {
  return { version: "inventory-local-v1", kind: "inspection", startedAt: now.toISOString(), finishedAt: now.toISOString(),
    item: "absent", coverage: "complete", outcome: "observed", code: "none", contentDigest: null, related: [], httpStatus: 200, overflow: false, ...overrides };
}
async function connect(user: string, seller = inventoryDigest("seller-" + user)) {
  await db.insert(schema.ebayConnections).values({ ownerId: user, id: randomUUID(), version: randomUUID(), configHash: config, status: "connected", sellerId: seller,
    sellerLabel: "Synthetic account", access: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 },
    refresh: { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 }, connectedAt: now.toISOString(),
    accessExpiresAt: new Date(now.getTime() + 7200000).toISOString(), refreshExpiresAt: new Date(now.getTime() + 86400000).toISOString(), scopes: [...EBAY_SCOPES] });
}
async function request(overrides: Partial<InventoryClaimInput> = {}): Promise<InventoryClaimInput> {
  const [c] = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, overrides.ownerId ?? owner));
  const result = await db.execute(sql`SELECT public.real_media_grant_version(${sql.param(c.scopes)}::text[]) AS hash`);
  return { ownerId: owner, listingId, listingVersion: overrides.listingVersion ?? (await listings.getById(overrides.ownerId ?? owner, overrides.listingId ?? listingId))!.updatedAt, connectionId: c.id, connectionVersion: c.version,
    configHash: config, grantHash: String(result.rows[0].hash), sessionId, actionHash: inventoryDigest(randomUUID()), operation: "inspect", ...overrides };
}
const claim = async (overrides: Partial<InventoryClaimInput> = {}) => repository.claim(await request(overrides));
async function fence() { const input = await request({ operation: "initial-stage" }), c = await repository.claim(input); return repository.recordIntent(c, intent(), input); }
beforeAll(async () => { isolated = await disposableInventoryDatabase(); db = isolated.db; listings = new DrizzleListingRepository(db); }, 30000);
beforeEach(async () => {
  now = new Date(); owner = randomUUID(); foreign = randomUUID(); repository = new DrizzleEbayInventoryRepository(db, () => now);
  await db.insert(schema.users).values([owner, foreign].map(id => ({ id, name: "Synthetic owner", email: id + "@example.invalid" })));
  listingId = (await listings.create(owner, listingFixture())).id; sessionId = randomUUID();
  await db.insert(schema.sessions).values({ id: sessionId, token: randomUUID(), userId: owner, expiresAt: new Date(now.getTime() + 86400000) });
  await connect(owner);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { if (isolated) await isolated.close(); });

it("applies and repeats committed migrations with empty Inventory ledgers", async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  expect(await db.select().from(r)).toEqual([]); expect(await db.select().from(a)).toEqual([]); expect(await db.select().from(e)).toEqual([]);
});
it("derives an owner-scoped projection with no remote ownership or permissions", async () => {
  const before = await listings.getById(owner, listingId), c = await claim();
  expect(await repository.projection(owner, listingId)).toMatchObject({ attemptId: c.id, hold: "none", ownership: "unproven", canStage: false, canDelete: false });
  expect(await repository.projection(foreign, listingId)).toBeNull();
  expect(await listings.getById(owner, listingId)).toEqual(before);
  const row = await resource(c.resourceId); expect(row).not.toHaveProperty("credentials");
  expect(row.reviewDueAt.slice(0,10)).toBe(new Date(Date.UTC(now.getUTCFullYear()+1, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0,10));
});
it("reproduces A/photo-1 -> B/reclaim -> A/photo-2 as a permanently consumed listing action", async () => {
  const input = await request(), first = await repository.claim(input);
  now = new Date(now.getTime()+INVENTORY_LEASE_MS+1); const next = await claim();
  expect(next.id).not.toBe(first.id); expect(next.token).not.toBe(first.token); expect(next.revision).toBe(0);
  expect(await attempt(first.id)).toMatchObject({ state: "retired", actionHash: first.actionHash, revision: 1 });
  const second = await listings.create(owner, listingFixture());
  await expect(claim({ listingId: second.id, listingVersion: second.updatedAt, actionHash: first.actionHash })).rejects.toMatchObject({ code: "blocked" });
  expect(await db.select().from(r).where(eq(r.historicalListingId, second.id))).toEqual([]); // Failed claim rolled back its anchor too.
});
it("preserves successive consumed actions with new IDs and stale-worker rejection", async () => {
  const first = await claim(); now = new Date(now.getTime()+INVENTORY_LEASE_MS+1);
  const second = await claim(); now = new Date(now.getTime()+INVENTORY_LEASE_MS+1);
  const third = await claim({ operation: "initial-stage" });
  for (const old of [first, second]) {
    await expect(claim({ actionHash: old.actionHash })).rejects.toMatchObject({ code: "blocked" });
    await expect(repository.retireUnfenced(old)).rejects.toMatchObject({ code: "stale" });
    await expect(repository.recordIntent(old, intent(), await request({ operation: "initial-stage", actionHash: old.actionHash }))).rejects.toMatchObject({ code: "stale" });
  }
  expect((await attempt(third.id)).state).toBe("preparing");
  expect(new Set([first.id,second.id,third.id]).size).toBe(3);
});
it("serializes concurrent initial and replacement claimants", async () => {
  const input = await request();
  const first = await Promise.allSettled([repository.claim(input), repository.claim({ ...input, actionHash: inventoryDigest(randomUUID()) })]);
  expect(first.filter(x => x.status==="fulfilled")).toHaveLength(1);
  now = new Date(now.getTime()+INVENTORY_LEASE_MS+1);
  const second = await Promise.allSettled([claim(),claim()]); expect(second.filter(x => x.status==="fulfilled")).toHaveLength(1);
  const rows = await db.select().from(a).where(eq(a.ownerId, owner));
  expect(rows).toHaveLength(2); expect(rows.filter(x=>x.state==="retired")).toHaveLength(1);
});
it("rolls back retirement and insertion together if replacement commit fails", async () => {
  const old = await claim(); now = new Date(now.getTime()+INVENTORY_LEASE_MS+1);
  const input=await request(), transaction = db.transaction.bind(db);
  const fault = vi.spyOn(db,"transaction").mockImplementationOnce(callback => transaction(async tx => { await callback(tx); throw new Error("Synthetic commit failure"); }));
  await expect(repository.claim(input)).rejects.toMatchObject({ code: "unavailable" }); fault.mockRestore();
  expect(await attempt(old.id)).toMatchObject({ state: "preparing", revision: 0 });
  expect(await db.select().from(a).where(eq(a.resourceId,old.resourceId))).toHaveLength(1);
  expect((await claim()).id).not.toBe(old.id);
});
it("allows local acknowledgement retry without adding evidence or advancing revision", async () => {
  const c = await claim(), value = envelope(), first = await repository.acknowledge(c,value);
  expect(first).toMatchObject({ late: false, revision: 1, canStage: false, canDelete: false });
  expect(await repository.acknowledge(c,value)).toEqual(first); expect(await evidence(c.id)).toHaveLength(1);
  await expect(claim({ actionHash: c.actionHash })).rejects.toMatchObject({ code: "blocked" });
  expect((await claim()).id).not.toBe(c.id);
});
it("uses durable creation order even when successive attempts share one timestamp", async () => {
  const first = await claim(); await repository.acknowledge(first,envelope()); const next = await claim();
  expect((await repository.projection(owner,listingId))?.attemptId).toBe(next.id);
});
it("keeps intent bindings immutable and seller uncertainty across expiry and fresh SKUs", async () => {
  const c = await fence(), row = await attempt(c.id); expect(row).toMatchObject({ state: "fenced", payloadDigest: intent().payloadDigest });
  expect((await resource(c.resourceId)).hold).toBe("seller");
  now = new Date(now.getTime()+INVENTORY_LEASE_MS+1);
  await expect(repository.retireUnfenced(c)).rejects.toMatchObject({ code: "stale" });
  const other = await listings.create(owner,listingFixture());
  await expect(claim({ listingId:other.id,listingVersion:other.updatedAt,operation:"initial-stage" })).rejects.toMatchObject({ code:"blocked" });
  expect(await claim({ listingId:other.id,listingVersion:other.updatedAt })).toHaveProperty("id"); // Read-only local inspection remains possible.
});
it("never admits ownership from matching synthetic acknowledgement/readback", async () => {
  const c = await fence();
  await repository.acknowledge(c,envelope({ kind:"acknowledgement",item:"present",contentDigest:intent().payloadDigest }));
  expect(await repository.projection(owner,listingId)).toMatchObject({ state:"acknowledged",hold:"seller",ownership:"unproven",canStage:false,canDelete:false });
});
it("retains conflicting acknowledgements and cannot clear a seller hold", async () => {
  const c = await fence(), first = await repository.acknowledge(c,envelope({ kind:"acknowledgement",item:"present",contentDigest:intent().payloadDigest }));
  await repository.acknowledge({ ...c,revision:first.revision },envelope({ kind:"acknowledgement",item:"absent",contentDigest:inventoryDigest("other") }));
  expect(await evidence(c.id)).toHaveLength(2); expect((await attempt(c.id)).state).toBe("conflict");
  expect((await resource(c.resourceId)).hold).toBe("seller");
});
it("preserves late evidence on the old attempt without activating/revising its replacement", async () => {
  const old = await claim(); now = new Date(now.getTime()+INVENTORY_LEASE_MS+1); const replacement = await claim();
  const result = await repository.acknowledge(old,envelope({ item:"present" })); expect(result.late).toBe(true);
  expect((await attempt(old.id)).state).toBe("retired"); expect(await attempt(replacement.id)).toMatchObject({ state:"preparing",revision:0 });
  expect(await repository.projection(owner,listingId)).toMatchObject({ attemptId:replacement.id,hold:"resource" });
});
it.each(["collision","stale","overflow"] as const)("persists a resource hold for pre-intent %s", async code => {
  const c = await claim(); await repository.acknowledge(c,envelope({ code })); expect((await resource(c.resourceId)).hold).toBe("resource");
  const next = await claim({ operation:"inspect" }); expect(next.id).not.toBe(c.id);
  await repository.acknowledge(next,envelope()); expect((await resource(c.resourceId)).hold).toBe("resource");
  await expect(claim({ operation:"initial-stage" })).rejects.toMatchObject({ code:"blocked" });
});
it.each(["recreation","integrity"] as const)("persists seller-wide %s holds with no override", async code => {
  const c = await claim(); await repository.acknowledge(c,envelope({ kind:"conflict",code })); expect((await resource(c.resourceId)).hold).toBe("seller");
});
it("records private recovery evidence without resetting a hold or retiring a fenced claim", async () => {
  const c = await fence(); await repository.acknowledge(c,envelope({ kind:"recovery",outcome:"not-sent" }));
  expect((await attempt(c.id)).state).toBe("fenced"); expect((await resource(c.resourceId)).hold).toBe("seller");
  await expect(repository.retireUnfenced(c)).rejects.toMatchObject({ code:"stale" });
});
it("retires exactly an expired unfenced claim through version checks", async () => {
  const c = await claim(); await expect(repository.retireUnfenced(c)).rejects.toMatchObject({ code:"stale" });
  now = new Date(now.getTime()+INVENTORY_LEASE_MS+1);
  await expect(repository.retireUnfenced({ ...c,revision:1 })).rejects.toMatchObject({ code:"stale" });
  await repository.acknowledge(c,envelope({ kind:"recovery",code:"stale" }));
  await repository.retireUnfenced(c); expect((await attempt(c.id)).state).toBe("retired");
});
it("detaches only the product projection on listing deletion, retaining all consumed history", async () => {
  const c = await claim(); await repository.acknowledge(c,envelope());
  const row = await attempt(c.id), records = await evidence(c.id);
  await listings.delete(owner,listingId);
  expect(await repository.projection(owner,listingId)).toBeNull(); expect(await attempt(c.id)).toEqual(row); expect(await evidence(c.id)).toEqual(records);
  expect(await resource(c.resourceId)).toMatchObject({ currentListingId:null,historicalListingId:listingId,hold:"resource" });
});
it("keeps local images, connection and simulation untouched by internal persistence", async () => {
  const image = randomUUID();
  await db.insert(schema.listingImages).values({ id:image,listingId,storageProvider:"vercel-blob",pathname:"images/"+image+"/synthetic.png",
    originalFilename:"synthetic.png",contentType:"image/png",byteSize:100,uploadedAt:now.toISOString(),order:0 });
  const before = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,owner));
  const c = await fence(); await repository.acknowledge(c,envelope({ kind:"acknowledgement",item:"present" }));
  expect(await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,owner))).toEqual(before);
  expect(await db.select().from(schema.listingImages).where(eq(schema.listingImages.id,image))).toHaveLength(1);
  expect(await db.select().from(schema.ebayMediaAttempts)).toEqual([]); expect(await db.select().from(schema.ebayRealMediaAttempts)).toEqual([]);
});
it.each(["disconnect","delete","config"])("records honest offboarding obligations after connection %s", async mode => {
  const c = await claim();
  if (mode==="disconnect") await new DrizzleEbayConnectionRepository(db).disconnect(owner);
  else if (mode==="delete") await db.delete(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,owner));
  else await db.update(schema.ebayConnections).set({ configHash:inventoryDigest("new-config") }).where(eq(schema.ebayConnections.ownerId,owner));
  const row = await resource(c.resourceId); expect(row).toMatchObject({ currentListingId:null,currentConnectionId:null,hold:"seller" });
  expect(row.retiredAt).not.toBeNull();
  expect(Date.parse(row.offboardReviewDueAt!)-Date.parse(row.retiredAt!)).toBe(7*86400000);
  expect(Date.parse(row.dispositionDueAt!)-Date.parse(row.retiredAt!)).toBe(30*86400000);
  expect(Date.parse(row.retentionReviewAt!)).toBeGreaterThan(Date.parse(row.retiredAt!)+360*86400000);
  expect(await repository.projection(owner,listingId)).toBeNull(); expect(await attempt(c.id)).toHaveProperty("actionHash",c.actionHash);
});
it("retirement uses owner/revision checks and never renews retention deadlines", async () => {
  const c = await claim(), row = await resource(c.resourceId);
  await expect(repository.retireResource(foreign,c.resourceId,row.revision)).rejects.toMatchObject({ code:"stale" });
  await expect(repository.retireResource(owner,c.resourceId,row.revision+1)).rejects.toMatchObject({ code:"stale" });
  await repository.retireResource(owner,c.resourceId,row.revision);
  const retired = await resource(c.resourceId);
  await expect(repository.retireResource(owner,c.resourceId,retired.revision)).rejects.toMatchObject({ code:"stale" });
  expect(await resource(c.resourceId)).toEqual(retired);
});
it("refuses owner deletion rather than cascading away safety history", async () => {
  const c = await claim(); await repository.acknowledge(c,envelope());
  await expect(db.delete(schema.users).where(eq(schema.users.id,owner))).rejects.toThrow();
  expect(await resource(c.resourceId)).toHaveProperty("ownerId",owner); expect(await attempt(c.id)).toBeDefined(); expect(await evidence(c.id)).toHaveLength(1);
});
it("preserves seller/SKU uniqueness across owner, connection and product deletion", async () => {
  const c = await claim(), old = await resource(c.resourceId), seller = old.sellerKey;
  await listings.delete(owner,listingId); await new DrizzleEbayConnectionRepository(db).disconnect(owner);
  await connect(foreign,seller);
  const replacement = listingFixture(); replacement.id=listingId;
  await listings.create(foreign,replacement);
  const [connection] = await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,foreign));
  const otherSession=randomUUID(); await db.insert(schema.sessions).values({ id:otherSession,token:randomUUID(),userId:foreign,expiresAt:new Date(now.getTime()+86400000) });
  const value=await request({ ownerId:foreign,listingId,listingVersion:(await listings.getById(foreign,listingId))!.updatedAt,
    connectionId:connection.id,connectionVersion:connection.version,sessionId:otherSession });
  await expect(repository.claim(value)).rejects.toMatchObject({ code:"blocked",message:"This operation requires private review before continuing." });
  expect(await repository.projection(foreign,listingId)).toBeNull(); expect(await resource(c.resourceId)).toHaveProperty("ownerId",owner);
});
it.each(["token","revision","actionHash","sessionHash","ownerId"])("rejects altered %s claim capabilities", async field => {
  const c=await claim({ operation:"initial-stage" });
  const changed={ ...c,[field]:field==="revision"?1:field==="ownerId"?foreign:field==="token"?randomUUID():inventoryDigest("other") };
  await expect(repository.recordIntent(changed,intent(),await request({ operation:"initial-stage",actionHash:c.actionHash }))).rejects.toMatchObject({ code:"stale" });
  expect((await attempt(c.id)).intentAt).toBeNull();
});
it.each(["listing","connection","grant","session"])("rejects stale %s context before intent and detaches stale projection", async change => {
  const input=await request({ operation:"initial-stage" }),c=await repository.claim(input);
  if(change==="listing") await db.update(schema.listings).set({ updatedAt:new Date(now.getTime()+1000).toISOString() }).where(eq(schema.listings.id,listingId));
  if(change==="connection") await db.update(schema.ebayConnections).set({ version:randomUUID() }).where(eq(schema.ebayConnections.ownerId,owner));
  if(change==="grant") await db.update(schema.ebayConnections).set({ scopes:[...EBAY_SCOPES,"synthetic-scope"] }).where(eq(schema.ebayConnections.ownerId,owner));
  if(change==="session") await db.delete(schema.sessions).where(eq(schema.sessions.id,sessionId));
  await expect(repository.recordIntent(c,intent(),input)).rejects.toMatchObject({ code:"stale" });
  expect((await attempt(c.id)).intentAt).toBeNull(); if(change!=="session") expect(await repository.projection(owner,listingId)).toBeNull();
});
it("rejects a foreign session without creating a resource or attempt", async () => {
  const foreignSession=randomUUID(); await db.insert(schema.sessions).values({ id:foreignSession,token:randomUUID(),userId:foreign,expiresAt:new Date(now.getTime()+86400000) });
  await expect(claim({ sessionId:foreignSession })).rejects.toMatchObject({ code:"stale" });
  expect(await db.select().from(r).where(eq(r.ownerId,owner))).toEqual([]);
});
it("preserves contradictory late evidence after detachment without restoring the projection", async () => {
  const c=await fence(); await listings.delete(owner,listingId);
  await repository.acknowledge(c,envelope({ kind:"acknowledgement",item:"present",contentDigest:intent().payloadDigest }));
  await repository.acknowledge(c,envelope({ kind:"conflict",item:"absent",code:"conflict" }));
  expect((await evidence(c.id)).every(x=>x.late)).toBe(true); expect(await evidence(c.id)).toHaveLength(2);
  expect((await resource(c.resourceId)).hold).toBe("seller"); expect(await repository.projection(owner,listingId)).toBeNull();
});
it("enforces the related-reference budget across an entire inspection and retries overflow idempotently", async () => {
  const c=await claim(), value=envelope({ related:Array.from({ length:200 },(_,n)=>({ kind:"offer",id:"test_"+n })) });
  const first=await repository.acknowledge(c,value);
  const extra=envelope({ related:Array.from({ length:51 },(_,n)=>({ kind:"offer",id:"extra_"+n })) });
  const second=await repository.acknowledge({ ...c,revision:first.revision },extra);
  const rows=await evidence(c.id); expect(rows.reduce((n,row)=>n+row.envelope.related.length,0)).toBe(200);
  expect(rows.find(x=>x.id===second.evidenceId)?.envelope).toMatchObject({ item:"unknown",coverage:"incomplete",overflow:true,related:[] });
  expect(await repository.acknowledge({ ...c,revision:first.revision },extra)).toEqual(second);
});
it.each(["credentials","signedUrl","filename","ownership"])("rejects %s in evidence and keeps it out of safe errors", async key => {
  const c=await claim();
  await expect(repository.acknowledge(c,{ ...envelope(),[key]:"synthetic-forbidden" })).rejects.toMatchObject({ code:"invalid" });
  expect(await evidence(c.id)).toEqual([]);
});
it("enforces strict evidence and 64 KiB/250-reference budgets in direct SQL too", async () => {
  const c=await claim();
  async function insert(value: unknown) {
    return db.insert(e).values({ id:randomUUID(),resourceId:c.resourceId,ownerId:owner,attemptId:c.id,expectedRevision:0,
      late:false,createdAt:now.toISOString(),fingerprint:inventoryDigest(randomUUID()),envelope:value as InventoryEvidence }).returning();
  }
  for(const change of [{ item:null },{ rawBody:"forbidden" },{ related:[{ kind:null,id:"safe" }] },{ related:[{ kind:"offer",id:"a".repeat(201) }] }]) await expect(insert({ ...envelope(),...change })).rejects.toThrow();
  const [saved]=await insert(envelope({ related:Array.from({ length:251 },(_,n)=>({ kind:"offer",id:"test_"+n })) }));
  expect(saved.envelope).toMatchObject({ item:"unknown",coverage:"incomplete",overflow:true,related:[] });
  expect(Buffer.byteLength(JSON.stringify(saved.envelope))).toBeLessThanOrEqual(65536);
});
it.each(["action_hash","claim_hash","listing_id","connection_version","intent_at","payload_digest","revision"])("SQL refuses changing immutable %s", async column => {
  const c=await fence();
  const value=column==="revision"?"revision+2":column==="intent_at"?"NULL":column==="listing_id"||column==="connection_version"?"'other'":"'"+inventoryDigest("other")+"'";
  const assignment=column==="revision"?"revision=revision+2":`${column}=${value},revision=revision+1`;
  await expect(db.execute(sql.raw(`UPDATE public.ebay_inventory_attempts SET ${assignment} WHERE id='${c.id}'`))).rejects.toThrow();
});
it.each(["resources","attempts","evidence"])("SQL disallows deletion/truncation of Inventory %s", async suffix => {
  const c=await claim(); await repository.acknowledge(c,envelope());
  await expect(db.execute(sql.raw(`DELETE FROM public.ebay_inventory_${suffix}`))).rejects.toThrow();
  await expect(db.execute(sql.raw(`TRUNCATE public.ebay_inventory_${suffix} CASCADE`))).rejects.toThrow();
});
it("SQL prevents evidence updates, forged ownership, hold release and deadline extension", async () => {
  const c=await fence(); await repository.acknowledge(c,envelope({ kind:"acknowledgement",item:"present" }));
  await expect(db.execute(sql`UPDATE public.ebay_inventory_evidence SET envelope='{}'::jsonb WHERE attempt_id=${c.id}`)).rejects.toThrow();
  await expect(db.execute(sql`UPDATE public.ebay_inventory_attempts SET state='confirmed',revision=revision+1 WHERE id=${c.id}`)).rejects.toThrow();
  await expect(db.execute(sql`UPDATE public.ebay_inventory_resources SET hold='none',revision=revision+1 WHERE id=${c.resourceId}`)).rejects.toThrow();
  await expect(db.execute(sql`UPDATE public.ebay_inventory_resources SET review_due_at=review_due_at+interval '1 year',revision=revision+1 WHERE id=${c.resourceId}`)).rejects.toThrow();
});
it("serializes duplicate and conflicting concurrent acknowledgements", async () => {
  const c=await fence(), value=envelope({ kind:"acknowledgement",item:"present",contentDigest:intent().payloadDigest });
  const results=await Promise.all([repository.acknowledge(c,value),repository.acknowledge(c,value)]);
  expect(results[0]).toEqual(results[1]); expect(await evidence(c.id)).toHaveLength(1);
  await Promise.all([repository.acknowledge(c,envelope({ kind:"conflict",code:"conflict",item:"absent" })),
    repository.acknowledge(c,envelope({ kind:"acknowledgement",item:"present",contentDigest:inventoryDigest("different") }))]);
  expect(await evidence(c.id)).toHaveLength(3); expect((await attempt(c.id)).state).toBe("conflict"); expect((await resource(c.resourceId)).hold).toBe("seller");
});
it("prevents stale tokens/revisions from addressing a replacement ID", async () => {
  const old=await claim(); now=new Date(now.getTime()+INVENTORY_LEASE_MS+1);
  const input=await request({ operation:"initial-stage" }), replacement=await repository.claim(input);
  await expect(repository.recordIntent({ ...replacement,token:old.token },intent(),input)).rejects.toMatchObject({ code:"stale" });
  await expect(repository.acknowledge({ ...replacement,actionHash:old.actionHash },envelope())).rejects.toMatchObject({ code:"stale" });
  await expect(repository.acknowledge({ ...replacement,revision:replacement.revision+1 },envelope())).rejects.toMatchObject({ code:"blocked" });
  expect(await repository.recordIntent(replacement,intent(),input)).toHaveProperty("revision",1);
});
it("rejects raw SQL action reassignment even before any intent", async () => {
  const c=await claim();
  await expect(db.execute(sql`UPDATE public.ebay_inventory_attempts SET action_hash=${inventoryDigest("new")},revision=revision+1 WHERE id=${c.id}`)).rejects.toThrow();
  await expect(db.execute(sql`UPDATE public.ebay_inventory_attempts SET state='retired',revision=revision+1 WHERE id=${c.id}`)).rejects.toThrow();
  expect((await attempt(c.id)).actionHash).toBe(c.actionHash);
});
it("SQL blocks scope/context substitution and future revisions in evidence", async () => {
  const c=await claim();
  await expect(db.insert(e).values({ id:randomUUID(),resourceId:c.resourceId,ownerId:foreign,attemptId:c.id,expectedRevision:0,
    late:false,createdAt:now.toISOString(),fingerprint:inventoryDigest("wrong"),envelope:envelope() })).rejects.toThrow();
  await expect(db.insert(e).values({ id:randomUUID(),resourceId:c.resourceId,ownerId:owner,attemptId:c.id,expectedRevision:100,
    late:false,createdAt:now.toISOString(),fingerprint:inventoryDigest("wrong"),envelope:envelope() })).rejects.toThrow();
  expect(await evidence(c.id)).toEqual([]);
});
it("preserves the 200-character reference boundary without leaking provider payloads", async () => {
  const c=await claim(); await repository.acknowledge(c,envelope({ related:Array.from({ length:250 },(_,n)=>({ kind:"offer",id:String(n).padStart(200,"a") })) }));
  const [saved]=await evidence(c.id); expect(saved.envelope.related).toHaveLength(250);
  expect(Buffer.byteLength(JSON.stringify(saved.envelope))).toBeLessThanOrEqual(65536);
  expect(saved.envelope).not.toHaveProperty("rawBody");
});
it("rollback of an intent leaves no partial fence or seller hold", async () => {
  const input=await request({ operation:"initial-stage" }),c=await repository.claim(input), transaction=db.transaction.bind(db);
  const fault=vi.spyOn(db,"transaction").mockImplementationOnce(callback=>transaction(async tx=>{ await callback(tx);throw new Error("Injected rollback"); }));
  await expect(repository.recordIntent(c,intent(),input)).rejects.toMatchObject({ code:"unavailable" });fault.mockRestore();
  expect(await attempt(c.id)).toMatchObject({ state:"preparing",intentAt:null,revision:0 });expect((await resource(c.resourceId)).hold).toBe("none");
  expect(await repository.recordIntent(c,intent(),input)).toHaveProperty("revision",1);
});
it("has no provider/storage/native work in its transaction-only implementation", async () => {
  const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Network forbidden"));
  const c=await fence();await repository.acknowledge(c,envelope({ kind:"acknowledgement",item:"present" }));
  await repository.projection(owner,listingId);expect(fetch).not.toHaveBeenCalled();
});
it.each(["recreation","integrity"] as const)("overflow cannot weaken seller-level %s evidence", async code => {
  const c=await claim();await repository.acknowledge(c,envelope({ code,overflow:true }));
  expect((await resource(c.resourceId)).hold).toBe("seller");expect((await evidence(c.id))[0].envelope).toMatchObject({ code,overflow:true,item:"unknown" });
});
it("serializes listing deletion against intent without losing the fence or reviving the projection", async () => {
  const input=await request({ operation:"initial-stage" }),c=await repository.claim(input);
  const result=await Promise.allSettled([repository.recordIntent(c,intent(),input),listings.delete(owner,listingId)]);
  expect(result[1].status).toBe("fulfilled");expect(await repository.projection(owner,listingId)).toBeNull();
  const row=await attempt(c.id),anchor=await resource(c.resourceId);
  expect(anchor.currentListingId).toBeNull();expect(anchor.hold).toBe(row.intentAt?"seller":"resource");
  await expect(repository.recordIntent(c,intent(),input)).rejects.toMatchObject({ code:"stale" });
});
it("serializes disconnect against claim with retained history or a clean rejection", async () => {
  const input=await request();
  const result=await Promise.allSettled([repository.claim(input),new DrizzleEbayConnectionRepository(db).disconnect(owner)]);
  expect(result[1].status).toBe("fulfilled");expect(await repository.projection(owner,listingId)).toBeNull();
  if(result[0].status==="fulfilled") expect(await resource(result[0].value.resourceId)).toMatchObject({ hold:"seller",currentConnectionId:null });
  else expect(result[0].reason).toMatchObject({ code:"stale" });
});
it("retains pre-claim observations as late/stale evidence without activating a current acknowledgement", async () => {
  const c=await claim(), before=new Date(now.getTime()-1000).toISOString();
  const result=await repository.acknowledge(c,envelope({ startedAt:before,finishedAt:before }));
  expect(result.late).toBe(true);expect((await attempt(c.id)).state).toBe("preparing");expect((await resource(c.resourceId)).hold).toBe("resource");
});
