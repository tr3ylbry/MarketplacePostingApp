import { randomBytes,randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { eq,sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import sharp from "sharp";
import { authOptions } from "../../auth/options";
import { disposableRealMediaDatabase } from "../../test/disposableRealMediaDatabase";
import { listingFixture } from "../../test/fixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { createImageService } from "../../application/imageService";
import { createPhotoDerivativeService } from "../../application/photoDerivativeService";
import { createCaptureWorkflow,type CaptureDependencies } from "../../application/ebayCaptureWorkflow";
import { realMediaDigest,mediaSessionHash,type RealMediaClaim,type RealMediaReviewGuard } from "../../application/ebayRealMedia";
import { EBAY_DISCOVERY_SCOPES,EBAY_READINESS_SCOPES,EbayError } from "../../application/ebayConnection";
import { createEbayConnectionService } from "../../application/ebayConnectionService";
import { EbayTokenCipher } from "../ebay/tokenCipher";
import { emptyCapture } from "../../application/ebayCaptureReport";
import { photoTransformer,PHOTO_RECIPE } from "../storage/photoDerivative/transformPhoto";
import { generateCaptureFixture } from "../storage/captureFixture";
import { DrizzleEbayRealMediaRepository } from "./drizzleEbayRealMediaRepository";
import { DrizzleMediaCaptureRepository } from "./drizzleMediaCaptureRepository";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleImageRepository } from "./drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import { mediaRuntime } from "../ebay/mediaRuntime";
import { admitRealMediaEvidence } from "../ebay/realMediaEvidence";
import * as schema from "../db/schema";
vi.mock("server-only",()=>({}));
let isolated:Awaited<ReturnType<typeof disposableRealMediaDatabase>>,db:typeof isolated.db;
const authFactory=(db:typeof isolated.db)=>betterAuth({...authOptions(db,{BETTER_AUTH_URL:"http://127.0.0.1:3100",BETTER_AUTH_SECRET:randomBytes(32).toString("hex"),GITHUB_CLIENT_ID:"synthetic",GITHUB_CLIENT_SECRET:"synthetic"}),plugins:[testUtils()]});
let auth:ReturnType<typeof authFactory>,headers:Headers,owner:string,foreign:string,sessionId:string,listingId:string,imageId:string,seller:string;
let repository:DrizzleEbayRealMediaRepository,evidence:DrizzleMediaCaptureRepository,listings:DrizzleListingRepository,images:DrizzleImageRepository,connections:DrizzleEbayConnectionRepository;
let storage:MemoryImageStorage,source:Awaited<ReturnType<typeof generateCaptureFixture>>,deps:CaptureDependencies,workflow:ReturnType<typeof createCaptureWorkflow>,captured:RealMediaClaim|undefined,guard:RealMediaReviewGuard|undefined;
const config=realMediaDigest("synthetic-capture-config"),transactions=new AsyncLocalStorage<boolean>(),send=vi.fn();
const rows=()=>db.select().from(schema.ebayRealMediaAttempts).where(eq(schema.ebayRealMediaAttempts.ownerId,owner));
const captures=async()=> (await db.select({capture:schema.ebayMediaCaptures}).from(schema.ebayMediaCaptures).innerJoin(schema.ebayRealMediaAttempts,eq(schema.ebayRealMediaAttempts.id,schema.ebayMediaCaptures.attemptId)).where(eq(schema.ebayRealMediaAttempts.ownerId,owner))).map(r=>r.capture);
const prepare=()=>workflow.prepare(listingId,imageId,seller,source.sourceDigest);
const confirm=async(signal?:AbortSignal)=>workflow.confirm(await prepare(),signal);
async function login(user=owner){const s=await(await auth.$context).test.login({userId:user});headers=s.headers;sessionId=s.session.id;}
async function addPhoto(){const service=createImageService(images,storage),p=await service.prepare(owner,listingId,{filename:"generated.png",contentType:"image/png",size:source.bytes.length});storage.objects.set(storage.uploads.get(p.imageId)!.pathname,{bytes:Buffer.from(source.bytes),type:"image/png"});await service.finalize(owner,listingId,p.imageId);return p.imageId;}
beforeAll(async()=>{isolated=await disposableRealMediaDatabase();db=isolated.db;auth=authFactory(db);},30000);
beforeEach(async()=>{
 vi.restoreAllMocks();send.mockReset();captured=undefined;guard=undefined;
 await db.execute(sql`DROP TRIGGER IF EXISTS aaa_capture_short ON public.ebay_real_media_attempts`);
 const h=(await auth.$context).test;owner=(await h.saveUser(h.createUser())).id;foreign=(await h.saveUser(h.createUser())).id;await login();seller=realMediaDigest(owner);
 listings=new DrizzleListingRepository(db);images=new DrizzleImageRepository(db);connections=new DrizzleEbayConnectionRepository(db);repository=new DrizzleEbayRealMediaRepository(db);evidence=new DrizzleMediaCaptureRepository(db);storage=new MemoryImageStorage();source=await generateCaptureFixture();
 listingId=(await listings.create(owner,listingFixture())).id;imageId=await addPhoto();
 await db.insert(schema.ebayConnections).values({ownerId:owner,id:randomUUID(),version:randomUUID(),configHash:config,status:"connected",sellerId:seller,sellerLabel:"Synthetic",scopes:[...EBAY_DISCOVERY_SCOPES],
 access:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},refresh:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},accessExpiresAt:sql`clock_timestamp()+interval '1 hour'`,refreshExpiresAt:sql`clock_timestamp()+interval '1 day'`,connectedAt:sql`clock_timestamp()`});
 const tx=db.transaction.bind(db);vi.spyOn(db,"transaction").mockImplementation((...args)=>transactions.run(true,()=>tx(...args)));
 const claim=repository.claim.bind(repository),fence=repository.fence.bind(repository);vi.spyOn(repository,"claim").mockImplementation(async(...args)=>{guard=args[1];captured=await claim(...args);return captured;});vi.spyOn(repository,"fence").mockImplementation(async(...args)=>{captured=await fence(...args);return captured;});
 const derivatives=createPhotoDerivativeService(listings,images,connections,{async readPrivateImage(p,signal){expect(transactions.getStore()).not.toBe(true);signal.throwIfAborted();return Buffer.from(storage.objects.get(p.pathname)!.bytes);}},photoTransformer,config);
 deps={repository,evidence,derive:derivatives.derive,recipe:()=>PHOTO_RECIPE,configHash:()=>config,async session(){const s=await auth.api.getSession({headers,query:{disableRefresh:true}});return s?{ownerId:s.user.id,id:s.session.id,expiresAt:s.session.expiresAt.toISOString()}:null;},credential:vi.fn(async()=>"synthetic"),capture:send};
 send.mockImplementation(async(bytes:Buffer)=>{expect(transactions.getStore()).not.toBe(true);expect((await rows())[0]).toMatchObject({state:"unknown",operation:"capture-only",derivativeDigest:realMediaDigest(bytes)});return emptyCapture("captured",201);});
 workflow=createCaptureWorkflow(deps);vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No real network"));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});afterAll(async()=>{if(isolated)await isolated.close();});
it("migrates repeatably, derives exact generated bytes, fences, captures structure and never admits an association",async()=>{
 const order:string[]=[],snapshot=repository.snapshot.bind(repository),authorize=evidence.authorize.bind(evidence);
 vi.spyOn(repository,"snapshot").mockImplementation(async(...args)=>{const result=await snapshot(...args);order.push("snapshot");return result;});
 vi.spyOn(evidence,"authorize").mockImplementation(async(...args)=>{await authorize(...args);order.push("authorize");});
 const capture=send.getMockImplementation()!;send.mockImplementation(async(...args)=>{expect(order.slice(-2)).toEqual(["snapshot","authorize"]);return capture(...args);});
 await migrate(db,{migrationsFolder:"drizzle"});const original=Buffer.from(source.bytes),before=await connections.connection(owner),review=await prepare();expect(send).not.toHaveBeenCalled();expect(await rows()).toEqual([]);
 expect(await workflow.confirm(review)).toEqual({state:"unknown",associated:false,captured:true});expect(send).toHaveBeenCalledOnce();expect(source.bytes).toEqual(original);
 const [row]=await rows();expect(row.postIntentAt).not.toBeNull();expect(row.sourceDigest).toBe(source.sourceDigest);expect(row.derivativeDigest).toBe(realMediaDigest(send.mock.calls[0][0]));
 const m=await sharp(send.mock.calls[0][0]).metadata();expect(m).toMatchObject({width:500,height:600,hasAlpha:false});expect(m.exif).toBeUndefined();expect(m.icc).toBeUndefined();
 expect((await captures())[0].report).toEqual(emptyCapture("captured",201));expect(await db.select().from(schema.ebayRealMediaReceipts)).toEqual([]);expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);expect(await connections.connection(owner)).toEqual(before);expect(mediaRuntime()).toEqual({enabled:false});expect(()=>admitRealMediaEvidence({})).toThrow();expect(fetch).not.toHaveBeenCalled();
});
it.each(["copy","session","owner","seller","source"])("rejects %s context without any send",async kind=>{
 const r=await prepare();if(kind==="session")await login();if(kind==="owner")await login(foreign);if(kind==="seller")await db.update(schema.ebayConnections).set({sellerId:realMediaDigest("other")}).where(eq(schema.ebayConnections.ownerId,owner));if(kind==="source")await db.update(schema.listingImages).set({originalFilename:"changed.png"}).where(eq(schema.listingImages.id,imageId));
 if(kind==="copy")await expect(workflow.confirm({...r})).rejects.toThrow();else expect(await workflow.confirm(r)).toHaveProperty("captured",false);expect(send).not.toHaveBeenCalled();
});
it("serializes replay and concurrent fresh runners, preserves both content fences after process loss/new IDs",async()=>{
 const a=await prepare(),other=createCaptureWorkflow(deps),b=await other.prepare(listingId,imageId,seller,source.sourceDigest);
 await Promise.allSettled([workflow.confirm(a),workflow.confirm(a),other.confirm(b)]);expect(send).toHaveBeenCalledOnce();await expect(workflow.confirm(a)).rejects.toThrow();
 const old=imageId;imageId=await addPhoto();workflow=createCaptureWorkflow(deps);expect(await confirm()).toHaveProperty("captured",false);expect(send).toHaveBeenCalledOnce();expect((await rows()).some(x=>x.imageId===old&&x.postIntentAt!==null)).toBe(true);
});
it.each(["disconnect","delete","lost-response","cancel"])("preserves unknown fence and late capture after %s",async kind=>{
 const c=new AbortController();send.mockImplementation(async()=>{if(kind==="disconnect")await connections.disconnect(owner);if(kind==="delete")await listings.delete(owner,listingId);if(kind==="cancel")c.abort();if(kind==="lost-response")throw new Error("PRIVATE RAW RESPONSE");return emptyCapture("captured",201);});
 const result=await confirm(c.signal);expect(result).toMatchObject({state:"unknown",associated:false});expect(JSON.stringify(result)).not.toContain("PRIVATE");expect((await rows())[0].postIntentAt).not.toBeNull();expect(await captures()).toHaveLength(1);expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);
 await expect(db.delete(schema.ebayRealMediaAttempts).where(eq(schema.ebayRealMediaAttempts.id,captured!.id))).rejects.toThrow();
});
it("only retries an identical local acknowledgement after loss, never the create",async()=>{
 const record=evidence.record.bind(evidence);let lost=true;vi.spyOn(evidence,"record").mockImplementation(async(...args)=>{await record(...args);if(lost){lost=false;throw new Error("commit acknowledgement lost");}});
 expect(await confirm()).toHaveProperty("captured",true);expect(send).toHaveBeenCalledOnce();expect(await captures()).toHaveLength(1);
});
it("does not send after an uncertain fence commit acknowledgement",async()=>{
 vi.mocked(repository.fence).mockRestore();const fence=repository.fence.bind(repository);vi.spyOn(repository,"fence").mockImplementation(async(...args)=>{await fence(...args);throw new Error("commit acknowledgement lost");});
 expect(await confirm()).toHaveProperty("captured",false);expect(send).not.toHaveBeenCalled();expect((await rows())[0].postIntentAt).not.toBeNull();
});
it("rejects arbitrary reports in SQL, keeps valid/idempotent evidence append-only and bounded",async()=>{
 await confirm();const c=captured!;await evidence.record(c,emptyCapture("captured",201));expect(await captures()).toHaveLength(1);
 const saved=(await captures())[0];await expect(db.update(schema.ebayMediaCaptures).set({report:emptyCapture("body")}).where(eq(schema.ebayMediaCaptures.id,saved.id))).rejects.toThrow();await expect(db.delete(schema.ebayMediaCaptures)).rejects.toThrow();
 await expect(db.execute(sql`INSERT INTO public.ebay_media_captures(id,attempt_id,report,fingerprint) VALUES ('invalid',${c.id},${JSON.stringify({...emptyCapture("body"),secret:"PRIVATE"})}::jsonb,${realMediaDigest("bad")})`)).rejects.toThrow();
 for(const status of [400,401,402])await evidence.record(c,emptyCapture("transport",status));await expect(evidence.record(c,emptyCapture("transport",403))).rejects.toThrow();expect(await captures()).toHaveLength(4);
});
async function directClaim(){const b=await repository.snapshot(owner,listingId,imageId);guard={binding:b,sessionId,leaseDeadline:new Date(Date.parse(await evidence.time())+30000).toISOString()};captured=await repository.claim({ownerId:owner,listingId,imageId,listingVersion:b.listingVersion,configHash:config,recipe:PHOTO_RECIPE,actionHash:realMediaDigest(randomUUID()),sessionHash:mediaSessionHash(owner,sessionId),operation:"capture-only"},guard);return captured;}
async function content(){const p=await photoTransformer.transform(source.bytes,"image/png",new AbortController().signal,performance.now()+15000);return {sourceDigest:p.sourceDigest,derivativeDigest:p.derivativeDigest,recipe:p.recipe,contentType:p.contentType,size:p.size,width:p.width,height:p.height};}
async function shorten(){await db.execute(sql`CREATE OR REPLACE FUNCTION public.test_capture_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='capture-only' THEN NEW.lease_until:=clock_timestamp()+interval '900 milliseconds';END IF;RETURN NEW;END $$`);await db.execute(sql`DROP TRIGGER IF EXISTS aaa_capture_short ON public.ebay_real_media_attempts`);await db.execute(sql`CREATE TRIGGER aaa_capture_short BEFORE INSERT ON public.ebay_real_media_attempts FOR EACH ROW EXECUTE FUNCTION public.test_capture_lease()`);}
it.each(["listing-lease","attempt-lease","session","access","refresh","attempt-session","attempt-access","attempt-refresh"])("rejects expiry after a real %s lock wait and rolls back fence/content",async kind=>{
 if(kind.includes("lease"))await shorten();
 const expiryKind=kind.replace("attempt-","");
 if(!kind.includes("lease")){if(expiryKind==="session")await db.update(schema.sessions).set({expiresAt:sql`clock_timestamp()+interval '1200 milliseconds'`}).where(eq(schema.sessions.id,sessionId));else await db.execute(sql`UPDATE public.ebay_connections SET ${sql.raw(expiryKind==="access"?"access_expires_at":"refresh_expires_at")}=clock_timestamp()+interval '1200 milliseconds' WHERE owner_id=${owner}`);}
 const c=await directClaim(),data=await content(),row=(await rows())[0],blocker=await isolated.pool.connect();await blocker.query("BEGIN");let pending:Promise<unknown>|undefined;
 try{
  await blocker.query(kind.startsWith("attempt-")?"SELECT id FROM ebay_real_media_attempts WHERE id=$1 FOR UPDATE":"SELECT id FROM listings WHERE id=$1 FOR UPDATE",[kind.startsWith("attempt-")?c.id:listingId]);
  pending=repository.fence(c,data,guard);const settled=pending.then(()=>true,()=>false);let blocked=false;for(let n=0;n<100;n++){const q=await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");if(q.rows[0].n){blocked=true;break;}await new Promise(r=>setTimeout(r,5));}expect(blocked).toBe(true);
  await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '50 milliseconds')",[kind.includes("lease")?row.leaseUntil:new Date(Date.now()+1300).toISOString()]);await blocker.query("COMMIT");expect(await settled).toBe(false);
  expect((await rows())[0]).toMatchObject({state:"preparing",postIntentAt:null,sourceDigest:null,derivativeDigest:null});
 }finally{await blocker.query("ROLLBACK");blocker.release();if(pending)await pending.catch(()=>undefined);}
});
it("SQL refuses backdated expired fencing and expires actual pre-send authorization",async()=>{
 await shorten();const c=await directClaim(),data=await content();await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '30 milliseconds')",[(await rows())[0].leaseUntil]);
 await expect(db.execute(sql`UPDATE public.ebay_real_media_attempts SET state='unknown',post_intent_at=created_at,updated_at=created_at,revision=revision+1,source_digest=${data.sourceDigest},derivative_digest=${data.derivativeDigest},content_type='image/png',encoded_size=${data.size},width=500,height=600 WHERE id=${c.id}`)).rejects.toThrow();expect((await rows())[0].postIntentAt).toBeNull();await expect(evidence.authorize(c)).rejects.toThrow();
});
it("reclaims expired unfenced captures with new action IDs while retaining consumed history/stale-worker refusal",async()=>{
 await shorten();const a=await directClaim();await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '30 milliseconds')",[(await rows())[0].leaseUntil]);const b=await directClaim();expect(b.id).not.toBe(a.id);await expect(repository.fence(a,await content(),guard)).rejects.toThrow();await expect(db.delete(schema.ebayRealMediaAttempts).where(eq(schema.ebayRealMediaAttempts.id,a.id))).rejects.toThrow();expect(await rows()).toHaveLength(2);
});
it("keeps existing readiness credentials through denied, failed and wrong-seller discovery authorization",async()=>{
 await db.update(schema.ebayConnections).set({scopes:[...EBAY_READINESS_SCOPES]}).where(eq(schema.ebayConnections.ownerId,owner));const before=(await connections.connection(owner))!;
 const gateway={exchange:vi.fn(async()=>({accessToken:"synthetic",expiresIn:3600,refreshToken:"synthetic",refreshExpiresIn:7200,scopes:[...EBAY_DISCOVERY_SCOPES]})),refresh:vi.fn(),identity:vi.fn(async()=>({sellerId:seller,label:"Synthetic",source:"trading-get-user" as const}))};
 const svc=createEbayConnectionService(connections,gateway,new EbayTokenCipher(randomBytes(32).toString("hex")),{clientId:"synthetic",clientSecret:"synthetic",ruName:"synthetic-runame",origin:"https://127.0.0.1:3000",fingerprint:config});
 const start=async()=>{const u=new URL(await svc.begin(owner,sessionId,"media-discovery"));expect(u.searchParams.get("scope")!.split(" ")).toEqual(EBAY_DISCOVERY_SCOPES);return u.searchParams.get("state")!;};
 await svc.complete(owner,sessionId,await start(),null,true);expect(gateway.exchange).not.toHaveBeenCalled();gateway.exchange.mockRejectedValueOnce(new EbayError("auth"));await expect(svc.complete(owner,sessionId,await start(),"synthetic")).rejects.toThrow();
 gateway.identity.mockResolvedValueOnce({sellerId:realMediaDigest("wrong"),label:"Synthetic",source:"trading-get-user"});await expect(svc.complete(owner,sessionId,await start(),"synthetic")).rejects.toThrow();
 expect((await connections.connection(owner))!.access).toEqual(before.access);expect((await connections.connection(owner))!.refresh).toEqual(before.refresh);expect((await connections.connection(owner))!.scopes).toEqual(before.scopes);
 await svc.complete(owner,sessionId,await start(),"synthetic");expect((await connections.connection(owner))!.scopes).toEqual(EBAY_DISCOVERY_SCOPES);expect((await connections.connection(owner))!.sellerId).toBe(seller);expect(gateway.refresh).not.toHaveBeenCalled();gateway.identity.mockClear();await expect(svc.accessToken(owner)).rejects.toThrow();expect(gateway.refresh).not.toHaveBeenCalled();expect(gateway.identity).not.toHaveBeenCalled();
});
it("holds both shared slots until cancelled sends settle, including late evidence",async()=>{
 const firstImage=imageId,firstDigest=source.sourceDigest;source=await generateCaptureFixture();const secondImage=await addPhoto(),secondDigest=source.sourceDigest;
 const first=createCaptureWorkflow(deps),second=createCaptureWorkflow(deps),third=createCaptureWorkflow(deps);
 const a=await first.prepare(listingId,firstImage,seller,firstDigest),b=await second.prepare(listingId,secondImage,seller,secondDigest),c=await third.prepare(listingId,firstImage,seller,firstDigest);
 let entered!:()=>void,firstEntered!:()=>void,release!:()=>void,n=0;const started=new Promise<void>(r=>entered=r),firstStarted=new Promise<void>(r=>firstEntered=r),gate=new Promise<void>(r=>release=r),cancel=new AbortController();
 send.mockImplementation(async()=>{if(++n===1)firstEntered();if(n===2)entered();await gate;return emptyCapture("captured",201);});
 const one=first.confirm(a,cancel.signal);await firstStarted;const work=[one,second.confirm(b,cancel.signal)];await started;cancel.abort();await expect(third.confirm(c)).rejects.toMatchObject({code:"busy"});expect(send).toHaveBeenCalledTimes(2);release();
 expect((await Promise.all(work)).every(x=>x.state==="unknown"&&!x.associated)).toBe(true);expect(await captures()).toHaveLength(2);await expect(third.confirm(c)).rejects.toThrow();
 const after=createCaptureWorkflow(deps);expect(await after.confirm(await after.prepare(listingId,firstImage,seller,firstDigest))).toHaveProperty("captured",false);
});
it.each(["session","access","refresh"])("rejects %s expiry while a claim waits and rolls back the claim",async kind=>{
 if(kind==="session")await db.update(schema.sessions).set({expiresAt:sql`clock_timestamp()+interval '1100 milliseconds'`}).where(eq(schema.sessions.id,sessionId));else await db.execute(sql`UPDATE public.ebay_connections SET ${sql.raw(kind==="access"?"access_expires_at":"refresh_expires_at")}=clock_timestamp()+interval '1100 milliseconds' WHERE owner_id=${owner}`);
 const b=await repository.snapshot(owner,listingId,imageId),g={binding:b,sessionId,leaseDeadline:new Date(Date.parse(await evidence.time())+30000).toISOString()},blocker=await isolated.pool.connect();await blocker.query("BEGIN");let pending:Promise<unknown>|undefined;
 try{await blocker.query("SELECT id FROM listings WHERE id=$1 FOR UPDATE",[listingId]);pending=repository.claim({ownerId:owner,listingId,imageId,listingVersion:b.listingVersion,configHash:config,recipe:PHOTO_RECIPE,operation:"capture-only",actionHash:realMediaDigest(randomUUID()),sessionHash:mediaSessionHash(owner,sessionId)},g);const settled=pending.then(()=>true,()=>false);
 let blocked=false;for(let n=0;n<100;n++){const q=await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");if(q.rows[0].n){blocked=true;break;}await new Promise(r=>setTimeout(r,5));}expect(blocked).toBe(true);await isolated.pool.query("SELECT pg_sleep(1.2)");await blocker.query("COMMIT");expect(await settled).toBe(false);expect(await rows()).toEqual([]);expect(send).not.toHaveBeenCalled();
 }finally{await blocker.query("ROLLBACK");blocker.release();if(pending)await pending.catch(()=>undefined);}
});
it("does not allow SQL lease renewal, active capture receipts, or owner deletion to clear safety history",async()=>{
 const c=await directClaim();await expect(evidence.authorize(c)).rejects.toThrow();await expect(db.execute(sql`SELECT public.capture_media_authorize(${c.id},${owner},${realMediaDigest(c.token)},NULL)`)).rejects.toThrow();await expect(db.execute(sql`UPDATE public.ebay_real_media_attempts SET lease_until=clock_timestamp()+interval '1 day',updated_at=clock_timestamp(),revision=revision+1 WHERE id=${c.id}`)).rejects.toThrow();
 await repository.fence(c,await content(),guard);await expect(db.update(schema.ebayRealMediaAttempts).set({operation:"normal"}).where(eq(schema.ebayRealMediaAttempts.id,c.id))).rejects.toThrow();
 await expect(db.execute(sql`INSERT INTO public.ebay_real_media_receipts(id,attempt_id,contract_version,fingerprint,level,created_at) VALUES ('forged',${c.id},'synthetic-real-media-v1',${realMediaDigest("forged")},'partial',clock_timestamp())`)).rejects.toThrow();
 await expect(db.delete(schema.users).where(eq(schema.users.id,owner))).rejects.toThrow();expect((await rows())[0].postIntentAt).not.toBeNull();
});
it("rejects a fence from an older transaction after wall-time lease expiry",async()=>{
 await shorten();const c=await directClaim(),data=await content();
 await db.transaction(async tx=>{
  await tx.execute(sql`SELECT transaction_timestamp()`);
  await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '30 milliseconds')",[(await rows())[0].leaseUntil]);
  await expect(tx.execute(sql`UPDATE public.ebay_real_media_attempts SET state='unknown',post_intent_at=transaction_timestamp(),updated_at=transaction_timestamp(),revision=revision+1,source_digest=${data.sourceDigest},derivative_digest=${data.derivativeDigest},content_type='image/png',encoded_size=${data.size},width=500,height=600 WHERE id=${c.id}`)).rejects.toThrow();
 });
 expect((await rows())[0]).toMatchObject({postIntentAt:null,sourceDigest:null,derivativeDigest:null,state:"preparing"});
});
it("refuses refresh expiry during the last snapshot lock wait and retains the committed fences",async()=>{
 const expiry=await db.execute(sql`UPDATE public.ebay_connections SET refresh_expires_at=clock_timestamp()+interval '2 seconds' WHERE owner_id=${owner} RETURNING refresh_expires_at AS at`);
 const deadline=new Date(expiry.rows[0].at as string).toISOString(),review=await prepare();
 const beforeSend=repository.beforeSend.bind(repository),snapshot=repository.snapshot.bind(repository);
 let finalSnapshot=false,waited=false;
 vi.spyOn(repository,"beforeSend").mockImplementation(async(...args)=>{await beforeSend(...args);finalSnapshot=true;});
 const snapshotSpy=vi.spyOn(repository,"snapshot").mockImplementation(async(...args)=>{
  if(!finalSnapshot)return snapshot(...args);finalSnapshot=false;
  const blocker=await isolated.pool.connect();let pending:ReturnType<typeof snapshot>|undefined;
  try{
   await blocker.query("BEGIN");await blocker.query("SELECT id FROM listings WHERE id=$1 FOR UPDATE",[listingId]);
   const pid=(await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
   expect(Date.parse(await evidence.time())).toBeLessThan(Date.parse(deadline));
   pending=snapshot(...args);const settled=pending.then(value=>({value}),error=>({error}));
   for(let n=0;n<150;n++){
    const q=await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))",[pid]);
    if(q.rows[0].n){waited=true;break;}await new Promise(resolve=>setTimeout(resolve,5));
   }
   expect(waited).toBe(true);expect(Date.parse(await evidence.time())).toBeLessThan(Date.parse(deadline));
   await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '50 milliseconds')",[deadline]);await blocker.query("COMMIT");
   const result=await settled;if("error" in result)throw result.error;return result.value;
  }finally{await blocker.query("ROLLBACK");blocker.release();if(pending)await pending.catch(()=>undefined);}
 });
 expect(await workflow.confirm(review)).toEqual({state:"unknown",associated:false,captured:false});
 expect(waited).toBe(true);expect(send).not.toHaveBeenCalled();snapshotSpy.mockRestore();
 const fence=(await rows())[0],claim=captured!;
 expect(fence).toMatchObject({operation:"capture-only",state:"unknown",sourceDigest:source.sourceDigest});
 expect(fence.postIntentAt).not.toBeNull();expect(fence.derivativeDigest).toMatch(/^[a-f0-9]{64}$/);
 await expect(workflow.confirm(review)).rejects.toMatchObject({code:"stale"});
 await evidence.record(claim,emptyCapture("captured",201));await evidence.record(claim,emptyCapture("captured",201));
 expect(await captures()).toHaveLength(2);await expect(evidence.authorize(claim)).rejects.toThrow();
 expect(await db.select().from(schema.ebayRealMediaReceipts)).toEqual([]);expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);
 // A distinct, valid synthetic reconnect cannot reopen this content's fence.
 await db.update(schema.ebayConnections).set({version:randomUUID(),refreshExpiresAt:sql`clock_timestamp()+interval '1 day'`}).where(eq(schema.ebayConnections.ownerId,owner));
 workflow=createCaptureWorkflow(deps);expect(await confirm()).toEqual({state:"unknown",associated:false,captured:false});
 expect(await rows()).toEqual([fence]);expect(send).not.toHaveBeenCalled();
});
it.each(["session","access","refresh","lease"])("refuses final %s expiry after the last matching snapshot",async kind=>{
 if(kind==="lease")await shorten();
 const beforeSend=repository.beforeSend.bind(repository),snapshot=repository.snapshot.bind(repository);let finalSnapshot=false;
 vi.spyOn(repository,"beforeSend").mockImplementation(async(...args)=>{await beforeSend(...args);finalSnapshot=true;});
 vi.spyOn(repository,"snapshot").mockImplementation(async(...args)=>{
  const result=await snapshot(...args);if(!finalSnapshot)return result;finalSnapshot=false;
  let deadline:string;
  if(kind==="lease")deadline=(await rows())[0].leaseUntil!;
  else if(kind==="session")deadline=(await db.update(schema.sessions).set({expiresAt:sql`clock_timestamp()+interval '400 milliseconds'`}).where(eq(schema.sessions.id,sessionId)).returning())[0].expiresAt.toISOString();
  else{
   const expiry=await db.execute(sql`UPDATE public.ebay_connections SET ${sql.raw(kind==="access"?"access_expires_at":"refresh_expires_at")}=clock_timestamp()+interval '400 milliseconds' WHERE owner_id=${owner} RETURNING ${sql.raw(kind==="access"?"access_expires_at":"refresh_expires_at")} AS at`);
   deadline=new Date(expiry.rows[0].at as string).toISOString();
  }
  expect(Date.parse(await evidence.time())).toBeLessThan(Date.parse(deadline));
  await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '50 milliseconds')",[deadline]);return result;
 });
 expect(await confirm()).toEqual({state:"unknown",associated:false,captured:false});expect(send).not.toHaveBeenCalled();
 expect((await rows())[0]).toMatchObject({state:"unknown",sourceDigest:source.sourceDigest});expect((await rows())[0].postIntentAt).not.toBeNull();
 expect(await db.select().from(schema.ebayRealMediaReceipts)).toEqual([]);expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);
});
it.each(["cancellation","review expiry"])("checks %s immediately after successful final authorization",async kind=>{
 if(kind==="review expiry")await db.update(schema.sessions).set({expiresAt:sql`clock_timestamp()+interval '2 seconds'`}).where(eq(schema.sessions.id,sessionId));
 const review=await prepare(),cancel=new AbortController(),authorize=evidence.authorize.bind(evidence);let authorized=false;
 vi.spyOn(evidence,"authorize").mockImplementation(async(...args)=>{
  await authorize(...args);authorized=true;
  if(kind==="cancellation")cancel.abort();else await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '50 milliseconds')",[review.expiresAt]);
 });
 expect(await workflow.confirm(review,cancel.signal)).toEqual({state:"unknown",associated:false,captured:false});expect(authorized).toBe(true);expect(send).not.toHaveBeenCalled();
 expect((await rows())[0].postIntentAt).not.toBeNull();expect((await captures())[0].report).toEqual(emptyCapture(kind==="cancellation"?"cancelled":"transport"));
});
