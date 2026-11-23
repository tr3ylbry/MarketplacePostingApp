// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { startImageDownload, type ImageDownloadInput } from "./imageDownloader";
import { resolveImageDownloadAddresses } from "./imageDownloadDns";
import { connectImagePeer, prepareImageHttp } from "./imageDownloadTransport";
import { acquirePhotoCapacity,releasePhotoCapacity } from "../../application/photoCapacity";
vi.mock("./imageDownloadDns",()=>({resolveImageDownloadAddresses:vi.fn()}));
vi.mock("./imageDownloadTransport",()=>({connectImagePeer:vi.fn(),prepareImageHttp:vi.fn()}));
function deferred<T>(){let resolve!:(x:T)=>void,reject!:(x:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return {promise,resolve,reject};}
const now=Date.parse("2026-11-23T00:00:00Z");
function input():ImageDownloadInput{return {url:"https://i.sandbox.ebayimg.com/test.png?secret=PRIVATE-MARKER",responseReceivedAt:Date.now(),providerExpiresAt:Date.now()+3_600_000,
  deadlines:{session:Date.now()+60_000,context:Date.now()+60_000,review:Date.now()+60_000,lease:Date.now()+60_000,access:Date.now()+60_000,refresh:Date.now()+60_000,request:Date.now()+60_000},beforeRequest:async()=>{}};}
let dns:ReturnType<typeof deferred<readonly {address:string;family:4}[]>>,done:ReturnType<typeof deferred<void>>;
const operations:Array<ReturnType<typeof startImageDownload>>=[];
const start=(v=input(),signal?:AbortSignal)=>{const op=startImageDownload(v,signal);operations.push(op);return op;};
beforeEach(()=>{
  vi.useFakeTimers({toFake:["Date","setTimeout","clearTimeout","performance"]});vi.setSystemTime(now);
  dns=deferred();done=deferred();vi.mocked(resolveImageDownloadAddresses).mockReturnValue({ready:dns.promise,settled:done.promise,abort:vi.fn()});
});
afterEach(async()=>{for(const o of operations)o.cancel();dns.resolve([]);done.resolve();await Promise.all(operations.map(o=>o.settled));operations.length=0;vi.useRealTimers();vi.clearAllMocks();});
it("guards all external and private access",assertOfflineGuards);
it.each(["session","context","review","lease","access","refresh","request"] as const)("refuses expired %s without resource construction",async field=>{
  const v=input();v.deadlines[field]=now;const o=start(v);expect((await o.result).diagnostic.reason).toBe("deadline");await o.settled;expect(resolveImageDownloadAddresses).not.toHaveBeenCalled();
});
it.each(["receipt","expiry","policy"])("honors shortened %s lifetime without phase renewal",async bound=>{
  if(bound==="policy")vi.setSystemTime(Date.parse("2027-02-20T20:31:27.969Z"));
  const v=input();if(bound==="receipt")v.responseReceivedAt=now-29_999;if(bound==="expiry")v.providerExpiresAt=now+60_001;
  const o=start(v);await vi.advanceTimersByTimeAsync(2);expect((await o.result).diagnostic.reason).toBe("deadline");done.resolve();dns.resolve([{address:"1.1.1.1",family:4}]);await o.settled;expect(connectImagePeer).not.toHaveBeenCalled();
});
it("enforces the ten-second total window even with no supplied shorter cutoff",async()=>{
  const o=start();await vi.advanceTimersByTimeAsync(9_999);let returned=false;void o.result.then(()=>{returned=true;});await Promise.resolve();expect(returned).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect((await o.result).diagnostic.reason).toBe("deadline");expect(connectImagePeer).not.toHaveBeenCalled();
});
it("retains capacity through cancelled resolver late settlement and never constructs TLS",async()=>{
  const a=start(),b=start();a.cancel();b.cancel();expect((await a.result).diagnostic.settlement).toBe("unsettled");
  expect((await start().result).diagnostic.reason).toBe("busy");expect(()=>acquirePhotoCapacity()).toThrow();
  dns.resolve([{address:"1.1.1.1",family:4}]);await Promise.resolve();expect(connectImagePeer).not.toHaveBeenCalled();done.resolve();await Promise.all([a.settled,b.settled]);
  const c=acquirePhotoCapacity();releasePhotoCapacity(c);expect(prepareImageHttp).not.toHaveBeenCalled();
});
it("rejects a failed/incomplete resolver without a connection",async()=>{const o=start();dns.reject(Error("PRIVATE-MARKER"));done.resolve();const r=await o.result;expect(r.data).toBeNull();expect(JSON.stringify(r.diagnostic)).not.toContain("PRIVATE-MARKER");await o.settled;expect(connectImagePeer).not.toHaveBeenCalled();});
it("rejects backwards wall time after the last resolver wait",async()=>{const o=start();vi.setSystemTime(now-1);dns.resolve([{address:"1.1.1.1",family:4}]);done.resolve();expect((await o.result).diagnostic.reason).toBe("clock");await o.settled;expect(connectImagePeer).not.toHaveBeenCalled();});
it("rejects a pre-cancelled operation without opening any resource",async()=>{const c=new AbortController();c.abort();const o=start(input(),c.signal);expect((await o.result).diagnostic.reason).toBe("cancelled");await o.settled;expect(resolveImageDownloadAddresses).not.toHaveBeenCalled();});
it.each(["https://i.sandbox.ebayimg.com:443/x","http://i.sandbox.ebayimg.com/x","https://i.sandbox.ebayimg.com/x#","https://i.sandbox.ebayimg.com/../x","https://i.sandbox.ebayimg.com/x?z=%25a","https://foreign.invalid/x"])("refuses malformed/normalized targets %# without DNS",async url=>{const v=input();v.url=url;const o=start(v);expect((await o.result).diagnostic.reason).toBe("policy");await o.settled;expect(resolveImageDownloadAddresses).not.toHaveBeenCalled();});
it.each([NaN,Infinity,now+0.5])("refuses invalid context clock %#",async t=>{const v=input();v.responseReceivedAt=t;const o=start(v);expect((await o.result).diagnostic.reason).toBe("context");await o.settled;expect(resolveImageDownloadAddresses).not.toHaveBeenCalled();});
it("rejects backwards monotonic time without a connection",async()=>{const o=start();const clock=vi.spyOn(performance,"now").mockReturnValue(-1);dns.resolve([{address:"1.1.1.1",family:4}]);done.resolve();try{expect((await o.result).diagnostic.reason).toBe("clock");await o.settled;expect(connectImagePeer).not.toHaveBeenCalled();}finally{clock.mockRestore();}});
it("discards a throwing clock as a fixed failure",async()=>{const clock=vi.spyOn(performance,"now").mockImplementationOnce(()=>{throw Error("PRIVATE-MARKER");});const o=start();try{expect((await o.result).diagnostic.reason).toBe("clock");await o.settled;expect(resolveImageDownloadAddresses).not.toHaveBeenCalled();}finally{clock.mockRestore();}});
it("refuses a forward wall-clock expiry even when the monotonic timer has not fired",async()=>{const o=start();vi.setSystemTime(now+20_000);dns.resolve([{address:"1.1.1.1",family:4}]);done.resolve();expect((await o.result).diagnostic.reason).toBe("deadline");await o.settled;expect(connectImagePeer).not.toHaveBeenCalled();});
