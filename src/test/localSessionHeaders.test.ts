// @vitest-environment node
import { randomUUID } from "node:crypto";
import { openLocalSessionReader, LOCAL_ORIGIN } from "../../scripts/local-session";

const mocks=vi.hoisted(()=>({query:vi.fn(),getSession:vi.fn(),end:vi.fn(),listeners:new Map<string,()=>void>()}));
vi.mock("pg",()=>({Pool:class{
  on(name:string,handler:()=>void){mocks.listeners.set(name,handler);return this;}
  query=mocks.query;end=mocks.end;
}}));
vi.mock("drizzle-orm/node-postgres",()=>({drizzle:()=>({})}));
vi.mock("better-auth",()=>({betterAuth:()=>({api:{getSession:mocks.getSession}})}));
vi.mock("../../src/auth/options",()=>({authOptions:()=>({session:{cookieCache:{enabled:false}}})}));
vi.mock("dotenv",()=>{throw Error("Private configuration forbidden");});
const env:NodeJS.ProcessEnv={NODE_ENV:"test",DATABASE_URL:"postgresql://127.0.0.1/synthetic_test",BETTER_AUTH_URL:LOCAL_ORIGIN};
let owner:string,id:string;
beforeEach(()=>{
 owner=randomUUID();id=randomUUID();mocks.listeners.clear();mocks.query.mockReset().mockResolvedValue({rows:[{transaction_read_only:"on"}]});mocks.end.mockReset().mockResolvedValue(undefined);
 mocks.getSession.mockReset().mockResolvedValue({response:{user:{id:owner},session:{id,userId:owner,expiresAt:new Date(Date.now()+3600000)}},headers:new Headers()});
});
it("passes an isolated copy of ordinary browser headers to genuine GET validation and returns no credentials",async()=>{
 const incoming=new Headers({cookie:"ui=compact; __Secure-better-auth.session_token=synthetic; other=state",origin:LOCAL_ORIGIN});
 const reader=openLocalSessionReader(env,true);
 try{
  const actor=await reader.sessionFromHeaders(incoming);
  expect(actor).toEqual({ownerId:owner,id,expiresAt:expect.any(String)});
  const request=mocks.getSession.mock.calls[0][0];expect(request).toMatchObject({method:"GET",query:{disableRefresh:true,disableCookieCache:true},returnHeaders:true});
  expect(request.headers).not.toBe(incoming);expect([...request.headers]).toEqual([...incoming]);
  request.headers.delete("cookie");expect(incoming.get("cookie")).toContain("synthetic");
  expect(JSON.stringify(actor)).not.toMatch(/cookie|synthetic|token|headers/i);
 }finally{await reader.close();}
 expect(mocks.end).toHaveBeenCalledOnce();
});
it("refuses a live validation that tries to emit a replacement cookie",async()=>{
 mocks.getSession.mockResolvedValue({response:{user:{id:owner},session:{id,userId:owner,expiresAt:new Date(Date.now()+3600000)}},headers:new Headers({"set-cookie":"synthetic-replacement"})});
 const reader=openLocalSessionReader(env);try{await expect(reader.sessionFromHeaders(new Headers())).rejects.toMatchObject({code:"unavailable",message:"Local session unavailable."});}finally{await reader.close();}
});
it("discards rejected-session cookie clearing headers rather than returning or forwarding them",async()=>{
 mocks.getSession.mockResolvedValue({response:null,headers:new Headers({"set-cookie":"synthetic-clear"})});
 const reader=openLocalSessionReader(env);try{expect(await reader.sessionFromHeaders(new Headers())).toBeNull();}finally{await reader.close();}
});
it("checks read-only enforcement before returning headers or validating a session",async()=>{
 mocks.query.mockResolvedValue({rows:[{transaction_read_only:"off"}]});
 const reader=openLocalSessionReader(env);try{
  await expect(reader.headersFromRequest(new Headers({cookie:"synthetic"}))).rejects.toMatchObject({code:"unavailable"});
  await expect(reader.sessionFromHeaders(new Headers({cookie:"synthetic"}))).rejects.toMatchObject({code:"unavailable"});
  expect(mocks.getSession).not.toHaveBeenCalled();
 }finally{await reader.close();}
});
it("fails closed after a pool error and does not disclose underlying authentication errors",async()=>{
 const reader=openLocalSessionReader(env);try{
  mocks.getSession.mockRejectedValue(Error("private cookie or SQL detail"));
  await expect(reader.sessionFromHeaders(new Headers())).rejects.toMatchObject({message:"Local session unavailable.",code:"unavailable"});
  mocks.getSession.mockClear();mocks.query.mockClear();mocks.listeners.get("error")!();
  await expect(reader.headersFromRequest(new Headers())).rejects.toMatchObject({code:"unavailable"});
  expect(mocks.query).not.toHaveBeenCalled();expect(mocks.getSession).not.toHaveBeenCalled();
 }finally{await reader.close();}
});
it("preserves manual exact-cookie format rejection before any session query",async()=>{
 const reader=openLocalSessionReader(env);try{await expect(reader.session("node synthetic-command")).rejects.toMatchObject({code:"format"});expect(mocks.query).not.toHaveBeenCalled();expect(mocks.getSession).not.toHaveBeenCalled();}finally{await reader.close();}
});
