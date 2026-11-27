// Loaded only by an explicit manual operational mode, never normal app wiring.
import { and, eq, isNotNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/infrastructure/db/schema";
import { openLocalDatabasePool, openLocalSessionReader } from "./local-session";
import { OPERATOR_ROOT } from "./reviewed-checkout";
import type { VerificationOptions } from "./image-verification-options";
import { assertVerificationDatabase, assertVerificationJournal, VerificationOperatorError, verificationFixtureTitle } from "./image-verification-context";
import { queueVerificationFixtureCleanup } from "./image-verification-cleanup";
import { verificationOutcome, unknownVerificationAccounting, type VerificationAccounting } from "./image-verification-report";
import { createDiagnosticImageWorkflow, createMaximumDiagnosticImageWorkflow, type DiagnosticImageOperation } from "../src/infrastructure/ebay/diagnosticImageWorkflow";
import { IMAGE_VERIFICATION_POLICY, MAXIMUM_IMAGE_VERIFICATION_POLICY, type VerificationPolicy } from "../src/application/ebayImageVerificationPersistence";
import { createPhotoDerivativeService } from "../src/application/photoDerivativeService";
import { EBAY_DISCOVERY_SCOPES, sameEbayScopes } from "../src/application/ebayConnection";
import { PHOTO_RECIPE, photoTransformer } from "../src/infrastructure/storage/photoDerivative/transformPhoto";
import { IMAGE_COMPARISON_RECIPE } from "../src/infrastructure/storage/diagnosticImageDecode";
import { captureSource } from "../src/infrastructure/storage/captureSource";
import { ebayConfig } from "../src/infrastructure/ebay/config";
import { EbayTokenCipher } from "../src/infrastructure/ebay/tokenCipher";
import { DrizzleListingRepository } from "../src/infrastructure/repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../src/infrastructure/repositories/drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "../src/infrastructure/repositories/drizzleEbayConnectionRepository";
import { DrizzleEbayRealMediaRepository } from "../src/infrastructure/repositories/drizzleEbayRealMediaRepository";
import { DrizzleEbayImageVerificationRepository } from "../src/infrastructure/repositories/drizzleEbayImageVerificationRepository";
import { DrizzleMediaCaptureRepository } from "../src/infrastructure/repositories/drizzleMediaCaptureRepository";
import type { RealMediaSnapshot } from "../src/application/ebayRealMedia";

type OperationalOptions = Extract<VerificationOptions,{pins:unknown}>;
type SessionInput = { kind: "manual"; cookie: string } | { kind: "request"; headers: Headers };

// Preserve the existing CLI entry point and exact-cookie contract.
export async function runVerificationOperator(options: OperationalOptions, env: NodeJS.ProcessEnv, cookie: string,
  signal: AbortSignal, stillReviewed: () => void) {
  return runAuthenticatedVerificationOperator(options,env,{kind:"manual",cookie},signal,stillReviewed,OPERATOR_ROOT,IMAGE_VERIFICATION_POLICY);
}

// Only a trusted server request boundary supplies headers and sourceRoot. This
// exports no cookie/authentication bridge and accepts no asserted actor DTO.
export async function runVerificationOperatorWithHeaders(options: OperationalOptions, env: NodeJS.ProcessEnv, requestHeaders: Headers,
  signal: AbortSignal, stillReviewed: () => void, sourceRoot = OPERATOR_ROOT) {
  const ownedHeaders=new Headers(requestHeaders);
  try { return await runAuthenticatedVerificationOperator(options,env,{kind:"request",headers:ownedHeaders},signal,stillReviewed,sourceRoot,IMAGE_VERIFICATION_POLICY); }
  finally { ownedHeaders.delete("cookie"); }
}

// Browser-led operator uses this fixed maximum-only composition. The request
// cannot select a field; activation source pins bind this composition as well.
export async function runMaximumVerificationOperatorWithHeaders(options: OperationalOptions, env: NodeJS.ProcessEnv, requestHeaders: Headers,
  signal: AbortSignal, stillReviewed: () => void, sourceRoot = OPERATOR_ROOT) {
  const ownedHeaders=new Headers(requestHeaders);
  try { return await runAuthenticatedVerificationOperator(options,env,{kind:"request",headers:ownedHeaders},signal,stillReviewed,sourceRoot,MAXIMUM_IMAGE_VERIFICATION_POLICY); }
  finally { ownedHeaders.delete("cookie"); }
}

async function runAuthenticatedVerificationOperator(options: OperationalOptions, env: NodeJS.ProcessEnv, input: SessionInput,
  signal: AbortSignal, stillReviewed: () => void, sourceRoot: string, policy: VerificationPolicy) {
  const p = options.pins;
  const cancelled = new AbortController(); signal=AbortSignal.any([signal,cancelled.signal]);
  assertVerificationDatabase(env,p.database); stillReviewed(); signal.throwIfAborted();
  const reader = openLocalSessionReader(env,true);
  let pool: ReturnType<typeof openLocalDatabasePool> | undefined, operation: DiagnosticImageOperation | undefined;
  try {
    const actor = await (input.kind === "manual" ? reader.session(input.cookie) : reader.sessionFromHeaders(input.headers));
    if (!actor) throw new VerificationOperatorError("context");
    pool = openLocalDatabasePool(env,"execution",true);
    const onError = () => { cancelled.abort(); operation?.cancel(); }; pool.on("error",onError);
    const db = drizzle(pool,{schema});
    await assertVerificationJournal(db,p.database,sourceRoot); signal.throwIfAborted(); stillReviewed();
    if (options.mode === "cleanup-fixture") {
      const cleanup = await queueVerificationFixtureCleanup(db,actor,p,signal);
      return { exitCode:0, report:{ version:"diagnostic-operator-v1",mode:"cleanup-fixture",cleanup,associated:false,providerRequests:0 } };
    }
    if (options.comparisonRecipe !== IMAGE_COMPARISON_RECIPE) throw new VerificationOperatorError("configuration");
    const config = ebayConfig(env), connections = new DrizzleEbayConnectionRepository(db), listings = new DrizzleListingRepository(db);
    const listing = await listings.getById(actor.ownerId,p.listing);
    if (!listing || listing.updatedAt !== p.listingVersion || listing.title !== verificationFixtureTitle(p.sourceDigest) ||
      listing.images.length !== 1 || listing.images[0].id !== p.image || listing.images[0].order !== 0 ||
      listing.images[0].source.kind !== "vercel-blob" || listing.images[0].source.contentType !== "image/png" ||
      listing.images[0].source.size > 1_048_576) throw new VerificationOperatorError("context");
    const pending = await db.select({id:schema.imageUploads.id}).from(schema.imageUploads).where(eq(schema.imageUploads.listingId,p.listing)).limit(1);
    const external = await db.select({id:schema.marketplaceListings.id}).from(schema.marketplaceListings)
      .where(and(eq(schema.marketplaceListings.listingId,p.listing),or(isNotNull(schema.marketplaceListings.externalListingId),
        isNotNull(schema.marketplaceListings.externalUrl),isNotNull(schema.marketplaceListings.publishedAt)))).limit(1);
    if (pending.length || external.length) throw new VerificationOperatorError("context");
    const connection = await connections.connection(actor.ownerId);
    const validConnection = (row: typeof connection) => row && row.ownerId === actor.ownerId && row.environment === "sandbox" && row.status === "connected" &&
      row.version === p.connectionVersion && row.configHash === config.fingerprint && row.sellerId === p.seller &&
      sameEbayScopes(row.scopes,EBAY_DISCOVERY_SCOPES) && row.access && row.refresh && row.connectedAt && row.accessExpiresAt &&
      Date.parse(row.accessExpiresAt) >= Date.now()+120_000 && row.refreshExpiresAt && Date.parse(row.refreshExpiresAt)>Date.now();
    if (!validConnection(connection)) throw new VerificationOperatorError("context");
    const key = env.EBAY_CREDENTIAL_ENCRYPTION_KEY;
    if (!key || key === env.REVERB_CREDENTIAL_ENCRYPTION_KEY || key === env.BETTER_AUTH_SECRET) throw new VerificationOperatorError("configuration");
    const cipher = new EbayTokenCipher(key);
    let attemptId: string | undefined, verificationId: string | undefined;
    // Observation only: IDs come from successful owner-scoped repository calls,
    // never command arguments. No token/claim revision is exposed to the CLI.
    class ObservedMedia extends DrizzleEbayRealMediaRepository {
      override async snapshot(...args: Parameters<DrizzleEbayRealMediaRepository["snapshot"]>) {
        const b = await super.snapshot(...args);
        if (b.ownerId !== actor!.ownerId || b.sellerKey !== p.seller || b.connectionVersion !== p.connectionVersion ||
          b.listingVersion !== p.listingVersion || b.configHash !== config.fingerprint || b.imageOrder !== 0) throw new VerificationOperatorError("context");
        return b;
      }
      override async claim(...args: Parameters<DrizzleEbayRealMediaRepository["claim"]>) {
        const value = await super.claim(...args); attemptId=value.id; return value;
      }
    }
    class ObservedVerification extends DrizzleEbayImageVerificationRepository {
      override async reserveVerification(...args: Parameters<DrizzleEbayImageVerificationRepository["reserveVerification"]>) {
        const value = await super.reserveVerification(...args); verificationId=value.id; return value;
      }
    }
    const repository = new ObservedMedia(db), verification = new ObservedVerification(db), evidence = new DrizzleMediaCaptureRepository(db);
    const derivative = createPhotoDerivativeService(listings,new DrizzleImageRepository(db),connections,captureSource(env),photoTransformer,config.fingerprint);
    const createWorkflow = policy === MAXIMUM_IMAGE_VERIFICATION_POLICY ? createMaximumDiagnosticImageWorkflow : createDiagnosticImageWorkflow;
    const workflow = createWorkflow({ auth:reader.api,headers:()=>input.kind === "manual" ? reader.headers(input.cookie) : reader.headersFromRequest(input.headers),repository,verification,evidence,
      configHash:()=>config.fingerprint,recipe:()=>PHOTO_RECIPE,
      async derive(...args) {
        const photo = await derivative.derive(...args);
        try {
          if (photo.sourceDigest !== p.sourceDigest || photo.derivativeDigest !== p.derivativeDigest || photo.recipe !== PHOTO_RECIPE) throw new VerificationOperatorError("context");
          stillReviewed(); signal.throwIfAborted(); return photo;
        } catch (error) { photo.bytes.fill(0); throw error; }
      },
      async credential(binding: RealMediaSnapshot) {
        const row = await connections.connection(actor.ownerId);
        if (!validConnection(row) || !row || row.id !== binding.connectionId || row.version !== binding.connectionVersion ||
          row.configHash !== binding.configHash || row.sellerId !== binding.sellerKey || !row.access) throw new VerificationOperatorError("context");
        return cipher.decrypt(row.access,JSON.stringify(["ebay-oauth-v1","access",row.ownerId,"sandbox",row.id,row.configHash,row.sellerId]));
      } });
    const review = await workflow.prepare(p.listing,p.image,p.seller,p.sourceDigest);
    stillReviewed(); signal.throwIfAborted();
    // Reserve the existing 30-second operation window in addition to the
    // approved two-minute access margin. This is a stricter local preflight,
    // not a renewed request deadline or a token-refresh path.
    const ready = await connections.connection(actor.ownerId);
    if (!validConnection(ready) || !ready?.accessExpiresAt || Date.parse(ready.accessExpiresAt)<Date.now()+150_000) throw new VerificationOperatorError("context");
    signal.throwIfAborted();
    operation = workflow.confirm(review,signal);
    // Even an early cancellation result cannot end the process, free capacity,
    // close pools or begin cleanup until underlying work actually settles.
    const result = verificationOutcome(await operation.result); await operation.settled;
    let accounting: VerificationAccounting = unknownVerificationAccounting(), accountingComplete = false;
    try {
      const [attempt] = attemptId ? await db.select({ at:schema.ebayRealMediaAttempts.postIntentAt }).from(schema.ebayRealMediaAttempts)
        .where(and(eq(schema.ebayRealMediaAttempts.id,attemptId),eq(schema.ebayRealMediaAttempts.ownerId,actor.ownerId))) : [];
      const [child] = verificationId ? await db.select({ at:schema.ebayImageVerifications.requestIntentAt }).from(schema.ebayImageVerifications)
        .where(and(eq(schema.ebayImageVerifications.id,verificationId),eq(schema.ebayImageVerifications.ownerId,actor.ownerId))) : [];
      if (attemptId && !attempt || verificationId && !child) throw Error();
      const [capture] = attemptId ? await db.select({ report:schema.ebayMediaCaptures.report }).from(schema.ebayMediaCaptures)
        .where(eq(schema.ebayMediaCaptures.attemptId,attemptId)) : [];
      const status=capture?.report.status??null;
      if(status!==null&&(!Number.isInteger(status)||status<100||status>599))throw Error();
      accounting = { postBudgetConsumed:!!attempt?.at,getBudgetConsumed:!!child?.at,
        postResponseObserved:status!==null,getResponseObserved:result.retrieved,postStatus:status,getStatus:result.retrieved?200:null,ceiling:2 };
      accountingComplete = true;
    } catch { /* Uncertain local accounting consumes the full ceiling; no retry. */ }
    const success = !signal.aborted && accountingComplete && accounting.postBudgetConsumed === true && accounting.getBudgetConsumed === true &&
      accounting.postResponseObserved && accounting.getResponseObserved && result.reason === "completed" && result.settlement === "settled" &&
      result.retrieved && result.visual?.verdict === "match" && result.acknowledgement === "recorded";
    return { exitCode:success?0:1,report:{ version:"diagnostic-operator-v1",mode:"approve-one-post-one-get",policy,outcome:result,
      operationSettled:true,accounting,accountingComplete,cleanup:"retained-use-separate-local-mode",associated:false,remoteErasureProven:false } };
  } catch (error) {
    if (error instanceof VerificationOperatorError) throw error;
    throw new VerificationOperatorError("unavailable");
  } finally {
    if (operation) { operation.cancel(); await operation.settled; }
    if (input.kind === "manual") input.cookie=""; else input.headers.delete("cookie");
    try { await pool?.end(); } finally { await reader.close(); }
  }
}
