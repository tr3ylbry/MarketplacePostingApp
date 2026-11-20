import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ownerIdSchema } from "./owner";
import { acquirePhotoCapacity, releasePhotoCapacity } from "./photoCapacity";
import { mediaId, mediaHash, mediaSessionHash, realMediaDigest, RealMediaError, type RealMediaClaim, type RealMediaReviewGuard, type RealMediaSnapshot } from "./ebayRealMedia";
import type { FakeMediaDependencies } from "./ebayMediaWorkflow";
import { CAPTURE_HTTP_MS, CAPTURE_IMAGE_BYTES, emptyCapture, type CaptureReport } from "./ebayCaptureReport";

export interface CaptureDependencies extends Pick<FakeMediaDependencies,"session"|"repository"|"derive"|"configHash"|"recipe"> {
  // No refresh/exchange/identity port. The manual caller supplies a verified
  // version-bound current access credential, never a browser-supplied token.
  credential(binding:RealMediaSnapshot):Promise<string>;
  capture(bytes:Buffer,token:string,signal:AbortSignal):Promise<CaptureReport>;
  evidence:{time():Promise<string>;authorize(claim:RealMediaClaim):Promise<void>;record(claim:RealMediaClaim,value:CaptureReport):Promise<void>};
}
const actor=z.strictObject({ownerId:ownerIdSchema,id:mediaId,expiresAt:z.iso.datetime()});
const keys=["ownerId","listingId","imageId","listingVersion","connectionId","connectionVersion","configHash","grantHash","sellerKey","sourceVersion","imageOrder","accessExpiresAt","mediaGrant"] as const;
interface Review {guard:RealMediaReviewGuard;sessionHash:string;actionHash:string;recipe:string;sourceDigest:string;expires:number;deadline:number}
// Internal, manually composed discovery boundary. No normal runtime, route,
// action, background task or environment switch imports this module.
export function createCaptureWorkflow(deps:CaptureDependencies) {
  const reviews=new WeakMap<object,Review>();let used=false;
  const now=async()=>Math.max(Date.now(),Date.parse(await deps.evidence.time()));
  async function live(){const a=actor.parse(await deps.session());if(Date.parse(a.expiresAt)<=await now())throw new RealMediaError("stale");return a;}
  function check(r:Review,signal:AbortSignal,end:number){if(signal.aborted||performance.now()>=Math.min(end,r.deadline)||Date.now()>=r.expires||deps.recipe()!==r.recipe||deps.configHash()!==r.guard.binding.configHash)throw new RealMediaError("stale");}
  async function current(r:Review,signal:AbortSignal,end:number){check(r,signal,end);const a=await live();const b=await deps.repository.snapshot(a.ownerId,r.guard.binding.listingId,r.guard.binding.imageId);check(r,signal,end);
    if(mediaSessionHash(a.ownerId,a.id)!==r.sessionHash||keys.some(k=>b[k]!==r.guard.binding[k])||!b.mediaGrant||await now()>=r.expires)throw new RealMediaError("stale");}
  return {
    async prepare(listingId:string,imageId:string,expectedSeller:string,generatedSourceDigest:string) {
      try {
        mediaId.parse(listingId);mediaId.parse(imageId);mediaHash.parse(expectedSeller);mediaHash.parse(generatedSourceDigest);
        if(used)throw new RealMediaError("blocked");
        const a=await live(),b=await deps.repository.snapshot(a.ownerId,listingId,imageId),at=await now();
        const expires=Math.min(at+300000,Date.parse(a.expiresAt),Date.parse(b.accessExpiresAt??"")-30000);
        if(!b.mediaGrant||b.ownerId!==a.ownerId||b.sellerKey!==expectedSeller||b.configHash!==deps.configHash()||!Number.isFinite(expires)||expires<=at)throw new RealMediaError("stale");
        const review=Object.freeze({captureOnly:true as const,environment:"sandbox" as const,expiresAt:new Date(expires).toISOString()});
        reviews.set(review,{guard:{binding:Object.freeze({...b}),sessionId:a.id},sessionHash:mediaSessionHash(a.ownerId,a.id),actionHash:realMediaDigest(randomUUID()),recipe:deps.recipe(),sourceDigest:generatedSourceDigest,expires,deadline:performance.now()+expires-at});
        return review;
      }catch {throw new RealMediaError("stale");}
    },
    async confirm(review:unknown,callerSignal?:AbortSignal):Promise<{state:"unknown"|"not-sent";associated:false;captured:boolean}> {
      const r=review&&typeof review==="object"?reviews.get(review):undefined;if(!r)throw new RealMediaError("stale");reviews.delete(review as object);
      if(used)throw new RealMediaError("blocked");used=true; // One operation per manually composed runner, even on pre-fence failure.
      const capacity=acquirePhotoCapacity(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),end=performance.now()+30000;
      const signal=AbortSignal.any([controller.signal,...(callerSignal?[callerSignal]:[])]);let claim:RealMediaClaim|undefined;
      try {
        await current(r,signal,end);const b=r.guard.binding;
        // Persist the whole-operation deadline as the claim's actual lease, so
        // a lock wait cannot authorize an intent after eligibility has elapsed.
        const wall=await now(),guard={...r.guard,leaseDeadline:new Date(Math.min(r.expires,wall+Math.max(0,end-performance.now()))).toISOString()};
        claim=await deps.repository.claim({ownerId:b.ownerId,listingId:b.listingId,imageId:b.imageId,listingVersion:b.listingVersion,configHash:b.configHash,recipe:r.recipe,
          operation:"capture-only",sessionHash:r.sessionHash,actionHash:r.actionHash},guard);
        check(r,signal,end);
        const photo=await deps.derive(b.ownerId,b.listingId,b.listingVersion,b.imageId,signal,capacity);
        await current(r,signal,end);
        if(photo.sourceDigest!==r.sourceDigest||photo.recipe!==r.recipe||photo.contentType!=="image/png"||photo.width!==500||photo.height!==600||photo.size>CAPTURE_IMAGE_BYTES||photo.bytes.length!==photo.size||realMediaDigest(photo.bytes)!==photo.derivativeDigest)throw new RealMediaError("stale");
        const token=await deps.credential(b);await current(r,signal,end);
        claim=await deps.repository.fence(claim,{sourceDigest:photo.sourceDigest,derivativeDigest:photo.derivativeDigest,recipe:photo.recipe,contentType:photo.contentType,size:photo.size,width:photo.width,height:photo.height},r.guard);
        await deps.repository.beforeSend(claim,r.guard);await deps.evidence.authorize(claim);await current(r,signal,end);
        check(r,signal,end);if(realMediaDigest(photo.bytes)!==photo.derivativeDigest)throw new RealMediaError("stale");
        // At most one call. Any uncertain fence/send/response leaves its durable
        // source AND derivative fences, including after restart or local deletion.
        const response=await deps.capture(photo.bytes,token,AbortSignal.any([signal,AbortSignal.timeout(CAPTURE_HTTP_MS)]));
        for(let attempt=0;attempt<2;attempt++) {
          try{await deps.evidence.record(claim,response);return {state:"unknown",associated:false,captured:true};}
          catch{if(attempt===1)return {state:"unknown",associated:false,captured:false};}
        }
        return {state:"unknown",associated:false,captured:false};
      }catch {
        if(claim){try{await deps.repository.notSent(claim);return {state:"not-sent",associated:false,captured:false};}catch{
          try{await deps.evidence.record(claim,emptyCapture(signal.aborted?"cancelled":"transport"));}catch{/* Fence remains authoritative even if acknowledgement is lost. */}
        }}
        return {state:"unknown",associated:false,captured:false};
      }finally{clearTimeout(timer);releasePhotoCapacity(capacity);}
    },
  };
}
