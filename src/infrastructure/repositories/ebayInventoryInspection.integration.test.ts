import { randomBytes,randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { eq,sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { authOptions } from "../../auth/options";
import { disposableInventoryDatabase } from "../../test/disposableInventoryDatabase";
import { composeFakeInventoryInspection,inspectionFixture } from "../../test/ebay/fakeInventoryInspection";
import { listingFixture } from "../../test/fixtures";
import { inventoryDigest,type InventoryClaim } from "../../application/ebayInventoryPersistence";
import type { InspectionFixture } from "../../application/ebayInventoryInspection";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import * as schema from "../db/schema";
vi.mock("server-only",()=>({}));
let isolated:Awaited<ReturnType<typeof disposableInventoryDatabase>>,db:typeof isolated.db;
const makeAuth=(db:typeof isolated.db)=>betterAuth({...authOptions(db,{BETTER_AUTH_URL:"http://127.0.0.1:3100",BETTER_AUTH_SECRET:randomBytes(32).toString("hex"),GITHUB_CLIENT_ID:"synthetic",GITHUB_CLIENT_SECRET:"synthetic"}),plugins:[testUtils()]});
let auth:ReturnType<typeof makeAuth>,h:Awaited<ReturnType<typeof composeFakeInventoryInspection>>,headers:Headers;
let owner:string,foreign:string,listingId:string,sessionId:string,captured:InventoryClaim|undefined;
const transactions=new AsyncLocalStorage<boolean>(),observe=vi.fn();
const attempts=()=>db.select().from(schema.ebayInventoryAttempts).where(eq(schema.ebayInventoryAttempts.ownerId,owner));
const records=()=>db.select().from(schema.ebayInventoryEvidence).where(eq(schema.ebayInventoryEvidence.ownerId,owner));
const resources=()=>db.select().from(schema.ebayInventoryResources).where(eq(schema.ebayInventoryResources.ownerId,owner));
const prepare=()=>h.workflow.prepare(listingId);
const confirm=async()=>h.workflow.confirm(await prepare());
function complete():InspectionFixture {const f=inspectionFixture();Object.assign(f.samples[0],{item:"absent",offersComplete:true,listings:"none",groups:"none"});return f;}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
async function login(user=owner){const s=await(await auth.$context).test.login({userId:user});headers=s.headers;sessionId=s.session.id;}
async function compose(workMs?:number){return composeFakeInventoryInspection(db,{workMs,observer:{inspect:observe},async session(){const s=await auth.api.getSession({headers,query:{disableRefresh:true}});return s?{ownerId:s.user.id,id:s.session.id,expiresAt:s.session.expiresAt.toISOString()}:null;}});}
beforeAll(async()=>{isolated=await disposableInventoryDatabase();db=isolated.db;auth=makeAuth(db);},30000);
beforeEach(async()=>{
  vi.restoreAllMocks();vi.unstubAllEnvs();captured=undefined;observe.mockReset();
  const helpers=(await auth.$context).test;owner=(await helpers.saveUser(helpers.createUser())).id;foreign=(await helpers.saveUser(helpers.createUser())).id;await login();h=await compose();
  listingId=(await h.listings.create(owner,listingFixture())).id;
  const image=randomUUID();await db.insert(schema.listingImages).values({id:image,listingId,storageProvider:"vercel-blob",pathname:`images/${image}/synthetic.png`,originalFilename:"synthetic.png",contentType:"image/png",byteSize:128,uploadedAt:new Date().toISOString(),order:0});
  await db.insert(schema.ebayConnections).values({ownerId:owner,id:randomUUID(),version:randomUUID(),configHash:inventoryDigest("config"),status:"connected",sellerId:inventoryDigest(owner),sellerLabel:"Synthetic seller",
    access:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},refresh:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},
    scopes:[...EBAY_SCOPES],accessExpiresAt:sql`clock_timestamp()+interval '1 hour'`,refreshExpiresAt:sql`clock_timestamp()+interval '1 day'`,connectedAt:sql`clock_timestamp()`});
  await db.execute(sql`DROP TRIGGER IF EXISTS aaa_inspection_short_lease ON public.ebay_inventory_attempts`);
  const transaction=db.transaction.bind(db);vi.spyOn(db,"transaction").mockImplementation((...args)=>transactions.run(true,()=>transaction(...args)));
  const claim=h.repository.claim.bind(h.repository);vi.spyOn(h.repository,"claim").mockImplementation(async input=>{captured=await claim(input);return captured;});
  observe.mockImplementation(async()=>{expect(transactions.getStore()).not.toBe(true);return complete();});
  vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Real network forbidden"));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
afterAll(async()=>{if(isolated)await isolated.close();});
it("authenticates with signed sessions, prepares locally, records inspect evidence and refuses every write",async()=>{
  const review=await prepare();expect(observe).not.toHaveBeenCalled();expect(await attempts()).toEqual([]);
  const value=await h.workflow.confirm(review);expect(value).toMatchObject({simulation:true,state:"refused",ownership:"unproven",canStage:false,canDelete:false});
  expect(value.reasons).toContain("external-create-race");expect(value.reasons).toContain("media-unverified");
  expect((await attempts())[0]).toMatchObject({operation:"inspect",intentAt:null,state:"acknowledged"});expect(await records()).toHaveLength(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();expect(JSON.stringify(value)).not.toMatch(/token|seller|path|http|digest|ciphertext/);
});
it.each(["owner","session"])("cannot confirm under another authenticated %s",async kind=>{
  const review=await prepare();await login(kind==="owner"?foreign:owner);
  expect(await h.workflow.confirm(review)).toMatchObject({state:"unknown"});expect(observe).not.toHaveBeenCalled();expect(await attempts()).toEqual([]);
  await expect(h.workflow.confirm(review)).rejects.toMatchObject({code:"stale"});
});
it("cannot prepare a foreign listing or use a serialized review in another service",async()=>{
  await login(foreign);await expect(prepare()).rejects.toMatchObject({code:"stale"});await login(owner);
  const review=await prepare(),other=await compose();await expect(other.workflow.confirm(review)).rejects.toMatchObject({code:"stale"});
  await expect(h.workflow.confirm(JSON.parse(JSON.stringify(review)))).rejects.toMatchObject({code:"stale"});
});
it("serializes concurrent confirmation and preserves consumed action history",async()=>{
  const review=await prepare(),result=await Promise.allSettled([h.workflow.confirm(review),h.workflow.confirm(review)]);
  expect(result.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(observe).toHaveBeenCalledTimes(1);expect(await attempts()).toHaveLength(1);
  expect((await attempts())[0].actionHash).toBe(captured!.actionHash);
});
it.each(["edit","delete","disconnect","reconnect"])("rejects %s between review and confirmation",async kind=>{
  const review=await prepare();
  if(kind==="edit")await db.update(schema.listings).set({updatedAt:sql`clock_timestamp()+interval '1 second'`}).where(eq(schema.listings.id,listingId));
  if(kind==="delete")await h.listings.delete(owner,listingId);
  if(kind==="disconnect")await new DrizzleEbayConnectionRepository(db).disconnect(owner);
  if(kind==="reconnect")await db.update(schema.ebayConnections).set({version:randomUUID()}).where(eq(schema.ebayConnections.ownerId,owner));
  expect(await h.workflow.confirm(review)).toMatchObject({state:"unknown"});expect(observe).not.toHaveBeenCalled();
});
it.each(["edit","delete","disconnect","reconnect","session"])("keeps %s during observation historical and cannot activate a stale inspection",async kind=>{
  observe.mockImplementation(async()=>{
    expect(transactions.getStore()).not.toBe(true);
    if(kind==="edit")await db.update(schema.listings).set({updatedAt:sql`clock_timestamp()+interval '1 second'`}).where(eq(schema.listings.id,listingId));
    if(kind==="delete")await h.listings.delete(owner,listingId);
    if(kind==="disconnect")await new DrizzleEbayConnectionRepository(db).disconnect(owner);
    if(kind==="reconnect")await db.update(schema.ebayConnections).set({version:randomUUID()}).where(eq(schema.ebayConnections.ownerId,owner));
    if(kind==="session")await db.update(schema.sessions).set({expiresAt:sql`clock_timestamp()-interval '1 second'`}).where(eq(schema.sessions.id,sessionId));
    return complete();
  });
  const value=await confirm();expect(value).toMatchObject({state:"stale",canStage:false,canDelete:false});expect((await attempts())[0]).toMatchObject({intentAt:null,state:"preparing"});
  expect((await records()).every(x=>x.envelope.kind==="recovery")).toBe(true);
  if(kind!=="session")expect(await h.repository.projection(owner,listingId)).toBeNull();else expect((await resources())[0].hold).toBe("resource");
});
it("retries only the same local acknowledgement after commit acknowledgement loss",async()=>{
  const ack=h.repository.acknowledge.bind(h.repository);let lost=true;vi.spyOn(h.repository,"acknowledge").mockImplementation(async(...args)=>{const value=await ack(...args);if(lost){lost=false;throw new Error("Synthetic lost acknowledgement");}return value;});
  expect(await confirm()).toHaveProperty("state","refused");expect(observe).toHaveBeenCalledTimes(1);expect(await records()).toHaveLength(1);expect(await attempts()).toHaveLength(1);
});
it("does not re-observe when both database acknowledgement outcomes are uncertain",async()=>{
  vi.spyOn(h.repository,"acknowledge").mockRejectedValue(new Error("Synthetic database unavailable"));
  expect(await confirm()).toMatchObject({state:"unknown"});expect(observe).toHaveBeenCalledTimes(1);expect((await attempts())[0]).toMatchObject({state:"preparing",intentAt:null});
});
it("rolls back a rejected claim without observation, and burns its review",async()=>{
  const review=await prepare(),transaction=db.transaction.bind(db),claim=h.repository.claim.bind(h.repository);
  vi.spyOn(h.repository,"claim").mockImplementationOnce(async input=>{
    vi.spyOn(db,"transaction").mockImplementationOnce(callback=>transaction(async tx=>{await callback(tx);throw new Error("Injected rollback");}));return claim(input);
  });
  expect(await h.workflow.confirm(review)).toHaveProperty("state","unknown");expect(observe).not.toHaveBeenCalled();expect(await attempts()).toEqual([]);
  await expect(h.workflow.confirm(review)).rejects.toMatchObject({code:"stale"});
});
it.each(["create","offers","groups","content","recreation"])("retains synthetic %s interleavings without ownership or mutation authority",async kind=>{
  const f=complete(),next={...f.samples[0]};
  if(kind==="create")next.item="present";
  if(kind==="offers")next.related=[{kind:"offer",id:"synthetic_offer"}];
  if(kind==="groups"){next.groups="present";next.related=[{kind:"group",id:"synthetic_group"}];}
  if(kind==="content"){f.samples[0].item="present";f.samples[0].content="matches";f.samples[0].contentDigest=inventoryDigest("before");next.item="present";next.content="different";next.contentDigest=inventoryDigest("after");}
  if(kind==="recreation")next.code="recreation";
  f.samples.push(next);observe.mockResolvedValue(f);
  expect(await confirm()).toMatchObject({ownership:"unproven",canStage:false,canDelete:false});expect(await records()).toHaveLength(2);
  expect((await resources())[0].hold).toBe(kind==="recreation"?"seller":"resource");expect((await attempts())[0].intentAt).toBeNull();
});
it("records oversized data as incomplete integrity ambiguity without dropping warnings into absence",async()=>{
  const f=complete();f.samples[0].code="recreation";f.samples[0].related=Array.from({length:251},(_,i)=>({kind:"offer",id:"synthetic_"+i}));observe.mockResolvedValue(f);
  expect(await confirm()).toMatchObject({canStage:false,ownership:"unproven"});expect((await resources())[0].hold).toBe("seller");
  expect((await records())[0].envelope).toMatchObject({item:"unknown",coverage:"incomplete",code:"recreation",overflow:true,related:[]});
});
it("retains capacity through cancellation and a late observer that ignores abort",async()=>{
  const started=deferred<void>(),settle=deferred<InspectionFixture>(),c=new AbortController();observe.mockImplementation(async()=>{started.resolve();return settle.promise;});
  const work=h.workflow.confirm(await prepare(),c.signal);await started.promise;c.abort();settle.resolve(complete());
  expect(await work).toMatchObject({state:"cancelled"});expect((await attempts())[0].state).toBe("preparing");expect((await resources())[0].hold).toBe("resource");
});
it("applies a shorter operation deadline without abandoning owned work",async()=>{
  h=await compose(500);observe.mockImplementation(async(_sku,signal:AbortSignal)=>{await new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));return complete();});
  expect(await confirm()).toMatchObject({state:"stale"});expect((await attempts())[0].intentAt).toBeNull();
});
it("rejects non-test construction and wrong actual database identities",async()=>{
  vi.stubEnv("NODE_ENV","production");await expect(compose()).rejects.toMatchObject({code:"isolation"});vi.stubEnv("NODE_ENV","test");
  vi.stubEnv("VERCEL","1");await expect(compose()).rejects.toMatchObject({code:"isolation"});vi.stubEnv("VERCEL","");
  const execute=vi.spyOn(db,"execute").mockResolvedValueOnce({rows:[{name:"marketplace_development"}]} as never);await expect(compose()).rejects.toMatchObject({code:"isolation"});execute.mockRestore();
});
async function shortLeases() {
  // Fixture-only shortening of NEW rows; production time/immutability guards
  // remain unchanged. The whole uniquely disposable database is dropped.
  await db.execute(sql`CREATE OR REPLACE FUNCTION public.test_inspection_short_lease() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.lease_until:=least(NEW.lease_until,clock_timestamp()+interval '1 second');RETURN NEW;END $$`);
  await db.execute(sql`CREATE TRIGGER aaa_inspection_short_lease BEFORE INSERT ON public.ebay_inventory_attempts FOR EACH ROW EXECUTE FUNCTION public.test_inspection_short_lease()`);
}
it("bounds fake work by its actual claim lease and preserves late results",async()=>{
  await shortLeases();observe.mockImplementation(async(_sku,signal:AbortSignal)=>{await new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));return complete();});
  expect(await confirm()).toHaveProperty("state","stale");expect(observe).toHaveBeenCalledTimes(1);
  expect((await attempts())[0]).toMatchObject({state:"preparing",intentAt:null});expect((await records()).every(row=>row.late)).toBe(true);
});
it("reclaims an expired inspect action with a fresh review without freeing its consumed action",async()=>{
  await shortLeases();const c=new AbortController();observe.mockImplementationOnce(async()=>{c.abort();return complete();});
  await h.workflow.confirm(await prepare(),c.signal);const old=captured!,row=(await attempts())[0];
  await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '20 milliseconds')",[row.leaseUntil]);
  expect(await confirm()).toHaveProperty("state","refused");expect(captured!.id).not.toBe(old.id);
  const rows=await attempts();expect(rows).toHaveLength(2);expect(rows.find(x=>x.id===old.id)).toMatchObject({state:"retired",actionHash:old.actionHash});
  await expect(h.repository.retireUnfenced(old)).rejects.toMatchObject({code:"stale"});
  expect((await h.repository.projection(owner,listingId))).toMatchObject({ownership:"unproven",canStage:false,canDelete:false,hold:"resource"});
});
it.each(["listing","session"])("preserves PostgreSQL post-lock session expiry when the claim waits on %s",async lock=>{
  const expiry=await db.execute(sql`UPDATE public.sessions SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=${sessionId} RETURNING expires_at AS at`);
  const deadline=new Date(expiry.rows[0].at as string).toISOString(),review=await prepare(),blocker=await isolated.pool.connect();await blocker.query("BEGIN");
  let work:Promise<unknown>|undefined;
  try {
    await blocker.query(lock==="listing"?"SELECT id FROM listings WHERE id=$1 FOR UPDATE":"SELECT id FROM sessions WHERE id=$1 FOR UPDATE",[lock==="listing"?listingId:sessionId]);
    work=h.workflow.confirm(review);
    const until=Date.now()+1000;let blocked=false;
    while(Date.now()<until){const q=await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");if(q.rows[0].n){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
    expect(blocked).toBe(true);await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '20 milliseconds')",[deadline]);await blocker.query("COMMIT");
    expect(await work).toMatchObject({state:"unknown"});expect(observe).not.toHaveBeenCalled();expect(await attempts()).toEqual([]);expect(await resources()).toEqual([]);
  } finally {await blocker.query("ROLLBACK");blocker.release();if(work)await work;}
});
it("retains a post-ack edit without activating a stale product projection",async()=>{
  const ack=h.repository.acknowledge.bind(h.repository);let changed=false;
  vi.spyOn(h.repository,"acknowledge").mockImplementation(async(...args)=>{const result=await ack(...args);if(!changed){changed=true;await db.update(schema.listings).set({updatedAt:sql`clock_timestamp()+interval '1 second'`}).where(eq(schema.listings.id,listingId));}return result;});
  expect(await confirm()).toHaveProperty("state","stale");expect(await h.repository.projection(owner,listingId)).toBeNull();expect(await records()).toHaveLength(2);expect((await resources())[0].hold).toBe("resource");
});
it("treats repeated matching synthetic content as local evidence, never ownership",async()=>{
  const f=complete();Object.assign(f.samples[0],{item:"present",content:"matches",contentDigest:inventoryDigest("matching-content")});f.samples.push({...f.samples[0]});observe.mockResolvedValue(f);
  expect(await confirm()).toMatchObject({simulation:true,ownership:"unproven",canStage:false,canDelete:false});expect(observe).toHaveBeenCalledTimes(1);expect(await records()).toHaveLength(1);
  expect((await attempts())[0]).toMatchObject({intentAt:null,state:"acknowledged"});expect((await resources())[0].hold).toBe("resource");
});
