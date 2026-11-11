import { MAX_IMAGE_BYTES } from "../../domain/listingImage";
import { BUNDLE_CHUNK_BYTES, yieldBundleWork } from "./photoBundle";

export const BUNDLE_TIMEOUT_MS = 120_000;
export const BUNDLE_URL_LIFETIME_MS = 1_000;

export async function readBundlePhoto(url: string, expectedSize: number, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_IMAGE_BYTES) throw new Error("Invalid photo size. Reload the listing.");
  signal.throwIfAborted();
  const response = await fetch(url, { signal, cache: "no-store", referrerPolicy: "no-referrer" });
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new Error("An image could not be downloaded. Try again.");
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const buffer = new ArrayBuffer(expectedSize);
    const bytes = new Uint8Array(buffer);
    let offset = 0;
    let workBytes = 0;
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        if (offset !== expectedSize) throw new Error("A photo's size changed. Reload the listing and try again.");
        return buffer;
      }
      if (value.byteLength > expectedSize - offset) throw new Error("A photo exceeds its expected size. Reload the listing and try again.");
      for (let start = 0; start < value.length;) {
        signal.throwIfAborted();
        const part = value.subarray(start, start + Math.min(BUNDLE_CHUNK_BYTES - workBytes, value.length - start));
        bytes.set(part, offset); start += part.length; offset += part.length; workBytes += part.length;
        if (workBytes === BUNDLE_CHUNK_BYTES) { workBytes = 0; await yieldBundleWork(signal); }
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel(); reader.releaseLock();
  }
}

export function initiateBundleDownload(blob: Blob, filename: string, signal: AbortSignal, onCleanup: (cleanup: () => void) => void) {
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handedOff = false;
  let cleaned = false;
  const cleanupNow = () => {
    if (cleaned) return;
    cleaned = true;
    if (url !== undefined) { URL.revokeObjectURL(url); url = undefined; }
    anchor?.remove();
    clearTimeout(timer);
    signal.removeEventListener("abort", cleanup);
    onCleanup(cleanup);
  };
  // Once clicked, preserve the handoff interval even if the gallery unmounts.
  const cleanup = () => { if (!handedOff) cleanupNow(); };
  try {
    signal.throwIfAborted();
    url = URL.createObjectURL(blob);
    signal.addEventListener("abort", cleanup, { once: true });
    signal.throwIfAborted();
    anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.append(anchor);
    signal.throwIfAborted();
    anchor.click();
    anchor.remove();
    handedOff = true;
    // Preserve the existing download handoff interval; cleanup is also available on unmount.
    timer = setTimeout(cleanupNow, BUNDLE_URL_LIFETIME_MS);
    signal.throwIfAborted();
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}
