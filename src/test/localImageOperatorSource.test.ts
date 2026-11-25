// @vitest-environment node
import { execFileSync,spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp,mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LOCAL_OPERATOR_REQUIRED_FILES,localOperatorContext } from "../../scripts/local-image-operator-source";
const loader=createRequire(import.meta.url).resolve("tsx");
const clean:NodeJS.ProcessEnv={NODE_ENV:"test",PATH:process.env.PATH!,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_SYSTEM:"/dev/null",GIT_TERMINAL_PROMPT:"0"};
function git(cwd:string,args:string[]){return execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","user.name=Synthetic","-c","user.email=synthetic@example.invalid",...args],{cwd,env:clean,encoding:"utf8"}).trim();}
const valid:NodeJS.ProcessEnv={NODE_ENV:"development",LOCAL_IMAGE_OPERATOR_ID:"00000000-0000-4000-8000-000000000001",LOCAL_IMAGE_OPERATOR_HEAD:"a".repeat(40),LOCAL_IMAGE_OPERATOR_TREE:"b".repeat(40),LOCAL_IMAGE_OPERATOR_ROOT:"/synthetic",BETTER_AUTH_URL:"https://127.0.0.1:3000",EBAY_ENVIRONMENT:"sandbox",VERCEL_BLOB_RETRIES:"0",DATABASE_URL:"postgresql://synthetic:fake@127.0.0.1:5555/synthetic_test"};
it("does not activate without a trusted launch context",()=>{expect(localOperatorContext({NODE_ENV:"test"})).toBeNull();});
it("accepts only the exact local development context",()=>{expect(localOperatorContext(valid)?.id).toBe(valid.LOCAL_IMAGE_OPERATOR_ID);});
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
