import { PhotoDerivativeError } from "../../application/photoDerivative";
import { acquirePhotoCapacity, borrowPhotoCapacity, releasePhotoCapacity, type PhotoCapacity } from "../../application/photoCapacity";
import { IMAGE_ADDRESS_POLICY } from "./imagePublicAddressPolicy";
import { inspectImageAddressSet } from "./imageAddressSetPolicy";
import { resolveImageDownloadAddresses } from "./imageDownloadDns";
import { connectImagePeer, prepareImageHttp, type ImageHttpBody } from "./imageDownloadTransport";
import { IMAGE_DOWNLOAD_POLICY_CUTOFF, ImageDownloadRefusal, imageRequestTarget, type DownloadReason } from "./imageDownloadPolicy";
import { downloadDeferred, type ImageDownloadWork } from "./imageDownloadWork";

// Internal primitive only. These numbers/callback do NOT authenticate an owner,
// bind a genuine response, consume a durable action or create network authority.
export interface ImageDownloadInput {
  url: string; responseReceivedAt: number; providerExpiresAt: number;
  deadlines: { session: number; review: number; context: number; lease: number; access: number; refresh: number; request: number };
  // Future trusted orchestration must perform its last post-lock authorization
  // here, after TLS setup. No context read is performed after this callback.
  beforeRequest(): Promise<void>;
}
export interface ImageDownloadDiagnostic {
  outcome: "retrieved" | "refused"; reason: DownloadReason; bytes: number;
  mime: "image/png" | "image/jpeg" | null; exceeded: boolean; unverified: true; associated: false;
  settlement: "settled" | "unsettled";
}
export interface ImageDownloadResult { diagnostic: Readonly<ImageDownloadDiagnostic>; data: Uint8Array | null }
export interface ImageDownloadOperation { result: Promise<ImageDownloadResult>; settled: Promise<void>; cancel(): void }
const diagnostic = (reason: DownloadReason, settled: boolean, body?: ImageHttpBody, progress?: {bytes: number; exceeded: boolean; mime: "image/png" | "image/jpeg" | null}): ImageDownloadResult => Object.freeze({
  diagnostic: Object.freeze({ outcome: body ? "retrieved" : "refused", reason, bytes: body?.data.byteLength ?? progress?.bytes ?? 0, mime: body?.mime ?? progress?.mime ?? null, exceeded: progress?.exceeded ?? false,
    unverified: true, associated: false, settlement: settled ? "settled" : "unsettled" }), data: body?.data ?? null,
});
function validated(input: ImageDownloadInput, now: number) {
  if (!input || Object.keys(input).sort().join(",") !== "beforeRequest,deadlines,providerExpiresAt,responseReceivedAt,url" || typeof input.beforeRequest !== "function") throw new ImageDownloadRefusal("context");
  const deadlines = input.deadlines;
  if (!deadlines || Object.keys(deadlines).sort().join(",") !== "access,context,lease,refresh,request,review,session") throw new ImageDownloadRefusal("context");
  const values = [input.responseReceivedAt, input.providerExpiresAt, ...Object.values(deadlines)];
  if (!values.every(Number.isSafeInteger) || input.responseReceivedAt > now || !IMAGE_ADDRESS_POLICY.available ||
    now < (IMAGE_ADDRESS_POLICY.validFrom ?? Infinity)) throw new ImageDownloadRefusal("context");
  const until = Math.min(...Object.values(deadlines), input.responseReceivedAt + 30_000, input.providerExpiresAt - 60_000,
    IMAGE_DOWNLOAD_POLICY_CUTOFF, now + 10_000);
  if (!Number.isSafeInteger(until) || until <= now) throw new ImageDownloadRefusal("deadline");
  return { target: imageRequestTarget(input.url), until, beforeRequest: input.beforeRequest };
}
function downloadClock() {
  try {
    const wall = Date.now(), elapsed = performance.now();
    if (!Number.isSafeInteger(wall) || !Number.isFinite(elapsed)) throw new Error();
    return { wall, elapsed };
  } catch { throw new ImageDownloadRefusal("clock"); }
}
/** Unwired Node boundary. At most one DNS exchange, TLS connection and GET. */
export function startImageDownload(input: ImageDownloadInput, signal?: AbortSignal, parentCapacity?: PhotoCapacity): ImageDownloadOperation {
  const result = downloadDeferred<ImageDownloadResult>(), settled = downloadDeferred<void>();
  let reason: DownloadReason | null = null, finished = false, allSettled = false;
  const resources: Array<ImageDownloadWork<unknown>> = [], waits: Promise<unknown>[] = [];
  let progress: (() => {bytes: number; exceeded: boolean; mime: "image/png" | "image/jpeg" | null}) | undefined;
  const controller = new AbortController();
  const stop = (value: DownloadReason) => {
    if (finished) return;
    reason ??= value; controller.abort();
    for (const resource of resources) { try { resource.abort(); } catch { /* settlement still owns capacity */ } }
    result.resolve(diagnostic(reason, allSettled || waits.length === 0, undefined, progress?.()));
  };
  const operation: ImageDownloadOperation = { result: result.promise, settled: settled.promise, cancel: () => stop("cancelled") };
  let capacity: ReturnType<typeof acquirePhotoCapacity> | undefined, finishCapacity: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort = () => {};
  const run = async () => {
    let body: ImageHttpBody | undefined;
    try {
      const { wall: initialWall, elapsed: initialElapsed } = downloadClock();
      const value = validated(input, initialWall), monoUntil = initialElapsed + value.until - initialWall;
      let lastWall = initialWall, lastElapsed = initialElapsed;
      const check = () => {
        if (reason || controller.signal.aborted || signal?.aborted) throw new ImageDownloadRefusal(reason ?? "cancelled");
        const { wall, elapsed } = downloadClock();
        if (wall < lastWall || elapsed < lastElapsed) throw new ImageDownloadRefusal("clock");
        lastWall = wall; lastElapsed = elapsed;
        if (wall >= value.until || elapsed >= monoUntil || wall >= IMAGE_DOWNLOAD_POLICY_CUTOFF) throw new ImageDownloadRefusal("deadline");
      };
      if (signal?.aborted || controller.signal.aborted) throw new ImageDownloadRefusal("cancelled");
      capacity = parentCapacity ?? acquirePhotoCapacity(); finishCapacity = borrowPhotoCapacity(capacity);
      const abort = () => stop("cancelled"); signal?.addEventListener("abort", abort, { once: true });
      removeAbort = () => signal?.removeEventListener("abort", abort);
      timer = setTimeout(() => stop("deadline"), Math.max(1, Math.floor(value.until - initialWall)));
      const track = <T extends ImageDownloadWork<unknown>>(resource: T): T => {
        resources.push(resource); waits.push(resource.settled.catch(() => {}));
        if (reason) resource.abort(); return resource;
      };
      check();
      const dns = track(resolveImageDownloadAddresses()), answers = await dns.ready;
      await dns.settled; check();
      const candidate = inspectImageAddressSet(answers, Date.now()).candidate;
      if (!candidate) throw new ImageDownloadRefusal("address");
      check(); const peer = track(connectImagePeer(candidate)), socket = await peer.ready; check();
      const http = track(prepareImageHttp(socket, candidate, value.target, check)); progress = http.progress;
      await http.attached; check();
      const context = Promise.resolve().then(() => { check(); return value.beforeRequest(); });
      // A timed-out/uncancellable callback remains started work. Its settlement
      // is tracked even after the bounded result has returned to the caller.
      waits.push(context.catch(() => {}));
      try { await context; } catch { throw new ImageDownloadRefusal("context"); }
      check(); http.send(); body = await http.ready; check();
      await http.settled; check();
      // All actual socket work has closed before a successful byte result.
      await peer.settled; check();
      allSettled = true; finished = true; result.resolve(diagnostic("retrieved", true, body)); body = undefined;
    } catch (error) {
      const failure = error instanceof ImageDownloadRefusal ? error.reason : error instanceof PhotoDerivativeError && error.code === "busy" ? "busy" : "transport";
      stop(failure);
    } finally {
      if (!finished) for (const resource of resources) { try { resource.abort(); } catch { /* wait below */ } }
      body?.data.fill(0);
      if (timer) clearTimeout(timer); removeAbort();
      if (capacity && !parentCapacity) releasePhotoCapacity(capacity);
      await Promise.allSettled(waits);
      finishCapacity?.(); resources.length = 0; waits.length = 0; progress = undefined; allSettled = true; finished = true; settled.resolve();
    }
  };
  void run(); return operation;
}
