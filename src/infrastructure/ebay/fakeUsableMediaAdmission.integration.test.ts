import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { authOptions } from "../../auth/options";
import { fakeUsableMediaDatabaseGuards } from "../../test/fakeUsableMediaDatabaseGuards";
import { disposableRealMediaDatabase } from "../../test/disposableRealMediaDatabase";
import { fakeUsableMediaFixture, fakeAdmissionFact, FAKE_LOCATION } from "../../test/fakeUsableMediaFixture";
import { listingFixture } from "../../test/fixtures";
import { generateVerificationFixture } from "../storage/verificationFixture";
import { PHOTO_RECIPE } from "../storage/photoDerivative/transformPhoto";
import { IMAGE_COMPARISON_RECIPE } from "../storage/diagnosticImageDecode";
import { DrizzleEbayRealMediaRepository } from "../repositories/drizzleEbayRealMediaRepository";
import { DrizzleListingRepository } from "../repositories/drizzleListingRepository";
import { mediaSessionHash, realMediaDigest, type RealMediaClaim, type RealMediaReviewGuard } from "../../application/ebayRealMedia";
import { EBAY_DISCOVERY_SCOPES } from "../../application/ebayConnection";
import { createFakeUsableMediaAssessment, FAKE_ADMISSION_CONSUMER, FAKE_ADMISSION_IDENTITY, type FakeAdmissionDependencies, type FakeAdmissionSnapshot } from "./fakeUsableMediaAdmission";
import { syntheticMediaEvidence, admitRealMediaEvidence } from "./realMediaEvidence";
import { mediaRuntime } from "./mediaRuntime";
import { planEbayInventory } from "../../application/ebayInventoryPlanner";
import * as schema from "../db/schema";

const mocks=vi.hoisted(()=>({forbidden:vi.fn(()=>{throw Error("Non-fixture construction forbidden.");})}));
vi.mock("server-only",()=>({}));
vi.mock("dotenv",()=>{throw Error("Private configuration forbidden.");});
vi.mock("../../test/testDatabase",()=>({testDatabaseUrl:()=>process.env.TEST_DATABASE_URL!}));
vi.mock("@vercel/blob",()=>{throw Error("Blob SDK forbidden.");});
vi.mock("./ebayClient",()=>{throw Error("Provider client forbidden.");});
vi.mock("./tokenCipher",()=>{throw Error("Credential client forbidden.");});
vi.mock("node:child_process",()=>({spawn:mocks.forbidden,spawnSync:mocks.forbidden,exec:mocks.forbidden,execSync:mocks.forbidden,execFile:mocks.forbidden,execFileSync:mocks.forbidden,fork:mocks.forbidden}));

let isolated:Awaited<ReturnType<typeof disposableRealMediaDatabase>>,db:typeof isolated.db;
let guards:ReturnType<typeof fakeUsableMediaDatabaseGuards>;
const makeAuth=(database:typeof db)=>betterAuth({...authOptions(database,{BETTER_AUTH_URL:"https://127.0.0.1:3000",BETTER_AUTH_SECRET:randomBytes(32).toString("hex"),GITHUB_CLIENT_ID:"synthetic",GITHUB_CLIENT_SECRET:"synthetic"}),
 session:{expiresIn:604800,updateAge:86400,deferSessionRefresh:true,cookieCache:{enabled:false}},plugins:[testUtils()]});
let auth:ReturnType<typeof makeAuth>,headers:Headers,owner:string,foreign:string,sessionId:string,listing:string,image:string;
let media:DrizzleEbayRealMediaRepository,claim:RealMediaClaim,review:RealMediaReviewGuard;
let deps:FakeAdmissionDependencies,fixture:ReturnType<typeof fakeUsableMediaFixture>,reviewUntil:string;
const config=realMediaDigest("synthetic-assessment-config"),a=schema.ebayRealMediaAttempts,r=schema.ebayRealMediaReceipts;
async function session(){
 const result=await auth.api.getSession({method:"GET",headers,query:{disableRefresh:true,disableCookieCache:true},returnHeaders:true});
 if(!result.response)return null;
 expect(result.headers.has("set-cookie")).toBe(false);
 return {ownerId:result.response.user.id,id:result.response.session.id,expiresAt:result.response.session.expiresAt.toISOString()};
}
async function snapshot(actor:string):Promise<FakeAdmissionSnapshot>{
 const {mediaGrant,accessExpiresAt,...binding}=await media.snapshot(actor,listing,image);
 const row=(await db.select().from(a).where(eq(a.id,claim.id)))[0];
 const connection=(await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,actor)))[0];
 const live=(await db.select().from(schema.sessions).where(eq(schema.sessions.id,sessionId)))[0];
 if(!mediaGrant||!accessExpiresAt||!row?.postIntentAt||!row.leaseUntil||!row.sourceDigest||!row.derivativeDigest||!connection?.refreshExpiresAt||!live)throw Error("Synthetic context missing.");
 return {...binding,environment:"sandbox",attemptId:row.id,operation:row.operation as FakeAdmissionSnapshot["operation"],revision:row.revision,postIntentAt:new Date(row.postIntentAt).toISOString(),actionHash:row.actionHash,sessionHash:row.sessionHash,
  sourceDigest:row.sourceDigest,derivativeDigest:row.derivativeDigest,recipe:row.recipe,comparisonRecipe:IMAGE_COMPARISON_RECIPE,targetField:"maxDimensionImageUrl",consumer:FAKE_ADMISSION_CONSUMER,identityPolicy:FAKE_ADMISSION_IDENTITY,
  sessionExpiresAt:live.expiresAt.toISOString(),accessExpiresAt,refreshExpiresAt:new Date(connection.refreshExpiresAt).toISOString(),reviewUntil,leaseUntil:new Date(row.leaseUntil).toISOString(),disposition:"current"};
}
const parents=()=>db.select().from(a).where(eq(a.ownerId,owner));
async function unchanged(){
 expect(await db.select().from(r).where(eq(r.attemptId,claim.id))).toEqual([]);
 expect(await db.select().from(schema.ebayRealMediaAssociations).where(eq(schema.ebayRealMediaAssociations.attemptId,claim.id))).toEqual([]);
 expect((await parents()).find(p=>p.id===claim.id)).toMatchObject({postIntentAt:expect.any(String),state:"unknown",revision:1});
}
async function createAssessment(){return createFakeUsableMediaAssessment(db,deps,"maxDimensionImageUrl");}
beforeAll(async()=>{guards=fakeUsableMediaDatabaseGuards();isolated=await disposableRealMediaDatabase();db=isolated.db;auth=makeAuth(db);},30_000);
beforeEach(async()=>{
 const h=(await auth.$context).test;owner=(await h.saveUser(h.createUser())).id;foreign=(await h.saveUser(h.createUser())).id;
 const logged=await h.login({userId:owner});headers=logged.headers;sessionId=logged.session.id;
 const generated=await generateVerificationFixture();fixture=fakeUsableMediaFixture(generated.bytes);media=new DrizzleEbayRealMediaRepository(db);reviewUntil=new Date(Date.now()+45_000).toISOString();
 listing=(await new DrizzleListingRepository(db).create(owner,listingFixture())).id;image=randomUUID();
 await db.insert(schema.listingImages).values({id:image,listingId:listing,storageProvider:"vercel-blob",pathname:"synthetic-owned/"+image,originalFilename:"generated.png",contentType:"image/png",byteSize:generated.bytes.length,order:0,uploadedAt:new Date().toISOString()});
 await db.insert(schema.ebayConnections).values({ownerId:owner,id:randomUUID(),version:randomUUID(),configHash:config,status:"connected",sellerId:realMediaDigest(owner),sellerLabel:"Synthetic",scopes:[...EBAY_DISCOVERY_SCOPES],
  access:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},refresh:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},connectedAt:sql`clock_timestamp()`,accessExpiresAt:sql`clock_timestamp()+interval '1 hour'`,refreshExpiresAt:sql`clock_timestamp()+interval '1 day'`});
 const binding=await media.snapshot(owner,listing,image);review={binding,sessionId};
 claim=await media.claim({ownerId:owner,listingId:listing,imageId:image,listingVersion:binding.listingVersion,configHash:config,recipe:PHOTO_RECIPE,sessionHash:mediaSessionHash(owner,sessionId),actionHash:realMediaDigest(randomUUID())},review);
 claim=await media.fence(claim,{sourceDigest:generated.sourceDigest,derivativeDigest:realMediaDigest(generated.bytes),recipe:PHOTO_RECIPE,contentType:"image/png",size:generated.bytes.length,width:500,height:600},review);
 deps={session,snapshot,observation:vi.fn(async()=>fixture.observation)};
});
afterEach(()=>{guards.assertNoExternalAccess();expect(mocks.forbidden).not.toHaveBeenCalled();});
afterAll(async()=>{if(isolated)await isolated.close();guards?.restore();});

it("uses a genuine signed Better Auth session in an actual disposable database and writes no assessment rows",async()=>{
 const before={parents:await parents(),connection:await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,owner)),sessions:await db.select().from(schema.sessions).where(eq(schema.sessions.userId,owner))};
 const service=await createAssessment(),proof=await service.produce(),result=await service.assess(proof);
 expect(result.summary.outcome).toBe("eligible-for-fake-association");expect(result.summary).toMatchObject({simulation:true,realAdmission:false,associated:false,canStage:false,canDelete:false});
 expect((await service.acknowledge(result.evidence,fakeAdmissionFact("response"))).accepted).toBe(true);
 expect(await parents()).toEqual(before.parents);expect(await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,owner))).toEqual(before.connection);
 expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId,owner))).toEqual(before.sessions);await unchanged();
});
it("new assessment proof cannot enter the existing synthetic receipt writer",async()=>{
 const service=await createAssessment(),proof=await service.produce(),result=await service.assess(proof);
 await expect(media.acknowledge(claim,proof,{guard:review,responseOnly:false})).rejects.toMatchObject({code:"contract"});
 await expect(media.acknowledge(claim,result.evidence,{guard:review,responseOnly:false})).rejects.toMatchObject({code:"contract"});await unchanged();
});
it("retains a legitimate legacy fixed-grammar receipt/association control with independent resource and visual IDs",async()=>{
 const proof=await syntheticMediaEvidence(db,owner,claim.id,{status:201,location:FAKE_LOCATION,body:{imageUrl:"https://eps-contract.invalid.test/photo/test_visual_"+"b".repeat(16)+".png",expirationDate:new Date(Date.now()+3600000).toISOString()}});
 expect(await media.acknowledge(claim,proof,{guard:review,responseOnly:false})).toEqual({state:"confirmed",associated:true});
 const rows=await db.select().from(r).where(eq(r.attemptId,claim.id));expect(rows).toHaveLength(1);expect(rows[0].resourceId).not.toBe(rows[0].imageUrl?.split("/").pop());
 expect(()=>admitRealMediaEvidence(proof)).toThrow();
});
it.each(["real-contract","real-url","query-url"])("SQL continues rejecting %s without changing its synthetic constraints",async kind=>{
 const imageUrl="https://eps-contract.invalid.test/photo/test_visual_"+"b".repeat(16)+".png";
 await expect(db.insert(r).values({id:randomUUID(),attemptId:claim.id,contractVersion:kind==="real-contract"?"real-media-v1":"synthetic-real-media-v1",fingerprint:realMediaDigest(randomUUID()),level:"complete",resourceId:"test_resource_"+"a".repeat(16),location:FAKE_LOCATION,
  imageUrl:kind==="real-url"?"https://i.sandbox.ebayimg.com/unrequested.png":kind==="query-url"?imageUrl+"?opaque=synthetic":imageUrl,maximumUrl:null,responseStatus:201,expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:new Date().toISOString()})).rejects.toThrow();
 await unchanged();
});
it("cross-owner signed session and revoked/tampered sessions cannot borrow a proof",async()=>{
 const service=await createAssessment(),proof=await service.produce();headers=(await (await auth.$context).test.login({userId:foreign})).headers;
 expect((await service.assess(proof)).summary.outcome).toBe("refused");await unchanged();
 const logged=await (await auth.$context).test.login({userId:owner});headers=logged.headers;sessionId=logged.session.id;
 // A new signed session cannot match the original consumed action/session binding.
 await expect((await createAssessment()).produce()).rejects.toThrow();
 headers=new Headers({cookie:"__Secure-better-auth.session_token=tampered-synthetic"});await expect((await createAssessment()).produce()).rejects.toThrow();
});
it("deletion detaches only product links, preserves evidence/fences and blocks owner erasure",async()=>{
 const service=await createAssessment(),result=await service.assess(await service.produce());
 await db.delete(schema.listings).where(eq(schema.listings.id,listing));
 expect((await service.status(result.evidence)).outcome).toBe("refused");expect(await parents()).toHaveLength(1);
 await expect(db.delete(schema.users).where(eq(schema.users.id,owner))).rejects.toThrow();
 await expect(db.delete(a).where(eq(a.id,claim.id))).rejects.toThrow();
});
it("a reconnect version change retires eligibility and cannot restore it by copying the old version",async()=>{
 const service=await createAssessment(),result=await service.assess(await service.produce());
 const [old]=await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,owner));
 await db.update(schema.ebayConnections).set({version:randomUUID()}).where(eq(schema.ebayConnections.ownerId,owner));
 expect((await service.status(result.evidence)).outcome).toBe("refused");
 await db.update(schema.ebayConnections).set({version:old.version}).where(eq(schema.ebayConnections.ownerId,owner));
 expect((await service.status(result.evidence)).outcome).toBe("refused");await unchanged();
});
it("capture-only/diagnostic parent remains ineligible in the assessment and SQL receipt admission",async()=>{
 const generated=await generateVerificationFixture(),id=randomUUID();
 await db.insert(schema.listingImages).values({id,listingId:listing,storageProvider:"vercel-blob",pathname:"synthetic-owned/"+id,originalFilename:"generated.png",contentType:"image/png",byteSize:generated.bytes.length,order:1,uploadedAt:new Date().toISOString()});
 image=id;fixture=fakeUsableMediaFixture(generated.bytes);const binding=await media.snapshot(owner,listing,image);review={binding,sessionId,leaseDeadline:new Date(Date.now()+30_000).toISOString()};
 claim=await media.claim({ownerId:owner,listingId:listing,imageId:image,listingVersion:binding.listingVersion,configHash:config,recipe:PHOTO_RECIPE,operation:"capture-only",sessionHash:mediaSessionHash(owner,sessionId),actionHash:realMediaDigest(randomUUID())},review);
 claim=await media.fence(claim,{sourceDigest:generated.sourceDigest,derivativeDigest:realMediaDigest(generated.bytes),recipe:PHOTO_RECIPE,contentType:"image/png",size:generated.bytes.length,width:500,height:600},review);
 await expect((await createAssessment()).produce()).rejects.toThrow();
 const proof=await syntheticMediaEvidence(db,owner,claim.id,{status:201,location:FAKE_LOCATION,body:{imageUrl:"https://eps-contract.invalid.test/photo/test_visual_"+"b".repeat(16)+".png",expirationDate:new Date(Date.now()+3600000).toISOString()}});
 await expect(media.acknowledge(claim,proof,{guard:review,responseOnly:false})).rejects.toThrow();await unchanged();
});
it.each(["session","access","refresh"] as const)("refuses real %s expiry while its final context snapshot waits on a demonstrated database lock",async kind=>{
 const expiry=new Date(String((await db.execute(sql`SELECT (clock_timestamp()+interval '4 seconds')::text AS value`)).rows[0].value));
 if(kind==="session")await db.update(schema.sessions).set({expiresAt:expiry}).where(eq(schema.sessions.id,sessionId));
 else await db.update(schema.ebayConnections).set(kind==="access"?{accessExpiresAt:expiry.toISOString()}:{refreshExpiresAt:expiry.toISOString()}).where(eq(schema.ebayConnections.ownerId,owner));
 const service=await createAssessment(),proof=await service.produce(),before=await parents();
 const blocker=await isolated.pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM listings WHERE id=$1 FOR UPDATE',[listing]);const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=service.assess(proof);let waiting=false;
  for(let n=0;n<100;n++){
   waiting=(await isolated.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))) AS waiting",[pid])).rows[0].waiting;
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(waiting).toBe(true);let expired=false;
  for(let n=0;n<100;n++){
   expired=(await isolated.pool.query('SELECT clock_timestamp()>=$1::timestamptz AS expired',[expiry])).rows[0].expired;
   if(expired)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  expect(expired).toBe(true);await blocker.query('ROLLBACK');
  const result=await pending as Awaited<ReturnType<typeof service.assess>>;expect(result.summary.outcome).toBe("refused");
  expect(await parents()).toEqual(before);await unchanged();
 }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
},10_000);
it("keeps normal runtime, real admission and Inventory request building disabled",()=>{
 expect(mediaRuntime()).toEqual({enabled:false});expect(()=>admitRealMediaEvidence({validated:true})).toThrow();
 expect(planEbayInventory({} as Parameters<typeof planEbayInventory>[0],"invalid")).toMatchObject({canStage:false,blockers:["media-admission-disabled","staging-disabled","invalid-snapshot"]});
});
