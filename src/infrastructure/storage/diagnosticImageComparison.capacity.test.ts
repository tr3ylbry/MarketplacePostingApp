// @vitest-environment node
import { randomUUID } from "node:crypto";
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { acquirePhotoCapacity,releasePhotoCapacity } from "../../application/photoCapacity";
import { realMediaDigest } from "../../application/ebayRealMedia";
import { generateVerificationFixture,verificationFixturePixels } from "./verificationFixture";
import * as native from "./diagnosticImageDecode";
import { prepareImageReference,startImageComparison,discardImageReference,type ImageComparisonOperation } from "./diagnosticImageComparison";
vi.mock("server-only",()=>({}));
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
const owned:ReturnType<typeof acquirePhotoCapacity>[]=[],refs:unknown[]=[],ops:ImageComparisonOperation[]=[];
async function reference(){const fixture=await generateVerificationFixture(),binding={operationId:randomUUID(),derivativeDigest:realMediaDigest(fixture.bytes)},lease=acquirePhotoCapacity(),signal=new AbortController();owned.push(lease);
 const window={wallUntil:Date.now()+20_000,monoUntil:performance.now()+20_000};const ref=await prepareImageReference(fixture.bytes,binding,window,signal.signal,lease);refs.push(ref);return{fixture,binding,lease,signal,window,ref};}
afterEach(async()=>{for(const op of ops){op.cancel();await op.settled;}ops.length=0;refs.forEach(discardImageReference);refs.length=0;owned.forEach(releasePhotoCapacity);owned.length=0;});
it("guards offline dependencies",assertOfflineGuards);
it.each(["cancelled","deadline","clock"])("discards %s late native results without releasing either borrowed slot early",async kind=>{
 const a=await reference(),b=await reference(),pending=[deferred<Buffer>(),deferred<Buffer>()];let n=0;
 const spy=vi.spyOn(native,"decodeDiagnosticImage").mockImplementation(()=>pending[n++].promise);
 if(kind==="deadline"){a.window.wallUntil=Date.now()+1100;b.window.wallUntil=a.window.wallUntil;}
 const x=startImageComparison(a.ref,a.binding,a.fixture.bytes,"image/png",a.window,a.signal.signal,a.lease),y=startImageComparison(b.ref,b.binding,b.fixture.bytes,"image/png",b.window,b.signal.signal,b.lease);ops.push(x,y);
 let ended=false,restoreClock:(()=>void)|undefined;void x.settled.then(()=>{ended=true;});
 try{
  expect(n).toBe(2);expect(()=>acquirePhotoCapacity()).toThrow();
  if(kind==="cancelled"){x.cancel();y.cancel();}
  if(kind==="clock"){
   const now=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValue(now-1000);restoreClock=()=>clock.mockRestore();
   pending.forEach(p=>p.resolve(verificationFixturePixels(Buffer.alloc(16))));
  }
  const early=await x.result;expect(early.verdict).toBe("inconclusive");expect(early.reason).toBe(kind==="clock"?"context":kind);
  if(kind!=="clock"){expect(ended).toBe(false);expect(()=>acquirePhotoCapacity()).toThrow();}
 }finally{
  pending.forEach(p=>p.resolve(verificationFixturePixels(Buffer.alloc(16))));await Promise.all([x.settled,y.settled]);spy.mockRestore();restoreClock?.();
 }
 expect(ended).toBe(true);releasePhotoCapacity(a.lease);releasePhotoCapacity(b.lease);const free=acquirePhotoCapacity();releasePhotoCapacity(free);
});
