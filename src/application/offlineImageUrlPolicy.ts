// Application proposal for an offline model, not an eBay URL/admission contract.
export const MODEL_IMAGE_HOST = "i.sandbox.ebayimg.com";
export const MODEL_IMAGE_ORIGIN = "https://" + MODEL_IMAGE_HOST;
export const MODEL_URL_BYTES = 8192;
export type UrlPolicyDecision = Readonly<{ simulation: true; accepted: boolean }>;
export type ModeledTarget = Readonly<object>;
const targets = new WeakMap<ModeledTarget, string>();
const refused = Object.freeze({ simulation: true as const, accepted: false });

// Internal modeled request target only: never a report, receipt or browser DTO.
// No query parser, URL construction from IDs, rewriting or URL fingerprinting.
function parseTarget(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MODEL_URL_BYTES || !/^[\x21-\x7e]+$/.test(raw) ||
    /[\\#]/.test(raw) || !raw.startsWith(MODEL_IMAGE_ORIGIN + "/")) return null;
  const target = raw.slice(MODEL_IMAGE_ORIGIN.length);
  const at = target.indexOf("?");
  const path = at < 0 ? target : target.slice(0, at);
  const query = at < 0 ? "" : target.slice(at + 1);
  const segments = path.slice(1).split("/");
  if (!segments.length || segments.length > 16 || segments.some(p => !p || p.length > 512 || p === "." || p === "..")) return null;
  // Path: no malformed, nested, separator/dot/delimiter/control escapes.
  // Query: triplet framing only, plus encoded C0/DEL/backslash rejection.
  // Encoded '%' is conservatively refused in queries too: nested decoding has
  // not been reviewed. Other encoded delimiters remain uninterpreted data.
  const escapes = (value: string, inPath: boolean) => {
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== "%") continue;
      if (!/^[a-f0-9]{2}$/i.test(value.slice(i + 1, i + 3))) return false;
      const byte = Number.parseInt(value.slice(i + 1, i + 3), 16); i += 2;
      if (byte <= 31 || byte === 127 || byte === 92 || byte === 37 ||
        inPath && [46, 47, 58, 63, 35, 64].includes(byte)) return false;
    }
    return true;
  };
  if (!escapes(path, true) || !escapes(query, false)) return null;
  try {
    const url = new URL(raw);
    if (url.href !== raw || url.origin !== MODEL_IMAGE_ORIGIN || url.hostname !== MODEL_IMAGE_HOST ||
      url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
    return target;
  } catch { return null; }
}
export function inspectModeledImageUrl(raw: unknown): UrlPolicyDecision {
  return parseTarget(raw) ? Object.freeze({ simulation: true, accepted: true }) : refused;
}
// Opaque internal memory handle, not a serializable URL-bearing DTO.
export function retainModeledTarget(raw: unknown): ModeledTarget | null {
  const target = parseTarget(raw); if (target === null) return null;
  const handle = Object.freeze(Object.create(null)) as ModeledTarget;
  targets.set(handle, target); return handle;
}
export function handoffModeledTarget<T>(handle: ModeledTarget, sink: (target: string) => T): T {
  const target = targets.get(handle); if (target === undefined) throw Error("Modeled target unavailable.");
  targets.delete(handle);
  return sink(target);
}
export function discardModeledTarget(handle: ModeledTarget | null): void { if (handle) targets.delete(handle); }

// Strict UTC syntax/calendar check. No query-derived expiry or date repair.
export function modeledExpiration(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString() === (value.length === 20 ? value.slice(0, -1) + ".000Z" : value) ? time : null;
}
