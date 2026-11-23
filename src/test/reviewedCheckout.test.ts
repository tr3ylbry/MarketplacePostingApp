// @vitest-environment node
import { execFileSync,spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp,mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OPERATOR_REQUIRED_FILES } from "../../scripts/reviewed-checkout";

const loader=createRequire(import.meta.url).resolve("tsx");
const clean={NODE_ENV:"test" as const,PATH:process.env.PATH!,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_SYSTEM:"/dev/null",GIT_TERMINAL_PROMPT:"0"};
function git(cwd:string,args:string[]){return execFileSync("git",["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","user.name=Synthetic","-c","user.email=synthetic@example.invalid",...args],{cwd,env:clean,encoding:"utf8"}).trim();}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"marketplace-reviewed-tree-")),a=join(root,"a");await mkdir(a);git(a,["init","-q"]);
 await writeFile(join(a,"package.json"),'{"type":"module"}');await writeFile(join(a,".gitignore"),'*.js\n');git(a,["add","--all"]);git(a,["commit","-qm","synthetic baseline"]);
 const base=git(a,["rev-parse","HEAD"]);
 for(const file of OPERATOR_REQUIRED_FILES){const target=join(a,file);await mkdir(join(target,".."),{recursive:true});
  if(file==="package.json")continue;
  await writeFile(target,file==="scripts/reviewed-checkout.ts"?await readFile(new URL("../../scripts/reviewed-checkout.ts",import.meta.url)):file.endsWith(".json")?"{}":"// synthetic tracked module\n");
 }
 return{root,a,base};
}
function check(sourceRoot:string,cwd:string,head:string){
 const module=pathToFileURL(join(sourceRoot,"scripts/reviewed-checkout.ts")).href;
 return spawnSync(process.execPath,["--import",loader,"--input-type=module","-e",`import {assertVerificationCheckout} from ${JSON.stringify(module)};try{assertVerificationCheckout(${JSON.stringify(head)});console.log('accepted')}catch{console.log('refused');process.exitCode=1}`],{cwd,env:clean,encoding:"utf8",timeout:10_000});
}
it("rejects operational modules absent from the reviewed commit, with no config/runtime construction",async()=>{
 const f=await fixture();try{const r=check(f.a,f.a,f.base);expect(r.status).toBe(1);expect(r.stdout.trim()).toBe("refused");}finally{await rm(f.root,{recursive:true,force:true});}
});
it("accepts the exact tracked tree and original root workspace, but refuses ignored source shadowing",async()=>{
 const f=await fixture();try{git(f.a,["add","--all"]);git(f.a,["commit","-qm","synthetic operator"]);const head=git(f.a,["rev-parse","HEAD"]);
  await writeFile(join(f.a,"MarketplacePostingApp.code-workspace"),'{}');expect(check(f.a,f.a,head).status).toBe(0);
  const shadow=join(f.a,"scripts/image-verification-runtime.js");await writeFile(shadow,"// ignored unreviewed shadow\n");
  const refused=check(f.a,f.a,head);expect(refused.status).toBe(1);expect(refused.stdout.trim()).toBe("refused");
  await rm(shadow);expect(check(f.a,f.a,head).status).toBe(0);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it("cannot validate a different clean approved checkout while executing a dirty source tree",async()=>{
 const f=await fixture();try{git(f.a,["add","--all"]);git(f.a,["commit","-qm","synthetic operator"]);const head=git(f.a,["rev-parse","HEAD"]),b=join(f.root,"b");
  git(f.root,["clone","--quiet","--no-hardlinks",f.a,b]);expect(git(b,["status","--porcelain"])).toBe("");expect(git(b,["rev-parse","HEAD"])).toBe(head);
  await writeFile(join(f.a,"scripts/image-verification-runtime.ts"),"// changed executing tree\n");
  const r=check(f.a,b,head);expect(r.status).toBe(1);expect(r.stdout.trim()).toBe("refused");
 }finally{await rm(f.root,{recursive:true,force:true});}
});
