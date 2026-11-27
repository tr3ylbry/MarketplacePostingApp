import "server-only";
import { randomBytes } from "node:crypto";
import { request } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { z } from "zod";
import { ownerIdSchema } from "../../application/owner";
import { mediaHash, mediaId, mediaRecipe, mediaSessionHash } from "../../application/ebayRealMedia";
import { verificationReferenceSchema, IMAGE_VERIFICATION_POLICY, MAXIMUM_IMAGE_VERIFICATION_POLICY, sameVerificationPolicy, type VerificationPolicy } from "../../application/ebayImageVerificationPersistence";
import { borrowPhotoCapacity, type PhotoCapacity } from "../../application/photoCapacity";
import { CAPTURE_BODY_BYTES, CAPTURE_HEADER_BYTES, CAPTURE_HTTP_MS, CAPTURE_IMAGE_BYTES,
  emptyCapture, inspectCapture, parseCaptureJson, type CaptureReport } from "../../application/ebayCaptureReport";
import { SANDBOX_CAPTURE_URL } from "./captureClient";
import { imageRequestTarget, IMAGE_DOWNLOAD_POLICY_CUTOFF, ImageDownloadRefusal } from "./imageDownloadPolicy";
import { startImageDownload, type ImageDownloadInput, type ImageDownloadOperation } from "./imageDownloader";

export const freshImageBindingSchema = z.strictObject({
  operationId: z.uuid(), reservation: verificationReferenceSchema,
  context: z.strictObject({
    ownerId: ownerIdSchema, listingId: mediaId, imageId: mediaId, listingVersion: z.iso.datetime(),
    connectionId: mediaId, connectionVersion: mediaId, configHash: mediaHash, grantHash: mediaHash,
    sellerKey: mediaHash, sourceVersion: mediaHash, imageOrder: z.number().int().nonnegative(),
    mediaGrant: z.literal(true), accessExpiresAt: z.iso.datetime(),
  }),
  sessionId: mediaId, sourceDigest: mediaHash, derivativeDigest: mediaHash, recipe: mediaRecipe,
  reviewUntil: z.iso.datetime(),
}).refine(v => v.context.ownerId === v.reservation.ownerId && v.context.listingId === v.reservation.parent.listingId &&
  v.context.imageId === v.reservation.parent.imageId && v.reservation.revision === 0 && v.reservation.parent.revision > 0 &&
  mediaSessionHash(v.context.ownerId, v.sessionId) === v.reservation.parent.sessionHash);
export type FreshImageBinding = z.infer<typeof freshImageBindingSchema>;
export type FreshImageHandle = Readonly<object>;
type Observation = { url: string; receivedAt: number; receivedMono: number; expiresAt: number;
  until: number; monoUntil: number; lastWall: number; lastMono: number; binding: string; dispose(): void };
const observations = new WeakMap<FreshImageHandle, Observation>();
const unavailable = () => new ImageDownloadRefusal("context");
const fingerprint = (value: FreshImageBinding) => JSON.stringify(freshImageBindingSchema.parse(value));
function clocks() {
  const wall = Date.now(), mono = performance.now();
  if (!Number.isSafeInteger(wall) || !Number.isFinite(mono)) throw unavailable();
  return { wall, mono };
}
function eligible(value: Observation, signal: AbortSignal) {
  const { wall, mono } = clocks();
  if (signal.aborted || wall < value.lastWall || mono < value.lastMono || wall >= value.until || mono >= value.monoUntil) throw unavailable();
  value.lastWall = wall; value.lastMono = mono;
}
export function discardFreshImage(handle: unknown): void {
  if (handle && typeof handle === "object") {
    const value = observations.get(handle);
    value?.dispose(); if (value) { value.url = ""; value.binding = ""; }
  }
}

/** Burns synchronously before invoking the asynchronous intent callback. No URL
 * getter or arbitrary sink: private target bytes can flow only to the client. */
export async function downloadFreshImage(handle: unknown, binding: FreshImageBinding, options: {
  signal: AbortSignal; capacity: PhotoCapacity;
  intent(times: { responseReceivedAt: string; providerExpiresAt: string }): Promise<Pick<ImageDownloadInput, "deadlines" | "beforeRequest">>;
}): Promise<ImageDownloadOperation> {
  const value = handle && typeof handle === "object" ? observations.get(handle) : undefined;
  if (!value) throw unavailable();
  value.dispose(); // Permanent in this process, even if validation/commit fails.
  try {
    if (value.binding !== fingerprint(binding)) throw unavailable();
    eligible(value, options.signal);
    const intent = await options.intent({ responseReceivedAt: new Date(value.receivedAt).toISOString(), providerExpiresAt: new Date(value.expiresAt).toISOString() });
    eligible(value, options.signal);
    return startImageDownload({ url: value.url, responseReceivedAt: value.receivedAt, providerExpiresAt: value.expiresAt,
      deadlines: intent.deadlines, beforeRequest: intent.beforeRequest }, options.signal, options.capacity);
  } catch { throw unavailable(); }
  finally { value.url = ""; value.binding = ""; }
}

/** Native, fixed-endpoint observation only. Unlike createCaptureClient, there is
 * no injectable CaptureRequest constructor capable of issuing a handle. */
export async function observeFreshImage(bytes: Buffer, token: string, binding: FreshImageBinding, options: {
  signal: AbortSignal; capacity: PhotoCapacity; until: number; monoUntil: number;
}): Promise<{ report: CaptureReport; handle: FreshImageHandle | null }> {
  return observe(bytes, token, binding, options, IMAGE_VERIFICATION_POLICY);
}

/** Separate fixed profile; no caller-supplied URL or response-field selector. */
export async function observeFreshMaximumImage(bytes: Buffer, token: string, binding: FreshImageBinding, options: {
  signal: AbortSignal; capacity: PhotoCapacity; until: number; monoUntil: number;
}): Promise<{ report: CaptureReport; handle: FreshImageHandle | null }> {
  return observe(bytes, token, binding, options, MAXIMUM_IMAGE_VERIFICATION_POLICY);
}

async function observe(bytes: Buffer, token: string, binding: FreshImageBinding, options: {
  signal: AbortSignal; capacity: PhotoCapacity; until: number; monoUntil: number;
}, policy: VerificationPolicy): Promise<{ report: CaptureReport; handle: FreshImageHandle | null }> {
  let finish: (() => void) | undefined;
  let buffer: Buffer | undefined;
  try {
    const bound = fingerprint(binding), start = clocks();
    if (!sameVerificationPolicy(binding.reservation.policy, policy)) throw unavailable();
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > CAPTURE_IMAGE_BYTES || !token || token.length > 16000 || /[\r\n\0]/.test(token) ||
      options.signal.aborted || !Number.isSafeInteger(options.until) || !Number.isFinite(options.monoUntil)) throw unavailable();
    const until = Math.min(options.until, start.wall + CAPTURE_HTTP_MS, IMAGE_DOWNLOAD_POLICY_CUTOFF);
    const monoUntil = Math.min(options.monoUntil, start.mono + until - start.wall);
    let lastWall = start.wall, lastMono = start.mono;
    const check = () => {
      const at = clocks();
      if (options.signal.aborted || at.wall < lastWall || at.mono < lastMono || at.wall >= until || at.mono >= monoUntil) throw unavailable();
      lastWall = at.wall; lastMono = at.mono;
    };
    check(); finish = borrowPhotoCapacity(options.capacity);
    const boundary = "marketplace-" + randomBytes(24).toString("hex");
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="sandbox-discovery.png"\r\nContent-Type: image/png\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    buffer = Buffer.alloc(CAPTURE_BODY_BYTES);
    return await new Promise(resolve => {
      let req: ClientRequest | undefined, res: IncomingMessage | undefined, socket: Socket | undefined;
      let requestClosed = false, responseClosed = false, socketClosed = false, ended = false, failed = false, completed = false, count = 0;
      let report = emptyCapture("transport"), receipt: ReturnType<typeof clocks> | undefined;
      const done = () => {
        if (completed || !requestClosed || res && !responseClosed || socket && !socketClosed) return;
        completed = true;
        clearTimeout(timer); options.signal.removeEventListener("abort", abort);
        let handle: FreshImageHandle | null = null;
        try {
          check();
          if (!failed && ended && res?.complete && receipt && report.status === 201 && report.outcome === "captured" && report.topLevel === "object" && report.expiration.syntax === "utc") {
            const parsed = parseCaptureJson(buffer!.subarray(0, count)) as Record<string, unknown>;
            const url = parsed[policy.targetField], expiry = parsed.expirationDate;
            imageRequestTarget(url);
            if (typeof url !== "string" || typeof expiry !== "string") throw unavailable();
            const expiresAt = Date.parse(expiry);
            if (!Number.isSafeInteger(expiresAt) || new Date(expiresAt).toISOString() !== (expiry.length === 20 ? expiry.slice(0, -1) + ".000Z" : expiry)) throw unavailable();
            const useUntil = Math.min(options.until, receipt.wall + 30_000, expiresAt - 60_000, IMAGE_DOWNLOAD_POLICY_CUTOFF);
            const useMonoUntil = Math.min(options.monoUntil, receipt.mono + useUntil - receipt.wall);
            if (lastWall >= useUntil || lastMono >= useMonoUntil) throw unavailable();
            handle = Object.freeze(Object.create(null)) as FreshImageHandle;
            const issued = handle;
            const dispose = () => { observations.delete(issued); clearTimeout(expire); options.signal.removeEventListener("abort", dispose); };
            const expire = setTimeout(dispose, Math.max(1, useUntil - lastWall)); expire.unref();
            observations.set(issued, { url, receivedAt: receipt.wall, receivedMono: receipt.mono, expiresAt, until: useUntil,
              monoUntil: useMonoUntil, lastWall, lastMono, binding: bound, dispose });
            options.signal.addEventListener("abort", dispose, { once: true });
          }
        } catch { /* No usable handle; structural evidence remains bounded. */ }
        body.fill(0); resolve({ report, handle });
      };
      const fail = (reason: CaptureReport["outcome"]) => { failed = true; report = emptyCapture(reason, res?.statusCode ?? null); req?.destroy(); res?.destroy(); socket?.destroy(); };
      const abort = () => fail("cancelled");
      const timer = setTimeout(abort, Math.max(1, Math.floor(until - start.wall)));
      options.signal.addEventListener("abort", abort, { once: true });
      try {
        check();
        req = request(SANDBOX_CAPTURE_URL, { method: "POST", agent: false, rejectUnauthorized: true, maxHeaderSize: CAPTURE_HEADER_BYTES,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Accept-Encoding": "identity",
            "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length } }, value => {
          res = value;
          value.once("close", () => { responseClosed = true; done(); });
          value.on("error", () => fail("transport")); value.once("aborted", () => fail("transport"));
          if (value.rawHeaders.length > 256 || value.rawHeaders.reduce((n, x) => n + Buffer.byteLength(x) + 4, 0) > CAPTURE_HEADER_BYTES) return fail("headers");
          value.on("data", (chunk: Buffer) => {
            try { check(); if (failed || !Buffer.isBuffer(chunk) || count + chunk.length > buffer!.length) return fail("body"); chunk.copy(buffer!, count); count += chunk.length; }
            catch { fail("cancelled"); }
          });
          value.once("end", () => {
            try { check(); if (failed || !value.complete || value.rawTrailers.length) return fail("transport");
              receipt = clocks(); report = inspectCapture(value.statusCode ?? 500, value.rawHeaders, buffer!.subarray(0, count)); ended = true;
            } catch { fail("transport"); }
          });
        });
        req.once("socket", value => { socket = value; socketClosed = value.closed; value.once("close", () => { socketClosed = true; done(); }); });
        req.on("error", () => fail("transport")); req.on("information", () => fail("headers"));
        req.on("upgrade", (_value, upgraded) => { upgraded.destroy(); fail("headers"); });
        req.once("close", () => { requestClosed = true; done(); });
        check(); req.end(body);
      } catch { fail("transport"); if (!req) { requestClosed = true; done(); } }
    });
  } catch { return { report: emptyCapture(options.signal.aborted ? "cancelled" : "transport"), handle: null }; }
  finally { buffer?.fill(0); finish?.(); }
}
