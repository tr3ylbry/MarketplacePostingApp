import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { totalmem } from "node:os";
import { LOCAL_ORIGIN, localDatabase } from "./local-session";

export interface LocalOperatorActivationContext { id:string;head:string;tree:string;root:string }
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha=/^[a-f0-9]{40}$/;
const unsafeExecutionKeys=["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy","NODE_PATH","NODE_EXTRA_CA_CERTS"];
const unsafeExecutionEnvironment=(env:NodeJS.ProcessEnv)=>unsafeExecutionKeys.some(k=>!!env[k])||env.NODE_TLS_REJECT_UNAUTHORIZED==="0"||!!env.VERCEL||env.MARKETPLACE_TEST_BUILD==="1";

// The launcher accepts no inherited Node options, even options which the Next
// worker may later generate. Call before private configuration and after dotenv.
export function assertLocalOperatorLaunchEnvironment(env:NodeJS.ProcessEnv) {
  if(env.NODE_OPTIONS||unsafeExecutionEnvironment(env))throw Error("Local operator disabled.");
}
function reviewedNextWorkerOptions(env:NodeJS.ProcessEnv) {
  if(!env.NODE_OPTIONS)return true;
  if(env.__NEXT_DEV_SERVER!=="1"||env.NEXT_PRIVATE_WORKER!=="1")return false;
  // Locked Next 16's clean development fork generates this exact pair. Match
  // its own default calculation/format; never parse or allow arbitrary flags.
  const memory=Math.floor(Math.floor(totalmem()/1024/1024)*0.5);
  return Number.isSafeInteger(memory)&&memory>0&&env.NODE_OPTIONS===`--max-old-space-size=${memory} --enable-source-maps`;
}
export const LOCAL_OPERATOR_REQUIRED_FILES=Object.freeze(["scripts/local-image-operator.ts","scripts/local-image-operator-source.ts","scripts/local-image-operator-runtime.ts","scripts/local-image-operator-pins.ts",
  "scripts/local-image-operator-fixture.ts","src/application/localImageOperatorHttp.ts","src/application/localImageOperator.ts",
  "src/infrastructure/repositories/drizzleLocalImageOperatorRepository.ts","src/infrastructure/db/localImageOperatorSchema.ts",
  "src/app/api/operator/ebay-image-verification/route.ts","src/app/operator/ebay-image-verification/page.tsx","scripts/image-verification-runtime.ts",
  "scripts/local-session.ts","package.json","package-lock.json","next.config.ts","drizzle/meta/_journal.json"]);

// This context is installed by the reviewed Node launcher. Browser input cannot
// set it. Presence of flags alone grants nothing: every request checks its SQL row.
export function localOperatorContext(env:NodeJS.ProcessEnv):LocalOperatorActivationContext|null {
  if(!env.LOCAL_IMAGE_OPERATOR_ID)return null;
  const {LOCAL_IMAGE_OPERATOR_ID:id,LOCAL_IMAGE_OPERATOR_HEAD:head,LOCAL_IMAGE_OPERATOR_TREE:tree,LOCAL_IMAGE_OPERATOR_ROOT:root}=env;
  if(!uuid.test(id)||!sha.test(head??"")||!sha.test(tree??"")||!root||env.NODE_ENV!=="development"||
    env.BETTER_AUTH_URL!==LOCAL_ORIGIN||env.EBAY_ENVIRONMENT!=="sandbox"||env.VERCEL_BLOB_RETRIES!=="0"||
    unsafeExecutionEnvironment(env)||!reviewedNextWorkerOptions(env))throw Error("Local operator disabled.");
  localDatabase(env);
  return {id,head:head!,tree:tree!,root};
}

export function assertLocalOperatorSource(context:LocalOperatorActivationContext) {
  const root=realpathSync(context.root);
  const git=(args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8",timeout:5000,maxBuffer:1_048_576,stdio:["ignore","pipe","pipe"]}).trim();
  if(realpathSync(process.cwd())!==root||realpathSync(git(["rev-parse","--show-toplevel"]))!==root||
    git(["rev-parse","HEAD"])!==context.head||git(["rev-parse","HEAD^{tree}"])!==context.tree||
    git(["status","--porcelain","--untracked-files=no"])||git(["ls-files","--others","--","scripts","src","drizzle"]))throw Error("Reviewed checkout required.");
  const tracked=new Set(git(["ls-tree","-r","--name-only",context.head,"--",...LOCAL_OPERATOR_REQUIRED_FILES]).split("\n"));
  if(LOCAL_OPERATOR_REQUIRED_FILES.some(p=>!tracked.has(p)))throw Error("Reviewed checkout required.");
}
