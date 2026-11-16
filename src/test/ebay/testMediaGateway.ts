import { z } from "zod";
import type { MediaOutcome, SimulatedMediaGateway } from "../../application/ebayMediaAttempt";
export const MAX_MEDIA_RESPONSE_BYTES = 64 * 1024;
const origin = "http://127.0.0.1:4313";
const identity = /^fake_[a-f0-9]{32}$/;
export function requireMediaTestBuild() {
  const db = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (process.env.MARKETPLACE_TEST_BUILD !== "1" || process.env.VERCEL || !["127.0.0.1", "localhost"].includes(db.hostname) ||
    !db.pathname.endsWith("_test") || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
    !process.env.TEST_EBAY_SECRET) throw new Error("Isolated media tests required.");
}
function resource(value: string | null, prefix: string, suffix = "") {
  if (!value || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || url.href !== value ||
      !url.pathname.startsWith(prefix) || suffix && !url.pathname.endsWith(suffix)) return null;
    const id = url.pathname.slice(prefix.length, suffix ? -suffix.length : undefined);
    return identity.test(id) ? id : null;
  } catch { return null; }
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
    Number(response.headers.get("content-length") ?? 0) > MAX_MEDIA_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined); throw new Error();
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const item = await reader.read(); signal.throwIfAborted(); if (item.done) break;
      length += item.value.byteLength; if (length > MAX_MEDIA_RESPONSE_BYTES) throw new Error(); chunks.push(item.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
const bodySchema = z.strictObject({ imageUrl: z.string().max(512), expirationDate: z.string().max(64), maxDimensionImageUrl: z.string().max(512).optional() });
// This validates a deliberately synthetic grammar, NOT an inferred eBay allowlist.
export async function mediaResponse(response: Response, signal: AbortSignal, now = new Date()): Promise<MediaOutcome> {
  const imageId = resource(response.headers.get("location"), "/commerce/media/v1_beta/image/");
  const result: MediaOutcome = { complete: false, imageId, imageUrl: null, expiresAt: null, responseStatus: response.status, reason: "response" };
  if (response.status !== 201) { await response.body?.cancel().catch(() => undefined); return { ...result, reason: "http" }; }
  try {
    const body = bodySchema.parse(await json(response, signal));
    const urlId = resource(body.imageUrl, "/eps/", ".png");
    const maxId = body.maxDimensionImageUrl === undefined ? true : !!resource(body.maxDimensionImageUrl, "/eps/", ".png");
    const expiry = z.iso.datetime({ offset: true }).safeParse(body.expirationDate);
    if (urlId && (!imageId || urlId === imageId)) result.imageUrl = body.imageUrl;
    if (expiry.success) result.expiresAt = new Date(expiry.data).toISOString();
    if (!result.imageId || !result.imageUrl || !maxId || !result.expiresAt) return result;
    if (Date.parse(result.expiresAt) <= now.getTime()) return { ...result, reason: "expired" };
    return { ...result, complete: true, reason: "complete" };
  } catch { return result; }
}
export function testMediaGateway(transport: typeof fetch = fetch): SimulatedMediaGateway {
  return {
    async create(bytes, signal) {
      requireMediaTestBuild();
      if (!bytes.length || bytes.length > 1024 * 1024) throw new Error("Invalid generated fixture.");
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      try {
        deadline.throwIfAborted();
        const form = new FormData(); form.set("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "fixture.png");
        const response = await transport(origin + "/commerce/media/v1_beta/image/create_image_from_file", { method: "POST", body: form,
          headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! }, signal: deadline, redirect: "error", cache: "no-store" });
        return await mediaResponse(response, deadline);
      } catch { return { complete: false, imageId: null, imageUrl: null, expiresAt: null, responseStatus: null, reason: "transport" }; }
    },
  };
}
