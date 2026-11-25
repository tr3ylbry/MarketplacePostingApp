import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { config as loadEnvironment } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../src/infrastructure/db/schema";
import { openLocalDatabasePool,localDatabase,LOCAL_ORIGIN } from "./local-session";
import { assertVerificationJournal } from "./image-verification-context";
import { assertLocalOperatorSource,localOperatorContext } from "./local-image-operator-source";
import { DrizzleLocalImageOperatorRepository } from "../src/infrastructure/repositories/drizzleLocalImageOperatorRepository";
import { ebayConfig } from "../src/infrastructure/ebay/config";
import { PHOTO_RECIPE } from "../src/infrastructure/storage/photoDerivative/transformPhoto";
import { IMAGE_COMPARISON_RECIPE } from "../src/infrastructure/storage/diagnosticImageDecode";

// No cookie or owner ID argument. Trusted setup derives one existing connected
// Sandbox seller privately; the browser must subsequently authenticate its owner.
async function main() {
  const {values}=parseArgs({options:{"reviewed-head":{type:"string"},"reviewed-tree":{type:"string"},"approve-four-requests":{type:"boolean"}}});
  if(!values["approve-four-requests"]||!values["reviewed-head"]||!values["reviewed-tree"])throw Error();
  const root=fileURLToPath(new URL("../",import.meta.url));
  const binding={id:randomUUID(),head:values["reviewed-head"],tree:values["reviewed-tree"],root};
  // Verify source before any private configuration read or database construction.
  assertLocalOperatorSource(binding);
  loadEnvironment({path:".env.local",quiet:true});loadEnvironment({path:".env.https.local",quiet:true});
  const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:"development",BETTER_AUTH_URL:LOCAL_ORIGIN,VERCEL_BLOB_RETRIES:"0",
    LOCAL_IMAGE_OPERATOR_ID:binding.id,LOCAL_IMAGE_OPERATOR_HEAD:binding.head,LOCAL_IMAGE_OPERATOR_TREE:binding.tree,LOCAL_IMAGE_OPERATOR_ROOT:root};
  if(process.versions.node.split(".")[0]!=="24"||!localOperatorContext(env))throw Error();
  const url=localDatabase(env),pool=openLocalDatabasePool(env,"execution",true);
  pool.on("error",()=>{});
  try {
    const db=drizzle(pool,{schema});
    await assertVerificationJournal(db,decodeURIComponent(url.pathname.slice(1)),root);
    const rows=await db.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.status,"connected")).limit(2);
    if(rows.length!==1||rows[0].environment!=="sandbox"||!rows[0].sellerId)throw Error();
    const row=rows[0],config=ebayConfig(env);
    if(row.configHash!==config.fingerprint)throw Error();
    await new DrizzleLocalImageOperatorRepository(db).arm({id:binding.id,ownerId:row.ownerId,reviewedHead:binding.head,reviewedTree:binding.tree,
      configHash:config.fingerprint,sellerKey:row.sellerId!,connectionId:row.id,initialConnectionVersion:row.version,
      derivativeRecipe:PHOTO_RECIPE,comparisonRecipe:IMAGE_COMPARISON_RECIPE,expiresAt:new Date(Date.now()+2*60*60*1000).toISOString()});
  } finally {await pool.end();}
  console.log(JSON.stringify({armed:true,requests:4,expiresInMinutes:120,associated:false}));
  const child=spawn(process.execPath,["scripts/dev-https.mjs"],{cwd:root,stdio:"inherit",env});
  for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>child.kill(signal));
  await new Promise<void>((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>{process.exitCode=code??1;resolve();});});
}
main().catch(()=>{console.error(JSON.stringify({armed:false,stopped:true,reason:"local-prerequisite"}));process.exitCode=1;});
