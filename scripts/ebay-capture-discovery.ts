// Manual operator tool only. Never imported by normal app/runtime composition.
import { execFileSync,spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and,eq } from "drizzle-orm";
import { generateCaptureFixture } from "../src/infrastructure/storage/captureFixture";
import { createCaptureWorkflow } from "../src/application/ebayCaptureWorkflow";
import { createEbayConnectionService } from "../src/application/ebayConnectionService";
import { createPhotoDerivativeService } from "../src/application/photoDerivativeService";
import { mediaHash } from "../src/application/ebayRealMedia";
import { EBAY_DISCOVERY_SCOPES,sameEbayScopes } from "../src/application/ebayConnection";
import { authOptions } from "../src/auth/options";
import { betterAuth } from "better-auth";
import { DrizzleListingRepository } from "../src/infrastructure/repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../src/infrastructure/repositories/drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "../src/infrastructure/repositories/drizzleEbayConnectionRepository";
import { DrizzleEbayRealMediaRepository } from "../src/infrastructure/repositories/drizzleEbayRealMediaRepository";
import { DrizzleMediaCaptureRepository } from "../src/infrastructure/repositories/drizzleMediaCaptureRepository";
import { captureSource } from "../src/infrastructure/storage/captureSource";
import { photoTransformer,PHOTO_RECIPE } from "../src/infrastructure/storage/photoDerivative/transformPhoto";
import { ebayConfig } from "../src/infrastructure/ebay/config";
import { EbayClient } from "../src/infrastructure/ebay/ebayClient";
import { EbayTokenCipher } from "../src/infrastructure/ebay/tokenCipher";
import { createCaptureClient } from "../src/infrastructure/ebay/captureClient";
import * as schema from "../src/infrastructure/db/schema";

async function privateCookie():Promise<string> {
  if(!process.stdin.isTTY)throw Error();
  process.stdout.write("Paste the existing LOCAL app session cookie (hidden; never an eBay token): ");
  return new Promise((resolve,reject)=>{
    let value="";process.stdin.setRawMode(true);process.stdin.resume();
    const finish=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off("data",data);process.stdout.write("\n");};
    const data=(chunk:Buffer)=>{for(const character of chunk.toString("utf8")){
      if(character==='\u0003'){finish();reject(Error());return;}
      if(character==='\r'||character==='\n'){finish();if(!value||value.length>32768||/[^\x20-\x7e]/.test(value))reject(Error());else resolve(value);return;}
      if(character==='\u007f')value=value.slice(0,-1);else value+=character;
      if(value.length>32768){finish();reject(Error());return;}
    }};process.stdin.on("data",data);
  });
}
async function main() {
 const {values:v}=parseArgs({options:{help:{type:"boolean"},fixture:{type:"string"},"reviewed-head":{type:"string"},"seller-key":{type:"string"},"source-digest":{type:"string"},listing:{type:"string"},image:{type:"string"},"approve-one-create":{type:"boolean"},"approve-media-consent":{type:"boolean"}}});
 if(v.help){console.log("Manual discovery only: --fixture ABSOLUTE_OUTPUT | --reviewed-head SHA --seller-key HASH [--approve-media-consent | --approve-one-create --source-digest HASH --listing ID --image ID]. Never run real modes without separate owner approval.");return;}
 if(v.fixture){if(v["approve-one-create"]||v["approve-media-consent"]||!v.fixture.startsWith("/"))throw Error();const f=await generateCaptureFixture();await writeFile(resolve(v.fixture),f.bytes,{mode:0o600,flag:"wx"});console.log(JSON.stringify({generated:true,width:500,height:600,sourceDigest:f.sourceDigest}));return;}
 if(!/^[a-f0-9]{40}$/.test(v["reviewed-head"]??"")||execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()!==v["reviewed-head"]||execFileSync("git",["status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim()||!mediaHash.safeParse(v["seller-key"]).success||!!v["approve-one-create"]===!!v["approve-media-consent"])throw Error();
 loadEnv({path:".env.local",quiet:true});
 const config=ebayConfig(process.env),database=new URL(process.env.DATABASE_URL??"");
 if(!["127.0.0.1","localhost"].includes(database.hostname)||!/^postgres(?:ql)?:$/.test(database.protocol)||process.env.VERCEL)throw Error();
 const cancel=new AbortController(),interrupt=()=>cancel.abort();
 const pool=new Pool({connectionString:database.toString(),max:5});
 pool.on("error",interrupt); // Idle DB errors must never print a client/config object.
 process.once("SIGINT",interrupt);
 try {
  const db=drizzle(pool,{schema}),auth=betterAuth(authOptions(db,process.env));
  const headers=new Headers({cookie:await privateCookie()});
  const session=async()=>{const s=await auth.api.getSession({headers,query:{disableRefresh:true}});return s?{ownerId:s.user.id,id:s.session.id,expiresAt:s.session.expiresAt.toISOString()}:null;};
  const actor=await session();if(!actor)throw Error();
  const connections=new DrizzleEbayConnectionRepository(db),row=await connections.connection(actor.ownerId);
  if(!row||row.environment!=="sandbox"||row.status!=="connected"||row.configHash!==config.fingerprint||row.sellerId!==v["seller-key"])throw Error();
  const key=process.env.EBAY_CREDENTIAL_ENCRYPTION_KEY;if(key===process.env.REVERB_CREDENTIAL_ENCRYPTION_KEY||key===process.env.BETTER_AUTH_SECRET)throw Error();const cipher=new EbayTokenCipher(key);
  if(v["approve-media-consent"]){
   // Exactly one chosen path: explicit authorization-code consent, then existing
   // callback exchange + authenticated GetUser. No alternate refresh path.
   const service=createEbayConnectionService(connections,new EbayClient(config),cipher,config);
   const url=await service.begin(actor.ownerId,actor.id,"media-discovery");cancel.signal.throwIfAborted();
   const browser=spawn("open",[url],{stdio:"ignore"});await new Promise<void>((resolve,reject)=>{browser.on("error",()=>reject(Error()));browser.on("close",c=>c===0?resolve():reject(Error()));});
   console.log("Opened the single approved Sandbox consent. The local HTTPS app must remain running. No capture was started.");return;
  }
  if(!v.listing||!v.image||!mediaHash.safeParse(v["source-digest"]).success||!sameEbayScopes(row.scopes,EBAY_DISCOVERY_SCOPES)||!row.accessExpiresAt||Date.parse(row.accessExpiresAt)<=Date.now()+120000)throw Error();
  const evidence=new DrizzleMediaCaptureRepository(db),repository=new DrizzleEbayRealMediaRepository(db),client=createCaptureClient();
  const derivative=createPhotoDerivativeService(new DrizzleListingRepository(db),new DrizzleImageRepository(db),connections,captureSource(process.env),photoTransformer,config.fingerprint);
  const workflow=createCaptureWorkflow({session,repository,evidence,derive:derivative.derive,configHash:()=>config.fingerprint,recipe:()=>PHOTO_RECIPE,capture:async(bytes,token,signal)=>{if(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()!==v["reviewed-head"]||execFileSync("git",["status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim())throw Error();return client.capture(bytes,token,signal);},
   async credential(binding){const current=await connections.connection(actor.ownerId);if(!current||current.ownerId!==binding.ownerId||current.id!==binding.connectionId||current.version!==binding.connectionVersion||current.sellerId!==binding.sellerKey||current.configHash!==binding.configHash||!sameEbayScopes(current.scopes,EBAY_DISCOVERY_SCOPES)||!current.access||!current.accessExpiresAt||Date.parse(current.accessExpiresAt)<=Date.now()+30000)throw Error();return cipher.decrypt(current.access,JSON.stringify(["ebay-oauth-v1","access",current.ownerId,"sandbox",current.id,current.configHash,current.sellerId]));}});
  const outcome=await workflow.confirm(await workflow.prepare(v.listing,v.image,v["seller-key"]!,v["source-digest"]!),cancel.signal);
  console.log(JSON.stringify(outcome));
  const reports=await db.select({report:schema.ebayMediaCaptures.report}).from(schema.ebayMediaCaptures).innerJoin(schema.ebayRealMediaAttempts,eq(schema.ebayRealMediaAttempts.id,schema.ebayMediaCaptures.attemptId)).where(and(eq(schema.ebayRealMediaAttempts.ownerId,actor.ownerId),eq(schema.ebayRealMediaAttempts.listingId,v.listing),eq(schema.ebayRealMediaAttempts.imageId,v.image)));
  console.log(JSON.stringify({historicalStructuralReports:reports.map(r=>r.report)}));
  if(!outcome.captured||reports.length!==1||reports[0].report.status!==201||reports[0].report.outcome!=="captured"||!reports[0].report.json)process.exitCode=1;
 }finally{process.off("SIGINT",interrupt);await pool.end();}
}
main().catch(()=>{console.error("Discovery stopped. No automatic retry is permitted; inspect the owned local fence before any further action.");process.exitCode=1;});
