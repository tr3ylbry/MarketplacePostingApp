// @vitest-environment node
import net from "node:net";
import dns from "node:dns";
import tls from "node:tls";
import fs from "node:fs";
import { localImageDns, localImageTls, dnsFixtureResponse, dnsAliasFixtureResponse, imageWireResponse, DOWNLOAD_TEST_CA, DOWNLOAD_TEST_HOST } from "../../test/imageDownloaderFixtures";
import { startImageDownload, type ImageDownloadInput } from "./imageDownloader";
import { inspectImageAddressSet } from "./imageAddressSetPolicy";
import { acquirePhotoCapacity, releasePhotoCapacity } from "../../application/photoCapacity";

vi.mock("./imageAddressSetPolicy", async original => {
  const actual = await original<typeof import("./imageAddressSetPolicy")>();
  return {...actual,inspectImageAddressSet:vi.fn((...args:Parameters<typeof actual.inspectImageAddressSet>)=>{
    const value=actual.inspectImageAddressSet(...args);
    // Test-only loopback candidate substitution AFTER exercising the actual
    // public policy on invented DNS answers. Never exported by production code.
    return value.candidate?{...value,candidate:{address:"127.0.0.1",family:4 as const}}:value;
  })};
});
vi.mock("dotenv",()=>{throw Error("Private configuration forbidden");});
vi.mock("pg",()=>{throw Error("Database forbidden");});
vi.mock("@vercel/blob",()=>{throw Error("Provider forbidden");});
const blocked=vi.fn(()=>{throw Error("Non-fixture network forbidden");});
const connect=net.Socket.prototype.connect, tlsConnect=tls.connect;
const allowed=new Set<number>();
let dnsServer:Awaited<ReturnType<typeof localImageDns>>,web:Awaited<ReturnType<typeof localImageTls>>;
let useTrust=true;
const operations:Array<ReturnType<typeof startImageDownload>>=[];
function input(overrides:Partial<ImageDownloadInput>={}):ImageDownloadInput{
  const now=Date.now();return {url:`https://${DOWNLOAD_TEST_HOST}/synthetic/image%41.png?opaque=A%2fb+Q&x=&x=2`,responseReceivedAt:now,providerExpiresAt:now+3_600_000,
    deadlines:{session:now+60_000,review:now+60_000,context:now+60_000,lease:now+60_000,access:now+60_000,refresh:now+60_000,request:now+60_000},beforeRequest:async()=>{},...overrides};
}
function start(value=input(),signal?:AbortSignal){const op=startImageDownload(value,signal);operations.push(op);return op;}
async function servers(response=(s:tls.TLSSocket)=>{s.end(imageWireResponse());},wrong=false,dnsReply?:Parameters<typeof localImageDns>[0]){
  dnsServer=await localImageDns(dnsReply);web=await localImageTls(response,wrong);allowed.add(dnsServer.port);allowed.add(web.port);
}
beforeAll(()=>{
  vi.stubGlobal("fetch",blocked);vi.stubGlobal("WebSocket",blocked);
  vi.spyOn(net.Socket.prototype,"connect").mockImplementation(function(this:net.Socket,...args:unknown[]){
    let o=args[0] as unknown;if(Array.isArray(o))o=o[0];const p=o as net.NetConnectOpts & {host?:string;port?:number};
    if(typeof p!=="object"||p.host!=="127.0.0.1"||!allowed.has(Number(p.port)))return blocked();
    return Reflect.apply(connect,this,args);
  } as typeof connect);
  const read=fs.readFileSync.bind(fs);vi.spyOn(fs,"readFileSync").mockImplementation(((p:never,...args:never[])=> /(?:^|\/)\.env(?:\.|$)/.test(String(p))?blocked():read(p,...args)) as typeof fs.readFileSync);
});
beforeEach(()=>{
  useTrust=true;
  vi.spyOn(dns,"getServers").mockImplementation(()=>[`127.0.0.1:${dnsServer.port}`]);
  vi.spyOn(tls,"connect").mockImplementation(((options:tls.ConnectionOptions & {port:number;host:string})=>{
    expect(options.port).toBe(443);expect(options.servername).toBe(DOWNLOAD_TEST_HOST);expect(options.host).toMatch(/^127\.0\.0\.[12]$/);
    expect(options.rejectUnauthorized).toBe(true);expect(options.checkServerIdentity).toBe(tls.checkServerIdentity);expect(options.ca).toEqual([...tls.rootCertificates]);
    expect(options).not.toHaveProperty("key");expect(options).not.toHaveProperty("cert");expect(options).not.toHaveProperty("pfx");
    const socket=tlsConnect({...options,host:"127.0.0.1",port:web.port,...(useTrust?{ca:DOWNLOAD_TEST_CA}:{})});
    // Only the local test destination port changes. Production arguments above
    // are still443. This synthetic observation is NOT real remote443 evidence.
    Object.defineProperty(socket,"remotePort",{get:()=>443});return socket;
  }) as typeof tlsConnect);
});
afterEach(async()=>{
  for(const op of operations)op.cancel();await Promise.allSettled(operations.map(o=>o.settled));operations.length=0;
  await web?.close();await dnsServer?.close();allowed.clear();
  vi.mocked(tls.connect).mockRestore();vi.mocked(dns.getServers).mockRestore();vi.mocked(inspectImageAddressSet).mockClear();
  expect(blocked).not.toHaveBeenCalled();
});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it("performs real local DNS/TLS/HTTP, preserves the exact target and sends only anonymous headers",async()=>{
  await servers();const before=vi.fn(async()=>{expect(web.requests).toHaveLength(0);});const op=start(input({beforeRequest:before}));
  const r=await op.result;await op.settled;
  expect(r.diagnostic).toMatchObject({outcome:"retrieved",bytes:4,mime:"image/png",unverified:true,associated:false,settlement:"settled"});
  expect([...r.data!]).toEqual([137,80,78,71]);expect(before).toHaveBeenCalledOnce();expect(dnsServer.questions).toHaveLength(2);expect(web.snis).toEqual([DOWNLOAD_TEST_HOST]);expect(tls.connect).toHaveBeenCalledOnce();expect(dnsServer.connections).toBe(1);
  for(const [i,q] of dnsServer.questions.entries()){expect(q.readUInt16BE(2)).toBe(0x0100);expect(q.readUInt16BE(4)).toBe(1);expect(q.subarray(12)).toEqual(Buffer.from(`\x01i\x07sandbox\x07ebayimg\x03com\x00\x00${i?"\x1c":"\x01"}\x00\x01`,"latin1"));}
  const request=web.requests[0].toString("ascii");
  expect(request).toBe(`GET /synthetic/image%41.png?opaque=A%2fb+Q&x=&x=2 HTTP/1.1\r\nHost: ${DOWNLOAD_TEST_HOST}\r\nAccept: image/png, image/jpeg\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`);
  expect(JSON.stringify(r.diagnostic)).not.toMatch(/opaque|synthetic|127\.|https|cookie|token|image%41/i);
});
it("retrieves after a positive alias A plus terminal SOA-backed alias AAAA NODATA",async()=>{
  await servers(undefined,false,(question,socket)=>socket.write(dnsAliasFixtureResponse(question)));
  const op=start(),result=await op.result;await op.settled;
  expect(result.diagnostic).toMatchObject({outcome:"retrieved",settlement:"settled",bytes:4});
  expect(result.diagnostic).not.toHaveProperty("dns");expect(dnsServer.connections).toBe(1);expect(dnsServer.questions).toHaveLength(2);
  expect(tls.connect).toHaveBeenCalledOnce();expect(web.requests).toHaveLength(1);result.data?.fill(0);
});
it.each([
  ["redirect","HTTP/1.1 302 Found\r\nLocation: https://refused.invalid/\r\nContent-Length: 0\r\n\r\n"],
  ["challenge","HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic\r\nContent-Length: 0\r\n\r\n"],
  ["informational","HTTP/1.1 103 Early Hints\r\nLink: secret\r\n\r\n"],
  ["upgrade","HTTP/1.1 101 Switching Protocols\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n"],
  ["duplicate","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nX-Test: a\r\nx-test: b\r\nContent-Length: 1\r\n\r\nx"],
  ["cookie","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nSet-Cookie: secret\r\nContent-Length: 1\r\n\r\nx"],
  ["encoding","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n\r\nx"],
  ["mime","HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1\r\n\r\nx"],
  ["fold","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nX-Test: a\r\n b\r\nContent-Length: 1\r\n\r\nx"],
  ["trailers","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx\r\n0\r\nX-Trailer: a\r\n\r\n"],
  ["ambiguous-length","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\nx"],
  ["short-body","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 4\r\n\r\nx"],
  ["long-body","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 1\r\n\r\nxx"],
  ["empty","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 0\r\n\r\n"],
  ["bad-chunk","HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\n\r\nZ\r\nx\r\n0\r\n\r\n"],
])("refuses real wire %s without retry or leaked diagnostics",async(_name,response)=>{
  await servers(s=>s.end(response));const op=start();const r=await op.result;await op.settled;
  expect(r.data).toBeNull();expect(r.diagnostic.outcome).toBe("refused");expect(web.requests).toHaveLength(1);expect(dnsServer.questions).toHaveLength(2);
  expect(JSON.stringify(r.diagnostic)).not.toMatch(/secret|refused.invalid|opaque|https:/);
});
it.each([false,true])("refuses untrusted chain or wrong certificate hostname (%s) before HTTP",async wrong=>{
  await servers(undefined,wrong);useTrust=wrong;const op=start(),r=await op.result;await op.settled;
  expect(r.diagnostic.reason).toBe("tls");expect(web.requests).toHaveLength(0);
});
it("compares the actual peer address and refuses mismatch before HTTP",async()=>{
  await servers();vi.mocked(inspectImageAddressSet).mockReturnValueOnce({candidate:{address:"127.0.0.2",family:4},reason:"candidate",networkAuthorized:false,policyVersion:"test",dataHash:"test"});
  const op=start(),r=await op.result;await op.settled;expect(r.diagnostic.reason).toBe("peer");expect(web.requests).toHaveLength(0);
});
it.each(["mixed","truncated","wrong-id","partial","error"])("refuses local DNS %s before TLS",async mode=>{
  await servers(undefined,false,(q,s,index)=>{
    if(mode==="partial"&&index===1){s.end();return;}
    let frame=dnsFixtureResponse(q,mode==="mixed"?["1.1.1.1","127.0.0.1"]:["1.1.1.1"],mode==="truncated"?0x8380:mode==="error"?0x8182:0x8180);
    if(mode==="wrong-id"){frame=Buffer.from(frame);frame.writeUInt16BE((q.readUInt16BE()+1)&65535,2);}s.write(frame);
  });
  const op=start(),r=await op.result;await op.settled;expect(r.diagnostic.outcome).toBe("refused");expect(tls.connect).not.toHaveBeenCalled();expect(web.requests).toHaveLength(0);
});
it("accepts chunked PNG with counted bytes and closes every socket",async()=>{
  await servers(s=>s.end("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\nab\r\n2\r\ncd\r\n0\r\n\r\n"));
  const op=start(),r=await op.result;await op.settled;expect(r.diagnostic.outcome).toBe("retrieved");expect(Buffer.from(r.data!).toString()).toBe("abcd");
});
it.each([128,129])("enforces exact raw header pair boundary %i",async count=>{
  const extra=Array.from({length:count-3},(_,n)=>`X-${n}: a\r\n`).join("");await servers(s=>s.end(imageWireResponse(undefined,extra)));
  const op=start(),r=await op.result;await op.settled;expect(r.diagnostic.outcome).toBe(count===128?"retrieved":"refused");
});
it("enforces parser/raw header bytes before a large body",async()=>{
  await servers(s=>s.end(imageWireResponse(undefined,`X-Large: ${"a".repeat(16_384)}\r\n`)));const op=start(),r=await op.result;await op.settled;expect(r.diagnostic.outcome).toBe("refused");
});
it.each([1_048_576,1_048_577])("counts actual streamed body limit %i",async size=>{
  await servers(s=>s.end(Buffer.concat([Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n"),Buffer.alloc(size,1)])));
  const op=start(),r=await op.result;await op.settled;expect(r.diagnostic.outcome).toBe(size===1_048_576?"retrieved":"refused");if(r.data)expect(r.data.length).toBe(size);
});
it("cancels a pending TLS/body operation and allows later clean controls",async()=>{
  await servers(()=>{});const controller=new AbortController(),op=start(input(),controller.signal);setTimeout(()=>controller.abort(),30);
  expect((await op.result).diagnostic.reason).toBe("cancelled");await op.settled;
  await web.close();web=await localImageTls(s=>s.end(imageWireResponse()));allowed.add(web.port);
  const control=start();expect((await control.result).diagnostic.outcome).toBe("retrieved");await control.settled;
});
it("uses a single shortened total deadline",async()=>{
  await servers(()=>{});const value=input();value.deadlines.context=Date.now()+80;const op=start(value);expect((await op.result).diagnostic.reason).toBe("deadline");await op.settled;
});
it("never sends after an expired post-TLS context callback",async()=>{
  await servers();const value=input({beforeRequest:async()=>{await new Promise(r=>setTimeout(r,100));}});value.deadlines.context=Date.now()+50;
  const op=start(value);expect((await op.result).diagnostic.reason).toBe("deadline");await op.settled;expect(web.requests).toHaveLength(0);
});
it("holds both shared slots until started callbacks actually settle",async()=>{
  await servers();let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});let entered=0;
  const value=input({beforeRequest:async()=>{entered++;await barrier;}}),a=start(value),b=start(value);
  for(let i=0;i<200&&entered<2;i++)await new Promise(r=>setTimeout(r,5));expect(entered).toBe(2);
  a.cancel();b.cancel();await Promise.all([a.result,b.result]);expect((await start().result).diagnostic.reason).toBe("busy");
  expect(()=>acquirePhotoCapacity()).toThrow();release();await Promise.all([a.settled,b.settled]);const slot=acquirePhotoCapacity();releasePhotoCapacity(slot);expect(web.requests).toHaveLength(0);
});
it("spends one genuine ten-second budget, then closes the actual socket",async()=>{
  await servers(()=>{});const began=performance.now(),op=start();expect((await op.result).diagnostic.reason).toBe("deadline");await op.settled;
  expect(performance.now()-began).toBeGreaterThanOrEqual(9_900);expect(web.requests).toHaveLength(1);expect(dnsServer.questions).toHaveLength(2);
},15_000);
it("does not renew total lifetime between delayed DNS and post-TLS checking",async()=>{
  await servers(()=>{},false,(q,s)=>{setTimeout(()=>{if(!s.destroyed)s.write(dnsFixtureResponse(q));},50);});
  const v=input({beforeRequest:async()=>{await new Promise(r=>setTimeout(r,50));}});v.deadlines.context=Date.now()+80;
  const op=start(v);expect((await op.result).diagnostic.reason).toBe("deadline");await op.settled;expect(web.requests).toHaveLength(0);
});
it.each([16_384,16_385])("enforces the complete raw-header byte boundary%i",async size=>{
  const base=imageWireResponse(undefined,"X-Pad: \r\n"),initial=base.indexOf("\r\n\r\n")+4;
  await servers(s=>s.end(imageWireResponse(undefined,`X-Pad: ${"a".repeat(size-initial)}\r\n`)));
  const op=start(),r=await op.result;await op.settled;expect(r.diagnostic.outcome).toBe(size===16_384?"retrieved":"refused");
});
it("keeps a rejected final context from producing HTTP bytes",async()=>{
  await servers();const op=start(input({beforeRequest:async()=>{throw Error("PRIVATE-MARKER");}})),r=await op.result;await op.settled;
  expect(r.diagnostic.reason).toBe("context");expect(web.requests).toHaveLength(0);expect(JSON.stringify(r.diagnostic)).not.toContain("PRIVATE-MARKER");
});
it("retains a failed connection's capacity until its close actually arrives",async()=>{
  await servers();const native=vi.mocked(tls.connect).getMockImplementation()!;const pending:tls.TLSSocket[]=[];
  vi.mocked(tls.connect).mockImplementation(((options:tls.ConnectionOptions)=>{const s=Reflect.apply(native,tls,[options]) as tls.TLSSocket;const destroy=s.destroy.bind(s);vi.spyOn(s,"destroy").mockImplementation(()=>{pending.push(s);return s;});Object.defineProperty(s,"testFinish",{value:()=>{vi.mocked(s.destroy).mockRestore();destroy();}});return s;}) as typeof tls.connect);
  const a=start(),b=start();for(let n=0;n<200&&web.requests.length<2;n++)await new Promise(r=>setTimeout(r,5));
  a.cancel();b.cancel();await Promise.all([a.result,b.result]);expect((await start().result).diagnostic.reason).toBe("busy");
  for(const s of new Set(pending))(s as tls.TLSSocket & {testFinish():void}).testFinish();await Promise.all([a.settled,b.settled]);
});
it("refuses unsolicited buffered response bytes before sending the request",async()=>{
  dnsServer=await localImageDns();web=await localImageTls(()=>{},false,imageWireResponse());allowed.add(dnsServer.port);allowed.add(web.port);
  const op=start(input({beforeRequest:async()=>{await new Promise(r=>setTimeout(r,50));}})),r=await op.result;await op.settled;
  expect(r.diagnostic.outcome).toBe("refused");expect(web.requests).toHaveLength(0);
});
