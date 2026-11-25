// @vitest-environment node
import { execFileSync,spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp,mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir,totalmem } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LOCAL_OPERATOR_REQUIRED_FILES,localOperatorContext,assertLocalOperatorLaunchEnvironment } from "../../scripts/local-image-operator-source";
const loader=createRequire(import.meta.url).resolve("tsx");
const clean:NodeJS.ProcessEnv={NODE_ENV:"test",PATH:process.env.PATH!,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_SYSTEM:"/dev/null",GIT_TERMINAL_PROMPT:"0"};
function git(cwd:string,args:string[]){return execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","user.name=Synthetic","-c","user.email=synthetic@example.invalid",...args],{cwd,env:clean,encoding:"utf8"}).trim();}
const valid:NodeJS.ProcessEnv={NODE_ENV:"development",LOCAL_IMAGE_OPERATOR_ID:"00000000-0000-4000-8000-000000000001",LOCAL_IMAGE_OPERATOR_HEAD:"a".repeat(40),LOCAL_IMAGE_OPERATOR_TREE:"b".repeat(40),LOCAL_IMAGE_OPERATOR_ROOT:"/synthetic",BETTER_AUTH_URL:"https://127.0.0.1:3000",EBAY_ENVIRONMENT:"sandbox",VERCEL_BLOB_RETRIES:"0",DATABASE_URL:"postgresql://synthetic:fake@127.0.0.1:5555/synthetic_test"};
const memory=String(Math.floor(Math.floor(totalmem()/1024/1024)*0.5));
const generated=`--max-old-space-size=${memory} --enable-source-maps`;
const worker={__NEXT_DEV_SERVER:"1",NEXT_PRIVATE_WORKER:"1"};
it("does not activate without a trusted launch context",()=>{expect(localOperatorContext({NODE_ENV:"test"})).toBeNull();});
it("accepts only the exact local development context",()=>{expect(localOperatorContext(valid)?.id).toBe(valid.LOCAL_IMAGE_OPERATOR_ID);});
it("accepts the installed Next development fork's own canonical runtime flags",()=>{
 const {formatNodeOptions}=createRequire(import.meta.url)("next/dist/server/lib/utils");
 const {nodeOptions}=formatNodeOptions({"max-old-space-size":memory,"enable-source-maps":true});
 expect(nodeOptions).toBe(generated);
 expect(localOperatorContext({...valid,...worker,NODE_OPTIONS:nodeOptions})?.id).toBe(valid.LOCAL_IMAGE_OPERATOR_ID);
});
it.each([{}, {__NEXT_DEV_SERVER:"1"},{NEXT_PRIVATE_WORKER:"1"},{__NEXT_DEV_SERVER:"0",NEXT_PRIVATE_WORKER:"1"}])("rejects runtime flags without both Next worker markers: %j",markers=>{
 expect(()=>localOperatorContext({...valid,...markers,NODE_OPTIONS:generated})).toThrow();
});
it.each([
 `--max-old-space-size=${memory}`,"--enable-source-maps",`--enable-source-maps --max-old-space-size=${memory}`,
 `${generated} --require=./unreviewed.cjs`,`${generated} --import=data:text/javascript,throw0`,`${generated} --inspect=0`,`${generated} --env-file=.env`,
 `${generated} --enable-source-maps`,`${generated} --max-old-space-size=${memory}`,`--max-old-space-size=0 --enable-source-maps`,
 `--max-old-space-size=0${memory} --enable-source-maps`,`--max-old-space-size=${Number(memory)+1} --enable-source-maps`,
 `--max-old-space-size="${memory}" --enable-source-maps`,`--max-old-space-size=${memory}  --enable-source-maps`,`${generated}\n`,` ${generated}`,`${generated} `,
])("rejects modified, extra or noncanonical worker options: %s",NODE_OPTIONS=>{expect(()=>localOperatorContext({...valid,...worker,NODE_OPTIONS})).toThrow();});
it("keeps the launch phase strict even for harmless generated worker flags",()=>{
 expect(()=>assertLocalOperatorLaunchEnvironment({NODE_ENV:"development"})).not.toThrow();
 for(const NODE_OPTIONS of[generated,"--enable-source-maps","--import=unreviewed",` ${generated}`])expect(()=>assertLocalOperatorLaunchEnvironment({...valid,...worker,NODE_OPTIONS})).toThrow();
});
it.each([{NODE_PATH:"/unreviewed"},{NODE_EXTRA_CA_CERTS:"/unreviewed"},{HTTPS_PROXY:"http://unreviewed.invalid"},{NODE_TLS_REJECT_UNAUTHORIZED:"0"},{VERCEL:"1"},{MARKETPLACE_TEST_BUILD:"1"}])("retains all other execution refusals at launch and in the worker: %j",extra=>{
 expect(()=>assertLocalOperatorLaunchEnvironment({...valid,...extra})).toThrow();
 expect(()=>localOperatorContext({...valid,...worker,NODE_OPTIONS:generated,...extra})).toThrow();
});
it("checks launch execution before configuration loading and again before DB/child construction",async()=>{
 const text=await readFile(new URL("../../scripts/local-image-operator.ts",import.meta.url),"utf8");
 expect(text.indexOf("assertLocalOperatorLaunchEnvironment(process.env)")).toBeLessThan(text.indexOf('loadEnvironment({path:'));
 expect(text.indexOf("assertLocalOperatorLaunchEnvironment(env)")).toBeGreaterThan(text.indexOf('loadEnvironment({path:'));
 expect(text.indexOf("assertLocalOperatorLaunchEnvironment(env)")).toBeLessThan(text.indexOf('const url=localDatabase(env)'));
});
it.each([{NODE_ENV:"production" as const},{VERCEL:"1"},{MARKETPLACE_TEST_BUILD:"1"},{BETTER_AUTH_URL:"http://127.0.0.1:3000"},{EBAY_ENVIRONMENT:"production"},{VERCEL_BLOB_RETRIES:"10"},{HTTPS_PROXY:"http://invalid"},{NODE_OPTIONS:"--import invalid"},{NODE_TLS_REJECT_UNAUTHORIZED:"0"},{LOCAL_IMAGE_OPERATOR_TREE:"wrong"},{DATABASE_URL:"postgresql://fake:fake@remote.invalid/db"}])("refuses unsafe activation %j",extra=>{expect(()=>localOperatorContext({...valid,...extra})).toThrow();});
it("binds the trusted launcher root to the exact source tree and rejects shadows/dirty content",async()=>{
 const root=await mkdtemp(join(tmpdir(),"marketplace-browser-source-"));
 try {
  git(root,["init","-q"]);
  for(const p of LOCAL_OPERATOR_REQUIRED_FILES){await mkdir(join(root,p,".."),{recursive:true});await writeFile(join(root,p),p==="package.json"?'{"type":"module"}':p==="scripts/local-image-operator-source.ts"?await readFile(new URL("../../scripts/local-image-operator-source.ts",import.meta.url)):p==="scripts/local-session.ts"?'export const LOCAL_ORIGIN="https://127.0.0.1:3000";export const localDatabase=()=>new URL("postgresql://fake@127.0.0.1/fake_test");':"// synthetic\n");}
  await writeFile(join(root,".gitignore"),"*.js\n");git(root,["add","--all"]);git(root,["commit","-qm","synthetic operator"]);
  const head=git(root,["rev-parse","HEAD"]),tree=git(root,["rev-parse","HEAD^{tree}"]);
  const check=(overrides={})=>spawnSync(process.execPath,["--import",loader,"--input-type=module","-e",`import {assertLocalOperatorSource} from ${JSON.stringify(pathToFileURL(join(root,"scripts/local-image-operator-source.ts")).href)};try{assertLocalOperatorSource(${JSON.stringify({id:valid.LOCAL_IMAGE_OPERATOR_ID,head,tree,root,...overrides})});console.log("accepted")}catch{console.log("refused");process.exitCode=1}`],{cwd:root,env:clean,encoding:"utf8",timeout:10000});
  await writeFile(join(root,"MarketplacePostingApp.code-workspace"),"{}");expect(check().status).toBe(0);expect(check({tree:"f".repeat(40)}).status).toBe(1);
  await writeFile(join(root,"scripts/local-image-operator-runtime.js"),"// ignored shadow");expect(check().status).toBe(1);await rm(join(root,"scripts/local-image-operator-runtime.js"));
  await writeFile(join(root,"package-lock.json"),"changed");expect(check().status).toBe(1);
 } finally {await rm(root,{recursive:true,force:true});}
});
