// @vitest-environment node
import { randomUUID } from "node:crypto";
import { listingFixture } from "../test/fixtures";
import { preparationSelection,requirementsFixture } from "../test/ebay/preparationFixtures";
import { boundedInspection,unknownInspection,type InspectionDependencies,type InspectionFixture,type InspectionSnapshot } from "./ebayInventoryInspection";
import { createInventoryInspection } from "./ebayInventoryInspectionService";
import { inventoryDigest } from "./ebayInventoryPersistence";
const complete=():InspectionFixture=>({version:"inventory-inspection-fixture-v1",samples:[{...unknownInspection(),item:"absent",offersComplete:true,groups:"none",listings:"none",code:"none"}]});
function setup(workMs?:number) {
  const at=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString(),listing=listingFixture();
  const snapshot:InspectionSnapshot={listing,binding:{ownerId:"owner",listingId:listing.id,listingVersion:listing.updatedAt,environment:"sandbox",sellerKey:inventoryDigest("seller"),
    connectionId:"connection",connectionVersion:"version",configHash:inventoryDigest("config"),grantHash:inventoryDigest("grant")},photos:[],sessionExpiresAt:expiresAt,credentialExpiresAt:expiresAt,checkedAt:at};
  const actor={ownerId:"owner",id:"session",expiresAt};
  const repository={claim:vi.fn<InspectionDependencies["repository"]["claim"]>(async()=>({id:randomUUID(),resourceId:randomUUID(),ownerId:"owner",token:randomUUID(),revision:0,actionHash:inventoryDigest("action"),sessionHash:inventoryDigest("session")})),
    acknowledge:vi.fn<InspectionDependencies["repository"]["acknowledge"]>(async()=>({revision:1,late:false}))};
  const deps:InspectionDependencies={session:vi.fn(async()=>({...actor})),load:vi.fn(async()=>snapshot),time:vi.fn(async()=>new Date().toISOString()),
    lease:vi.fn(async()=>new Date(Date.now()+60000).toISOString()),repository,observer:{inspect:vi.fn(async()=>complete())},planning:()=>({selection:preparationSelection(),requirements:requirementsFixture()})};
  return {deps,repository,actor,snapshot,workflow:createInventoryInspection(deps,workMs)};
}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it("prepares locally and permanently refuses writes after a valid synthetic inspection",async()=>{
  const h=setup(),review=await h.workflow.prepare(h.snapshot.listing.id);
  expect(h.repository.claim).not.toHaveBeenCalled();expect(h.deps.observer.inspect).not.toHaveBeenCalled();
  const value=await h.workflow.confirm(review);expect(value).toMatchObject({state:"refused",simulation:true,ownership:"unproven",canStage:false,canDelete:false});
  expect(h.repository.claim.mock.calls[0]?.[0]).toMatchObject({operation:"inspect",ownerId:"owner",sessionId:"session"});
  expect(value.reasons).toContain("external-create-race");expect(value.reasons).toContain("media-admission-disabled");
  expect(JSON.stringify(value)).not.toMatch(/seller|token|path|http|digest|credential/);
});
it.each(["copy","serialize","instance"])("rejects %s reviews and replay",async kind=>{
  const h=setup(),review=await h.workflow.prepare(h.snapshot.listing.id),other=createInventoryInspection(h.deps);
  await expect(kind==="instance"?other.confirm(review):h.workflow.confirm(kind==="copy"?{...review}:JSON.parse(JSON.stringify(review)))).rejects.toMatchObject({code:"stale"});
  await h.workflow.confirm(review);await expect(h.workflow.confirm(review)).rejects.toMatchObject({code:"stale"});expect(h.deps.observer.inspect).toHaveBeenCalledTimes(1);
});
it("consumes confirmation synchronously under concurrent replay",async()=>{
  const h=setup(),review=await h.workflow.prepare(h.snapshot.listing.id),results=await Promise.allSettled([h.workflow.confirm(review),h.workflow.confirm(review)]);
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(h.deps.observer.inspect).toHaveBeenCalledTimes(1);
});
it.each(["owner","session","listing","connection"])("rejects changed %s context before observation",async kind=>{
  const h=setup(),review=await h.workflow.prepare(h.snapshot.listing.id);
  if(kind==="owner")h.actor.ownerId="foreign";if(kind==="session")h.actor.id="other";
  if(kind==="listing")h.snapshot.binding.listingVersion=new Date(Date.now()+1).toISOString();if(kind==="connection")h.snapshot.binding.connectionVersion="other";
  expect(await h.workflow.confirm(review)).toMatchObject({state:"unknown",canStage:false});expect(h.deps.observer.inspect).not.toHaveBeenCalled();
  await expect(h.workflow.confirm(review)).rejects.toMatchObject({code:"stale"});
});
it("expires reviews on elapsed time without reusable confirmation",async()=>{
  vi.useFakeTimers();const h=setup(),review=await h.workflow.prepare(h.snapshot.listing.id);vi.advanceTimersByTime(300001);
  expect(await h.workflow.confirm(review)).toMatchObject({state:"unknown"});expect(h.repository.claim).not.toHaveBeenCalled();
});
it("cancellation before work burns the review without observing",async()=>{
  const h=setup(),review=await h.workflow.prepare(h.snapshot.listing.id),c=new AbortController();c.abort();
  expect(await h.workflow.confirm(review,c.signal)).toMatchObject({state:"cancelled"});expect(h.deps.observer.inspect).not.toHaveBeenCalled();
});
it("holds shared capacity until cancelled owned work settles",async()=>{
  const h=setup(),pending=deferred<unknown>(),entered=deferred<void>(),c=new AbortController();let calls=0;
  h.deps.observer.inspect=vi.fn(async()=>{if(++calls===2)entered.resolve();return pending.promise;});
  const one=h.workflow.confirm(await h.workflow.prepare(h.snapshot.listing.id),c.signal),two=h.workflow.confirm(await h.workflow.prepare(h.snapshot.listing.id),c.signal);
  await entered.promise;c.abort();const review=await h.workflow.prepare(h.snapshot.listing.id);await expect(h.workflow.confirm(review)).rejects.toMatchObject({code:"busy"});
  pending.resolve(complete());expect((await Promise.all([one,two])).every(x=>x.state==="cancelled")).toBe(true);
  expect(await h.workflow.confirm(await h.workflow.prepare(h.snapshot.listing.id))).toHaveProperty("state","refused");
});
it("retries an identical local acknowledgement without another observation",async()=>{
  const h=setup();h.repository.acknowledge.mockRejectedValueOnce(new Error("Synthetic lost acknowledgement"));
  expect(await h.workflow.confirm(await h.workflow.prepare(h.snapshot.listing.id))).toHaveProperty("state","refused");
  expect(h.deps.observer.inspect).toHaveBeenCalledTimes(1);expect(h.repository.acknowledge).toHaveBeenCalledTimes(2);
  expect(h.repository.acknowledge.mock.calls[0]).toEqual(h.repository.acknowledge.mock.calls[1]);
});
it("bounds oversized samples before traversing them",()=>{
  const samples=new Array(4);Object.defineProperty(samples,0,{get(){throw new Error("must not traverse");}});
  expect(boundedInspection({version:"inventory-inspection-fixture-v1",samples})).toMatchObject({overflow:true,samples:[{item:"unknown",code:"integrity"}]});
});
it("bounds oversized references before traversing or serializing them",()=>{
  const f=complete(),refs=new Array(251);Object.defineProperty(refs,0,{get(){throw new Error("must not traverse");}});f.samples[0].related=refs;
  expect(boundedInspection(f)).toMatchObject({overflow:true,samples:[{item:"unknown",code:"integrity",related:[]}]});
});
it.each(["unknown-field","identifier","version","too-many-total-references"])("fails closed for %s fixture data",kind=>{
  const f=complete();if(kind==="unknown-field")Object.assign(f.samples[0],{url:"https://private.invalid"});if(kind==="identifier")f.samples[0].related=[{kind:"offer",id:"x".repeat(201)}];
  if(kind==="version")Object.assign(f,{version:"provider-contract"});if(kind==="too-many-total-references")f.samples=Array.from({length:3},()=>({...complete().samples[0],related:Array.from({length:84},(_,i)=>({kind:"offer" as const,id:"ref_"+i}))}));
  expect(boundedInspection(f)).toMatchObject({overflow:true,samples:[{code:"integrity",item:"unknown"}]});
});
it("accepts bounded legitimate controls and preserves explicit recreation warnings",()=>{
  const f=complete();f.samples[0].code="recreation";f.samples[0].related=[{kind:"group",id:"x".repeat(200)}];
  expect(boundedInspection(f)).toEqual({samples:f.samples,overflow:false});
});
it.each(["recreation","conflict"] as const)("overflow preserves a known %s warning",code=>{
  const f=complete();f.samples[0].code=code;f.samples[0].related=new Array(251);
  expect(boundedInspection(f)).toMatchObject({overflow:true,samples:[{code,item:"unknown",related:[]}]});
});
it("keeps preparation failures generic without exposing source/provider details",async()=>{
  const h=setup();h.deps.load=vi.fn(async()=>{throw new Error("synthetic-private-provider-details");});
  await expect(h.workflow.prepare(h.snapshot.listing.id)).rejects.toMatchObject({code:"unavailable",message:"The simulated inspection could not be completed."});
});
it("uses trusted database time to refuse expired work despite a lagging process clock",async()=>{
  const h=setup(),review=await h.workflow.prepare(h.snapshot.listing.id);
  h.deps.time=vi.fn(async()=>new Date(Date.now()+120000).toISOString());
  expect(await h.workflow.confirm(review)).toHaveProperty("state","unknown");expect(h.deps.observer.inspect).not.toHaveBeenCalled();
});
