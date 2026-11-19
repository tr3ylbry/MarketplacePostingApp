import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ownerIdSchema } from "./owner";
import { inventoryDigest, inventoryId, type InventoryClaim, type InventoryEvidence } from "./ebayInventoryPersistence";
import { ebaySku } from "./ebayPreparationMapping";
import { sameInventoryBinding, assessInventoryPreflight, assessInventoryReconciliation, assessInventoryCleanup, type InventoryObservation } from "./ebayInventoryDecisions";
import { planEbayInventory } from "./ebayInventoryPlanner";
import { INSPECTION_REVIEW_MS, INSPECTION_WORK_MS, InventoryInspectionError, boundedInspection,
  type InspectionDependencies, type InspectionReview, type InspectionSnapshot, type InspectionSummary, type InspectionActor } from "./ebayInventoryInspection";

let active = 0; // Two shared process slots, no queue; held through settlement.
const actorSchema = z.strictObject({ ownerId: ownerIdSchema, id: inventoryId, expiresAt: z.iso.datetime() });
interface Review { actor: InspectionActor; snapshot: Omit<InspectionSnapshot,"listing">; actionHash: string; expires: number; monotonic: number }
function same(a: Omit<InspectionSnapshot,"listing">, b: Omit<InspectionSnapshot,"listing">) {
  return sameInventoryBinding(a.binding,b.binding) && a.sessionExpiresAt===b.sessionExpiresAt && a.credentialExpiresAt===b.credentialExpiresAt &&
    JSON.stringify(a.photos)===JSON.stringify(b.photos);
}
// Internal orchestration; the only composition lives in src/test, guarded by
// test environment AND actual uniquely disposable database identity.
export function createInventoryInspection(deps: InspectionDependencies, workMs = INSPECTION_WORK_MS) {
  if (!Number.isInteger(workMs) || workMs<1 || workMs>INSPECTION_WORK_MS) throw new InventoryInspectionError("isolation");
  const reviews = new WeakMap<object,Review>();
  async function actor() {
    const parsed=actorSchema.safeParse(await deps.session());
    if(!parsed.success || Date.parse(parsed.data.expiresAt)<=Date.now()) throw new InventoryInspectionError("stale");
    return parsed.data;
  }
  function check(r:Review,signal?:AbortSignal,end=Infinity) {
    if(signal?.aborted || Date.now()>=r.expires || performance.now()>=Math.min(r.monotonic,end)) throw new InventoryInspectionError("stale");
  }
  async function current(r:Review,signal?:AbortSignal,end?:number) {
    check(r,signal,end);const user=await actor();check(r,signal,end);
    if(user.ownerId!==r.actor.ownerId || user.id!==r.actor.id) throw new InventoryInspectionError("stale");
    const snapshot=await deps.load(user,r.snapshot.binding.listingId);check(r,signal,end);
    if(!same(snapshot,r.snapshot)) throw new InventoryInspectionError("stale");
    return snapshot;
  }
  const summary=(state:InspectionSummary["state"],reasons:string[],checkedAt:string):InspectionSummary=>({ simulation:true,ownership:"unproven",canStage:false,canDelete:false,
    state,reasons:[...new Set(reasons)].slice(0,64),checkedAt });
  async function append(claim:InventoryClaim,value:InventoryEvidence) {
    // Retry only the identical local acknowledgement. Never observe again.
    try { return await deps.repository.acknowledge(claim,value); }
    catch { return deps.repository.acknowledge(claim,value); }
  }
  return {
    async prepare(listingId:string):Promise<InspectionReview> {
      try {
      inventoryId.parse(listingId);const user=await actor(),snapshot=await deps.load(user,listingId),now=Math.max(Date.now(),Date.parse(snapshot.checkedAt));
      if(snapshot.binding.ownerId!==user.ownerId || snapshot.binding.listingId!==listingId || snapshot.binding.environment!=="sandbox") throw new InventoryInspectionError("stale");
      const expires=Math.min(now+INSPECTION_REVIEW_MS,Date.parse(user.expiresAt),Date.parse(snapshot.sessionExpiresAt),Date.parse(snapshot.credentialExpiresAt));
      if(!Number.isFinite(expires) || expires<=now) throw new InventoryInspectionError("stale");
      const review=Object.freeze({ simulation:true as const,expiresAt:new Date(expires).toISOString() });
      const { listing,...captured }=snapshot;void listing;
      reviews.set(review,{ actor:Object.freeze({...user}),snapshot:{...captured,binding:Object.freeze({...captured.binding}),photos:captured.photos.map(p=>Object.freeze({...p}))},
        actionHash:inventoryDigest(randomUUID()),expires,monotonic:performance.now()+expires-now });return review;
      } catch(error) { if(error instanceof InventoryInspectionError)throw error;throw new InventoryInspectionError("unavailable"); }
    },
    async confirm(review:unknown,callerSignal?:AbortSignal):Promise<InspectionSummary> {
      const r=review && typeof review==="object"?reviews.get(review):undefined;
      if(!r)throw new InventoryInspectionError("stale");
      reviews.delete(review as object); // Synchronous one-use burn before any await.
      if(active>=2)throw new InventoryInspectionError("busy");active++;
      const controller=new AbortController(),end=performance.now()+workMs;
      let timer=setTimeout(()=>controller.abort(),workMs);
      const signal=AbortSignal.any([controller.signal,...(callerSignal?[callerSignal]:[])]);
      let claim:InventoryClaim|undefined,checkedAt=r.snapshot.checkedAt,startedAt=checkedAt;
      const reasons:string[]=[];
      try {
        let latest=await current(r,signal,end);const b=latest.binding;
        claim=await deps.repository.claim({ ownerId:b.ownerId,listingId:b.listingId,listingVersion:b.listingVersion,connectionId:b.connectionId,connectionVersion:b.connectionVersion,
          configHash:b.configHash,grantHash:b.grantHash,sessionId:r.actor.id,actionHash:r.actionHash,operation:"inspect" });
        const lease=Date.parse(await deps.lease(claim)),serverNow=Date.parse(await deps.time()),remaining=Math.min(lease,r.expires)-Math.max(Date.now(),serverNow);
        if(!Number.isFinite(remaining) || remaining<=0)throw new InventoryInspectionError("stale");
        r.expires=Math.min(r.expires,lease);r.monotonic=Math.min(r.monotonic,performance.now()+remaining);
        clearTimeout(timer);timer=setTimeout(()=>controller.abort(),Math.max(0,Math.min(remaining,end-performance.now())));
        latest=await current(r,signal,end);startedAt=await deps.time();check(r,signal,end);
        if(Date.parse(startedAt)>=r.expires)throw new InventoryInspectionError("stale");
        const batch=boundedInspection(await deps.observer.inspect(ebaySku(b.listingId),signal)); // Outside all transactions.
        let stale=false;try{latest=await current(r,signal,end);}catch{stale=true;}
        checkedAt=await deps.time();
        if(Date.parse(checkedAt)>=r.expires)stale=true;
        const plan=planEbayInventory({ ...deps.planning(latest),listing:latest.listing,binding:b,current:latest.binding,
          photos:latest.photos,media:latest.photos.map(photo=>({ imageId:photo.imageId,state:"unverified" as const })),
          metadata:{ checkedAt:startedAt,expiresAt:new Date(Math.max(Date.parse(checkedAt),Date.parse(startedAt))+1).toISOString() } },checkedAt);
        reasons.push(...plan.blockers);
        for(const sample of batch.samples) {
          try{await current(r,signal,end);}catch{stale=true;}
          const related=sample.related,collision=related.length>0 || sample.groups==="present" || sample.listings==="present";
          const code=sample.code!=="none"?sample.code:stale?"stale":collision?"collision":"none";
          const value:InventoryEvidence={ version:"inventory-local-v1",kind:stale?"recovery":"inspection",startedAt,finishedAt:checkedAt,
            item:sample.item,coverage:sample.offersComplete && sample.groups!=="unknown" && sample.listings!=="unknown" && !stale?"complete":"incomplete",
            outcome:stale?"uncertain":"observed",code,contentDigest:sample.contentDigest,related,httpStatus:null,overflow:batch.overflow };
          const ack=await append(claim,value);claim={ ...claim,revision:ack.revision };if(ack.late)stale=true;
          const observation:InventoryObservation={ binding:b,sku:ebaySku(b.listingId),checkedAt:startedAt,expiresAt:new Date(r.expires).toISOString(),
            item:sample.item,content:sample.item==="present"?sample.content:"unknown",offers:{ complete:sample.offersComplete,scope:"all-marketplaces-and-formats",count:related.filter(x=>x.kind==="offer").length },
            groups:sample.groups,listings:sample.listings,ownership:{ state:"unproven" },priorWrite:"none",reconciliation:stale?"incomplete":"complete",media:"unverified" };
          for(const decide of [assessInventoryPreflight,assessInventoryReconciliation,assessInventoryCleanup])reasons.push(...decide(b,observation,checkedAt).reasons);
          if(code!=="none")reasons.push(code);
        }
        try{await current(r,signal,end);}catch{stale=true;}
        if(stale) {
          const finishedAt=await deps.time();await append(claim,{ version:"inventory-local-v1",kind:"recovery",startedAt,finishedAt,
            item:"unknown",coverage:"incomplete",outcome:"uncertain",code:"stale",contentDigest:null,related:[],httpStatus:null,overflow:false });
        }
        return summary(callerSignal?.aborted?"cancelled":stale?"stale":"refused",[...reasons,...(stale?["stale-inspection"]:[])],checkedAt);
      } catch {
        if(claim) {
          try{checkedAt=await deps.time();await append(claim,{ version:"inventory-local-v1",kind:"recovery",startedAt,finishedAt:checkedAt,
            item:"unknown",coverage:"incomplete",outcome:"uncertain",code:"stale",contentDigest:null,related:[],httpStatus:null,overflow:false });}catch{/* Unknown DB outcome remains retained; no new observation. */}
        }
        return summary(callerSignal?.aborted?"cancelled":"unknown",["inspection-incomplete"],checkedAt);
      } finally { clearTimeout(timer);active--; } // Await owned work; cancellation never frees an unsettled slot.
    },
  };
}
