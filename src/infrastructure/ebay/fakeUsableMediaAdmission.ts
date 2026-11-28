import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type * as schema from "../db/schema";
import { ownerIdSchema } from "../../application/owner";
import { mediaHash, mediaId, mediaSessionHash, realMediaDigest } from "../../application/ebayRealMedia";
import { acquirePhotoCapacity, releasePhotoCapacity } from "../../application/photoCapacity";
import { CAPTURE_BODY_BYTES, CAPTURE_HEADER_BYTES, inspectCapture, parseCaptureJson } from "../../application/ebayCaptureReport";
import { IMAGE_COMPARISON } from "../../application/imageComparison";
import { IMAGE_COMPARISON_RECIPE } from "../storage/diagnosticImageDecode";
import { PHOTO_RECIPE } from "../storage/photoDerivative/transformPhoto";
import { discardImageReference, prepareImageReference, startImageComparison } from "../storage/diagnosticImageComparison";
import { disposableMediaDatabaseName, parseSyntheticMediaReceipt } from "./realMediaEvidence";
import { IMAGE_DOWNLOAD_POLICY_CUTOFF } from "./imageDownloadPolicy";

export const FAKE_ADMISSION_CONSUMER = "fake-usable-media-v1";
export const FAKE_ADMISSION_IDENTITY = "synthetic-independent-resource-v1";
export const FAKE_ADMISSION_FACT_BYTES = 2048, FAKE_ADMISSION_FACTS = 4;
const date = z.iso.datetime();
const snapshotSchema = z.strictObject({
  ownerId: ownerIdSchema, environment: z.literal("sandbox"), attemptId: mediaId,
  operation: z.enum(["normal", "capture-only"]), revision: z.number().int().min(1), postIntentAt: date,
  actionHash: mediaHash, sessionHash: mediaHash, sellerKey: mediaHash, connectionId: mediaId,
  connectionVersion: mediaId, configHash: mediaHash, grantHash: mediaHash,
  listingId: mediaId, listingVersion: date, imageId: mediaId, sourceVersion: mediaHash,
  imageOrder: z.number().int().nonnegative(), sourceDigest: mediaHash, derivativeDigest: mediaHash,
  recipe: z.string().max(1024), comparisonRecipe: z.string().max(1024),
  targetField: z.enum(["imageUrl", "maxDimensionImageUrl"]), consumer: z.string().max(64), identityPolicy: z.string().max(64),
  sessionExpiresAt: date, accessExpiresAt: date, refreshExpiresAt: date, reviewUntil: date, leaseUntil: date,
  disposition: z.enum(["current", "detached", "conflict", "uncertain"]),
});
export type FakeAdmissionSnapshot = z.infer<typeof snapshotSchema>;
const sessionSchema = z.strictObject({ ownerId: ownerIdSchema, id: mediaId, expiresAt: date });
const bytes = (limit: number) => z.custom<Uint8Array>(v => v instanceof Uint8Array).refine(v => v.byteLength > 0 && v.byteLength <= limit);
const observationSchema = z.strictObject({
  response: z.strictObject({ status: z.number().int().min(100).max(599), rawHeaders: z.array(z.string().max(CAPTURE_HEADER_BYTES)).max(256), body: bytes(CAPTURE_BODY_BYTES) }),
  reference: bytes(IMAGE_COMPARISON.encodedBytes),
  image: z.strictObject({ target: z.string().max(8192), mime: z.enum(["image/png", "image/jpeg"]), bytes: bytes(IMAGE_COMPARISON.encodedBytes) }),
});
export type FakeAdmissionObservation = z.infer<typeof observationSchema>;
export interface FakeAdmissionDependencies {
  // Trusted internal test adapters. No browser owner/session/URL arguments.
  session(): Promise<z.infer<typeof sessionSchema> | null>;
  snapshot(ownerId: string): Promise<FakeAdmissionSnapshot>;
  // A bounded in-memory fixture, not a provider gateway or request permission.
  // No caller-supplied validation/settlement flags are accepted in its shape.
  observation(signal: AbortSignal): Promise<FakeAdmissionObservation>;
  clock?: () => number;
  monotonic?: () => number;
}
type Reason = "disabled" | "invalid-proof" | "replayed" | "context" | "consumer" | "identity" | "provenance" | "target"
  | "image-validation" | "expired" | "cancelled" | "unavailable" | "conflict" | "overflow" | "invalid-fact";
type Claim = "passed" | "failed" | "not-run";
interface Facts { provenance: Claim; imageValidation: Claim; resourceIdentity: Claim; urlEligibility: Claim }
export interface FakeAdmissionSummary {
  simulation: true; realAdmission: false; associated: false; canStage: false; canDelete: false;
  outcome: "eligible-for-fake-association" | "refused"; reasons: readonly Reason[];
  evidence: Readonly<Facts>; currentAssociation: "not-created";
}
interface Candidate { binding: string; facts: Readonly<Facts>; reasons: Reason[]; until: number; monoUntil: number; lastWall: number; lastMono: number }
interface Acknowledgement { candidate: Candidate; facts: Map<string, string>; conflict: boolean; overflow: boolean; invalid: boolean; retired: boolean }
export interface FakeAdmissionAssessment { summary: Readonly<FakeAdmissionSummary>; evidence: Readonly<object> | null }
export interface FakeAdmissionAcknowledgement { accepted: boolean; duplicate: boolean; distinctFacts: number; conflict: boolean; overflow: boolean; summary: Readonly<FakeAdmissionSummary> }
export class FakeAdmissionError extends Error {
  constructor(readonly code: "disabled" | "unavailable") { super("Fake media assessment unavailable."); }
}
const enabled = () => process.env.NODE_ENV === "test" && !process.env.VERCEL;
const blank = (): Facts => ({ provenance: "not-run", imageValidation: "not-run", resourceIdentity: "not-run", urlEligibility: "not-run" });
const factSchema = z.strictObject({ version: z.literal("fake-admission-fact-v1"),
  kind: z.enum(["response", "validation", "identity", "settlement"]), outcome: z.enum(["passed", "refused", "unknown"]),
  reason: z.enum(["bounded", "validated", "verified", "settled", "changed", "cancelled", "unavailable"]),
}).refine(v => v.outcome === "passed" ? v.reason === ({ response: "bounded", validation: "validated", identity: "verified", settlement: "settled" } as const)[v.kind]
  : ["changed", "cancelled", "unavailable"].includes(v.reason));

// Fixed synthetic representation grammar plus an opaque operation-local query.
// This does not change the legacy receipt parser/SQL or admit a real URL.
function syntheticTarget(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || !/^[\x21-\x7e]+$/.test(value) || /[\\#]/.test(value) ||
    !/^https:\/\/eps-contract\.invalid\.test\/photo\/test_visual_[a-f0-9]{16}\.png(?:\?.*)?$/.test(value)) throw Error();
  const u = new URL(value);
  if (u.href !== value || u.port || u.username || u.password || u.hash) throw Error();
  const query = value.slice(value.indexOf("?") < 0 ? value.length : value.indexOf("?") + 1);
  for (let n=0;n<query.length;n++) if (query[n] === "%") {
    if (!/^[a-f0-9]{2}$/i.test(query.slice(n+1,n+3))) throw Error();
    const b = Number.parseInt(query.slice(n+1,n+3),16); n+=2;
    if (b<=31 || b===127 || b===37 || b===92) throw Error();
  }
  return value; // Exact raw bytes; no query interpretation, sorting or rewrite.
}

/** Test-only assessment; never writes a receipt, association or any database row.
 * The actual database identity is inspected, not accepted as an environment flag.
 * Each instance owns one producer invocation and private proof registries. */
export async function createFakeUsableMediaAssessment(db: Pick<NodePgDatabase<typeof schema>, "execute">,
  deps: FakeAdmissionDependencies, targetField: FakeAdmissionSnapshot["targetField"]) {
  try {
    if (!enabled() || !["imageUrl", "maxDimensionImageUrl"].includes(targetField)) throw Error();
    const identity = await db.execute(sql`SELECT current_database() AS name`);
    if (!disposableMediaDatabaseName.test(String(identity.rows[0]?.name))) throw Error();
  } catch { throw new FakeAdmissionError("disabled"); }
  const clock = deps.clock ?? Date.now, monotonic = deps.monotonic ?? (() => performance.now());
  const issued = new WeakMap<object, Candidate>(), acknowledged = new WeakMap<object, Acknowledgement>();
  let produced = false;
  function check(c: Candidate, signal?: AbortSignal) {
    if (!enabled()) return "disabled" as const;
    let wall:number,mono:number;
    try{wall=clock();mono=monotonic();}catch{return "unavailable" as const;}
    if (!Number.isSafeInteger(wall) || !Number.isFinite(mono) || wall<c.lastWall || mono<c.lastMono) return "context" as const;
    c.lastWall=wall;c.lastMono=mono;
    return wall>=c.until || mono>=c.monoUntil ? "expired" as const : signal?.aborted ? "cancelled" as const : null;
  }
  async function current(c?: Candidate, signal?: AbortSignal) {
    const actor=sessionSchema.parse(await deps.session());
    const snapshot=snapshotSchema.parse(await deps.snapshot(actor.ownerId));
    const confirmed=sessionSchema.parse(await deps.session());
    // Sample after ALL asynchronous reads. This is an assessment, not a SQL
    // positive-transition guard or proof of cross-system atomicity.
    const now=clock();
    if (!enabled() || signal?.aborted || !Number.isSafeInteger(now) || JSON.stringify(actor)!==JSON.stringify(confirmed) || snapshot.ownerId!==actor.ownerId ||
      snapshot.sessionHash!==mediaSessionHash(actor.ownerId,actor.id) || snapshot.sessionExpiresAt!==actor.expiresAt ||
      snapshot.operation!=="normal" || snapshot.disposition!=="current" || snapshot.targetField!==targetField || Date.parse(snapshot.postIntentAt)>now ||
      snapshot.recipe!==PHOTO_RECIPE || snapshot.comparisonRecipe!==IMAGE_COMPARISON_RECIPE) throw Error("context");
    if (snapshot.consumer!==FAKE_ADMISSION_CONSUMER) throw Error("consumer");
    if (snapshot.identityPolicy!==FAKE_ADMISSION_IDENTITY) throw Error("identity");
    const until=Math.min(...[snapshot.sessionExpiresAt,snapshot.accessExpiresAt,snapshot.refreshExpiresAt,snapshot.reviewUntil,snapshot.leaseUntil].map(Date.parse),IMAGE_DOWNLOAD_POLICY_CUTOFF);
    if (until<=now) throw Error("expired");
    const binding=JSON.stringify(snapshot);
    if (c) {
      if(c.binding!==binding)throw Error("context");
      const stopped=check(c,signal);if(stopped)throw Error(stopped);
    }
    return {binding,until,now,derivativeDigest:snapshot.derivativeDigest};
  }
  const summary = (c: Candidate, extra: Reason[] = []): Readonly<FakeAdmissionSummary> => {
    const reasons=Object.freeze([...new Set([...c.reasons,...extra])]);
    return Object.freeze({simulation:true,realAdmission:false,associated:false,canStage:false,canDelete:false,
      outcome:reasons.length ? "refused" : "eligible-for-fake-association",reasons,evidence:c.facts,currentAssociation:"not-created"});
  };
  const rejected = (reason: Reason) => summary({binding:"",facts:Object.freeze(blank()),reasons:[],until:0,monoUntil:0,lastWall:0,lastMono:0},[reason]);
  async function currentSummary(a: Acknowledgement, signal?: AbortSignal) {
    let reason=check(a.candidate,signal);
    if(!reason)try{await current(a.candidate,signal);reason=check(a.candidate,signal);}catch{reason=check(a.candidate,signal)??"context";}
    if(reason)a.retired=true;
    return summary(a.candidate,[...(reason?[reason]:[]),...(a.conflict?["conflict" as const]:[]),...(a.overflow?["overflow" as const]:[]),...(a.invalid?["invalid-fact" as const]:[]),...(a.retired?["context" as const]:[])]);
  }
  return {
    async produce(signal?: AbortSignal): Promise<Readonly<object>> {
      if (produced || !enabled()) throw new FakeAdmissionError("disabled");
      produced=true; // Never retry the producer after cancellation/failure/busy.
      let initial: Awaited<ReturnType<typeof current>>;
      try { initial=await current(undefined,signal); } catch { throw new FakeAdmissionError("unavailable"); }
      let wall:number,mono:number;
      try{wall=clock();mono=monotonic();}catch{throw new FakeAdmissionError("unavailable");}
      const until=Math.min(initial.until,wall+30_000);
      const c: Candidate={binding:initial.binding,facts:Object.freeze(blank()),reasons:[],until,monoUntil:mono+until-wall,lastWall:wall,lastMono:mono};
      const facts=blank(), controller=new AbortController();
      const combined=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
      const timer=setTimeout(()=>controller.abort(),Math.max(1,until-wall));
      let capacity: ReturnType<typeof acquirePhotoCapacity> | undefined, reference: Awaited<ReturnType<typeof prepareImageReference>> | undefined;
      let comparison: ReturnType<typeof startImageComparison> | undefined, source: Buffer | undefined, returned: Buffer | undefined, response: Buffer | undefined;
      let phase: Reason="provenance";
      try {
        const early=check(c,combined);if(early)throw Error(early);
        capacity=acquirePhotoCapacity();
        const observation=observationSchema.parse(await deps.observation(combined));
        const stopped=check(c,combined);if(stopped)throw Error(stopped);
        await current(c,combined);
        response=Buffer.from(observation.response.body);
        if(observation.response.rawHeaders.length%2)throw Error();
        const report=inspectCapture(observation.response.status,observation.response.rawHeaders,response);
        if(report.outcome!=="captured" || report.status!==201 || report.duplicateHeaders || report.topLevel!=="object" || report.expiration.syntax!=="utc")throw Error();
        const parsed=z.strictObject({imageUrl:z.unknown().optional(),maxDimensionImageUrl:z.unknown().optional(),expirationDate:z.unknown()}).parse(parseCaptureJson(response));
        facts.provenance="passed";
        phase="identity";
        const location=observation.response.rawHeaders.findIndex((v,n)=>n%2===0&&v.toLowerCase()==="location");
        // Use only its fixed resource grammar. Never feed image capabilities
        // into the legacy parser's receipt fingerprint, even without a query.
        const resource=parseSyntheticMediaReceipt({status:201,location:location<0?undefined:observation.response.rawHeaders[location+1]});
        if(!resource.resourceId || !resource.location)throw Error();
        facts.resourceIdentity="passed"; // Synthetic resource grammar only; never equated with visual ID.
        phase="target";
        const raw=syntheticTarget(parsed[targetField]);
        if(raw!==observation.image.target)throw Error();
        facts.urlEligibility="passed";
        const expires=Date.parse(report.expiration.normalized!);
        c.until=Math.min(c.until,clock()+30_000,expires-60_000);
        c.monoUntil=Math.min(c.monoUntil,monotonic()+c.until-clock());
        const deadline=check(c,combined);if(deadline)throw Error(deadline);
        source=Buffer.from(observation.reference);returned=Buffer.from(observation.image.bytes);
        if(realMediaDigest(source)!==initial.derivativeDigest)throw Error("context");
        phase="image-validation";
        const binding={operationId:randomUUID(),derivativeDigest:initial.derivativeDigest},window={wallUntil:c.until,monoUntil:c.monoUntil};
        reference=await prepareImageReference(source,binding,window,combined,capacity);
        await current(c,combined);
        comparison=startImageComparison(reference,binding,returned,observation.image.mime,window,combined,capacity);
        const visual=await comparison.result;await comparison.settled;
        if(visual.verdict!=="match" || visual.settlement!=="settled" || [visual.decoding,visual.geometry,visual.orientation,visual.marker,visual.color,visual.similarity].some(v=>v!=="passed"))throw Error();
        facts.imageValidation="passed";
        await current(c,combined);const final=check(c,combined);if(final)throw Error(final);
      } catch(error) {
        const message=error instanceof Error?error.message:"";
        const reason=check(c,combined)??(["context","expired","consumer","identity"].includes(message)?message as Reason:phase);
        c.reasons.push(reason);
        if(facts.provenance==="not-run"&&phase==="provenance")facts.provenance="failed";
        if(facts.resourceIdentity==="not-run"&&phase==="identity")facts.resourceIdentity="failed";
        if(facts.urlEligibility==="not-run"&&phase==="target")facts.urlEligibility="failed";
        if(phase==="image-validation")facts.imageValidation="failed";
      } finally {
        if(comparison){comparison.cancel();await comparison.settled;}
        discardImageReference(reference);source?.fill(0);returned?.fill(0);response?.fill(0);
        if(capacity)releasePhotoCapacity(capacity);clearTimeout(timer);
      }
      c.facts=Object.freeze({...facts});
      const proof=Object.freeze(Object.create(null)) as object;issued.set(proof,c);return proof;
    },
    async assess(proof: unknown, signal?: AbortSignal): Promise<FakeAdmissionAssessment> {
      const c=proof&&typeof proof==="object"?issued.get(proof):undefined;
      if(!c)return Object.freeze({summary:rejected("invalid-proof"),evidence:null});
      issued.delete(proof as object); // One use before any blocking read, including failures.
      let reason=check(c,signal);
      if(!reason)try{await current(c,signal);reason=check(c,signal);}catch{reason=signal?.aborted?"cancelled":"context";}
      if(reason)c.reasons.push(reason);
      const evidence=Object.freeze(Object.create(null)) as object;
      acknowledged.set(evidence,{candidate:c,facts:new Map(),conflict:false,overflow:false,invalid:false,retired:!!c.reasons.length});
      return Object.freeze({summary:summary(c),evidence});
    },
    async acknowledge(evidence: unknown, envelope: Uint8Array): Promise<FakeAdmissionAcknowledgement> {
      const a=evidence&&typeof evidence==="object"?acknowledged.get(evidence):undefined;
      if(!a || !enabled())return Object.freeze({accepted:false,duplicate:false,distinctFacts:0,conflict:false,overflow:false,summary:rejected("invalid-proof")});
      let duplicate=false,accepted=false;
      try {
        if(!(envelope instanceof Uint8Array))throw Error();
        if(envelope.byteLength>FAKE_ADMISSION_FACT_BYTES){a.overflow=true;throw Error();}
        const fact=factSchema.parse(parseCaptureJson(envelope)),canonical=JSON.stringify(fact);
        duplicate=a.facts.has(canonical);
        if(!duplicate){
          if([...a.facts.values()].some(kind=>kind===fact.kind))a.conflict=true;
          if(a.facts.size>=FAKE_ADMISSION_FACTS)a.overflow=true;
          else a.facts.set(canonical,fact.kind);
        }
        if(fact.outcome!=="passed")a.retired=true;
        accepted=duplicate||!a.overflow;
      }catch{a.invalid=true;}
      const extra:Reason[]=[...(a.conflict?["conflict" as const]:[]),...(a.overflow?["overflow" as const]:[]),...(a.invalid?["invalid-fact" as const]:[]),...(a.retired?["context" as const]:[])];
      if(extra.length)a.retired=true;
      return Object.freeze({accepted,duplicate,distinctFacts:a.facts.size,conflict:a.conflict,overflow:a.overflow,summary:await currentSummary(a)});
    },
    async status(evidence: unknown, signal?: AbortSignal): Promise<Readonly<FakeAdmissionSummary>> {
      const a=evidence&&typeof evidence==="object"?acknowledged.get(evidence):undefined;
      if(!a)return rejected("invalid-proof");
      return currentSummary(a,signal);
    },
  };
}
