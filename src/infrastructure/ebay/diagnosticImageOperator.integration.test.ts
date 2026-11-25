import { randomBytes,randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq,sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { Pool } from "pg";
import { disposableVerificationDatabase } from "../../test/disposableVerificationDatabase";
import { diagnosticImageWire } from "../../test/diagnosticImageWire";
import { imageWireResponse } from "../../test/imageDownloaderFixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { privateTerminal } from "../../test/privateTerminal";
import { listingFixture } from "../../test/fixtures";
import { authOptions } from "../../auth/options";
import { createImageService } from "../../application/imageService";
import { EBAY_DISCOVERY_SCOPES } from "../../application/ebayConnection";
import { realMediaDigest } from "../../application/ebayRealMedia";
import { DrizzleListingRepository } from "../repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../repositories/drizzleImageRepository";
import { DrizzleLocalImageOperatorRepository } from "../repositories/drizzleLocalImageOperatorRepository";
import { DrizzleEbayImageVerificationRepository } from "../repositories/drizzleEbayImageVerificationRepository";
import { generateVerificationFixture } from "../storage/verificationFixture";
import { photoTransformer, PHOTO_RECIPE } from "../storage/photoDerivative/transformPhoto";
import * as comparison from "../storage/diagnosticImageDecode";
import { EbayTokenCipher } from "./tokenCipher";
import { ebayConfig } from "./config";
import { mediaRuntime } from "./mediaRuntime";
import { admitRealMediaEvidence } from "./realMediaEvidence";
import { runVerificationOperator,runVerificationOperatorWithHeaders } from "../../../scripts/image-verification-runtime";
import { runImageVerificationTool } from "../../../scripts/ebay-image-verification";
import { verificationFixtureTitle } from "../../../scripts/image-verification-context";
import type { VerificationPins,VerificationOptions } from "../../../scripts/image-verification-options";
import * as schema from "../db/schema";
import { OPERATOR_ROOT,OPERATOR_REQUIRED_FILES } from "../../../scripts/reviewed-checkout";
import { localOperatorVerificationPins } from "../../../scripts/local-image-operator-pins";

const sdk=vi.hoisted(()=>({get:vi.fn(),git:vi.fn()}));
vi.mock("server-only",()=>({}));vi.mock("dotenv",()=>{throw Error("Private environment forbidden");});
vi.mock("@vercel/blob",()=>({get:sdk.get}));
vi.mock("./ebayClient",()=>{throw Error("OAuth/refresh/GetUser client must never be constructed");});
vi.mock("node:child_process",()=>({execFileSync:sdk.git,spawn:()=>{throw Error("Browser/process launch forbidden");}}));
vi.mock("./imageAddressSetPolicy",async original=>{const actual=await original<typeof import("./imageAddressSetPolicy")>();return{...actual,
 inspectImageAddressSet:(...args:Parameters<typeof actual.inspectImageAddressSet>)=>{const r=actual.inspectImageAddressSet(...args);return r.candidate?{...r,candidate:{address:"127.0.0.1",family:4 as const}}:r;}};});
let isolated:Awaited<ReturnType<typeof disposableVerificationDatabase>>,db:typeof isolated.db;
const makeAuth=(env:NodeJS.ProcessEnv)=>betterAuth({...authOptions(db,env),plugins:[testUtils()]});
let auth:ReturnType<typeof makeAuth>,env:NodeJS.ProcessEnv,cookie:string,owner:string,foreign:string,sessionId:string;
let wire:Awaited<ReturnType<typeof diagnosticImageWire>>,storage:MemoryImageStorage,pins:VerificationPins;
let returned:Buffer|undefined,source:Awaited<ReturnType<typeof generateVerificationFixture>>;
const a=schema.ebayRealMediaAttempts,v=schema.ebayImageVerifications,e=schema.ebayImageVerificationOutcomes;
const options=():Extract<VerificationOptions,{mode:"approve-one-post-one-get"}>=>({mode:"approve-one-post-one-get",pins:{...pins},comparisonRecipe:comparison.IMAGE_COMPARISON_RECIPE});
const cleanup=():Extract<VerificationOptions,{mode:"cleanup-fixture"}>=>({mode:"cleanup-fixture",pins:{...pins}});
const parents=()=>db.select().from(a).where(eq(a.ownerId,owner));
const children=()=>db.select().from(v).where(eq(v.ownerId,owner));
const connection=async()=> (await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,owner)))[0];
async function noAdmission(){expect(await db.select().from(schema.ebayRealMediaReceipts)).toEqual([]);expect(await db.select().from(schema.ebayRealMediaAssociations)).toEqual([]);
 expect(mediaRuntime()).toEqual({enabled:false});expect(()=>admitRealMediaEvidence({})).toThrow();}
const run=(o=options(),signal=new AbortController().signal)=>runVerificationOperator(o,env,cookie,signal,()=>{});
async function persistedBrowserFixture() {
 const c=(await connection())!,repo=new DrizzleLocalImageOperatorRepository(db),id=randomUUID(),future=new Date(Date.now()+3_600_000).toISOString();
 const actor={ownerId:owner,id:sessionId,expiresAt:future};
 await repo.arm({id,ownerId:owner,connectionId:c.id,initialConnectionVersion:c.version,sellerKey:c.sellerId!,configHash:c.configHash,
  reviewedHead:pins.head,reviewedTree:"a".repeat(40),derivativeRecipe:PHOTO_RECIPE,comparisonRecipe:comparison.IMAGE_COMPARISON_RECIPE,expiresAt:future});
 const row=async()=>(await repo.activation(id,owner))!;
 const proxy=repo.consentRepository(id,actor,(await row()).revision),state=realMediaDigest(randomUUID());
 await proxy.begin(owner,realMediaDigest(sessionId),c.configHash,state,new Date().toISOString(),future,EBAY_DISCOVERY_SCOPES);
 await proxy.consume(owner,realMediaDigest(sessionId),c.configHash,state,new Date().toISOString());
 await repo.consumeCallbackIntent(id,actor,state,"exchange");await repo.consumeCallbackIntent(id,actor,state,"identity");
 await proxy.connect(owner,(await row()).consentVersion!,{sellerId:c.sellerId,sellerLabel:c.sellerLabel,access:c.access,refresh:c.refresh,
  accessExpiresAt:c.accessExpiresAt,refreshExpiresAt:c.refreshExpiresAt,scopes:[...EBAY_DISCOVERY_SCOPES]},new Date().toISOString());
 const listingId=randomUUID();let active=await repo.beginFixture(id,actor,(await row()).revision,listingId);
 active=await repo.pinFixtureContent(id,actor,active.revision,{sourceDigest:pins.sourceDigest,derivativeDigest:pins.derivativeDigest});
 const listings=new DrizzleListingRepository(db);await listings.create(owner,{...listingFixture(),id:listingId,title:verificationFixtureTitle(source.sourceDigest)});
 const service=createImageService(new DrizzleImageRepository(db),storage),upload=await service.prepare(owner,listingId,{filename:"generated.png",contentType:"image/png",size:source.bytes.length});
 storage.objects.set(storage.uploads.get(upload.imageId)!.pathname,{bytes:Buffer.from(source.bytes),type:"image/png"});await service.finalize(owner,listingId,upload.imageId);
 await repo.finalizeFixture(id,actor,active.revision,{imageId:upload.imageId,listingVersion:(await listings.getById(owner,listingId))!.updatedAt});
 return {repo,actor,id,row};
}
beforeAll(async()=>{isolated=await disposableVerificationDatabase();db=isolated.db;},30000);
beforeEach(async()=>{
 wire=await diagnosticImageWire(Number(new URL(process.env.TEST_DATABASE_URL!).port||5432));
 env={NODE_ENV:"test",DATABASE_URL:isolated.pool.options.connectionString!,BETTER_AUTH_URL:"https://127.0.0.1:3000",BETTER_AUTH_SECRET:randomBytes(32).toString("hex"),
  GITHUB_CLIENT_ID:"synthetic",GITHUB_CLIENT_SECRET:"synthetic",EBAY_ENVIRONMENT:"sandbox",EBAY_SANDBOX_CLIENT_ID:"synthetic-app",EBAY_SANDBOX_CLIENT_SECRET:"synthetic-secret",
  EBAY_SANDBOX_RUNAME:"synthetic-ru-name",EBAY_CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString("hex"),BLOB_READ_WRITE_TOKEN:"synthetic-explicit-blob"};
 auth=makeAuth(env);const h=(await auth.$context).test;owner=(await h.saveUser(h.createUser())).id;foreign=(await h.saveUser(h.createUser())).id;
 const login=await h.login({userId:owner});cookie=login.headers.get("cookie")!;sessionId=login.session.id;
 source=await generateVerificationFixture();const photo=await photoTransformer.transform(source.bytes,"image/png",new AbortController().signal,performance.now()+5000);
 const listing=await new DrizzleListingRepository(db).create(owner,{...listingFixture(),title:verificationFixtureTitle(source.sourceDigest)});
 storage=new MemoryImageStorage();const service=createImageService(new DrizzleImageRepository(db),storage),upload=await service.prepare(owner,listing.id,{filename:"generated.png",contentType:"image/png",size:source.bytes.length});
 storage.objects.set(storage.uploads.get(upload.imageId)!.pathname,{bytes:Buffer.from(source.bytes),type:"image/png"});await service.finalize(owner,listing.id,upload.imageId);
 const seller=realMediaDigest(owner),id=randomUUID(),version=randomUUID(),config=ebayConfig(env),cipher=new EbayTokenCipher(env.EBAY_CREDENTIAL_ENCRYPTION_KEY);
 const access=cipher.encrypt("synthetic-operator-access",JSON.stringify(["ebay-oauth-v1","access",owner,"sandbox",id,config.fingerprint,seller]));
 const refresh=cipher.encrypt("synthetic-unused-refresh",JSON.stringify(["ebay-oauth-v1","refresh",owner,"sandbox",id,config.fingerprint,seller]));
 await db.insert(schema.ebayConnections).values({ownerId:owner,id,version,configHash:config.fingerprint,status:"connected",sellerId:seller,sellerLabel:"Synthetic seller",scopes:[...EBAY_DISCOVERY_SCOPES],
  access,refresh,connectedAt:sql`clock_timestamp()`,accessExpiresAt:sql`clock_timestamp()+interval '1 hour'`,refreshExpiresAt:sql`clock_timestamp()+interval '1 day'`});
 pins={head:"b".repeat(40),database:isolated.name,listing:listing.id,image:upload.imageId,listingVersion:(await new DrizzleListingRepository(db).getById(owner,listing.id))!.updatedAt,
  seller,connectionVersion:version,sourceDigest:source.sourceDigest,derivativeDigest:photo.derivativeDigest};photo.bytes.fill(0);
 sdk.git.mockImplementation((_name:string,args:string[])=>args[0]==="rev-parse"?(args[1]==="HEAD"?pins.head:OPERATOR_ROOT):args[0]==="ls-tree"?OPERATOR_REQUIRED_FILES.join("\n"):"");sdk.get.mockReset();
 sdk.get.mockImplementation(async(path:string,opts:Record<string,unknown>)=>{
  expect(opts).toMatchObject({token:"synthetic-explicit-blob",access:"private",useCache:false});expect(opts).not.toHaveProperty("oidcToken");
  const tx=await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND state='idle in transaction'",[isolated.name]);expect(tx.rows[0].n).toBe(0);
  const object=storage.objects.get(path)!;return{statusCode:200,blob:{pathname:path,size:object.bytes.length,contentType:object.type},
   stream:new ReadableStream<Uint8Array>({start(c){c.enqueue(Uint8Array.from(object.bytes));c.close();}})};
 });
 returned=undefined;wire.response.before=async(req,body)=>{const boundary=/boundary=(.+)$/.exec(req.headers["content-type"]!)![1];
  returned=Buffer.from(body.subarray(body.indexOf("\r\n\r\n")+4,-Buffer.byteLength(`\r\n--${boundary}--\r\n`)));};
 wire.response.image=socket=>socket.end(imageWireResponse(returned!));
});
afterEach(async()=>{returned?.fill(0);source.bytes.fill(0);await noAdmission();await wire.close();});
afterAll(async()=>{if(isolated)await isolated.close();});

it("runs the real manual path with signed hidden input, native local wire, exact derivative and read-only authentication",async()=>{
 const before=await connection(),session=await db.select().from(schema.sessions).where(eq(schema.sessions.id,sessionId)),original=Buffer.from(source.bytes);
 const o=options(),args=["--approve-one-post-one-get","--reviewed-head",pins.head,"--database",pins.database,"--listing",pins.listing,"--image",pins.image,
  "--listing-version",pins.listingVersion,"--seller-key",pins.seller,"--connection-version",pins.connectionVersion,"--source-digest",pins.sourceDigest,"--derivative-digest",pins.derivativeDigest,"--comparison-recipe",o.comparisonRecipe];
 const t=privateTerminal(),pending=runImageVerificationTool(args,env,t.terminal);for(let n=0;n<100&&!t.input.isRaw;n++)await new Promise<void>(r=>setImmediate(r));
 expect(t.input.isRaw).toBe(true);t.send(cookie);t.submit();expect(await pending).toBe(0);
 const report=JSON.parse(t.text().split("\n").filter(s=>s.startsWith("{"))[0]);expect(report).toMatchObject({operationSettled:true,accountingComplete:true,
  accounting:{postBudgetConsumed:true,getBudgetConsumed:true,postResponseObserved:true,getResponseObserved:true,ceiling:2},outcome:{visual:{verdict:"match"},acknowledgement:"recorded"},associated:false});
 expect(t.text()).not.toContain(cookie);expect(t.text()).not.toContain(pins.seller);expect(t.text()).not.toMatch(/opaque|image%41|synthetic-operator-access|pathname|ciphertext/);
 expect(await connection()).toEqual(before);expect(await db.select().from(schema.sessions).where(eq(schema.sessions.id,sessionId))).toEqual(session);expect(source.bytes).toEqual(original);
 expect(await db.select().from(schema.ebayOauthStates)).toEqual([]);expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);expect(sdk.get).toHaveBeenCalledOnce();
 const [image]=await db.select().from(schema.listingImages).where(eq(schema.listingImages.id,pins.image));expect(Date.parse(image.providerRetainUntil!)).toBeGreaterThan(Date.now()+5*60_000);
});
it.each(["listing-version","source","derivative","seller","connection","recipe","foreign","expired-session","expiring-access","access-margin","head"])("stops stale/unapproved %s before any eBay request",async kind=>{
 const o=options();if(kind==="listing-version")o.pins.listingVersion="2000-01-01T00:00:00.000Z";if(kind==="source")o.pins.sourceDigest="a".repeat(64);if(kind==="derivative")o.pins.derivativeDigest="a".repeat(64);
 if(kind==="seller")o.pins.seller="a".repeat(64);if(kind==="connection")o.pins.connectionVersion=randomUUID();if(kind==="recipe")o.comparisonRecipe="wrong-recipe";
 if(kind==="foreign")cookie=(await(await auth.$context).test.login({userId:foreign})).headers.get("cookie")!;
 if(kind==="expired-session")await db.update(schema.sessions).set({expiresAt:new Date(Date.now()-1)}).where(eq(schema.sessions.id,sessionId));
 if(kind==="expiring-access")await db.update(schema.ebayConnections).set({accessExpiresAt:new Date(Date.now()+60_000).toISOString()}).where(eq(schema.ebayConnections.ownerId,owner));
 if(kind==="access-margin")await db.update(schema.ebayConnections).set({accessExpiresAt:new Date(Date.now()+130_000).toISOString()}).where(eq(schema.ebayConnections.ownerId,owner));
 const result=await runVerificationOperator(o,env,cookie,new AbortController().signal,()=>{if(kind==="head")throw Error("changed source");})
  .then(value=>({value}),error=>({error}));
 if("value"in result)expect(result.value.exitCode).toBe(1);else expect(result.error).toBeInstanceOf(Error);
 expect(wire.posts).toHaveLength(0);expect(wire.image.requests).toHaveLength(0);expect((await parents()).every(p=>p.postIntentAt===null)).toBe(true);
});
it.each(["invalid-json","wrong-host","http-error","redirect","different-marker","corrupt"])("stops unexpected %s without another POST/GET",async kind=>{
 if(kind==="invalid-json")wire.response.body=()=>"{";if(kind==="wrong-host")wire.response.body=()=>JSON.stringify({imageUrl:"https://unapproved.invalid/image",expirationDate:new Date(Date.now()+3_600_000).toISOString()});
 if(kind==="http-error")wire.response.status=500;
 if(kind==="redirect")wire.response.image=socket=>socket.end("HTTP/1.1 302 Found\r\nLocation: https://not-fetched.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
 if(kind==="different-marker"){const different=await generateVerificationFixture();wire.response.image=socket=>socket.end(imageWireResponse(different.bytes));}
 if(kind==="corrupt")wire.response.image=socket=>socket.end(imageWireResponse(Buffer.from([137,80,78,71])));
 const result=await run();expect(result.exitCode).toBe(1);expect(wire.posts).toHaveLength(1);expect(wire.image.requests.length).toBeLessThanOrEqual(1);expect((await parents())[0].postIntentAt).not.toBeNull();
});
it("blocks replay/restart through retained content fences",async()=>{
 expect((await run()).exitCode).toBe(0);expect((await run()).exitCode).toBe(1);expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);
 expect((await parents()).filter(p=>p.postIntentAt!==null)).toHaveLength(1);
});
it("serializes concurrent independent operators for the same approved content",async()=>{
 const results=await Promise.allSettled([run(),run()]);expect(results.some(r=>r.status==="fulfilled"&&r.value.exitCode===0)).toBe(true);
 expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);expect((await parents()).filter(p=>p.postIntentAt!==null)).toHaveLength(1);
});
it("keeps lost acknowledgements and committed request slots uncertain without provider retries",async()=>{
 const original=DrizzleEbayImageVerificationRepository.prototype.recordOutcome;
 vi.spyOn(DrizzleEbayImageVerificationRepository.prototype,"recordOutcome").mockImplementation(async function(this:DrizzleEbayImageVerificationRepository,...args){await original.apply(this,args);throw Error("lost ack");});
 const result=await run();expect(result).toMatchObject({exitCode:1,report:{accounting:{postBudgetConsumed:true,getBudgetConsumed:true},outcome:{retrieved:true,acknowledgement:"uncertain"}}});
 expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);expect((await children())[0].requestIntentAt).not.toBeNull();
});
it("counts the full ceiling as uncertain if final accounting cannot be read, without retrying the run",async()=>{
 const query=Pool.prototype.query;
 const spy=vi.spyOn(Pool.prototype,"query").mockImplementation(function(this:Pool,...args:unknown[]){
  const text=typeof args[0]==="string"?args[0]:(args[0] as {text?:string})?.text;
  if(text?.startsWith('select "post_intent_at" from "ebay_real_media_attempts"'))throw Error("synthetic accounting unavailable");
  return Reflect.apply(query,this,args);
 } as typeof query);
 try{const result=await run();expect(result).toMatchObject({exitCode:1,report:{accountingComplete:false,accounting:{postBudgetConsumed:null,getBudgetConsumed:null,ceiling:2}}});
  expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);expect((await parents())[0].postIntentAt).not.toBeNull();
 }finally{spy.mockRestore();}
});
it.each(["cancelled","session-expiry","connection-change"])("waits for late native settlement and discards %s results",async kind=>{
 let entered=false,resolve!:(v:Buffer)=>void;const pending=new Promise<Buffer>(r=>{resolve=r;}),decode=comparison.decodeDiagnosticImage;let n=0;
 const spy=vi.spyOn(comparison,"decodeDiagnosticImage").mockImplementation(async(...args)=>{if(++n===2){entered=true;return pending;}return decode(...args);});
 const controller=new AbortController();let finished=false;const operation=run(options(),controller.signal);void operation.then(()=>{finished=true;});
 try{for(let i=0;i<800&&!entered;i++)await new Promise(r=>setTimeout(r,5));expect(entered).toBe(true);
  if(kind==="cancelled")controller.abort();if(kind==="session-expiry")await db.update(schema.sessions).set({expiresAt:new Date(Date.now()-1)}).where(eq(schema.sessions.id,sessionId));
  if(kind==="connection-change")await db.update(schema.ebayConnections).set({version:randomUUID()}).where(eq(schema.ebayConnections.ownerId,owner));
  await new Promise(r=>setTimeout(r,20));expect(finished).toBe(false);expect((await parents())[0].postIntentAt).not.toBeNull();
  resolve(await sharp(returned!).raw().toBuffer());const result=await operation;expect(result).toMatchObject({exitCode:1,report:{operationSettled:true,outcome:{visual:{verdict:"inconclusive"}}}});
  expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);
 }finally{resolve(Buffer.alloc(900_000));await operation.catch(()=>{});spy.mockRestore();}
});
it("retains the fixture until its actual persisted deadline; cleanup requires no eBay/Blob credentials",async()=>{
 await run();const before=await parents(),o=cleanup(),minimal={NODE_ENV:"test",DATABASE_URL:env.DATABASE_URL,BETTER_AUTH_URL:env.BETTER_AUTH_URL,BETTER_AUTH_SECRET:env.BETTER_AUTH_SECRET,GITHUB_CLIENT_ID:"synthetic",GITHUB_CLIENT_SECRET:"synthetic"} as NodeJS.ProcessEnv;
 const result=await runVerificationOperator(o,minimal,cookie,new AbortController().signal,()=>{});expect(result).toMatchObject({exitCode:0,report:{providerRequests:0,cleanup:{status:"retained",remoteErasureProven:false}}});
 expect(await parents()).toEqual(before);expect(await new DrizzleListingRepository(db).getById(owner,pins.listing)).not.toBeNull();expect(sdk.get).toHaveBeenCalledOnce();
});
async function dueCleanupFixture(){
 await run();
 // Synthetic mutable fixture date only; no attempt/evidence/guard changes.
 // A separate control above verifies the normal six-minute retention extension.
 await db.update(schema.listingImages).set({providerRetainUntil:sql`clock_timestamp()+interval '80 milliseconds'`}).where(eq(schema.listingImages.id,pins.image));
 await isolated.pool.query("SELECT pg_sleep_until(provider_retain_until+interval '20 milliseconds') FROM listing_images WHERE id=$1",[pins.image]);
}
it("queues due guarded local removal, detaches projection and retains all permanent safety history",async()=>{
 await dueCleanupFixture();const before=await parents(),events=await db.select().from(e).where(eq(e.ownerId,owner));
 const result=await runVerificationOperator(cleanup(),env,cookie,new AbortController().signal,()=>{});expect(result).toMatchObject({exitCode:0,report:{cleanup:{status:"queued",remoteErasureProven:false},providerRequests:0}});
 expect(await new DrizzleListingRepository(db).getById(owner,pins.listing)).toBeNull();expect(await parents()).toEqual(before);expect(await db.select().from(e).where(eq(e.ownerId,owner))).toEqual(events);
 const queue=await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname,storage.uploads.get(pins.image)!.pathname));
 expect(queue).toHaveLength(1);expect(Date.parse(queue[0].notBefore)).toBeGreaterThan(Date.now());expect(storage.deleted).toEqual([]);
});
it.each(["version","extra-photo","missing-history","foreign","delete-failure"])("refuses unsafe cleanup %s without changing the fixture or its fences",async kind=>{
 if(kind==="missing-history")await db.update(schema.listingImages).set({providerRetainUntil:sql`clock_timestamp()-interval '1 second'`}).where(eq(schema.listingImages.id,pins.image));
 else await dueCleanupFixture();
 const o=cleanup();if(kind==="version")o.pins.listingVersion="2000-01-01T00:00:00.000Z";
 if(kind==="extra-photo")await db.insert(schema.listingImages).values({id:randomUUID(),listingId:pins.listing,storageProvider:"filename",originalFilename:"synthetic.png",order:1});
 if(kind==="foreign")cookie=(await(await auth.$context).test.login({userId:foreign})).headers.get("cookie")!;
 if(kind==="delete-failure")await db.execute(sql.raw(`CREATE FUNCTION public.operator_test_delete_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic delete failure'; END $$; CREATE TRIGGER operator_test_delete_refusal BEFORE DELETE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.operator_test_delete_refusal()`));
 const before=await parents(),path=storage.uploads.get(pins.image)!.pathname,queue=await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname,path));
 try{await expect(runVerificationOperator(o,env,cookie,new AbortController().signal,()=>{})).rejects.toThrow();
  expect(await new DrizzleListingRepository(db).getById(owner,pins.listing)).not.toBeNull();expect(await parents()).toEqual(before);
  expect(await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname,path))).toEqual(queue);
 }finally{if(kind==="delete-failure")await db.execute(sql`DROP TRIGGER operator_test_delete_refusal ON public.listings; DROP FUNCTION public.operator_test_delete_refusal()`);}
});

it("rolls cleanup back if its session expires during the later cleanup-ledger lock wait",async()=>{
 await dueCleanupFixture();const path=storage.uploads.get(pins.image)!.pathname,at=new Date(Date.now()-1000).toISOString();
 await db.insert(schema.imageCleanup).values({pathname:path,notBefore:at});
 const expiry=new Date(Date.now()+1800);await db.update(schema.sessions).set({expiresAt:expiry}).where(eq(schema.sessions.id,sessionId));
 const blocker=await isolated.pool.connect();await blocker.query("BEGIN");await blocker.query("SELECT pathname FROM image_cleanup WHERE pathname=$1 FOR UPDATE",[path]);
 const operation=runVerificationOperator(cleanup(),env,cookie,new AbortController().signal,()=>{}).then(value=>({value}),error=>({error}));
 try{
  let waiting=false;
  for(let n=0;n<100&&!waiting;n++){
   const activity=await isolated.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%insert into \"image_cleanup\"%'",[isolated.name]);
   waiting=activity.rows[0].n>0;if(!waiting)await new Promise(r=>setTimeout(r,10));
  }
  expect(waiting).toBe(true);await isolated.pool.query("SELECT pg_sleep_until($1::timestamptz+interval '50 milliseconds')",[expiry.toISOString()]);
  await blocker.query("COMMIT");const result=await operation;expect(result).toHaveProperty("error");
  expect(await new DrizzleListingRepository(db).getById(owner,pins.listing)).not.toBeNull();
  expect(new Date((await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname,path)))[0].notBefore).toISOString()).toBe(at);
 }finally{await blocker.query("ROLLBACK");blocker.release();await operation;}
},15000);

it("refuses a mismatched actual disposable migration journal without initializing byte access or claims",async()=>{
 const row=(await isolated.pool.query("SELECT id,hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1")).rows[0];
 await isolated.pool.query("UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2",["0".repeat(64),row.id]);
 try{await expect(run()).rejects.toMatchObject({code:"journal"});expect(sdk.get).not.toHaveBeenCalled();expect(await parents()).toEqual([]);expect(wire.posts).toHaveLength(0);expect(wire.image.requests).toHaveLength(0);}
 finally{await isolated.pool.query("UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2",[row.hash,row.id]);}
});

it("uses genuine request headers through the same full diagnostic without cookie export or session mutation",async()=>{
 const incoming=new Headers({cookie:"ui-preference=compact; "+cookie+"; other-state=synthetic",origin:"https://127.0.0.1:3000",host:"127.0.0.1:3000"});
 const before=await connection(),session=await db.select().from(schema.sessions).where(eq(schema.sessions.id,sessionId));
 const result=await runVerificationOperatorWithHeaders(options(),env,incoming,new AbortController().signal,()=>{},OPERATOR_ROOT);
 expect(result).toMatchObject({exitCode:0,report:{operationSettled:true,accountingComplete:true,outcome:{retrieved:true,visual:{verdict:"match"},acknowledgement:"recorded"},associated:false}});
 expect(incoming.get("cookie")).toContain(cookie);expect(incoming.get("origin")).toBe("https://127.0.0.1:3000");
 expect(JSON.stringify(result)).not.toContain(cookie);expect(JSON.stringify(result)).not.toMatch(/opaque|image%41|synthetic-operator-access|pathname|ciphertext/);
 expect(await connection()).toEqual(before);expect(await db.select().from(schema.sessions).where(eq(schema.sessions.id,sessionId))).toEqual(session);
 expect(await db.select().from(schema.ebayOauthStates)).toEqual([]);expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);
});
it.each(["missing","tampered","foreign"])("refuses %s request authentication before source access or requests",async kind=>{
 let value=kind==="missing"?"":cookie;
 if(kind==="tampered")value=value.slice(0,-1)+(value.endsWith("x")?"y":"x");
 if(kind==="foreign")value=(await(await auth.$context).test.login({userId:foreign})).headers.get("cookie")!;
 await expect(runVerificationOperatorWithHeaders(options(),env,new Headers({cookie:value}),new AbortController().signal,()=>{},OPERATOR_ROOT)).rejects.toThrow();
 expect(await parents()).toEqual([]);expect(sdk.get).not.toHaveBeenCalled();expect(wire.posts).toHaveLength(0);expect(wire.image.requests).toHaveLength(0);
});
it("uses the browser's supplied trusted source root for the journal rather than the bundled module location",async()=>{
 await expect(runVerificationOperatorWithHeaders(options(),env,new Headers({cookie}),new AbortController().signal,()=>{},OPERATOR_ROOT+"/missing-source-root")).rejects.toMatchObject({code:"journal"});
 expect(await parents()).toEqual([]);expect(sdk.get).not.toHaveBeenCalled();expect(wire.posts).toHaveLength(0);expect(wire.image.requests).toHaveLength(0);
});
it("passes persisted browser activation pins through the real signed runtime and POST-fenced cleanup",async()=>{
 const browser=await persistedBrowserFixture(),active=await browser.row(),frozen=localOperatorVerificationPins(active,isolated.name),runner=randomUUID();
 expect(active.listingVersion).not.toBe((await new DrizzleListingRepository(db).getById(owner,active.listingId!))!.updatedAt);
 await browser.repo.claimRun(browser.id,browser.actor,active.revision,runner);
 const result=await runVerificationOperatorWithHeaders({...options(),pins:frozen},env,new Headers({cookie}),new AbortController().signal,()=>{},OPERATOR_ROOT);
 expect(result).toMatchObject({exitCode:0,report:{operationSettled:true,accountingComplete:true,outcome:{retrieved:true,visual:{verdict:"match"},acknowledgement:"recorded"},associated:false}});
 expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);
 const settled=await browser.repo.settle(browser.id,owner,runner);
 const cleanupOptions={mode:"cleanup-fixture" as const,pins:localOperatorVerificationPins(settled,isolated.name)};
 expect((await runVerificationOperatorWithHeaders(cleanupOptions,env,new Headers({cookie}),new AbortController().signal,()=>{},OPERATOR_ROOT)).report).toMatchObject({cleanup:{status:"retained"},providerRequests:0});
 // Only this synthetic mutable fixture date changes; no history/guard rewrite.
 await db.update(schema.listingImages).set({providerRetainUntil:sql`clock_timestamp()+interval '80 milliseconds'`}).where(eq(schema.listingImages.id,frozen.image));
 await isolated.pool.query("SELECT pg_sleep_until(provider_retain_until+interval '20 milliseconds') FROM listing_images WHERE id=$1",[frozen.image]);
 const cleaning=await browser.repo.beginCleanup(browser.id,browser.actor,settled.revision);
 const removed=await runVerificationOperatorWithHeaders({mode:"cleanup-fixture",pins:localOperatorVerificationPins(cleaning,isolated.name)},env,new Headers({cookie}),new AbortController().signal,()=>{},OPERATOR_ROOT);
 expect(removed).toMatchObject({exitCode:0,report:{cleanup:{status:"queued"},providerRequests:0,associated:false}});
 await expect(browser.repo.claimRun(browser.id,browser.actor,cleaning.revision,randomUUID())).rejects.toThrow();
 expect((await browser.row()).runStartedAt).not.toBeNull();expect((await parents())[0].postIntentAt).not.toBeNull();
 expect(wire.posts).toHaveLength(1);expect(wire.image.requests).toHaveLength(1);await noAdmission();
});
it("rejects a changed listing after the persisted browser run is consumed without sending",async()=>{
 const browser=await persistedBrowserFixture(),active=await browser.row(),frozen=localOperatorVerificationPins(active,isolated.name);
 const consumed=await browser.repo.claimRun(browser.id,browser.actor,active.revision,randomUUID());
 await db.update(schema.listings).set({updatedAt:sql`clock_timestamp()+interval '1 second'`}).where(eq(schema.listings.id,frozen.listing));
 await expect(runVerificationOperatorWithHeaders({...options(),pins:frozen},env,new Headers({cookie}),new AbortController().signal,()=>{},OPERATOR_ROOT)).rejects.toThrow();
 expect(await browser.row()).toEqual(consumed);expect(await parents()).toEqual([]);expect(await children()).toEqual([]);
 expect(wire.posts).toHaveLength(0);expect(wire.image.requests).toHaveLength(0);await noAdmission();
});
