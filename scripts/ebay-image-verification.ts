// Deliberately manual. No application/route/job imports this entry point.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReadStream, WriteStream } from "node:tty";
import { imageVerificationOptions } from "./image-verification-options";
import { readPrivateInput, localSessionCookie, PrivateInputError, REHEARSAL_TEXT } from "./private-tty-input";
import { assertVerificationCheckout,OPERATOR_ROOT } from "./reviewed-checkout";

type Terminal = {input:ReadStream;output:WriteStream};
let active=false;
export async function runImageVerificationTool(args:string[],env:NodeJS.ProcessEnv=process.env,
  terminal:Terminal={input:process.stdin,output:process.stdout}):Promise<number> {
  let owned=false,parsed=false;
  const report=(value:object)=>terminal.output.write(JSON.stringify(value)+"\n");
  try {
    const options=imageVerificationOptions(args);
    parsed=true;
    if(options.mode==="help"){
      terminal.output.write("Manual M3 diagnostic only. Modes: --help | --rehearse-input | --fixture ABSOLUTE_OUTPUT | --approve-one-post-one-get | --cleanup-fixture. Operational modes require --reviewed-head SHA --database NAME --listing UUID --image UUID --listing-version ISO --seller-key HASH --connection-version UUID --source-digest HASH --derivative-digest HASH; verification also requires --comparison-recipe EXACT_RECIPE. No OAuth, refresh or retry. Flags assert separately obtained owner approval; they do not create it. See docs/ebay-image-verification-operator.md.\n");return 0;
    }
    if(options.mode==="rehearse-input"){
      const value=await readPrivateInput("Paste only the harmless rehearsal text, then press Enter (hidden): ",terminal.input,terminal.output);
      const matched=value===REHEARSAL_TEXT;report({rehearsal:true,matched});return matched?0:1;
    }
    if(active){report({stopped:true,failure:"busy"});return 1;}active=true;owned=true;
    if(options.mode==="fixture"){
      const {generateVerificationFixture}=await import("../src/infrastructure/storage/verificationFixture");
      const {photoTransformer,PHOTO_RECIPE}=await import("../src/infrastructure/storage/photoDerivative/transformPhoto");
      const {IMAGE_COMPARISON_RECIPE}=await import("../src/infrastructure/storage/diagnosticImageDecode");
      const {acquirePhotoCapacity,borrowPhotoCapacity,releasePhotoCapacity}=await import("../src/application/photoCapacity");
      const lease=acquirePhotoCapacity(),finish=borrowPhotoCapacity(lease),signal=AbortSignal.timeout(5000),deadline=performance.now()+5000;
      let source:Awaited<ReturnType<typeof generateVerificationFixture>>|undefined,photo:Awaited<ReturnType<typeof photoTransformer.transform>>|undefined;
      try{
        source=await generateVerificationFixture();signal.throwIfAborted();
        photo=await photoTransformer.transform(source.bytes,"image/png",signal,deadline);signal.throwIfAborted();
        if(source.bytes.length>1_048_576||photo.sourceDigest!==source.sourceDigest||photo.contentType!=="image/png"||photo.width!==500||photo.height!==600||photo.size>1_048_576)throw Error();
        await writeFile(options.output,source.bytes,{mode:0o600,flag:"wx"});
        report({generated:true,width:500,height:600,sourceDigest:source.sourceDigest,derivativeDigest:photo.derivativeDigest,
          fixtureTitle:`SANDBOX M3 Generated ${source.sourceDigest.slice(0,12)}`,derivativeRecipe:PHOTO_RECIPE,comparisonRecipe:IMAGE_COMPARISON_RECIPE});return 0;
      }finally{source?.bytes.fill(0);photo?.bytes.fill(0);finish();releasePhotoCapacity(lease);}
    }
    const stillReviewed=()=>assertVerificationCheckout(options.pins.head);
    stillReviewed();
    const cancel=new AbortController(),interrupt=()=>cancel.abort();
    process.once("SIGINT",interrupt);process.once("SIGTERM",interrupt);
    try{
      // Help/rehearsal/fixture never import dotenv, pools, auth or real clients.
      // Synthetic tests pass a clean explicit environment, so no ignored file loads.
      if(env===process.env){const {config}=await import("dotenv");config({path:resolve(OPERATOR_ROOT,".env.local"),quiet:true});}
      cancel.signal.throwIfAborted();
      const cookie=localSessionCookie(await readPrivateInput("Paste ONLY __Secure-better-auth.session_token=VALUE from the LOCAL HTTPS app, then press Enter (hidden): ",terminal.input,terminal.output));
      cancel.signal.throwIfAborted();stillReviewed();
      const {runVerificationOperator}=await import("./image-verification-runtime");
      const result=await runVerificationOperator(options,env,cookie,cancel.signal,stillReviewed);
      report(result.report);return result.exitCode;
    }finally{process.off("SIGINT",interrupt);process.off("SIGTERM",interrupt);}
  }catch(error){
    const candidate=error&&typeof error==="object"&&"code"in error?String(error.code):"unavailable";
    const safe=!parsed?"flags":["tty","format","too-long","cancelled","eof","input","configuration","journal","context","busy","unavailable"].includes(candidate)?candidate:error instanceof PrivateInputError?"input":"unavailable";
    report({stopped:true,failure:safe,requestAccounting:"unverified-stop-no-retry",associated:false});return 1;
  }finally{if(owned)active=false;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await runImageVerificationTool(process.argv.slice(2));
