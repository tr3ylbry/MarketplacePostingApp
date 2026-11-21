// Manual operator tool only. Never imported by normal app/runtime composition.
import { execFileSync, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReadStream, WriteStream } from "node:tty";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { captureOptions } from "./capture-options";
import { PrivateInputError, REHEARSAL_TEXT, localSessionCookie, readPrivateInput } from "./private-tty-input";
import { LocalSessionError, openLocalDatabasePool, openLocalSessionReader } from "./local-session";
import type { RealMediaSnapshot } from "../src/application/ebayRealMedia";
import * as schema from "../src/infrastructure/db/schema";

type Terminal = { input: ReadStream; output: WriteStream };
export async function runManualTool(args: string[], env: NodeJS.ProcessEnv = process.env,
  terminal: Terminal = { input: process.stdin, output: process.stdout }): Promise<number> {
  let mode: string | undefined;
  const result = (value: object) => terminal.output.write(JSON.stringify(value) + "\n");
  try {
    const parsed = captureOptions(args), v = parsed.values; mode = parsed.mode;
    if (mode === "help") {
      terminal.output.write("Manual discovery: --rehearse-input | --check-session | --fixture ABSOLUTE_OUTPUT | --reviewed-head SHA --seller-key HASH [--approve-media-consent | --approve-one-create --source-digest HASH --listing ID --image ID]. Real modes require separate owner approval.\n");
      return 0;
    }
    if (mode === "rehearse-input") {
      const text = await readPrivateInput("Paste only the harmless rehearsal text, then press Enter (hidden): ", terminal.input, terminal.output);
      const matched = text === REHEARSAL_TEXT;
      result({ rehearsal: true, matched }); return matched ? 0 : 1;
    }
    if (mode === "fixture") {
      const { generateCaptureFixture } = await import("../src/infrastructure/storage/captureFixture");
      const f = await generateCaptureFixture();
      await writeFile(resolve(v.fixture!), f.bytes, { mode: 0o600, flag: "wx" });
      result({ generated: true, width: 500, height: 600, sourceDigest: f.sourceDigest }); return 0;
    }
    if (mode !== "check-session" && (execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== v["reviewed-head"] ||
      execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim())) throw Error();
    // Supplying an environment in tests never loads the owner's ignored config.
    if (env === process.env) loadEnv({ path: ".env.local", quiet: true });
    const reader = openLocalSessionReader(env);
    let cookie = "";
    try {
      cookie = localSessionCookie(await readPrivateInput("Paste ONLY __Secure-better-auth.session_token=VALUE from the LOCAL HTTPS app, then press Enter (hidden): ", terminal.input, terminal.output));
      const session = () => reader.session(cookie);
      const actor = await session();
      if (!actor) throw new LocalSessionError("unauthenticated");
      if (mode === "check-session") {
        await reader.close();
        result({ authenticated: true, live: true, originMatches: true }); return 0;
      }
      // No provider/Blob/native composition is imported by either local mode.
      const { createCaptureWorkflow } = await import("../src/application/ebayCaptureWorkflow");
      const { createEbayConnectionService } = await import("../src/application/ebayConnectionService");
      const { createPhotoDerivativeService } = await import("../src/application/photoDerivativeService");
      const { EBAY_DISCOVERY_SCOPES, sameEbayScopes } = await import("../src/application/ebayConnection");
      const { mediaHash } = await import("../src/application/ebayRealMedia");
      const { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository");
      const { DrizzleImageRepository } = await import("../src/infrastructure/repositories/drizzleImageRepository");
      const { DrizzleEbayConnectionRepository } = await import("../src/infrastructure/repositories/drizzleEbayConnectionRepository");
      const { DrizzleEbayRealMediaRepository } = await import("../src/infrastructure/repositories/drizzleEbayRealMediaRepository");
      const { DrizzleMediaCaptureRepository } = await import("../src/infrastructure/repositories/drizzleMediaCaptureRepository");
      const { captureSource } = await import("../src/infrastructure/storage/captureSource");
      const { photoTransformer, PHOTO_RECIPE } = await import("../src/infrastructure/storage/photoDerivative/transformPhoto");
      const { ebayConfig } = await import("../src/infrastructure/ebay/config");
      const { EbayClient } = await import("../src/infrastructure/ebay/ebayClient");
      const { EbayTokenCipher } = await import("../src/infrastructure/ebay/tokenCipher");
      const { createCaptureClient } = await import("../src/infrastructure/ebay/captureClient");
      const config = ebayConfig(env);
      const cancel = new AbortController(), interrupt = () => cancel.abort();
      const pool = openLocalDatabasePool(env, "execution");
      pool.on("error", interrupt);
      process.once("SIGINT", interrupt);
      try {
        const db = drizzle(pool, { schema });
        const connections=new DrizzleEbayConnectionRepository(db),row=await connections.connection(actor.ownerId);
        if(!row||row.environment!=="sandbox"||row.status!=="connected"||row.configHash!==config.fingerprint||row.sellerId!==v["seller-key"])throw Error();
        const key=env.EBAY_CREDENTIAL_ENCRYPTION_KEY;if(key===env.REVERB_CREDENTIAL_ENCRYPTION_KEY||key===env.BETTER_AUTH_SECRET)throw Error();const cipher=new EbayTokenCipher(key);
        if(v["approve-media-consent"]){
         // Exactly one chosen path: explicit authorization-code consent, then existing
         // callback exchange + authenticated GetUser. No alternate refresh path.
         const service=createEbayConnectionService(connections,new EbayClient(config),cipher,config);
         const url=await service.begin(actor.ownerId,actor.id,"media-discovery");cancel.signal.throwIfAborted();
         const browser=spawn("open",[url],{stdio:"ignore"});await new Promise<void>((resolve,reject)=>{browser.on("error",()=>reject(Error()));browser.on("close",c=>c===0?resolve():reject(Error()));});
         console.log("Opened the single approved Sandbox consent. The local HTTPS app must remain running. No capture was started.");return 0;
        }
        if(!v.listing||!v.image||!mediaHash.safeParse(v["source-digest"]).success||!sameEbayScopes(row.scopes,EBAY_DISCOVERY_SCOPES)||!row.accessExpiresAt||Date.parse(row.accessExpiresAt)<=Date.now()+120000)throw Error();
        const evidence=new DrizzleMediaCaptureRepository(db),repository=new DrizzleEbayRealMediaRepository(db),client=createCaptureClient();
        const derivative=createPhotoDerivativeService(new DrizzleListingRepository(db),new DrizzleImageRepository(db),connections,captureSource(env),photoTransformer,config.fingerprint);
        const workflow=createCaptureWorkflow({session,repository,evidence,derive:derivative.derive,configHash:()=>config.fingerprint,recipe:()=>PHOTO_RECIPE,capture:async(bytes,token,signal)=>{if(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()!==v["reviewed-head"]||execFileSync("git",["status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim())throw Error();return client.capture(bytes,token,signal);},
         async credential(binding:RealMediaSnapshot){const current=await connections.connection(actor.ownerId);if(!current||current.ownerId!==binding.ownerId||current.id!==binding.connectionId||current.version!==binding.connectionVersion||current.sellerId!==binding.sellerKey||current.configHash!==binding.configHash||!sameEbayScopes(current.scopes,EBAY_DISCOVERY_SCOPES)||!current.access||!current.accessExpiresAt||Date.parse(current.accessExpiresAt)<=Date.now()+30000)throw Error();return cipher.decrypt(current.access,JSON.stringify(["ebay-oauth-v1","access",current.ownerId,"sandbox",current.id,current.configHash,current.sellerId]));}});
        const outcome=await workflow.confirm(await workflow.prepare(v.listing,v.image,v["seller-key"]!,v["source-digest"]!),cancel.signal);
        console.log(JSON.stringify(outcome));
        const reports=await db.select({report:schema.ebayMediaCaptures.report}).from(schema.ebayMediaCaptures).innerJoin(schema.ebayRealMediaAttempts,eq(schema.ebayRealMediaAttempts.id,schema.ebayMediaCaptures.attemptId)).where(and(eq(schema.ebayRealMediaAttempts.ownerId,actor.ownerId),eq(schema.ebayRealMediaAttempts.listingId,v.listing),eq(schema.ebayRealMediaAttempts.imageId,v.image)));
        console.log(JSON.stringify({historicalStructuralReports:reports.map(r=>r.report)}));
        if(!outcome.captured||reports.length!==1||reports[0].report.status!==201||reports[0].report.outcome!=="captured"||!reports[0].report.json)return 1;

        return 0;
      } finally { process.off("SIGINT", interrupt); await pool.end(); }
    } finally { cookie = ""; await reader.close(); }
  } catch (error) {
    if (mode === "check-session" || mode === "rehearse-input" || !mode) {
      const failure = error instanceof PrivateInputError ? error.code : error instanceof LocalSessionError ? error.code : "flags";
      result({ authenticated: false, live: false, originMatches: false, failure });
    } else terminal.output.write("Discovery stopped. No automatic retry is permitted; inspect the owned local fence before any further action.\n");
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runManualTool(process.argv.slice(2));
}
