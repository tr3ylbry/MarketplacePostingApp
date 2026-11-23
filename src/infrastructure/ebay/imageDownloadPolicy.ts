// Reviewed conservative application contract, not a universal provider grammar.
export const IMAGE_DOWNLOAD_HOST = "i.sandbox.ebayimg.com";
export const IMAGE_DOWNLOAD_ORIGIN = "https://" + IMAGE_DOWNLOAD_HOST;
export const IMAGE_DOWNLOAD_BODY_LIMIT = 1_048_576;
export const IMAGE_DOWNLOAD_HEADER_LIMIT = 16_384;
export const IMAGE_DOWNLOAD_WIRE_LIMIT = 2 * IMAGE_DOWNLOAD_BODY_LIMIT + IMAGE_DOWNLOAD_HEADER_LIMIT;
export const IMAGE_DOWNLOAD_POLICY_CUTOFF = Date.parse("2027-02-20T20:31:27.970Z");
export type DownloadReason = "retrieved" | "policy" | "context" | "clock" | "deadline" | "cancelled" | "busy" | "dns" | "address" | "tls" | "peer" | "headers" | "status" | "body" | "transport";
export class ImageDownloadRefusal extends Error {
  constructor(readonly reason: DownloadReason) { super("Image download refused."); }
}
export function refuseDownload(reason: DownloadReason): never { throw new ImageDownloadRefusal(reason); }
/** Internal operation-local target bytes. Never a DTO, log or persisted value. */
export function imageRequestTarget(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 8192 || !/^[\x21-\x7e]+$/.test(raw) || /[\\#]/.test(raw) || !raw.startsWith(IMAGE_DOWNLOAD_ORIGIN + "/")) return refuseDownload("policy");
  const target = raw.slice(IMAGE_DOWNLOAD_ORIGIN.length), q = target.indexOf("?");
  const path = q < 0 ? target : target.slice(0, q), query = q < 0 ? "" : target.slice(q + 1);
  const segments = path.slice(1).split("/");
  if (segments.length > 16 || segments.some(p => !p || p.length > 512 || p === "." || p === "..")) return refuseDownload("policy");
  for (const [text, inPath] of [[path, true], [query, false]] as const) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "%") continue;
      if (!/^[a-f0-9]{2}$/i.test(text.slice(i + 1, i + 3))) return refuseDownload("policy");
      const byte = Number.parseInt(text.slice(i + 1, i + 3), 16); i += 2;
      if (byte <= 31 || byte === 127 || byte === 92 || byte === 37 || inPath && [46, 47, 58, 63, 35, 64].includes(byte)) return refuseDownload("policy");
    }
  }
  try {
    const url = new URL(raw);
    if (url.href !== raw || url.origin !== IMAGE_DOWNLOAD_ORIGIN || url.hostname !== IMAGE_DOWNLOAD_HOST || url.port || url.username || url.password || url.hash) return refuseDownload("policy");
  } catch { return refuseDownload("policy"); }
  return target;
}
export interface ImageResponseFacts { length: number | null; mime: "image/png" | "image/jpeg"; chunked: boolean }
/** Also used by the raw-header monitor before the Node HTTP parser callback. */
export function imageResponseHeaders(raw: Buffer): ImageResponseFacts {
  if (raw.length > IMAGE_DOWNLOAD_HEADER_LIMIT || !raw.subarray(-4).equals(Buffer.from("\r\n\r\n"))) return refuseDownload("headers");
  for (const byte of raw) if (byte !== 13 && byte !== 10 && (byte < 32 || byte > 126)) return refuseDownload("headers");
  const lines = raw.toString("ascii").slice(0, -4).split("\r\n");
  if (!/^HTTP\/1\.[01] 200(?: [\x20-\x7e]*)?$/.test(lines.shift() ?? "")) return refuseDownload("status");
  if (lines.length > 128) return refuseDownload("headers");
  const headers = new Map<string, string>();
  for (const line of lines) {
    const at = line.indexOf(":"), key = line.slice(0, at).toLowerCase();
    if (at < 1 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || headers.has(key)) return refuseDownload("headers");
    headers.set(key, line.slice(at + 1).trim());
  }
  for (const key of ["set-cookie", "trailer", "www-authenticate", "proxy-authenticate", "upgrade"]) if (headers.has(key)) return refuseDownload("headers");
  if (headers.has("connection") && headers.get("connection")?.toLowerCase() !== "close") return refuseDownload("headers");
  const mime = headers.get("content-type")?.toLowerCase();
  if (mime !== "image/png" && mime !== "image/jpeg") return refuseDownload("headers");
  if (headers.has("content-encoding") && headers.get("content-encoding")?.toLowerCase() !== "identity") return refuseDownload("headers");
  const te = headers.get("transfer-encoding"), cl = headers.get("content-length");
  if (te !== undefined && (te.toLowerCase() !== "chunked" || cl !== undefined)) return refuseDownload("headers");
  if (cl !== undefined && (!/^(0|[1-9][0-9]{0,6})$/.test(cl) || Number(cl) > IMAGE_DOWNLOAD_BODY_LIMIT)) return refuseDownload("body");
  return { length: cl === undefined ? null : Number(cl), mime, chunked: te !== undefined };
}
