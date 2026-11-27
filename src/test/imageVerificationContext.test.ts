// @vitest-environment node
import net from "node:net";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 visual:{recipe:IMAGE_COMPARISON_RECIPE,verdict:"match",reason:"matched",decoding:"passed",geometry:"passed",orientation:"passed",marker:"passed",color:"passed",similarity:"passed",settlement:"settled",associated:false,encodedDimensions:{width:500,height:600},
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

it.each([null,{width:600,height:500},{width:0,height:0xffffffff}])("reports only bounded header dimensions %j without admitting a mismatch",encodedDimensions=>{
 const r=result();Object.assign(r.visual!,{verdict:"inconclusive",reason:"geometry",decoding:"not-run",geometry:"failed",encodedDimensions,metrics:null});
 expect(verificationOutcome(r)).toMatchObject({associated:false,state:"unknown",visual:{verdict:"inconclusive",encodedDimensions}});
});
it.each([{width:-1,height:600},{width:500,height:0x100000000},{width:NaN,height:600},{width:500,height:Infinity},
 {width:500.5,height:600},{width:"500",height:600},{width:500},{width:500,height:600,url:"https://private.invalid/capability"}])("refuses invalid/disclosing dimensions %j",encodedDimensions=>{
 const r=result();Object.assign(r.visual!,{encodedDimensions});expect(()=>verificationOutcome(r)).toThrow();
});

it("reads a supplied trusted source root without changing the manual default root",async()=>{
 const root=mkdtempSync(join(tmpdir(),"marketplace-operator-journal-"));
 try{
  mkdirSync(join(root,"drizzle","meta"),{recursive:true});
  const entries=Array.from({length:15},(_,idx)=>({idx,version:"7",when:1700000000000+idx,tag:`${String(idx).padStart(4,"0")}_synthetic`,breakpoints:true}));
  writeFileSync(join(root,"drizzle","meta","_journal.json"),JSON.stringify({version:"7",dialect:"postgresql",entries}));
  for(const entry of entries)writeFileSync(join(root,"drizzle",entry.tag+".sql"),`SELECT ${entry.idx};`);
  const rows=readMigrationFiles({migrationsFolder:join(root,"drizzle")}).map(m=>({hash:m.hash,at:String(m.folderMillis)}));
  const database=()=>({execute:vi.fn().mockResolvedValueOnce({rows:[{name:"synthetic_test"}]}).mockResolvedValueOnce({rows})}) as unknown as Parameters<typeof assertVerificationJournal>[0];
  await expect(assertVerificationJournal(database(),"synthetic_test",root)).resolves.toBeUndefined();
  await expect(assertVerificationJournal(database(),"synthetic_test")).rejects.toMatchObject({code:"journal",message:"Diagnostic operator stopped."});
  await expect(assertVerificationJournal(database(),"synthetic_test",join(root,"missing"))).rejects.toMatchObject({code:"journal",message:"Diagnostic operator stopped."});
 }finally{rmSync(root,{recursive:true,force:true});}
});
