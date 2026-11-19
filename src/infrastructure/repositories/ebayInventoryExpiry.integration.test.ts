import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { disposableInventoryDatabase } from "../../test/disposableInventoryDatabase";
import { listingFixture } from "../../test/fixtures";
import { inventoryDigest, type InventoryClaim, type InventoryClaimInput } from "../../application/ebayInventoryPersistence";
import { ebaySku } from "../../application/ebayPreparationMapping";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleEbayInventoryRepository } from "./drizzleEbayInventoryRepository";
import * as schema from "../db/schema";

let isolated: Awaited<ReturnType<typeof disposableInventoryDatabase>>;
let db: typeof isolated.db, repository: DrizzleEbayInventoryRepository;
let input: InventoryClaimInput, seller: string;
const a=schema.ebayInventoryAttempts, r=schema.ebayInventoryResources;
const intent={ payloadDigest:inventoryDigest("synthetic-item"),mediaManifestDigest:inventoryDigest("synthetic-media") };
beforeAll(async()=>{ isolated=await disposableInventoryDatabase();db=isolated.db;repository=new DrizzleEbayInventoryRepository(db); },30000);
beforeEach(async()=>{
  const owner=randomUUID(),session=randomUUID(),config=inventoryDigest("expiry-config");seller=inventoryDigest(owner);
  await db.insert(schema.users).values({ id:owner,name:"Synthetic expiry owner",email:owner+"@example.invalid" });
  const listing=await new DrizzleListingRepository(db).create(owner,listingFixture());
  await db.insert(schema.sessions).values({ id:session,token:randomUUID(),userId:owner,expiresAt:sql`clock_timestamp()+interval '1 hour'` });
  const [connection]=await db.insert(schema.ebayConnections).values({ ownerId:owner,id:randomUUID(),version:randomUUID(),configHash:config,status:"connected",sellerId:seller,
    sellerLabel:"Synthetic seller",access:{ ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1 },refresh:{ ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1 },
    accessExpiresAt:sql`clock_timestamp()+interval '1 hour'`,refreshExpiresAt:sql`clock_timestamp()+interval '1 day'`,connectedAt:sql`clock_timestamp()`,scopes:[...EBAY_SCOPES] }).returning();
  const grant=await db.execute(sql`SELECT public.real_media_grant_version(${sql.param(connection.scopes)}::text[]) AS hash`);
  input={ ownerId:owner,listingId:listing.id,listingVersion:listing.updatedAt,sessionId:session,connectionId:connection.id,connectionVersion:connection.version,
    configHash:config,grantHash:String(grant.rows[0].hash),actionHash:inventoryDigest(randomUUID()),operation:"initial-stage" };
});
afterAll(async()=>{ if(isolated) await isolated.close(); });

// Fixtures may shorten a valid lease, never extend/fake authorization time or
// disable production guards. Every expiry below follows PostgreSQL wall time.
async function fixtureClaim(milliseconds=1500): Promise<InventoryClaim> {
  const [resource]=await db.insert(r).values({ id:randomUUID(),ownerId:input.ownerId,sellerKey:seller,sku:ebaySku(input.listingId),historicalListingId:input.listingId,
    currentListingId:input.listingId,currentConnectionId:input.connectionId,createdAt:sql`clock_timestamp()`,reviewDueAt:sql`clock_timestamp()` }).returning();
  const token=randomUUID(),hash=await db.execute(sql`SELECT public.inventory_session_hash(${input.ownerId},${input.sessionId}) AS hash`);
  const {sessionId,...binding}=input;void sessionId;
  const [row]=await db.insert(a).values({ ...binding,id:randomUUID(),resourceId:resource.id,claimHash:inventoryDigest(token),sessionHash:String(hash.rows[0].hash),
    createdAt:sql`clock_timestamp()`,updatedAt:sql`clock_timestamp()`,leaseUntil:sql`clock_timestamp()+${milliseconds}*interval '1 millisecond'` }).returning();
  return { id:row.id,resourceId:row.resourceId,ownerId:row.ownerId,token,revision:row.revision,sessionHash:row.sessionHash,actionHash:row.actionHash };
}
async function assertUnfenced(c:InventoryClaim) {
  const [row]=await db.select().from(a).where(eq(a.id,c.id)),[resource]=await db.select().from(r).where(eq(r.id,c.resourceId));
  expect(row).toMatchObject({ state:"preparing",revision:0,intentAt:null,payloadDigest:null,mediaManifestDigest:null });
  expect(resource.hold).toBe("none");
}
async function waitForBlock() {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    const result=await isolated.pool.query("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
    if(result.rows.length)return String(result.rows[0].query);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error("Expected a real PostgreSQL lock wait");
}
async function past(deadline:string) { await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '20 milliseconds')",[deadline]); }

it("rejects lease expiry while recordIntent waits on the listing lock and rolls back the fence",async()=>{
  const c=await fixtureClaim(),[row]=await db.select().from(a).where(eq(a.id,c.id));
  const blocker=await isolated.pool.connect();await blocker.query("BEGIN");
  try {
    await blocker.query("SELECT id FROM listings WHERE id=$1 FOR UPDATE",[input.listingId]);
    const work=repository.recordIntent(c,intent,input).then(value=>({ value,error:null }),error=>({ value:null,error }));
    await waitForBlock();await past(row.leaseUntil);await blocker.query("COMMIT");
    expect(["stale","blocked"]).toContain((await work).error?.code);await assertUnfenced(c);
  } finally { await blocker.query("ROLLBACK");blocker.release(); }
});
type Lock="listing"|"seller"|"session";
async function blockedUntil<T>(lock:Lock,deadline:string,start:()=>Promise<T>) {
  const blocker=await isolated.pool.connect();await blocker.query("BEGIN");
  let work:Promise<{value:T|null;error:unknown}>|undefined;
  try {
    if(lock==="listing") await blocker.query("SELECT id FROM listings WHERE id=$1 FOR UPDATE",[input.listingId]);
    if(lock==="seller") await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory:sandbox:'||$1,0))",[seller]);
    if(lock==="session") await blocker.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE",[input.sessionId]);
    work=start().then(value=>({ value,error:null }),error=>({ value:null,error }));
    const query=await waitForBlock();
    expect(query).toContain(lock==="seller"?"pg_advisory_xact_lock":lock==="session"?"sessions":"listings");
    const time=await isolated.pool.query("SELECT clock_timestamp()<$1::timestamptz AS valid",[deadline]);expect(time.rows[0].valid).toBe(true);
    await past(deadline);await blocker.query("COMMIT");return await work;
  } finally { await blocker.query("ROLLBACK");blocker.release();if(work)await work; }
}
async function expiry(kind:"session"|"credential",milliseconds=1500) {
  const result=kind==="session"?
    await db.execute(sql`UPDATE public.sessions SET expires_at=clock_timestamp()+${milliseconds}*interval '1 millisecond' WHERE id=${input.sessionId} RETURNING expires_at AS at`):
    await db.execute(sql`UPDATE public.ebay_connections SET refresh_expires_at=clock_timestamp()+${milliseconds}*interval '1 millisecond' WHERE owner_id=${input.ownerId} RETURNING refresh_expires_at AS at`);
  return new Date(result.rows[0].at as string).toISOString();
}
it.each(["seller","session"] as const)("rejects lease expiry at a later %s lock after initial context reads",async lock=>{
  const c=await fixtureClaim(),[row]=await db.select().from(a).where(eq(a.id,c.id));
  const result=await blockedUntil(lock,row.leaseUntil,()=>repository.recordIntent(c,intent,input));
  expect(["stale","blocked"]).toContain((result.error as {code:string})?.code);await assertUnfenced(c);
});
it.each(["listing","seller","session"] as const)("rejects session expiry across the %s lock",async lock=>{
  const c=await fixtureClaim(10_000),deadline=await expiry("session");
  const result=await blockedUntil(lock,deadline,()=>repository.recordIntent(c,intent,input));
  expect(["stale","blocked"]).toContain((result.error as {code:string})?.code);await assertUnfenced(c);
});
it.each(["listing","seller","session"] as const)("rejects refresh-credential expiry across the %s lock",async lock=>{
  const c=await fixtureClaim(10_000),deadline=await expiry("credential");
  const result=await blockedUntil(lock,deadline,()=>repository.recordIntent(c,intent,input));
  expect(["stale","blocked"]).toContain((result.error as {code:string})?.code);await assertUnfenced(c);
});
it.each(["session","credential"] as const)("rejects a new claim if %s expires during its later lock wait",async kind=>{
  const deadline=await expiry(kind),result=await blockedUntil(kind==="session"?"session":"seller",deadline,()=>repository.claim(input));
  expect(["stale","blocked"]).toContain((result.error as {code:string})?.code);
  expect(await db.select().from(a).where(eq(a.ownerId,input.ownerId))).toEqual([]);
  expect(await db.select().from(r).where(eq(r.ownerId,input.ownerId))).toEqual([]);
});
it.each(["lease","session","credential"] as const)("SQL refuses a backdated intent after %s expires, even within an older transaction",async kind=>{
  const c=await fixtureClaim(kind==="lease"?300:10_000),[row]=await db.select().from(a).where(eq(a.id,c.id));
  const deadline=kind==="lease"?row.leaseUntil:await expiry(kind,300),client=await isolated.pool.connect();
  try {
    await client.query("BEGIN");await past(deadline);
    await expect(client.query("UPDATE public.ebay_inventory_attempts SET state='fenced',intent_at=transaction_timestamp(),updated_at=transaction_timestamp(),payload_digest=$2,media_manifest_digest=$3,revision=revision+1 WHERE id=$1",[c.id,intent.payloadDigest,intent.mediaManifestDigest])).rejects.toThrow();
    await client.query("ROLLBACK");await assertUnfenced(c);
  } finally { await client.query("ROLLBACK");client.release(); }
});
it("SQL refuses future timestamps that would retire a still-live claim",async()=>{
  const c=await fixtureClaim(10_000);
  await expect(db.execute(sql`UPDATE public.ebay_inventory_attempts SET state='retired',updated_at=clock_timestamp()+interval '1 day',revision=revision+1 WHERE id=${c.id}`)).rejects.toThrow();
  await assertUnfenced(c);
});
it("records expiry-delayed evidence as late without activating an acknowledgement",async()=>{
  const c=await fixtureClaim(),[row]=await db.select().from(a).where(eq(a.id,c.id)),time=await db.execute(sql`SELECT clock_timestamp() AS at`);
  const at=new Date(time.rows[0].at as string).toISOString(),value={ version:"inventory-local-v1",kind:"inspection",startedAt:at,finishedAt:at,item:"absent",coverage:"complete",outcome:"observed",code:"none",contentDigest:null,related:[],httpStatus:200,overflow:false };
  const result=await blockedUntil("seller",row.leaseUntil,()=>repository.acknowledge(c,value));
  expect(result.error).toBeNull();expect(result.value).toMatchObject({ late:true,canStage:false,canDelete:false });
  expect((await db.select().from(a).where(eq(a.id,c.id)))[0]).toMatchObject({ state:"preparing",intentAt:null,payloadDigest:null });
  expect((await db.select().from(r).where(eq(r.id,c.resourceId)))[0].hold).toBe("resource");
});
it("allows a valid transition after a real lock wait and stamps trusted wall time",async()=>{
  const c=await fixtureClaim(10_000),client=await isolated.pool.connect();await client.query("BEGIN");
  try {
    await client.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE",[input.sessionId]);
    const work=repository.recordIntent(c,intent,input);await waitForBlock();
    const release=await isolated.pool.query("SELECT clock_timestamp() AS at");await client.query("COMMIT");
    expect((await work).revision).toBe(1);
    const [row]=await db.select().from(a).where(eq(a.id,c.id));expect(Date.parse(row.intentAt!)).toBeGreaterThanOrEqual(new Date(release.rows[0].at).getTime());
    expect((await repository.projection(input.ownerId,input.listingId))).toMatchObject({ ownership:"unproven",canStage:false,canDelete:false,hold:"seller" });
  } finally { await client.query("ROLLBACK");client.release(); }
});
