// @vitest-environment node
import { mkdtemp,readFile,stat,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImageVerificationTool } from "../../scripts/ebay-image-verification";
import { REHEARSAL_TEXT } from "../../scripts/private-tty-input";
import { privateTerminal } from "./privateTerminal";
import { OPERATOR_ROOT,OPERATOR_REQUIRED_FILES } from "../../scripts/reviewed-checkout";

const mock=vi.hoisted(()=>({head:"b".repeat(40),dirty:"",root:"",required:"",loaded:0,loadEnv:vi.fn(()=>{throw Error("Private env forbidden");}),
  run:vi.fn(async()=>({exitCode:0,report:{synthetic:true}}))}));
vi.mock("dotenv",()=>({config:mock.loadEnv}));
vi.mock("node:child_process",()=>({execFileSync:vi.fn((name:string,args:string[])=>{
  if(name!=="git")throw Error("Process forbidden");if(args[0]==="rev-parse")return args[1]==="HEAD"?mock.head:mock.root;
  return args[0]==="ls-tree"?mock.required:args[0]==="ls-files"?"":mock.dirty;
})}));
vi.mock("../../scripts/image-verification-runtime",()=>{mock.loaded++;return{runVerificationOperator:mock.run};});
vi.mock("server-only",()=>({}));
function terminal(){const t=privateTerminal();return {...t,tty:t.terminal};}
function enter(t:ReturnType<typeof terminal>,value:string){t.send(value);t.submit();}
const uuid="11111111-1111-4111-8111-111111111111",hash="a".repeat(64);
const args=["--approve-one-post-one-get","--reviewed-head","b".repeat(40),"--database","synthetic_test","--listing",uuid,"--image",uuid,
  "--listing-version","2026-11-23T00:00:00.000Z","--seller-key",hash,"--connection-version",uuid,"--source-digest",hash,"--derivative-digest",hash,
  "--comparison-recipe","generated-rgb-marker-v1;test"];
const env={NODE_ENV:"test"} as NodeJS.ProcessEnv;
beforeEach(()=>{mock.run.mockClear();mock.loadEnv.mockClear();mock.head="b".repeat(40);mock.dirty="";mock.root=OPERATOR_ROOT;mock.required=OPERATOR_REQUIRED_FILES.join("\n");mock.run.mockResolvedValue({exitCode:0,report:{synthetic:true}});});
afterEach(()=>expect(mock.loadEnv).not.toHaveBeenCalled());
async function waiting(t:ReturnType<typeof terminal>){for(let n=0;n<40&&!t.input.isRaw;n++)await new Promise<void>(r=>setImmediate(r));expect(t.input.isRaw).toBe(true);}
it("help needs neither private configuration, input nor runtime construction",async()=>{const t=terminal(),before=mock.loaded;
 expect(await runImageVerificationTool(["--help"],undefined,t.tty)).toBe(0);expect(t.text()).toContain("No OAuth, refresh or retry");expect(mock.run).not.toHaveBeenCalled();expect(mock.loaded).toBe(before);});
it.each([true,false])("uses the shared hidden rehearsal without loading runtime: matched=%s",async matched=>{const t=terminal(),before=mock.loaded,p=runImageVerificationTool(["--rehearse-input"],undefined,t.tty);
 await waiting(t);enter(t,matched?REHEARSAL_TEXT:"harmless mismatch");expect(await p).toBe(matched?0:1);expect(t.text()).toContain(`"matched":${matched}`);
 expect(t.text()).not.toContain(REHEARSAL_TEXT);expect(t.input.isRaw).toBe(false);expect(mock.loaded).toBe(before);expect(mock.run).not.toHaveBeenCalled();});
it.each(["head","dirty","flags"])("stops %s before hidden input/runtime",async kind=>{const t=terminal();if(kind==="head")mock.head="c".repeat(40);if(kind==="dirty")mock.dirty=" M synthetic.ts";
 expect(await runImageVerificationTool(kind==="flags"?["--help","--cleanup-fixture"]:args,env,t.tty)).toBe(1);expect(t.input.isRaw).toBe(false);expect(mock.run).not.toHaveBeenCalled();});
it.each(["empty","command","eof","cancel","error"])("rejects %s without runtime or echoed input",async kind=>{const t=terminal(),p=runImageVerificationTool(args,env,t.tty);await waiting(t);
 if(kind==="eof")t.input.emit("end");else if(kind==="cancel")t.send("\x03");else if(kind==="error")t.input.emit("error",Error("private error"));else enter(t,kind==="empty"?"":"node private-command");
 expect(await p).toBe(1);expect(mock.run).not.toHaveBeenCalled();expect(t.text()).not.toContain("private-command");expect(t.text()).not.toContain("private error");expect(t.input.isRaw).toBe(false);});
it("accepts only a synthetic hidden cookie and delegates, then restores handlers",async()=>{const t=terminal(),signals=process.listenerCount("SIGINT"),p=runImageVerificationTool(args,env,t.tty);await waiting(t);
 enter(t,"__Secure-better-auth.session_token=synthetic-session.signature");expect(await p).toBe(0);expect(mock.run).toHaveBeenCalledOnce();
 expect(t.text()).not.toContain("synthetic-session.signature");expect(t.text()).toContain('"synthetic":true');expect(process.listenerCount("SIGINT")).toBe(signals);expect(t.input.isRaw).toBe(false);});
it("rejects overlapping operational invocations while the first input is hidden",async()=>{const t=terminal(),p=runImageVerificationTool(args,env,t.tty);await waiting(t);const other=terminal();
 expect(await runImageVerificationTool(args,env,other.tty)).toBe(1);expect(other.text()).toContain('"busy"');t.send("\x03");expect(await p).toBe(1);expect(mock.run).not.toHaveBeenCalled();});
it("never prints an underlying runtime error or retries",async()=>{mock.run.mockRejectedValueOnce(Error("https://sensitive.invalid/raw?token=secret"));const t=terminal(),p=runImageVerificationTool(args,env,t.tty);await waiting(t);
 enter(t,"__Secure-better-auth.session_token=synthetic-session.signature");expect(await p).toBe(1);expect(mock.run).toHaveBeenCalledOnce();expect(t.text()).not.toMatch(/sensitive|secret|signature/);});
it("generates a unique local fixture and exact derivative pins without loading runtime/config, and never overwrites",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"marketplace-operator-vector-")),path=join(dir,"generated.png"),t=terminal(),before=mock.loaded;
 try{expect(await runImageVerificationTool(["--fixture",path],env,t.tty)).toBe(0);const value=JSON.parse(t.text().trim());
  expect(value).toMatchObject({generated:true,width:500,height:600});expect(value.sourceDigest).toMatch(/^[a-f0-9]{64}$/);expect(value.derivativeDigest).toMatch(/^[a-f0-9]{64}$/);
  expect((await stat(path)).mode&0o777).toBe(0o600);const original=await readFile(path);expect(await runImageVerificationTool(["--fixture",path],env,terminal().tty)).toBe(1);expect(await readFile(path)).toEqual(original);
  expect(t.text()).not.toContain(path);expect(mock.loaded).toBe(before);expect(mock.run).not.toHaveBeenCalled();
 }finally{await rm(dir,{recursive:true,force:true});}
});
