import { handleEbayCallback } from "./ebayCallback";
import nextConfig from "../../next.config";
const origin="https://127.0.0.1:3000", state="s".repeat(43);
const request=(query:string, host="127.0.0.1:3000", urlOrigin=origin)=>new Request(`${urlOrigin}/api/integrations/ebay/callback?${query}`,{headers:{host}});
const session=vi.fn(async()=>({owner:"owner-a",sessionId:"session-a"})), complete=vi.fn(async()=>undefined);
beforeEach(()=>vi.clearAllMocks());
it("preserves original callback origins through the documented framework normalization setting", () => {
  expect(nextConfig.skipProxyUrlNormalize).toBe(true);
});
it("does not consume state or exchange a code on a framework-generated HEAD request", async () => {
  const response = await handleEbayCallback(new Request(`${origin}/api/integrations/ebay/callback?state=${state}&code=synthetic`, { method: "HEAD", headers: { host: "127.0.0.1:3000" } }), "callback", { origin, session, complete });
  expect(response.status).toBe(405);
  expect(session).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
it("processes the accepted callback server-side and redirects away from code/state with no-store/no-referrer",async()=>{
  const result=await handleEbayCallback(request(`state=${state}&code=private-code`),"callback",{origin,session,complete});
  expect(complete).toHaveBeenCalledWith("owner-a","session-a",state,"private-code",false);
  expect(result.status).toBe(303); expect(result.headers.get("location")).toBe(origin+"/settings/integrations/ebay?result=connected");
  expect(result.headers.get("cache-control")).toContain("no-store"); expect(result.headers.get("referrer-policy")).toBe("no-referrer"); expect(await result.text()).toBe("");
});
it.each([["foreign.example",origin],["127.0.0.1:3000","http://127.0.0.1:3000"],["localhost:3000","https://localhost:3000"]])("rejects forged host/scheme before session or provider access",async(host,urlOrigin)=>{
  expect((await handleEbayCallback(request(`state=${state}&code=x`,host,urlOrigin),"callback",{origin,session,complete})).status).toBe(400);expect(session).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
});
it("rejects forwarded-host spoofing, duplicate parameters and absent sessions",async()=>{
  const forged=request(`state=${state}`);forged.headers.set("x-forwarded-host","attacker.example");
  expect((await handleEbayCallback(forged,"callback",{origin,session,complete})).status).toBe(400);
  await handleEbayCallback(request(`state=${state}&state=other&code=x`),"callback",{origin,session,complete});expect(complete).not.toHaveBeenCalled();
  await handleEbayCallback(request(`state=${state}&code=x`),"callback",{origin,session:async()=>null,complete});expect(complete).not.toHaveBeenCalled();
});
it("handles denied consent by consuming valid state without exchanging a code",async()=>{
  const result=await handleEbayCallback(request(`state=${state}&error=access_denied`),"callback",{origin,session,complete});
  expect(complete).toHaveBeenCalledWith("owner-a","session-a",state,null,true);expect(result.headers.get("location")).toContain("result=denied");
});
it("handles a declined route without provider state without mutating credentials or pending state",async()=>{
  const result=await handleEbayCallback(new Request(origin+"/api/integrations/ebay/declined",{headers:{host:"127.0.0.1:3000"}}),"declined",{origin,session,complete});
  expect(complete).not.toHaveBeenCalled();expect(result.headers.get("location")).toContain("result=denied");
});
it("contains unexpected provider/SQL failures without exposing raw codes or bodies",async()=>{
  const result=await handleEbayCallback(request(`state=${state}&code=private-code`),"callback",{origin,session,complete:async()=>{throw new Error("private-token-provider-body");}});
  expect(result.headers.get("location")).toContain("result=failed");expect(await result.text()).not.toContain("private");
});
