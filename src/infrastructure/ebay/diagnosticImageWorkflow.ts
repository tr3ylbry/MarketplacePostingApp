import "server-only";
import type { betterAuth } from "better-auth";
import { randomUUID } from "node:crypto";
import { ownerIdSchema } from "../../application/owner";
import { acquirePhotoCapacity, releasePhotoCapacity, type PhotoCapacity } from "../../application/photoCapacity";
import { PhotoDerivativeError, type PhotoDerivative } from "../../application/photoDerivative";
import { mediaId, mediaHash, mediaSessionHash, realMediaDigest, RealMediaError,
  type RealMediaClaim, type RealMediaReviewGuard, type RealMediaSnapshot, type RealMediaRepository } from "../../application/ebayRealMedia";
import { IMAGE_VERIFICATION_POLICY, type VerificationReference, type VerificationEnvelope } from "../../application/ebayImageVerificationPersistence";
import type { DrizzleEbayImageVerificationRepository } from "../repositories/drizzleEbayImageVerificationRepository";
import type { DrizzleMediaCaptureRepository } from "../repositories/drizzleMediaCaptureRepository";
import { CAPTURE_IMAGE_BYTES, type CaptureReport } from "../../application/ebayCaptureReport";
import { observeFreshImage, downloadFreshImage, discardFreshImage, freshImageBindingSchema, type FreshImageHandle } from "./freshImageCapture";
import { downloadDeferred } from "./imageDownloadWork";
import type { ImageDownloadDiagnostic, ImageDownloadOperation } from "./imageDownloader";
import { IMAGE_DOWNLOAD_POLICY_CUTOFF } from "./imageDownloadPolicy";

export interface DiagnosticImageDependencies {
  // Trusted server composition supplies the actual Better Auth API and request
  // headers. The workflow never accepts an owner/session DTO as authentication.
  auth: Pick<ReturnType<typeof betterAuth>["api"], "getSession">;
  headers(): Promise<Headers>;
  repository: RealMediaRepository;
  verification: Pick<DrizzleEbayImageVerificationRepository, "reserveVerification" | "recordRequestIntent" | "checkIntentContext" | "window" | "closePrepared" | "recordOutcome" | "status">;
  evidence: Pick<DrizzleMediaCaptureRepository, "time" | "authorize" | "record">;
  derive(owner: string, listing: string, version: string, image: string, signal: AbortSignal, capacity: PhotoCapacity): Promise<PhotoDerivative>;
  credential(binding: RealMediaSnapshot): Promise<string>; // Exact existing grant, no refresh port.
  configHash(): string;
  recipe(): string;
}
export interface DiagnosticImageResult {
  state: "unknown" | "not-sent"; associated: false; retrieved: boolean;
  diagnostic: Readonly<ImageDownloadDiagnostic> | null; settlement: "settled" | "unsettled";
  reason: "completed" | "cancelled" | "deadline" | "busy" | "unavailable";
}
export interface DiagnosticImageOperation { result: Promise<Readonly<DiagnosticImageResult>>; settled: Promise<void>; cancel(): void }
interface Review {
  guard: RealMediaReviewGuard; actionHash: string; operationId: string; sourceDigest: string; recipe: string;
  expires: number; monoUntil: number; lastWall: number; lastMono: number;
}
const bindingKeys = ["ownerId","listingId","imageId","listingVersion","connectionId","connectionVersion","configHash","grantHash","sellerKey","sourceVersion","imageOrder","accessExpiresAt","mediaGrant"] as const;
const envelope = (reason: VerificationEnvelope["reason"], settlement: VerificationEnvelope["settlement"], event: VerificationEnvelope["event"] = "failure"): VerificationEnvelope => ({
  version: "diagnostic-verification-v1", event, reason, settlement, httpStatus: null, bytes: 0, exceeded: false, mime: null,
});
export function diagnosticEnvelope(value: Readonly<ImageDownloadDiagnostic>): VerificationEnvelope {
  const reason: VerificationEnvelope["reason"] = value.reason === "retrieved" ? "bounded-response" :
    ["policy","context","deadline","headers","body","status"].includes(value.reason) ? value.reason as VerificationEnvelope["reason"] :
    value.reason === "cancelled" ? "cancelled" : value.reason === "clock" ? "context" : value.reason === "busy" ? "unavailable" : "transport";
  return { ...envelope(reason, value.settlement, value.outcome === "retrieved" ? "response" :
    value.reason === "cancelled" && value.settlement === "unsettled" ? "cancelled" : "failure"),
    httpStatus: value.outcome === "retrieved" ? 200 : null, bytes: value.bytes, exceeded: value.exceeded, mime: value.mime };
}

/** Internal composition only: no runtime/CLI/route/job imports this factory.
 * Neither a review, a successful diagnostic nor any retained row is admission. */
export function createDiagnosticImageWorkflow(deps: DiagnosticImageDependencies) {
  const reviews = new WeakMap<object, Review>();
  let used = false;
  async function actor() {
    const result = await deps.auth.getSession({ method: "GET", headers: await deps.headers(), query: { disableRefresh: true, disableCookieCache: true }, returnHeaders: true });
    const s = result.response;
    if (!s || result.headers.has("set-cookie") || !ownerIdSchema.safeParse(s.user.id).success || !mediaId.safeParse(s.session.id).success ||
      s.session.userId !== s.user.id || s.session.expiresAt.getTime() <= Date.now()) throw new RealMediaError("stale");
    return { ownerId: s.user.id, id: s.session.id, expires: s.session.expiresAt.getTime() };
  }
  function check(r: Review, signal: AbortSignal, wallEnd: number, monoEnd: number) {
    const wall = Date.now(), mono = performance.now();
    if (signal.aborted || !Number.isSafeInteger(wall) || !Number.isFinite(mono) || wall < r.lastWall || mono < r.lastMono ||
      wall >= Math.min(r.expires, wallEnd, IMAGE_DOWNLOAD_POLICY_CUTOFF) || mono >= Math.min(r.monoUntil, monoEnd) ||
      deps.recipe() !== r.recipe || deps.configHash() !== r.guard.binding.configHash) throw new RealMediaError("stale");
    r.lastWall = wall; r.lastMono = mono;
  }
  async function current(r: Review, signal: AbortSignal, wallEnd: number, monoEnd: number) {
    check(r, signal, wallEnd, monoEnd);
    const a = await actor();
    if (a.ownerId !== r.guard.binding.ownerId || a.id !== r.guard.sessionId) throw new RealMediaError("stale");
    const b = await deps.repository.snapshot(a.ownerId, r.guard.binding.listingId, r.guard.binding.imageId);
    check(r, signal, wallEnd, monoEnd);
    if (bindingKeys.some(key => b[key] !== r.guard.binding[key])) throw new RealMediaError("stale");
  }
  return {
    async prepare(listingId: string, imageId: string, expectedSeller: string, expectedSourceDigest: string) {
      try {
        mediaId.parse(listingId); mediaId.parse(imageId); mediaHash.parse(expectedSeller); mediaHash.parse(expectedSourceDigest);
        if (used) throw new RealMediaError("blocked");
        const a = await actor(), b = await deps.repository.snapshot(a.ownerId, listingId, imageId);
        const wall = Math.max(Date.now(), Date.parse(await deps.evidence.time())), mono = performance.now();
        const expires = Math.min(wall + 300_000, a.expires, Date.parse(b.accessExpiresAt ?? "") - 30_000, IMAGE_DOWNLOAD_POLICY_CUTOFF);
        if (!Number.isSafeInteger(wall) || !Number.isFinite(mono) || !Number.isSafeInteger(expires) || expires <= wall ||
          !b.mediaGrant || b.ownerId !== a.ownerId || b.sellerKey !== expectedSeller || b.configHash !== deps.configHash()) throw new RealMediaError("stale");
        const review = Object.freeze({ diagnosticOnly: true, associated: false, expiresAt: new Date(expires).toISOString() });
        reviews.set(review, { guard: { binding: Object.freeze({ ...b }), sessionId: a.id }, sourceDigest: expectedSourceDigest,
          recipe: deps.recipe(), actionHash: realMediaDigest(randomUUID()), operationId: randomUUID(), expires,
          monoUntil: mono + expires - wall, lastWall: wall, lastMono: mono });
        return review;
      } catch { throw new RealMediaError("stale"); }
    },
    confirm(review: unknown, callerSignal?: AbortSignal): DiagnosticImageOperation {
      const r = review && typeof review === "object" ? reviews.get(review) : undefined;
      if (!r || used) throw new RealMediaError("stale");
      reviews.delete(review as object); used = true; // Burn before the first await.
      const result = downloadDeferred<Readonly<DiagnosticImageResult>>(), settled = downloadDeferred<void>(), controller = new AbortController();
      let reason: DiagnosticImageResult["reason"] | undefined, finished = false;
      let ref: VerificationReference | undefined, claim: RealMediaClaim | undefined, capacity: PhotoCapacity | undefined;
      let photo: PhotoDerivative | undefined, handle: FreshImageHandle | null = null, download: ImageDownloadOperation | undefined;
      let diagnostic: Readonly<ImageDownloadDiagnostic> | null = null, state: DiagnosticImageResult["state"] = "unknown";
      const wallEnd = Math.min(r.expires, Date.now() + 30_000), monoEnd = Math.min(r.monoUntil, performance.now() + 30_000);
      const summary = (settlement: "settled" | "unsettled"): Readonly<DiagnosticImageResult> => Object.freeze({
        state, associated: false, retrieved: !reason && diagnostic?.outcome === "retrieved", diagnostic, settlement, reason: reason ?? "completed",
      });
      const stop = (why: "cancelled" | "deadline") => { if (finished) return; reason ??= why; controller.abort(); result.resolve(summary("unsettled")); };
      const abort = () => stop("cancelled"); callerSignal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => stop("deadline"), Math.max(1, Math.min(wallEnd - Date.now(), monoEnd - performance.now())));
      const signal = controller.signal;
      if (callerSignal?.aborted) stop("cancelled");
      async function record(value: VerificationEnvelope) {
        if (!ref) return;
        // Only evidence correlation, never resumption or send eligibility. An
        // uncertain intent acknowledgement can still have committed revision1.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const status = await deps.verification.status(ref.ownerId, ref.id);
            if (!status) { reason ??= "unavailable"; return; }
            await deps.verification.recordOutcome(ref, { intentRevision: status.phase === "intent-recorded" ? 1 : null, envelope: value }); return;
          } catch { /* Same bounded local acknowledgement only; no I/O retry. */ }
        }
        reason ??= "unavailable";
      }
      async function captureEvidence(value: CaptureReport) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try { await deps.evidence.record(claim!, value); return; }
          catch { if (attempt === 1) throw new RealMediaError("unavailable"); }
        }
      }
      const run = async () => {
        try {
          capacity = acquirePhotoCapacity();
          await current(r, signal, wallEnd, monoEnd);
          const b = r.guard.binding, guard = { ...r.guard, leaseDeadline: new Date(Math.floor(wallEnd)).toISOString() };
          claim = await deps.repository.claim({ ownerId: b.ownerId, listingId: b.listingId, imageId: b.imageId, listingVersion: b.listingVersion,
            configHash: b.configHash, recipe: r.recipe, operation: "capture-only", sessionHash: mediaSessionHash(b.ownerId, guard.sessionId), actionHash: r.actionHash }, guard);
          check(r, signal, wallEnd, monoEnd);
          photo = await deps.derive(b.ownerId, b.listingId, b.listingVersion, b.imageId, signal, capacity);
          await current(r, signal, wallEnd, monoEnd);
          if (!Buffer.isBuffer(photo.bytes) || photo.sourceDigest !== r.sourceDigest || photo.recipe !== r.recipe || photo.contentType !== "image/png" ||
            photo.width !== 500 || photo.height !== 600 || photo.size > CAPTURE_IMAGE_BYTES || photo.size !== photo.bytes.length ||
            realMediaDigest(photo.bytes) !== photo.derivativeDigest) throw new RealMediaError("stale");
          ref = await deps.verification.reserveVerification({ parent: claim, guard, actionHash: realMediaDigest("verification:" + r.actionHash),
            sourceDigest: photo.sourceDigest, derivativeDigest: photo.derivativeDigest, reviewUntil: new Date(r.expires).toISOString(), policy: IMAGE_VERIFICATION_POLICY });
          check(r, signal, wallEnd, monoEnd);
          const token = await deps.credential(b);
          await current(r, signal, wallEnd, monoEnd);
          claim = await deps.repository.fence(claim, { sourceDigest: photo.sourceDigest, derivativeDigest: photo.derivativeDigest,
            recipe: photo.recipe, contentType: photo.contentType, size: photo.size, width: photo.width, height: photo.height }, guard);
          ref = { ...ref, parent: claim };
          await deps.repository.beforeSend(claim, guard);
          await current(r, signal, wallEnd, monoEnd);
          const binding = freshImageBindingSchema.parse({ operationId: r.operationId, reservation: ref, context: b,
            sessionId: guard.sessionId, sourceDigest: photo.sourceDigest, derivativeDigest: photo.derivativeDigest, recipe: r.recipe, reviewUntil: new Date(r.expires).toISOString() });
          // Finish the parent check, then authorize the still-prepared child
          // and parent together after the combined guard's blocking reads.
          await deps.evidence.authorize(claim);
          // Bind the still-prepared reservation as well as the fenced parent.
          // This read finishes with the combined post-lock SQL check; there is
          // no later asynchronous context/credential access before POST.
          const uploadWindow = await deps.verification.window(ref, guard, "prepared");
          if (realMediaDigest(photo.bytes) !== photo.derivativeDigest) throw new RealMediaError("stale");
          check(r, signal, wallEnd, monoEnd);
          const observed = await observeFreshImage(photo.bytes, token, binding, { signal, capacity,
            until: Math.min(wallEnd, ...Object.values(uploadWindow)), monoUntil: monoEnd });
          handle = observed.handle;
          await captureEvidence(observed.report);
          check(r, signal, wallEnd, monoEnd);
          if (!handle) throw new RealMediaError("stale");
          download = await downloadFreshImage(handle, binding, { signal, capacity, async intent(times) {
            await current(r, signal, wallEnd, monoEnd);
            ref = await deps.verification.recordRequestIntent(ref!, guard, times); // An uncertain acknowledgement throws: never start DNS/GET.
            const deadlines = await deps.verification.window(ref, guard, "intent-recorded");
            check(r, signal, wallEnd, monoEnd);
            return { deadlines, beforeRequest: async () => {
              await current(r, signal, wallEnd, monoEnd);
              await deps.verification.checkIntentContext(ref!, guard);
              check(r, signal, wallEnd, monoEnd); // No asynchronous reads after SQL authorization.
            } };
          } });
          const downloaded = await download.result;
          diagnostic = downloaded.diagnostic;
          try {
            if (reason && diagnostic.reason !== reason) await record(envelope(reason === "cancelled" ? "cancelled" : reason === "deadline" ? "deadline" : "unavailable", "unsettled", reason === "cancelled" ? "cancelled" : "failure"));
            await record(diagnosticEnvelope(diagnostic));
          } finally { downloaded.data?.fill(0); }
          await download.settled;
          await record(envelope("settled", "settled", "settlement"));
        } catch (error) {
          reason ??= error instanceof PhotoDerivativeError && error.code === "busy" ? "busy" : "unavailable";
          if (claim) { try { if ((await deps.repository.notSent(claim)).state === "not-sent") state = "not-sent"; } catch { /* Committed/uncertain fences survive. */ } }
          if (ref) {
            try { await deps.verification.closePrepared(ref, reason === "cancelled" ? "cancelled" : reason === "deadline" ? "expired" : "preparation-failed"); } catch { /* Immutable intent is never closed/reset. */ }
            await record(envelope(reason === "cancelled" ? "cancelled" : reason === "deadline" ? "deadline" : "unavailable", "unsettled", reason === "cancelled" ? "cancelled" : "failure"));
          }
        } finally {
          discardFreshImage(handle);
          if (download) { download.cancel(); await download.settled; }
          if (ref && reason) await record(envelope("settled", "settled", "settlement"));
          if (Buffer.isBuffer(photo?.bytes)) photo.bytes.fill(0);
          if (capacity) releasePhotoCapacity(capacity);
          clearTimeout(timer); callerSignal?.removeEventListener("abort", abort);
          finished = true; result.resolve(summary("settled")); settled.resolve();
        }
      };
      void run();
      return { result: result.promise, settled: settled.promise, cancel: () => stop("cancelled") };
    },
  };
}
