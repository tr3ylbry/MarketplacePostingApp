import "server-only";
import { createHash } from "node:crypto";
import { borrowPhotoCapacity, type PhotoCapacity } from "../../application/photoCapacity";
import { IMAGE_COMPARISON as policy, ImageComparisonError, type ComparisonReason, type ImageComparisonDiagnostic } from "../../application/imageComparison";
import { decodeDiagnosticImage, IMAGE_COMPARISON_RECIPE } from "./diagnosticImageDecode";
import { inspectReferencePixels, visualMetrics } from "./visualMetrics";
import { downloadDeferred } from "../ebay/imageDownloadWork";

interface Binding { operationId:string;derivativeDigest:string }
interface Window { wallUntil:number;monoUntil:number }
interface Reference { raw:Buffer;binding:string;window:Window;dispose():void }
const references=new WeakMap<object,Reference>();
export type ImageComparisonReference=Readonly<object>;
export interface ImageComparisonOperation {result:Promise<Readonly<ImageComparisonDiagnostic>>;settled:Promise<void>;cancel():void}
export const inconclusiveComparison=(reason:ComparisonReason,settlement:"settled"|"unsettled"="settled"):ImageComparisonDiagnostic=>({
  recipe:IMAGE_COMPARISON_RECIPE,verdict:"inconclusive",reason,decoding:"not-run",geometry:reason==="geometry"?"failed":"not-run",orientation:"not-run",marker:"not-run",color:"not-run",similarity:"not-run",settlement,metrics:null,associated:false,
});
function bound(value:Binding){
  if(!/^[a-f0-9-]{36}$/.test(value.operationId)||!/^[a-f0-9]{64}$/.test(value.derivativeDigest))throw new ImageComparisonError("context");
  return JSON.stringify([value.operationId,value.derivativeDigest]);
}
function clock(window:Window,signal:AbortSignal){
  let wall=Date.now(),mono=performance.now();
  if(!Number.isSafeInteger(window.wallUntil)||!Number.isFinite(window.monoUntil))throw new ImageComparisonError("context");
  const end=Math.min(window.wallUntil,wall+policy.processingMs),elapsedEnd=Math.min(window.monoUntil,mono+end-wall);
  const check=()=>{
    const w=Date.now(),m=performance.now();
    if(signal.aborted)throw new ImageComparisonError("cancelled");
    if(!Number.isSafeInteger(w)||!Number.isFinite(m)||w<wall||m<mono)throw new ImageComparisonError("context");
    wall=w;mono=m;
    if(w>=end||m>=elapsedEnd)throw new ImageComparisonError("deadline");
  };
  check();return {check,remaining:()=>Math.min(end-Date.now(),elapsedEnd-performance.now())};
}
export function discardImageReference(ref:unknown){
  const value=ref&&typeof ref==="object"?references.get(ref):undefined;
  if(value){value.dispose();value.raw.fill(0);}
}
export async function prepareImageReference(bytes:Buffer,binding:Binding,window:Window,signal:AbortSignal,capacity:PhotoCapacity):Promise<ImageComparisonReference>{
  const key=bound(binding),guard=clock(window,signal),finish=borrowPhotoCapacity(capacity);let raw:Buffer|undefined;
  try{
    if(createHash("sha256").update(bytes).digest("hex")!==binding.derivativeDigest)throw new ImageComparisonError("reference");
    raw=await decodeDiagnosticImage(bytes,"image/png",guard.check,guard.remaining,signal);guard.check();inspectReferencePixels(raw);guard.check();
    const handle=Object.freeze(Object.create(null)) as object;
    const dispose=()=>{references.delete(handle);clearTimeout(timer);signal.removeEventListener("abort",cleanup);};
    const cleanup=()=>discardImageReference(handle);
    const retainedWindow={wallUntil:Math.min(window.wallUntil,Date.now()+30_000),monoUntil:Math.min(window.monoUntil,performance.now()+30_000)};
    const timer=setTimeout(cleanup,Math.max(1,Math.min(retainedWindow.wallUntil-Date.now(),retainedWindow.monoUntil-performance.now())));timer.unref();
    references.set(handle,{raw,binding:key,window:retainedWindow,dispose});signal.addEventListener("abort",cleanup,{once:true});raw=undefined;
    return handle;
  }finally{raw?.fill(0);finish();}
}
export function startImageComparison(handle:unknown,binding:Binding,bytes:Uint8Array,mime:string,window:Window,signal:AbortSignal,capacity:PhotoCapacity):ImageComparisonOperation{
  const ref=handle&&typeof handle==="object"?references.get(handle):undefined;
  ref?.dispose(); // Burn synchronously, including mismatch or failed native work.
  const result=downloadDeferred<Readonly<ImageComparisonDiagnostic>>(),settled=downloadDeferred<void>(),controller=new AbortController();
  const combined=AbortSignal.any([signal,controller.signal]);let done=false;
  const stop=(reason:"cancelled"|"deadline")=>{if(!done){controller.abort();result.resolve(Object.freeze(inconclusiveComparison(reason,"unsettled")));}};
  const abort=()=>stop("cancelled");signal.addEventListener("abort",abort,{once:true});
  const until=Math.min(window.wallUntil,ref?.window.wallUntil??Infinity,Date.now()+policy.processingMs);
  const monoUntil=Math.min(window.monoUntil,ref?.window.monoUntil??Infinity,performance.now()+Math.max(0,until-Date.now()));
  const timer=setTimeout(()=>stop("deadline"),Math.max(1,Math.min(until-Date.now(),monoUntil-performance.now())));
  const run=async()=>{let returned:Buffer|undefined,finish:(()=>void)|undefined;
    try{
      if(!ref||ref.binding!==bound(binding))throw new ImageComparisonError("context");
      const guard=clock({wallUntil:until,monoUntil},combined);finish=borrowPhotoCapacity(capacity);
      returned=await decodeDiagnosticImage(bytes,mime,guard.check,guard.remaining,combined);guard.check();
      const metrics=visualMetrics(ref.raw,returned,guard.check);guard.check();
      const marker=metrics.markerErrors===0&&metrics.markerMargin>=policy.markerMargin;
      const orientation=metrics.orientationErrors===0&&metrics.orientationMargin>=policy.markerMargin;
      const color=metrics.anchorDelta<=policy.anchorDelta,similarity=metrics.mae<=policy.mae&&metrics.rmse<=policy.rmse&&metrics.tileMae<=policy.tileMae;
      result.resolve(Object.freeze({recipe:IMAGE_COMPARISON_RECIPE,verdict:orientation&&marker&&color&&similarity?"match":"mismatch",reason:!orientation?"orientation":!marker?"marker":!color?"color":!similarity?"similarity":"matched",
        decoding:"passed",geometry:"passed",orientation:orientation?"passed":"failed",marker:marker?"passed":"failed",color:color?"passed":"failed",similarity:similarity?"passed":"failed",metrics:Object.freeze(metrics),settlement:"settled",associated:false}));
    }catch(error){const reason=error instanceof ImageComparisonError?error.reason:"decode";
      result.resolve(Object.freeze({...inconclusiveComparison(reason),decoding:reason==="decode"?"failed":"not-run"}));
    }finally{returned?.fill(0);ref?.raw.fill(0);clearTimeout(timer);signal.removeEventListener("abort",abort);finish?.();done=true;settled.resolve();}
  };void run();
  return{result:result.promise,settled:settled.promise,cancel:()=>stop("cancelled")};
}
