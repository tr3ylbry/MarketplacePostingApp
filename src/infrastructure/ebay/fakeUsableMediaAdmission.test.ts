// @vitest-environment node
import "../../test/offlinePrototypeGuards";
import { Hash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { acquirePhotoCapacity, releasePhotoCapacity } from "../../application/photoCapacity";
import { realMediaDigest } from "../../application/ebayRealMedia";
import { generateVerificationFixture } from "../storage/verificationFixture";
import { fakeUsableMediaFixture, fakeAdmissionFact, FAKE_PRIMARY, FAKE_MAXIMUM } from "../../test/fakeUsableMediaFixture";
import { createFakeUsableMediaAssessment, type FakeAdmissionSnapshot } from "./fakeUsableMediaAdmission";
import { mediaRuntime } from "./mediaRuntime";
import { admitRealMediaEvidence } from "./realMediaEvidence";

vi.mock("server-only",()=>({}));
vi.mock("./ebayClient",()=>{throw Error("Provider construction forbidden.");});
vi.mock("./tokenCipher",()=>{throw Error("Credential construction forbidden.");});
let reference:Buffer, smallPng:Buffer, smallJpeg:Buffer, different:Buffer;
beforeAll(async()=>{
 reference=(await generateVerificationFixture()).bytes;different=(await generateVerificationFixture()).bytes;
 const raw=Buffer.alloc(334*400*3,200);
 smallPng=await sharp(raw,{raw:{width:334,height:400,channels:3}}).png().toBuffer();
 smallJpeg=await sharp(raw,{raw:{width:334,height:400,channels:3}}).jpeg().toBuffer();raw.fill(0);
});
afterEach(()=>vi.unstubAllEnvs());
const database=(name="marketplace_real_media_"+"d".repeat(24)+"_test")=>({execute:vi.fn(async()=>({rows:[{name}]}))}) as unknown as Pick<NodePgDatabase<typeof schema>,"execute">;
async function setup(field:FakeAdmissionSnapshot["targetField"]="maxDimensionImageUrl"){
 const h=fakeUsableMediaFixture(reference,field),observe=vi.fn(h.deps.observation);h.deps.observation=observe;
 const assessment=await createFakeUsableMediaAssessment(database(),h.deps,field);
 return {...h,observe,assessment,async complete(){const proof=await assessment.produce();return {...await assessment.assess(proof),proof};}};
}

it.each(["imageUrl","maxDimensionImageUrl"] as const)("legitimate %s proof requires actual frozen full comparison and remains fake-only",async field=>{
 const h=await setup(field),before=realMediaDigest(Buffer.from(h.observation.reference)),r=await h.complete();
 expect(r.summary).toMatchObject({simulation:true,realAdmission:false,associated:false,canStage:false,canDelete:false,outcome:"eligible-for-fake-association",currentAssociation:"not-created",
  evidence:{provenance:"passed",imageValidation:"passed",resourceIdentity:"passed",urlEligibility:"passed"}});
 expect(Object.isFrozen(r.summary)).toBe(true);expect(Object.isFrozen(r.summary.evidence)).toBe(true);
 expect(JSON.stringify(r.proof)).toBe("{}");expect(JSON.stringify(r.evidence)).toBe("{}");expect(h.observe).toHaveBeenCalledTimes(1);
 expect(realMediaDigest(Buffer.from(h.observation.reference))).toBe(before);expect(realMediaDigest(Buffer.from(h.observation.image.bytes))).toBe(before);
 expect(JSON.stringify(r.summary)).not.toMatch(/https:|opaque|test_resource|test_visual|cipher|session_token|sourceDigest/);
 expect(mediaRuntime()).toEqual({enabled:false});expect(()=>admitRealMediaEvidence(r.proof)).toThrow();
});
it.each(["production","development"])("refuses construction in %s even with a test-looking database",async mode=>{
 vi.stubEnv("NODE_ENV",mode);const db=database();await expect(createFakeUsableMediaAssessment(db,fakeUsableMediaFixture(reference).deps,"imageUrl")).rejects.toMatchObject({code:"disabled"});expect(db.execute).not.toHaveBeenCalled();
});
it("refuses Vercel and actual non-disposable database identity",async()=>{
 await expect(createFakeUsableMediaAssessment(database("marketplace_development"),fakeUsableMediaFixture(reference).deps,"imageUrl")).rejects.toMatchObject({code:"disabled"});
 vi.stubEnv("VERCEL","1");const db=database();await expect(createFakeUsableMediaAssessment(db,fakeUsableMediaFixture(reference).deps,"imageUrl")).rejects.toMatchObject({code:"disabled"});expect(db.execute).not.toHaveBeenCalled();
});
it("sanitizes database construction failure without raw causes",async()=>{
 const db={execute:vi.fn(async()=>{throw Error("Bearer private connection");})} as unknown as Pick<NodePgDatabase<typeof schema>,"execute">;
 try{await createFakeUsableMediaAssessment(db,fakeUsableMediaFixture(reference).deps,"imageUrl");throw Error("expected refusal");}catch(error){expect(String(error)).not.toMatch(/Bearer|private|connection/);expect(error).not.toHaveProperty("cause");}
});
it.each([null,{},Object.freeze({validated:true,match:true}),"serialized-proof"])("refuses arbitrary proof reference %j",async proof=>{
 const h=await setup();expect((await h.assessment.assess(proof)).summary.outcome).toBe("refused");expect(h.observe).not.toHaveBeenCalled();
});
it("rejects copied, serialized and wrong-issuer proofs without consuming the correct issuer's proof",async()=>{
 const a=await setup(),b=await setup(),proof=await a.assessment.produce();
 for(const v of [{...proof},JSON.parse(JSON.stringify(proof)),Object.freeze({})])expect((await a.assessment.assess(v)).summary.outcome).toBe("refused");
 expect((await b.assessment.assess(proof)).summary.outcome).toBe("refused");expect((await a.assessment.assess(proof)).summary.outcome).toBe("eligible-for-fake-association");
 expect((await a.assessment.assess(proof)).summary.outcome).toBe("refused");
});
it("burns proof consumption before asynchronous context reads and serializes concurrent assessment",async()=>{
 const h=await setup(),proof=await h.assessment.produce();
 const r=await Promise.all([h.assessment.assess(proof),h.assessment.assess(proof)]);
 expect(r.filter(x=>x.summary.outcome==="eligible-for-fake-association")).toHaveLength(1);expect(r.filter(x=>x.evidence===null)).toHaveLength(1);
 await expect(h.assessment.produce()).rejects.toThrow();expect(h.observe).toHaveBeenCalledTimes(1);
});
const changes:Partial<Record<keyof FakeAdmissionSnapshot,unknown>>={ownerId:randomUUID(),environment:"production",attemptId:randomUUID(),operation:"capture-only",revision:2,postIntentAt:new Date(Date.now()-5000).toISOString(),
 actionHash:realMediaDigest("other-action"),sessionHash:realMediaDigest("other-session"),sellerKey:realMediaDigest("other-seller"),connectionId:randomUUID(),connectionVersion:randomUUID(),configHash:realMediaDigest("other-config"),grantHash:realMediaDigest("other-grant"),
 listingId:randomUUID(),listingVersion:new Date(Date.now()-8000).toISOString(),imageId:randomUUID(),sourceVersion:realMediaDigest("other-source-version"),imageOrder:1,sourceDigest:realMediaDigest("other-source"),derivativeDigest:realMediaDigest("other-derivative"),
 recipe:"unreviewed-recipe",comparisonRecipe:"unreviewed-comparison",targetField:"imageUrl",consumer:"inventory-item-image",identityPolicy:"operator-asserted",disposition:"detached"};
it.each(Object.entries(changes))("refuses changed trusted %s after issuance",async(key,value)=>{
 const h=await setup(),proof=await h.assessment.produce();Object.assign(h.snapshot,{[key]:value});expect((await h.assessment.assess(proof)).summary.outcome).toBe("refused");
});
it.each(["sessionExpiresAt","accessExpiresAt","refreshExpiresAt","reviewUntil","leaseUntil"] as const)("refuses elapsed %s and does not extend original deadlines",async key=>{
 const h=await setup();h.snapshot[key]=new Date(Date.now()+10_000).toISOString();if(key==="sessionExpiresAt")h.actor.expiresAt=h.snapshot[key];
 const proof=await h.assessment.produce();h.advance(10_001);expect((await h.assessment.assess(proof)).summary.outcome).toBe("refused");
});
it("refuses expiry at the exact boundary and backward wall/monotonic clocks",async()=>{
 const h=await setup(),proof=await h.assessment.produce();h.advance(30_000);expect((await h.assessment.assess(proof)).summary.outcome).toBe("refused");
 const j=await setup(),p=await j.assessment.produce();j.advance(-1000);expect((await j.assessment.assess(p)).summary.outcome).toBe("refused");
});
it("samples current time after a blocking snapshot instead of accepting its earlier session context",async()=>{
 const h=await setup(),proof=await h.assessment.produce();
 h.deps.snapshot=vi.fn(async()=>{h.advance(70_000);return {...h.snapshot};});
 expect((await h.assessment.assess(proof)).summary.outcome).toBe("refused");expect(h.observe).toHaveBeenCalledTimes(1);
});
it("checks a live authenticated session rather than a submitted owner/session ID",async()=>{
 const h=await setup(),proof=await h.assessment.produce();h.deps.session=async()=>null;expect((await h.assessment.assess(proof)).summary.outcome).toBe("refused");
 const j=await setup(),p=await j.assessment.produce();j.actor.id=randomUUID();expect((await j.assessment.assess(p)).summary.outcome).toBe("refused");
});
it("does not reactivate a retired projection after context is restored",async()=>{
 const h=await setup(),r=await h.complete();h.snapshot.disposition="detached";expect((await h.assessment.status(r.evidence)).outcome).toBe("refused");
 h.snapshot.disposition="current";expect((await h.assessment.status(r.evidence)).outcome).toBe("refused");expect(r.summary.evidence.imageValidation).toBe("passed");
});
it.each([null,undefined,17,{},"https://foreign.invalid.test/image.png",FAKE_MAXIMUM+"#fragment",FAKE_MAXIMUM+"%00",FAKE_MAXIMUM+"%25",FAKE_MAXIMUM+"%zz"])("refuses missing/unsafe maximum without primary fallback: %j",async value=>{
 const h=await setup();h.setBody({maxDimensionImageUrl:value});expect((await h.complete()).summary.outcome).toBe("refused");expect(h.observe).toHaveBeenCalledTimes(1);
});
it("does not transfer primary validation to maximum or equate independent API and visual IDs",async()=>{
 const h=await setup();h.observation.image.target=FAKE_PRIMARY;expect((await h.complete()).summary.outcome).toBe("refused");
 const j=await setup();expect((await j.complete()).summary.evidence.resourceIdentity).toBe("passed");
});
it.each(["?z=2&z=1&opaque=A%2fb+Q&empty=", "?", "?opaque=%3F%23%40%3A%2F"])("preserves the exact invented opaque query %s without public exposure",async query=>{
 const h=await setup(),target=FAKE_MAXIMUM.split("?")[0]+query;h.setBody({maxDimensionImageUrl:target});h.observation.image.target=target;
 const r=await h.complete();expect(r.summary.outcome).toBe("eligible-for-fake-association");expect(JSON.stringify(r)).not.toContain(target);expect(JSON.stringify(r)).not.toContain("opaque");
});
it.each([true,false])("never logs or fingerprints the complete capability (query=%s)",async query=>{
 const logs=["log","info","warn","error"].map(key=>vi.spyOn(console,key as "log").mockImplementation(()=>{}));
 const update=Hash.prototype.update;let capabilityHashes=0;
 const hashing=vi.spyOn(Hash.prototype,"update").mockImplementation(function(this:Hash,...args:Parameters<Hash["update"]>){
  const value=args[0];
  const text=typeof value==="string"?value:Buffer.from(value as Uint8Array).toString("utf8");
  if(text.includes("opaque=")||text.includes("eps-contract.invalid.test"))capabilityHashes++;
  return Reflect.apply(update,this,args);
 });
 try{const h=await setup();if(!query){const primary=FAKE_PRIMARY.split("?")[0],maximum=FAKE_MAXIMUM.split("?")[0];h.setBody({imageUrl:primary,maxDimensionImageUrl:maximum});h.observation.image.target=maximum;}
  expect((await h.complete()).summary.outcome).toBe("eligible-for-fake-association");expect(capabilityHashes).toBe(0);for(const log of logs)expect(log).not.toHaveBeenCalled();}
 finally{hashing.mockRestore();for(const log of logs)log.mockRestore();}
});
it.each([FAKE_MAXIMUM.replace("%2f","/"),FAKE_MAXIMUM.replace("&x=&x=2","&x=2&x="),FAKE_MAXIMUM.split("?")[0]])("changed opaque target bytes cannot borrow the proof: %s",async target=>{
 const h=await setup();h.observation.image.target=target;expect((await h.complete()).summary.outcome).toBe("refused");
});
it("equal selected fields still produce one consumed proof and no new URL accessor",async()=>{
 const h=await setup();h.setBody({imageUrl:FAKE_MAXIMUM});const r=await h.complete();expect(r.summary.outcome).toBe("eligible-for-fake-association");
 expect((await h.assessment.assess(r.proof)).summary.outcome).toBe("refused");expect(h.assessment).not.toHaveProperty("url");expect(h.assessment).not.toHaveProperty("download");
});
it.each(["validated","match","settled"])("caller-supplied %s cannot issue validation authority",async key=>{
 const h=await setup();Object.assign(h.observation,{[key]:true});const r=await h.complete();expect(r.summary.outcome).toBe("refused");
});
it.each([200,302,400,500])("fake response status %s cannot establish create provenance",async status=>{
 const h=await setup();h.observation.response.status=status;expect((await h.complete()).summary.evidence.provenance).toBe("failed");
});
it.each(["missing-location","duplicate-header","odd-headers","duplicate-json","extra-json","bad-expiry","expired-image"])("rejects malformed provenance/identity: %s",async kind=>{
 const h=await setup();
 if(kind==="missing-location")h.observation.response.rawHeaders=["Content-Type","application/json"];
 if(kind==="duplicate-header")h.observation.response.rawHeaders.push("Location",h.observation.response.rawHeaders[3]);
 if(kind==="odd-headers")h.observation.response.rawHeaders.push("Extra");
 if(kind==="duplicate-json")h.observation.response.body=Buffer.from('{"expirationDate":"2030-01-01T00:00:00Z","expirationDate":"2031-01-01T00:00:00Z"}');
 if(kind==="extra-json")h.setBody({validated:true});
 if(kind==="bad-expiry")h.setBody({expirationDate:"not-a-date"});
 if(kind==="expired-image")h.setBody({expirationDate:new Date(Date.now()+59_000).toISOString()});
 expect((await h.complete()).summary.outcome).toBe("refused");
});
it.each(["header-only","334x400-png","334x400-jpeg","wrong-marker","wrong-reference","oversized-response","oversized-image"])("requires complete frozen image validation: %s",async kind=>{
 const h=await setup();
 if(kind==="header-only")h.observation.image.bytes=reference.subarray(0,24);
 if(kind==="334x400-png")h.observation.image.bytes=smallPng;
 if(kind==="334x400-jpeg"){h.observation.image.bytes=smallJpeg;h.observation.image.mime="image/jpeg";}
 if(kind==="wrong-marker")h.observation.image.bytes=different;
 if(kind==="wrong-reference")h.observation.reference=different;
 if(kind==="oversized-response")h.observation.response.body=Buffer.alloc(65_537);
 if(kind==="oversized-image")h.observation.image.bytes=Buffer.alloc(1_048_577);
 expect((await h.complete()).summary.outcome).toBe("refused");
});
it("keeps cancellation one-use and holds capacity until the actual producer settles",async()=>{
 const h=await setup(),controller=new AbortController();let finish!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(resolve=>{entered=resolve;});h.deps.observation=async()=>{entered();await new Promise<void>(resolve=>{finish=resolve;});return h.observation;};
 const producing=h.assessment.produce(controller.signal);await waiting;controller.abort();
 const second=acquirePhotoCapacity();expect(()=>acquirePhotoCapacity()).toThrow();releasePhotoCapacity(second);
 finish();const proof=await producing;expect((await h.assessment.assess(proof)).summary.outcome).toBe("refused");
 const free=acquirePhotoCapacity();releasePhotoCapacity(free);await expect(h.assessment.produce()).rejects.toThrow();
});
it("cancellation during assessment burns the proof without creating new work",async()=>{
 const h=await setup(),proof=await h.assessment.produce(),c=new AbortController();c.abort();
 expect((await h.assessment.assess(proof,c.signal)).summary.reasons).toContain("cancelled");expect((await h.assessment.assess(proof)).evidence).toBeNull();
});
it("models four distinct facts, concurrent idempotent acknowledgements and safe overflow",async()=>{
 const h=await setup(),r=await h.complete(),fact=fakeAdmissionFact("response");
 const repeated=await Promise.all(Array.from({length:8},()=>h.assessment.acknowledge(r.evidence,fact)));
 expect(repeated.filter(x=>!x.duplicate)).toHaveLength(1);expect(repeated.every(x=>x.distinctFacts===1)).toBe(true);
 for(const kind of ["validation","identity","settlement"] as const)expect((await h.assessment.acknowledge(r.evidence,fakeAdmissionFact(kind))).accepted).toBe(true);
 const over=await h.assessment.acknowledge(r.evidence,fakeAdmissionFact("response","refused"));
 expect(over).toMatchObject({accepted:false,distinctFacts:4,overflow:true,conflict:true});expect(over.summary.outcome).toBe("refused");
 expect((await h.assessment.acknowledge(r.evidence,fact)).summary.outcome).toBe("refused");
});
it("accepts an exact2048-byte envelope but rejects2049 before parsing, without storing it",async()=>{
 const h=await setup(),r=await h.complete(),raw=fakeAdmissionFact("response");
 const exact=Buffer.concat([raw,Buffer.alloc(2048-raw.length,32)]);expect((await h.assessment.acknowledge(r.evidence,exact)).accepted).toBe(true);
 const over=await h.assessment.acknowledge(r.evidence,Buffer.concat([exact,Buffer.from(" ")]));
 expect(over.overflow).toBe(true);expect(over.distinctFacts).toBe(1);expect(over.summary.outcome).toBe("refused");
});
it.each(['{"version":"fake-admission-fact-v1","url":"https://sensitive.invalid/?opaque=secret"}', '{"kind":"response","kind":"validation"}', '{"validated":true}', 'not-json'])("malformed/private facts are refused and never reflected",async raw=>{
 const h=await setup(),r=await h.complete(),ack=await h.assessment.acknowledge(r.evidence,Buffer.from(raw));
 expect(ack.accepted).toBe(false);expect(ack.summary.outcome).toBe("refused");expect(JSON.stringify(ack)).not.toMatch(/https:|opaque|secret|not-json/);
});
it("late facts remain recordable but cannot activate an expired association",async()=>{
 const h=await setup(),r=await h.complete();h.advance(70_000);
 const ack=await h.assessment.acknowledge(r.evidence,fakeAdmissionFact("settlement"));expect(ack.accepted).toBe(true);expect(ack.summary.outcome).toBe("refused");
 expect(ack.summary.evidence.imageValidation).toBe("passed");expect(h.observe).toHaveBeenCalledTimes(1);
});
it("a copied acknowledgement handle and an environment change cannot borrow authority",async()=>{
 const h=await setup(),r=await h.complete();expect((await h.assessment.acknowledge({...r.evidence},fakeAdmissionFact("response"))).accepted).toBe(false);
 vi.stubEnv("NODE_ENV","production");expect((await h.assessment.status(r.evidence)).outcome).toBe("refused");
 expect((await h.assessment.acknowledge(r.evidence,fakeAdmissionFact("response"))).accepted).toBe(false);
});
it("producer failure is bounded, one-use and releases only its own settled capacity",async()=>{
 const h=await setup();h.deps.observation=async()=>{throw Error("Bearer private URL https://sensitive.invalid/?opaque=secret");};
 const proof=await h.assessment.produce(),r=await h.assessment.assess(proof);
 expect(r.summary.outcome).toBe("refused");expect(JSON.stringify(r)).not.toMatch(/Bearer|https:|opaque|secret/);await expect(h.assessment.produce()).rejects.toThrow();
 const free=acquirePhotoCapacity();releasePhotoCapacity(free);
});
it("a failing trusted clock refuses safely instead of leaking its error",async()=>{
 const j=await setup();let fail=false;const clock=j.deps.clock!;j.deps.clock=()=>{if(fail)throw Error("private-clock");return clock();};
 const service=await createFakeUsableMediaAssessment(database(),j.deps,"maxDimensionImageUrl"),p=await service.produce();fail=true;
 const result=await service.assess(p);expect(result.summary.outcome).toBe("refused");expect(JSON.stringify(result)).not.toContain("private-clock");
});
