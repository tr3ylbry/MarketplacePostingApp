// @vitest-environment node
import net from "node:net";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { assertVerificationDatabase,assertVerificationJournal } from "../../scripts/image-verification-context";
import { verificationOutcome } from "../../scripts/image-verification-report";
import type { DiagnosticImageResult } from "../infrastructure/ebay/diagnosticImageWorkflow";
import { IMAGE_COMPARISON_RECIPE } from "../infrastructure/storage/diagnosticImageDecode";
const forbidden=vi.hoisted(()=>vi.fn(()=>{throw Error("No external or private access");}));
vi.mock("pg",()=>({Pool:class{constructor(){forbidden();}}}));
vi.mock("dotenv",()=>({config:forbidden}));vi.mock("server-only",()=>({}));
beforeAll(()=>{vi.stubGlobal("fetch",forbidden);vi.spyOn(net.Socket.prototype,"connect").mockImplementation(forbidden);});
afterEach(()=>expect(forbidden).not.toHaveBeenCalled());
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const env:NodeJS.ProcessEnv={NODE_ENV:"test",DATABASE_URL:"postgresql://127.0.0.1/synthetic_test",BETTER_AUTH_URL:"https://127.0.0.1:3000"};
it("accepts only the explicitly named loopback database without constructing a pool",()=>expect(()=>assertVerificationDatabase(env,"synthetic_test")).not.toThrow());
it.each(["another_test","synthetic_test?host=remote.invalid"])("rejects a mismatched database identity %s",name=>expect(()=>assertVerificationDatabase(env,name)).toThrow());
it.each(["host=remote.invalid","sslkey=/synthetic/private.pem","dbname=another_test","port=6432"])("rejects connection override %s",query=>{
 expect(()=>assertVerificationDatabase({...env,DATABASE_URL:env.DATABASE_URL+"?"+query},"synthetic_test")).toThrow();
});
it.each(["valid","missing","extra","hash","time","identity","unavailable"])("inspects all committed migration hashes/times without migrating: %s",async kind=>{
 let rows=readMigrationFiles({migrationsFolder:"drizzle"}).map(m=>({hash:m.hash,at:String(m.folderMillis)}));
 if(kind==="missing")rows=rows.slice(0,-1);if(kind==="extra")rows.push({...rows[rows.length-1]});if(kind==="hash")rows[0].hash="a".repeat(64);if(kind==="time")rows[0].at="0";
 const execute=vi.fn().mockResolvedValueOnce({rows:[{name:kind==="identity"?"another_test":"synthetic_test"}]}).mockResolvedValueOnce({rows});
 if(kind==="unavailable")execute.mockReset().mockRejectedValue(Error("private SQL detail"));
 const operation=assertVerificationJournal({execute} as unknown as Parameters<typeof assertVerificationJournal>[0],"synthetic_test");
 if(kind==="valid")await expect(operation).resolves.toBeUndefined();else await expect(operation).rejects.toMatchObject({code:"journal",message:"Diagnostic operator stopped."});
 expect(execute.mock.calls.length).toBeLessThanOrEqual(2);
});
function result():DiagnosticImageResult{return{state:"unknown",associated:false,retrieved:true,settlement:"settled",reason:"completed",acknowledgement:"recorded",
 diagnostic:{outcome:"retrieved",reason:"retrieved",bytes:2000,mime:"image/png",exceeded:false,unverified:true,associated:false,settlement:"settled"},
 visual:{recipe:IMAGE_COMPARISON_RECIPE,verdict:"match",reason:"matched",decoding:"passed",geometry:"passed",orientation:"passed",marker:"passed",color:"passed",similarity:"passed",settlement:"settled",associated:false,
 metrics:{orientationErrors:0,orientationMargin:107,markerErrors:0,markerMargin:107,mae:0,rmse:0,tileMae:0,anchorDelta:0}}};}
it("admits only the bounded diagnostic report, never usable-media admission",()=>expect(verificationOutcome(result())).toMatchObject({associated:false,state:"unknown",visual:{verdict:"match"}}));
it.each(["url","path","code","recipe","nan","oversize","association"])("refuses unexpected/disclosing report %s",kind=>{
 const r=result();if(kind==="url")Object.assign(r,{url:"https://sensitive.invalid/image?capability=private"});
 if(kind==="path")Object.assign(r.visual!,{path:"/private/synthetic.png"});if(kind==="code")Object.assign(r.diagnostic!,{code:"private-authorization"});
 if(kind==="recipe")Object.assign(r.visual!,{recipe:"https://sensitive.invalid/query"});if(kind==="nan")r.visual!.metrics!.mae=NaN;
 if(kind==="oversize")Object.assign(r.diagnostic!,{bytes:1_048_577});if(kind==="association")Object.assign(r,{associated:true});
 expect(()=>verificationOutcome(r)).toThrow();
});
it("keeps a peer refusal distinct from a retrieved response",()=>{
 const r=result();r.retrieved=false;r.visual=null;r.diagnostic={...r.diagnostic!,outcome:"refused",reason:"peer",bytes:0,mime:null};
 expect(verificationOutcome(r).diagnostic).toMatchObject({outcome:"refused",reason:"peer"});
});
