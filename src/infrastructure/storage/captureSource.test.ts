// @vitest-environment node
import { MockAgent,getGlobalDispatcher,setGlobalDispatcher } from "undici";
import { getVercelOidcToken } from "@vercel/oidc";
import { captureSource } from "./captureSource";
vi.mock("server-only",()=>({}));
vi.mock("@vercel/oidc",()=>({getVercelOidcToken:vi.fn(()=>{throw new Error("Implicit credential discovery forbidden");})}));
const source={kind:"vercel-blob" as const,pathname:"images/11111111-1111-4111-8111-111111111111/photo.png",originalFilename:"generated.png",contentType:"image/png" as const,size:12,uploadedAt:"2026-01-01T00:00:00.000Z"};
let agent:MockAgent,original:ReturnType<typeof getGlobalDispatcher>;
beforeEach(()=>{original=getGlobalDispatcher();agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent);vi.mocked(getVercelOidcToken).mockClear();});
afterEach(async()=>{setGlobalDispatcher(original);await agent.close();});
it.each(["token","oidc"])("uses the actual Blob SDK with explicit synthetic %s and no implicit discovery",async mode=>{
 const token=mode==="token"?"vercel_blob_rw_synthetic_fixture":"synthetic-oidc";
 const env=mode==="token"?{BLOB_READ_WRITE_TOKEN:token}:{VERCEL_OIDC_TOKEN:token,BLOB_STORE_ID:"store_synthetic"};
 agent.get("https://synthetic.private.blob.vercel-storage.com").intercept({method:"GET",path:"/images/11111111-1111-4111-8111-111111111111/photo.png?cache=0",headers:{authorization:`Bearer ${token}`}}).reply(200,Buffer.alloc(12),{headers:{"Content-Type":"image/png","Content-Length":"12"}});
 expect(await captureSource(env).readPrivateImage(source,AbortSignal.timeout(1000))).toEqual(Buffer.alloc(12));
 expect(getVercelOidcToken).not.toHaveBeenCalled();agent.assertNoPendingInterceptors();
});
it.each([{}, {BLOB_STORE_ID:"store_synthetic"},{VERCEL_OIDC_TOKEN:"synthetic"},{BLOB_READ_WRITE_TOKEN:"bad\nvalue"}])("refuses absent/incomplete explicit credentials without discovery %#",env=>{
 expect(()=>captureSource(env)).toThrow();expect(getVercelOidcToken).not.toHaveBeenCalled();
});
it("preserves bounded-reader size validation on actual SDK responses and keeps errors generic",async()=>{
 agent.get("https://synthetic.private.blob.vercel-storage.com").intercept({method:"GET",path:"/images/11111111-1111-4111-8111-111111111111/photo.png?cache=0"}).reply(200,Buffer.alloc(13),{headers:{"Content-Type":"image/png","Content-Length":"13"}});
 await expect(captureSource({VERCEL_OIDC_TOKEN:"synthetic",BLOB_STORE_ID:"store_synthetic"}).readPrivateImage(source,AbortSignal.timeout(1000))).rejects.toThrow("could not be verified");
 expect(getVercelOidcToken).not.toHaveBeenCalled();agent.assertNoPendingInterceptors();
});
