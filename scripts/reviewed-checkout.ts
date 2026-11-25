import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Bind to the executing module, not whichever repository the caller selected.
// Computing the URL loads no configuration and performs no Git operation.
export const OPERATOR_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const OPERATOR_REQUIRED_FILES=Object.freeze([
  "package.json","package-lock.json","tsconfig.json","scripts/ebay-image-verification.ts","scripts/reviewed-checkout.ts",
  "scripts/image-verification-options.ts","scripts/image-verification-context.ts","scripts/image-verification-report.ts",
  "scripts/image-verification-cleanup.ts","scripts/image-verification-runtime.ts","scripts/local-session.ts","scripts/private-tty-input.ts",
]);
export function assertVerificationCheckout(head:string) {
  const root=realpathSync(OPERATOR_ROOT);
  if(realpathSync(process.cwd())!==root||!/^[a-f0-9]{40}$/.test(head))throw Error("Reviewed checkout required.");
  const git=(args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8",timeout:5000,maxBuffer:1_048_576,stdio:["ignore","pipe","pipe"]}).trim();
  if(realpathSync(git(["rev-parse","--show-toplevel"]))!==root||git(["rev-parse","HEAD"])!==head||
    git(["status","--porcelain","--untracked-files=no"]))throw Error("Reviewed checkout required.");
  const tracked=new Set(git(["ls-tree","-r","--name-only",head,"--",...OPERATOR_REQUIRED_FILES]).split("\n"));
  // Even ignored/untracked source could shadow a reviewed TS import. Do not
  // inspect its contents; refuse it. The original root workspace is unaffected.
  if(OPERATOR_REQUIRED_FILES.some(path=>!tracked.has(path))||git(["ls-files","--others","--","scripts","src","drizzle"]))throw Error("Reviewed checkout required.");
}
