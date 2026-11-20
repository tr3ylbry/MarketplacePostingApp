// @vitest-environment node
import { createServer,request as httpRequest,type Server } from "node:http";
import { once } from "node:events";
import { createCaptureClient,SANDBOX_CAPTURE_URL,type CaptureRequest } from "./captureClient";
import { generateCaptureFixture } from "../storage/captureFixture";
import { photoTransformer } from "../storage/photoDerivative/transformPhoto";
import { realMediaDigest } from "../../application/ebayRealMedia";
import { inspectCapture,urlShape } from "../../application/ebayCaptureReport";
vi.mock("server-only",()=>({}));

let server:Server,base:string,paths:string[];
const reply=()=>JSON.stringify({imageUrl:"https://i.ebayimg.com/images/g/PRIVATE_ID/s-l1600.png?signature=PRIVATE_CAPABILITY",expirationDate:"2027-01-01T00:00:00Z"});
beforeEach(async()=>{paths=[];server=createServer();server.on("request",req=>{paths.push(req.url!);});server.listen(0,"127.0.0.1");await once(server,"listening");base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
function client(){return createCaptureClient(((url,options,callback)=>{
  expect(url).toBe(SANDBOX_CAPTURE_URL);expect(options).toMatchObject({method:"POST",rejectUnauthorized:true,agent:false,maxHeaderSize:16384});
  return httpRequest(base+"/commerce/media/v1_beta/image/create_image_from_file",options,callback);
}) as CaptureRequest);}
it("sends exactly the accepted derivative through the real Node multipart client without requesting returned URLs",async()=>{
  const source=await generateCaptureFixture(),copy=Buffer.from(source.bytes),photo=await photoTransformer.transform(source.bytes,"image/png",new AbortController().signal,performance.now()+15000);
  let transmitted=Buffer.alloc(0);
  server.on("request",(req,res)=>{const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
    transmitted=Buffer.concat(chunks);const boundary=/boundary=(.+)$/.exec(req.headers["content-type"]!)![1];
    expect(req.headers.authorization).toBe("Bearer synthetic");expect(+req.headers["content-length"]!).toBe(transmitted.length);
    const prefix=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="sandbox-discovery.png"\r\nContent-Type: image/png\r\n\r\n`),suffix=Buffer.from(`\r\n--${boundary}--\r\n`);
    expect(transmitted.subarray(0,prefix.length)).toEqual(prefix);expect(transmitted.subarray(-suffix.length)).toEqual(suffix);
    expect(realMediaDigest(transmitted.subarray(prefix.length,-suffix.length))).toBe(photo.derivativeDigest);expect(transmitted.length-photo.size).toBeLessThanOrEqual(2048);
    res.writeHead(201,{"Content-Type":"application/json",Location:base+"/private-resource"});res.end(reply());
  });});
  const result=await client().capture(photo.bytes,"synthetic",new AbortController().signal);
  expect(result).toMatchObject({outcome:"captured",json:true,imageUrl:{hostname:"i.ebayimg.com",query:true},expiration:{syntax:"utc",normalized:"2027-01-01T00:00:00.000Z"}});
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|signature|1600\.png|private-resource|synthetic/);expect(source.bytes).toEqual(copy);expect(paths).toHaveLength(1);expect(transmitted.length).toBeGreaterThan(photo.size);
});
it.each([301,302,303,307,308])("refuses redirect %i with no followup or download",async status=>{
  server.on("request",(_req,res)=>{res.writeHead(status,{Location:base+"/must-not-request"});res.end();});
  expect(await client().capture(Buffer.from("png"),"synthetic",new AbortController().signal)).toHaveProperty("outcome","redirect");expect(paths).toHaveLength(1);
});
it.each(["duplicate-headers","huge-headers","chunked-body","error-body","bad-utf8","bad-json","duplicate-json","escaped-duplicate","deep-json","wrong-type","encoding","trailers"])("bounds and sanitizes %s on the wire",async kind=>{
  server.on("request",(_req,res)=>{
    if(kind==="duplicate-headers"){res.writeHead(201,["Content-Type","application/json","Location",base+"/one","Location",base+"/two"]);res.end(reply());return;}
    res.statusCode=kind==="error-body"?500:201;res.setHeader("Content-Type",kind==="wrong-type"?"text/html":"application/json");
    if(kind==="huge-headers")res.setHeader("X-Private","x".repeat(17000));if(kind==="encoding")res.setHeader("Content-Encoding","gzip");
    if(kind==="trailers"){res.setHeader("Trailer","Location");res.write(reply());res.addTrailers({Location:base+"/private"});res.end();return;}
    if(["chunked-body","error-body"].includes(kind)){res.write("x".repeat(33000));res.end("x".repeat(33000));return;}
    res.end(kind==="bad-utf8"?Buffer.from([0xff]):kind==="bad-json"?"{":kind==="duplicate-json"?'{"imageUrl":"a","imageUrl":"b"}':kind==="escaped-duplicate"?'{"imageUrl":"a","image\\u0055rl":"b"}':kind==="deep-json"?'['.repeat(12)+'0'+']'.repeat(12):reply());
  });
  const result=await client().capture(Buffer.from("png"),"synthetic",new AbortController().signal);
  expect(result.outcome).toBe(kind==="duplicate-headers"||kind.includes("duplicate")?"duplicate":kind==="huge-headers"||kind==="trailers"?"headers":["chunked-body","error-body"].includes(kind)?"body":kind==="bad-utf8"||kind==="encoding"?"encoding":kind==="wrong-type"?"content-type":"json");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");expect(paths).toHaveLength(1);
});
it("settles lost responses and caller cancellation without retry",async()=>{
  server.on("request",req=>req.socket.destroy());expect(await client().capture(Buffer.from("png"),"synthetic",new AbortController().signal)).toHaveProperty("outcome","transport");expect(paths).toHaveLength(1);
});
it("aborts a pending response and awaits socket settlement",async()=>{
  const controller=new AbortController();server.on("request",()=>controller.abort());expect(await client().capture(Buffer.from("png"),"synthetic",controller.signal)).toHaveProperty("outcome","cancelled");expect(paths).toHaveLength(1);
});
it("enforces the real ten-second HTTP deadline without retry",async()=>{
  server.on("request",()=>undefined);
  expect(await client().capture(Buffer.from("png"),"synthetic",new AbortController().signal)).toHaveProperty("outcome","cancelled");
  expect(paths).toHaveLength(1);
},15000);
it.each(["https://user:SECRET@unexpected.example/a%2Fb/RESOURCE?token=SECRET#SECRET","javascript:SECRET","https://☃.example/private","https://bad_host/private","https://example.com/"+"x".repeat(8200)])("redacts untrusted URL structure without following it: %#",value=>{
  const shape=urlShape(value);expect(JSON.stringify(shape)).not.toMatch(/SECRET|RESOURCE|private|bad_host|☃/);expect(shape.segments.length).toBeLessThanOrEqual(16);
});
it.each([null,{},"not-a-date","2026-99-99T99:99:99Z","2026-01-01T00:00:00+01:00"])("does not persist malformed expiry %#",expirationDate=>{
  const r=inspectCapture(201,["Content-Type","application/json"],Buffer.from(JSON.stringify({expirationDate})));expect(r.expiration.normalized).toBeNull();
});
