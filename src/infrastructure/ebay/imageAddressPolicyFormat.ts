import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const ADDRESS_POLICY_VERSION = "iana-image-address-v1-2026-11-22";
export const ADDRESS_POLICY_FORMAT = 1;
export const SOURCE_LIMIT = 1_048_576;
export const ROW_LIMIT = 4_096;
export const REVIEW_INTERVAL = 90 * 24 * 60 * 60 * 1_000;
export const SOURCE_IDS = ["ipv4-address-space", "iana-ipv4-special-registry", "ipv6-unicast-address-assignments", "iana-ipv6-special-registry"] as const;
export type SourceId = typeof SOURCE_IDS[number];
export type Family = 4 | 6;
export interface NumericAddress { family: Family; value: bigint; canonical: string; embedded: boolean }
export interface PolicyRow { family: Family; prefix: string; kind: "positive" | "reserved" | "special"; source: SourceId; row: number }
export interface SourceMetadata {
  id: SourceId; title: string; indexUrl: string; url: string; file: string;
  retrievedAt: string; updated: string; sha256: string; bytes: number;
  rows: number; annotationsSha256: string;
}
export interface PolicyManifest {
  formatVersion: 1; policyVersion: string; normalizedSha256: string;
  validFrom: string; reviewCutoff: string; reviewer: "project-maintainer";
  coverage: string; exclusions: string; sources: SourceMetadata[];
}
export interface NormalizedPolicy { formatVersion: 1; policyVersion: string; rows: PolicyRow[] }
export interface PolicyData { manifest: PolicyManifest; normalized: NormalizedPolicy; manifestSha256: string }

export const SOURCE_TITLES = ["IPv4 Address Space", "IPv4 Special-Purpose Address Space", "IPv6 Global Unicast Address Space", "IPv6 Special-Purpose Address Space"] as const;
export const COVERAGE = "IPv4 ALLOCATED/LEGACY ordinary unicast /8s; IPv6 ALLOCATED GUA prefixes within 2000::/3; special-purpose and reserved matches override all positives.";
export const EXCLUSIONS = "Unknown/uncovered, special-purpose (including reachable exceptions and terminated entries), reserved, recognized embedded/transition forms; numeric classification does not detect arbitrary translation/tunneling or authorize connections.";

export function policyFailure(): never { throw new Error("Address policy data rejected."); }
export function assertPolicy(value: unknown): asserts value { if (!value) policyFailure(); }
export function hasOwn(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
export function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  assertPolicy(value !== null && typeof value === "object" && !Array.isArray(value));
  const found = Object.keys(value);
  assertPolicy(found.length === keys.length && keys.every(k => hasOwn(value, k)));
}
export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k])).join(",") + "}";
  const encoded = JSON.stringify(value); assertPolicy(typeof encoded === "string"); return encoded;
}
export function utcTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}

/** Numeric input only. Dotted IPv4 tails are parsed for a blocked verdict, never admitted. */
export function numericAddress(input: unknown): NumericAddress | null {
  if (typeof input !== "string" || input.length < 1 || input.length > 45 || !/^[0-9A-Fa-f:.]+$/.test(input)) return null;
  const family = isIP(input);
  if (family !== 4 && family !== 6) return null;
  if (family === 4) {
    const octets = input.split(".").map(Number);
    return { family, value: octets.reduce((n, x) => n * 256n + BigInt(x), 0n), canonical: octets.join("."), embedded: false };
  }
  let text = input.toLowerCase();
  const dotted = text.includes(".");
  if (dotted) {
    const at = text.lastIndexOf(":");
    const tail = numericAddress(text.slice(at + 1));
    if (!tail || tail.family !== 4) return null;
    text = text.slice(0, at + 1) + (tail.value >> 16n).toString(16) + ":" + (tail.value & 65535n).toString(16);
  }
  const halves = text.split("::"), left = halves[0] ? halves[0].split(":") : [], right = halves[1] ? halves[1].split(":") : [];
  const groups = (halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left).map(x => Number.parseInt(x, 16));
  if (groups.length !== 8) return null;
  const value = groups.reduce((n, x) => n * 65536n + BigInt(x), 0n);
  let longest = -1, length = 1;
  for (let i = 0; i < groups.length;) {
    if (groups[i] !== 0) { i++; continue; }
    let end = i; while (end < groups.length && groups[end] === 0) end++;
    if (end - i > length) { longest = i; length = end - i; }
    i = end;
  }
  const hex = groups.map(x => x.toString(16));
  const canonical = longest < 0 ? hex.join(":") : hex.slice(0, longest).join(":") + "::" + hex.slice(longest + length).join(":");
  // IPv4-compatible/mapped and recognizable ISATAP-style interface IDs are
  // conservative syntax restrictions, not a detector for arbitrary tunnels.
  const embedded = dotted || value >> 32n === 0n || value >> 32n === 65535n ||
    (groups[4] === 0 || groups[4] === 0x200) && groups[5] === 0x5efe;
  return { family, value, canonical, embedded };
}
export function addressFromValue(value: bigint, family: Family): string {
  if (family === 4) return [24n, 16n, 8n, 0n].map(n => ((value >> n) & 255n).toString()).join(".");
  return numericAddress(Array.from({ length: 8 }, (_, i) => ((value >> BigInt((7 - i) * 16)) & 65535n).toString(16)).join(":"))!.canonical;
}
export function numericPrefix(input: unknown, family: Family): { address: NumericAddress; length: number; last: bigint } | null {
  if (typeof input !== "string" || input.length > 49) return null;
  const parts = input.split("/");
  if (parts.length !== 2 || !/^(0|[1-9]\d{0,2})$/.test(parts[1])) return null;
  const address = numericAddress(parts[0]), length = Number(parts[1]), bits = family === 4 ? 32 : 128;
  if (!address || address.family !== family || length > bits) return null;
  const size = 1n << BigInt(bits - length);
  return address.value % size === 0n ? { address, length, last: address.value + size - 1n } : null;
}
export function within(address: NumericAddress, prefix: ReturnType<typeof numericPrefix>): boolean {
  return !!prefix && address.family === prefix.address.family && address.value >= prefix.address.value && address.value <= prefix.last;
}

/** Shared build/runtime validation; not a caller-selectable classification policy. */
export function inspectPolicyData(input: unknown): PolicyData {
  exactKeys(input, ["manifest", "normalized", "manifestSha256"]);
  const { manifest, normalized } = input;
  exactKeys(manifest, ["formatVersion", "policyVersion", "normalizedSha256", "validFrom", "reviewCutoff", "reviewer", "coverage", "exclusions", "sources"]);
  exactKeys(normalized, ["formatVersion", "policyVersion", "rows"]);
  assertPolicy(manifest.formatVersion === ADDRESS_POLICY_FORMAT && normalized.formatVersion === ADDRESS_POLICY_FORMAT);
  assertPolicy(manifest.policyVersion === ADDRESS_POLICY_VERSION && normalized.policyVersion === ADDRESS_POLICY_VERSION);
  assertPolicy(manifest.coverage === COVERAGE && manifest.exclusions === EXCLUSIONS && manifest.reviewer === "project-maintainer");
  assertPolicy(sha256(canonicalJson(manifest)) === input.manifestSha256 && sha256(canonicalJson(normalized)) === manifest.normalizedSha256);
  assertPolicy(Array.isArray(manifest.sources) && manifest.sources.length === 4);
  const sourceEntries = manifest.sources;
  const times: number[] = [];
  let count = 0;
  for (let i = 0; i < SOURCE_IDS.length; i++) {
    const source = manifest.sources[i];
    exactKeys(source, ["id", "title", "indexUrl", "url", "file", "retrievedAt", "updated", "sha256", "bytes", "rows", "annotationsSha256"]);
    const id = SOURCE_IDS[i], index = "https://www.iana.org/assignments/" + id + "/";
    assertPolicy(source.id === id && source.title === SOURCE_TITLES[i] && source.indexUrl === index && source.file === id + ".xml" && source.url === index + source.file);
    const time = utcTime(source.retrievedAt), updated = utcTime(source.updated + "T00:00:00.000Z");
    assertPolicy(time !== null && updated !== null && updated <= time);
    assertPolicy(typeof source.sha256 === "string" && /^[a-f0-9]{64}$/.test(source.sha256) && typeof source.annotationsSha256 === "string" && /^[a-f0-9]{64}$/.test(source.annotationsSha256));
    assertPolicy(Number.isSafeInteger(source.bytes) && Number(source.bytes) > 0 && Number(source.bytes) <= SOURCE_LIMIT);
    assertPolicy(Number.isSafeInteger(source.rows) && Number(source.rows) > 0 && (count += Number(source.rows)) <= ROW_LIMIT);
    times.push(time);
  }
  assertPolicy(utcTime(manifest.validFrom) === Math.max(...times) && utcTime(manifest.reviewCutoff) === Math.min(...times) + REVIEW_INTERVAL);
  assertPolicy(Array.isArray(normalized.rows) && normalized.rows.length >= count && normalized.rows.length <= ROW_LIMIT);
  const seen = new Set<string>();
  const represented = SOURCE_IDS.map(() => new Set<number>());
  for (const row of normalized.rows) {
    exactKeys(row, ["family", "prefix", "kind", "source", "row"]);
    const sourceIndex = SOURCE_IDS.indexOf(row.source as SourceId);
    assertPolicy(sourceIndex >= 0 && row.family === (sourceIndex < 2 ? 4 : 6));
    assertPolicy(Number.isSafeInteger(row.row) && Number(row.row) >= 1 && Number(row.row) <= Number(manifest.sources[sourceIndex].rows));
    represented[sourceIndex].add(Number(row.row));
    assertPolicy(sourceIndex % 2 ? row.kind === "special" : row.kind === "positive" || row.kind === "reserved");
    const prefix = numericPrefix(row.prefix, row.family as Family);
    assertPolicy(prefix && row.prefix === prefix.address.canonical + "/" + prefix.length);
    if (sourceIndex === 0) assertPolicy(prefix.length === 8);
    if (row.kind === "positive") assertPolicy(row.family === 4 ? prefix.address.value >= 1n << 24n && prefix.last < 224n << 24n : within(prefix.address, numericPrefix("2000::/3", 6)) && prefix.last <= numericPrefix("2000::/3", 6)!.last);
    const key = row.source + ":" + row.prefix;
    assertPolicy(!seen.has(key)); seen.add(key);
  }
  assertPolicy(represented.every((rows, index) => rows.size === Number(sourceEntries[index].rows)));
  return input as unknown as PolicyData;
}
