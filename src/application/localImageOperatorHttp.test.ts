import { describe,it,expect,vi } from "vitest";
import { handleLocalOperatorRequest,rejectLocalOperatorCallback,type LocalOperatorHttpDependencies } from "./localImageOperatorHttp";
import { LocalOperatorError } from "./localImageOperator";

const actor={ownerId:"owner-a",id:"session-a",expiresAt:new Date(Date.now()+60_000).toISOString()};
const url="https://127.0.0.1:3000/api/operator/ebay-image-verification";
function setup(){return {enabled:vi.fn(()=>true),session:vi.fn(async()=>actor),status:vi.fn(async()=>({state:{phase:"armed"}})),action:vi.fn(async()=>({state:{phase:"running"}}))} as unknown as LocalOperatorHttpDependencies;}
function request(method="POST",body:unknown={action:"run",revision:0,confirmed:true},extra:Record<string,string|undefined>={}){
  const safe=Object.fromEntries(Object.entries(extra).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  return new Request(url,{method,headers:{host:"127.0.0.1:3000",origin:"https://127.0.0.1:3000","content-type":"application/json","sec-fetch-site":"same-origin",...safe},...(method==="GET"?{}:{body:JSON.stringify(body)})});
}
describe("local authenticated operator request boundary",()=>{
  it("does nothing before disabled 404",async()=>{const d=setup();d.enabled=()=>false;expect((await handleLocalOperatorRequest(request(),d)).status).toBe(404);expect(d.session).not.toHaveBeenCalled();expect(d.action).not.toHaveBeenCalled();});
  it("uses genuine request headers and forwards only the strict action",async()=>{const d=setup(),r=request();expect((await handleLocalOperatorRequest(r,d)).status).toBe(200);expect(d.session).toHaveBeenCalledWith(r.headers);expect(d.action).toHaveBeenCalledWith(actor,{action:"run",revision:0,confirmed:true},r.headers);});
  it("GET performs only read-only status",async()=>{const d=setup(),r=await handleLocalOperatorRequest(request("GET"),d);expect(r.status).toBe(200);expect(d.action).not.toHaveBeenCalled();expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("set-cookie")).toBeNull();});
  it.each([{host:"localhost:3000"},{origin:"https://foreign.invalid"},{"x-forwarded-host":"foreign.invalid"},{"x-forwarded-proto":"http"},{"sec-fetch-site":"cross-site"},{"content-type":"text/plain"}])("rejects foreign/ambiguous origin %j before auth",async extra=>{const d=setup();expect((await handleLocalOperatorRequest(request("POST",undefined,extra),d)).status).toBe(403);expect(d.session).not.toHaveBeenCalled();});
  it.each(["http://127.0.0.1:3000/api/operator/ebay-image-verification",`${url}?owner=x`,"https://127.0.0.1:3000/api/operator/other"])("rejects changed route %s",async target=>{const d=setup();expect((await handleLocalOperatorRequest(new Request(target,{headers:{host:"127.0.0.1:3000"}}),d)).status).toBe(403);expect(d.session).not.toHaveBeenCalled();});
  it.each([null,{...actor,expiresAt:"2000-01-01T00:00:00.000Z"}])("rejects missing/expired session",async value=>{const d=setup();d.session=async()=>value;expect((await handleLocalOperatorRequest(request(),d)).status).toBe(401);expect(d.action).not.toHaveBeenCalled();});
  it.each([{action:"run",revision:0,confirmed:false},{action:"run",revision:-1,confirmed:true},{action:"run",revision:1,confirmed:true,ownerId:"foreign"},{action:"run",revision:1,confirmed:true,url:"https://foreign.invalid"},{action:"repeat",revision:1,confirmed:true}])("rejects unconfirmed or expanded authority %j",async body=>{const d=setup();expect((await handleLocalOperatorRequest(request("POST",body),d)).status).toBe(409);expect(d.action).not.toHaveBeenCalled();});
  it("bounds request bytes before parsing",async()=>{const d=setup();expect((await handleLocalOperatorRequest(request("POST","x".repeat(1025)),d)).status).toBe(409);expect(d.action).not.toHaveBeenCalled();});
  it("redacts all errors and emits no replacement cookie",async()=>{const d=setup();d.action=async()=>{throw Error("private-secret-invalid");};const r=await handleLocalOperatorRequest(request(),d);expect(await r.text()).not.toContain("private-secret");expect(r.headers.has("set-cookie")).toBe(false);});
  it("preserves conflicts without a retry",async()=>{const d=setup();d.action=vi.fn(async()=>{throw new LocalOperatorError("conflict");});expect((await handleLocalOperatorRequest(request(),d)).status).toBe(409);expect(d.action).toHaveBeenCalledTimes(1);});
});
describe("operator callback preview safety",()=>{
  const target="https://127.0.0.1:3000/api/integrations/ebay/callback?state=synthetic";
  it.each(["HEAD","POST","OPTIONS"])("rejects %s before any callback binding is read",method=>{expect(rejectLocalOperatorCallback(new Request(target,{method,headers:{host:"127.0.0.1:3000"}}),"callback")?.status).toBe(405);});
  it.each([{host:"foreign.invalid"},{host:"127.0.0.1:3000","x-forwarded-host":"foreign.invalid"},{host:"127.0.0.1:3000","x-forwarded-proto":"http"}])("rejects foreign callback %j before mutation",headers=>{expect(rejectLocalOperatorCallback(new Request(target,{headers:new Headers(Object.fromEntries(Object.entries(headers).filter((e):e is [string,string]=>!!e[1])))}),"callback")?.status).toBe(400);});
  it("rejects duplicate state without consuming it",()=>{expect(rejectLocalOperatorCallback(new Request(`${target}&state=duplicate`,{headers:{host:"127.0.0.1:3000"}}),"callback")?.status).toBe(400);});
  it("permits a genuine same-origin GET for later authenticated validation",()=>{expect(rejectLocalOperatorCallback(new Request(target,{headers:{host:"127.0.0.1:3000"}}),"callback")).toBeNull();});
});
