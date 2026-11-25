import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/infrastructure/db/schema";
import { getDatabase } from "../src/infrastructure/db/client";
import { DrizzleLocalImageOperatorRepository, type LocalImageOperatorActivation } from "../src/infrastructure/repositories/drizzleLocalImageOperatorRepository";
import { createEbayConnectionService } from "../src/application/ebayConnectionService";
import { EbayError, type EbayGateway } from "../src/application/ebayConnection";
import { EbayClient } from "../src/infrastructure/ebay/ebayClient";
import { ebayConfig } from "../src/infrastructure/ebay/config";
import { EbayTokenCipher } from "../src/infrastructure/ebay/tokenCipher";
import { createLocalOperatorRegistry, type LocalOperatorRegistry } from "../src/application/localImageOperatorRegistry";
import { LocalOperatorError, type LocalOperatorView } from "../src/application/localImageOperator";
import { mediaSessionHash } from "../src/application/ebayRealMedia";
import { handleLocalOperatorRequest, rejectLocalOperatorCallback, type LocalOperatorActor, localOperatorHeaders } from "../src/application/localImageOperatorHttp";
import { handleEbayCallback } from "../src/application/ebayCallback";
import { openLocalDatabasePool, openLocalSessionReader, localDatabase, LOCAL_ORIGIN } from "./local-session";
import { assertLocalOperatorSource, localOperatorContext, type LocalOperatorActivationContext } from "./local-image-operator-source";
import { assertVerificationJournal } from "./image-verification-context";
import { runVerificationOperatorWithHeaders } from "./image-verification-runtime";
import { createLocalOperatorFixturePreparer } from "./local-image-operator-fixture";
import { localOperatorVerificationPins } from "./local-image-operator-pins";
import type { VerificationPins } from "./image-verification-options";
import { PHOTO_RECIPE } from "../src/infrastructure/storage/photoDerivative/transformPhoto";
import { IMAGE_COMPARISON_RECIPE } from "../src/infrastructure/storage/diagnosticImageDecode";

const registryKey=Symbol.for("marketplace.local-image-operator.work.v1");
const globalRegistry=globalThis as typeof globalThis & {[registryKey]?:LocalOperatorRegistry};
const registry=()=>globalRegistry[registryKey]??=createLocalOperatorRegistry();
const databaseName=(env:NodeJS.ProcessEnv)=>decodeURIComponent(localDatabase(env).pathname.slice(1));
function context(env:NodeJS.ProcessEnv) {
  const c=localOperatorContext(env);if(!c)throw new LocalOperatorError("disabled");assertLocalOperatorSource(c);return c;
}
function match(row:LocalImageOperatorActivation|null,c:LocalOperatorActivationContext) {
  if(!row||row.id!==c.id||row.reviewedHead!==c.head||row.reviewedTree!==c.tree||row.derivativeRecipe!==PHOTO_RECIPE||row.comparisonRecipe!==IMAGE_COMPARISON_RECIPE)throw new LocalOperatorError("context");
  return row;
}
function pins(row:LocalImageOperatorActivation,env:NodeJS.ProcessEnv):VerificationPins {
  return localOperatorVerificationPins(row,databaseName(env));
}
async function withRepository<T>(env:NodeJS.ProcessEnv,c:LocalOperatorActivationContext,fn:(repo:DrizzleLocalImageOperatorRepository,db:ReturnType<typeof drizzle<typeof schema>>)=>Promise<T>) {
  assertLocalOperatorSource(c);
  const pool=openLocalDatabasePool(env,"execution",true);
  pool.on("error",()=>{ /* Errors are handled by the bounded operation; never log raw values. */ });
  try {const db=drizzle(pool,{schema});await assertVerificationJournal(db,databaseName(env),c.root);return await fn(new DrizzleLocalImageOperatorRepository(db),db);}
  finally {await pool.end();}
}
async function session(env:NodeJS.ProcessEnv,h:Headers) {
  const reader=openLocalSessionReader(env,true);
  try {return await reader.sessionFromHeaders(h);}finally {await reader.close();}
}
async function view(row:LocalImageOperatorActivation,repo:DrizzleLocalImageOperatorRepository,actor:LocalOperatorActor):Promise<LocalOperatorView> {
  const run=registry().get(row.id,"run"),fixture=registry().get(row.id,"fixture");
  const retainUntil=row.imageId?await repo.fixtureRetentionUntil(row.id,row.ownerId):null;
  let phase=row.phase as LocalOperatorView["phase"];
  if((phase==="running"&&(!run||run.settled))||(phase==="fixture-preparing"&&(!fixture||fixture.settled)))phase="unknown";
  const sessionMatches=!row.sessionHash||row.sessionHash===mediaSessionHash(actor.ownerId,actor.id);
  const live=sessionMatches&&Date.parse(row.expiresAt)>Date.now()&&!row.stoppedAt&&!row.cancelRequestedAt;
  return {phase,revision:row.revision,canConsent:live&&phase==="armed"&&!row.consentStartedAt,
    canPrepare:live&&phase==="connected"&&!row.fixtureStartedAt,canRun:live&&phase==="ready"&&!row.runStartedAt,
    canCancel:sessionMatches&&!!((run&&!run.settled)||(fixture&&!fixture.settled))&&!row.cancelRequestedAt,
    canCleanup:!!row.settledAt&&!!row.imageId&&!row.cleanupStartedAt&&!!retainUntil&&Date.parse(retainUntil)<=Date.now(),
    message:phase==="unknown"?"The owning process or acknowledgement is unavailable. Do not repeat the attempt.":phase==="cleanup-queued"?"Local fixture removed; private-object cleanup is queued. Remote erasure is unproven.":phase==="settled"?"The diagnostic has settled. Review its bounded result; no association was created.":"Local diagnostic only. Every action requires confirmation and can be used once.",
    budget:{exchange:!!row.exchangeIntentAt,identity:!!row.identityIntentAt,
      post:row.runStartedAt?null:false,get:row.runStartedAt?null:false,ceiling:4},
    reportText:run?.result??null,retainUntil,cleanupNotBefore:row.cleanupNotBefore,associated:false};
}
async function status(env:NodeJS.ProcessEnv,c:LocalOperatorActivationContext,actor:LocalOperatorActor) {
  return withRepository(env,c,async repo=>({state:await view(match(await repo.activation(c.id,actor.ownerId),c),repo,actor)}));
}

export async function localImageOperatorApi(request:Request,env=process.env) {
  let c:LocalOperatorActivationContext|null=null;
  try {c=localOperatorContext(env);if(c)assertLocalOperatorSource(c);}catch {c=null; /* Fail closed before constructing clients. */ }
  return handleLocalOperatorRequest(request,{enabled:()=>!!c,session:h=>session(env,h),status:actor=>status(env,c!,actor),
    async action(actor,input,h) {
      const active=context(env);
      return withRepository(env,active,async repo=>{
        let row=match(await repo.activation(active.id,actor.ownerId),active);
        if(row.revision!==input.revision)throw new LocalOperatorError("conflict");
        if(input.action==="consent") {
          const config=ebayConfig(env),key=env.EBAY_CREDENTIAL_ENCRYPTION_KEY;
          if(!key||key===env.BETTER_AUTH_SECRET||key===env.REVERB_CREDENTIAL_ENCRYPTION_KEY)throw new LocalOperatorError("context");
          // Begin constructs no network client; this gateway can never exchange.
          const denied=async()=>{throw new EbayError("permissions");};
          const service=createEbayConnectionService(repo.consentRepository(row.id,actor,input.revision),{exchange:denied,identity:denied,refresh:denied},new EbayTokenCipher(key),config);
          const authorizationUrl=await service.begin(actor.ownerId,actor.id,"media-discovery");
          row=match(await repo.activation(active.id,actor.ownerId),active);
          return {state:await view(row,repo,actor),authorizationUrl};
        }
        if(input.action==="prepare-fixture") {
          row=await repo.beginFixture(row.id,actor,input.revision,randomUUID());
          const id=row.id,listingId=row.listingId!;
          registry().start(id,"fixture",async signal=>{
            try {await withRepository(env,active,async(r,d)=>{
              const fixture=await createLocalOperatorFixturePreparer(d,env)(actor,{listingId,signal,
                async authorizeContext(){assertLocalOperatorSource(active);await r.authorizeFixture(id,actor);},
                async onContent(sourceDigest:string,derivativeDigest:string){const now=match(await r.activation(id,actor.ownerId),active);await r.pinFixtureContent(id,actor,now.revision,{sourceDigest,derivativeDigest});}});
              const now=match(await r.activation(id,actor.ownerId),active);await r.finalizeFixture(id,actor,now.revision,fixture);
            });}catch {await withRepository(env,active,r=>r.stop(id,actor.ownerId));}
            return null;
          });
        } else if(input.action==="run") {
          const frozen=pins(row,env),runnerId=randomUUID();
          row=await repo.claimRun(row.id,actor,input.revision,runnerId);
          const ownedHeaders=new Headers(h),id=row.id;
          registry().start(id,"run",async signal=>{
            let report:string|null=null;
            try {
              const result=await runVerificationOperatorWithHeaders({mode:"approve-one-post-one-get",pins:frozen,comparisonRecipe:IMAGE_COMPARISON_RECIPE},env,ownedHeaders,signal,()=>assertLocalOperatorSource(active),active.root);
              report=JSON.stringify({exitCode:result.exitCode,...result.report});
              // Runtime returns only after its actual native/network settlement.
              await withRepository(env,active,r=>r.settle(id,actor.ownerId,runnerId));
            } catch {await withRepository(env,active,r=>r.stop(id,actor.ownerId));}
            finally {ownedHeaders.delete("cookie");}
            return report;
          });
        } else if(input.action==="cancel") {
          const work=registry().get(row.id,row.runStartedAt?"run":"fixture");
          if(!work||work.settled)throw new LocalOperatorError("conflict");
          row=await repo.requestCancel(row.id,actor,input.revision);work.controller.abort();
        } else if(input.action==="cleanup") {
          row=await repo.beginCleanup(row.id,actor,input.revision);
          const result=await runVerificationOperatorWithHeaders({mode:"cleanup-fixture",pins:pins(row,env)},env,h,new AbortController().signal,()=>assertLocalOperatorSource(active),active.root);
          const report=result.report as {cleanup?:{status?:string;notBefore?:string}};
          if(result.exitCode!==0||report.cleanup?.status!=="queued"||!report.cleanup.notBefore)throw new LocalOperatorError("unavailable");
          row=await repo.recordCleanup(row.id,actor.ownerId,report.cleanup.notBefore);
        }
        return {state:await view(row,repo,actor)};
      });
    }});
}

// Normal callbacks remain unchanged. A durable operator state is recognized
// even after its launcher has disappeared, so it cannot fall through to normal
// authorization and silently gain another exchange after a restart.
export async function localImageOperatorCallback(request:Request,path:"callback"|"declined",env=process.env):Promise<Response|null> {
  if(env.MARKETPLACE_TEST_BUILD==="1"||env.BETTER_AUTH_URL!==LOCAL_ORIGIN||env.VERCEL)return null;
  const rejection=rejectLocalOperatorCallback(request,path);if(rejection)return rejection;
  const callbackUrl=new URL(request.url),state=callbackUrl.searchParams.get("state");
  if(!state) {
    // Some genuine declines omit state. Only the active, same-session pending
    // operator can be stopped; no old or unrelated authorization is consumed.
    if(path!=="declined"&&callbackUrl.searchParams.get("error")!=="access_denied")return null;
    const active=localOperatorContext(env);if(!active)return null;
    assertLocalOperatorSource(active);
    const actor=await session(env,request.headers);if(!actor)return new Response(null,{status:401,headers:localOperatorHeaders});
    return withRepository(env,active,async repo=>{
      const row=match(await repo.activation(active.id,actor.ownerId),active);
      if(row.phase!=="consent-pending"||row.sessionHash!==mediaSessionHash(actor.ownerId,actor.id))throw new LocalOperatorError("context");
      await repo.stop(row.id,row.ownerId);
      return new Response(null,{status:303,headers:{...localOperatorHeaders,Location:`${LOCAL_ORIGIN}/operator/ebay-image-verification`}});
    });
  }
  if(!/^[A-Za-z0-9_-]{43}$/.test(state))return new Response("Invalid callback.",{status:400,headers:localOperatorHeaders});
  const hash=createHash("sha256").update(state).digest("hex");
  if(!env.LOCAL_IMAGE_OPERATOR_ID) {
    // Ordinary local-HTTPS authentication supports its normal configured DB,
    // including hosted databases. Inspect through that existing boundary rather
    // than imposing diagnostic-only loopback rules on every OAuth callback.
    // A retained operator state still fails closed when its launcher is absent.
    const db=getDatabase();
    const present=await db.execute(sql`SELECT to_regclass('public.local_image_operator_activations') AS name`);
    if(!present.rows[0]?.name)return null;
    const row=await new DrizzleLocalImageOperatorRepository(db).byStateHash(hash);
    return row?new Response("The local diagnostic authorization stopped. Do not repeat it.",{status:409,headers:localOperatorHeaders}):null;
  }
  const pool=openLocalDatabasePool(env,"execution",true);pool.on("error",()=>{});
  try {
    const db=drizzle(pool,{schema});
    const present=await db.execute(sql`SELECT to_regclass('public.local_image_operator_activations') AS name`);
    if(!present.rows[0]?.name)return null;
    const repo=new DrizzleLocalImageOperatorRepository(db),row=await repo.byStateHash(hash);
    if(!row)return null;
    try {
      const active=context(env);match(row,active);
      const config=ebayConfig(env),reader=openLocalSessionReader(env,true);
      try {
        const actor=await reader.sessionFromHeaders(request.headers);
        if(!actor||actor.ownerId!==row.ownerId)throw new LocalOperatorError("auth");
        const client=new EbayClient(config);
        const gateway:EbayGateway={
          async exchange(code){assertLocalOperatorSource(active);await repo.consumeCallbackIntent(row.id,actor,hash,"exchange");return client.exchange(code);},
          async identity(access){assertLocalOperatorSource(active);await repo.consumeCallbackIntent(row.id,actor,hash,"identity");return client.identity(access);},
          async refresh(){throw new EbayError("permissions");},
        };
        const key=env.EBAY_CREDENTIAL_ENCRYPTION_KEY;
        if(!key||key===env.BETTER_AUTH_SECRET||key===env.REVERB_CREDENTIAL_ENCRYPTION_KEY)throw new LocalOperatorError("context");
        const service=createEbayConnectionService(repo.consentRepository(row.id,actor,row.revision),gateway,new EbayTokenCipher(key),config);
        const response=await handleEbayCallback(request,path,{origin:LOCAL_ORIGIN,session:async()=>({owner:actor.ownerId,sessionId:actor.id}),complete:(...args)=>service.complete(...args)});
        const location=response.headers.get("location");
        if(location?.includes("result=connected"))return new Response(null,{status:303,headers:{...localOperatorHeaders,Location:`${LOCAL_ORIGIN}/operator/ebay-image-verification`}});
        await repo.stop(row.id,row.ownerId);
        return new Response(null,{status:303,headers:{...localOperatorHeaders,Location:`${LOCAL_ORIGIN}/operator/ebay-image-verification`}});
      } finally {await reader.close();}
    } catch {return new Response("The local diagnostic authorization stopped. Do not repeat it.",{status:409,headers:localOperatorHeaders});}
  } finally {await pool.end();}
}
