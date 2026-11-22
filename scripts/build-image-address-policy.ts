// Build tool only: exact checked-in public files, no env loading or networking.
import { open, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  ADDRESS_POLICY_FORMAT, ADDRESS_POLICY_VERSION, COVERAGE, EXCLUSIONS,
  SOURCE_IDS, SOURCE_TITLES, SOURCE_LIMIT, ROW_LIMIT, REVIEW_INTERVAL,
  assertPolicy, canonicalJson, exactKeys, hasOwn, inspectPolicyData, numericPrefix,
  sha256, utcTime, type Family, type PolicyData,
  type PolicyManifest, type PolicyRow, type SourceId, type SourceMetadata,
} from "../src/infrastructure/ebay/imageAddressPolicyFormat";

interface Element { name: string; attrs: Record<string, string>; text: string; children: Element[] }
const attributes: Record<string, readonly string[]> = {
  registry: ["id", "xmlns"], xref: ["type", "data", "section", "label-format"],
  note: ["title"], footnote: ["anchor"], record: ["date", "updated"],
};
const leaves = ["title", "category", "created", "updated", "prefix", "designation", "date", "description", "whois", "server", "status", "address", "name", "allocation", "termination", "source", "destination", "forwardable", "global", "reserved"];
const mixed = ["xref", "note", "notes", "footnote", "spec", "registration_rule", "description", "address", "source", "destination", "forwardable", "global"];
function element(raw: unknown, depth = 0): Element {
  assertPolicy(depth <= 16);
  assertPolicy(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  const record = raw as Record<string, unknown>, keys = Object.keys(record).filter(k => k !== ":@");
  assertPolicy(keys.length === 1);
  const name = keys[0], attrs: Record<string, string> = {}, children: Element[] = [];
  assertPolicy([...leaves, ...mixed, "registry", "record", "rdap", "people"].includes(name));
  if (record[":@"] !== undefined) {
    assertPolicy(record[":@"] !== null && typeof record[":@"] === "object");
    for (const [key, value] of Object.entries(record[":@"] as Record<string, unknown>)) {
      assertPolicy(key.startsWith("@_") && (attributes[name] ?? []).includes(key.slice(2)) && typeof value === "string" && value.length <= 512);
      attrs[key.slice(2)] = value;
    }
  }
  assertPolicy(Array.isArray(record[name]));
  let text = "";
  for (const part of record[name]) {
    if (hasOwn(part, "#text")) { exactKeys(part, ["#text"]); assertPolicy(typeof part["#text"] === "string"); text += part["#text"]; }
    else children.push(element(part, depth + 1));
  }
  assertPolicy(text.length <= 65_536);
  if (leaves.includes(name) && !mixed.includes(name)) assertPolicy(children.length === 0);
  if (mixed.includes(name)) assertPolicy(children.every(c => c.name === "xref"));
  if (name === "xref") {
    assertPolicy(["rfc", "rfc-errata", "uri", "registry", "note"].includes(attrs.type) && !!attrs.data && children.length === 0);
  }
  if (name === "rdap") assertPolicy(children.every(c => c.name === "server") && children.length >= 1);
  if (name === "people") assertPolicy(!text.trim() && children.length === 0);
  return { name, attrs, text, children };
}
function children(parent: Element, name: string): Element[] { return parent.children.filter(n => n.name === name); }
function one(parent: Element, name: string): Element { const found = children(parent, name); assertPolicy(found.length === 1); return found[0]; }
function text(parent: Element, name: string): string { return one(parent, name).text.trim(); }
function schema(parent: Element, allowed: readonly string[], required: readonly string[], multiple: readonly string[] = []): void {
  assertPolicy(!parent.text.trim() && parent.children.every(c => allowed.includes(c.name)));
  for (const key of allowed) assertPolicy(multiple.includes(key) || children(parent, key).length <= 1);
  for (const key of required) one(parent, key);
}
function annotationTree(node: Element): unknown {
  return { ...node, children: node.children.filter(c => c.name !== "record").map(annotationTree) };
}

/** Source inspection is exported for offline tests/build bootstrap, never runtime input. */
export function inspectRegistry(bytes: Uint8Array, id: SourceId): { updated: string; annotationsSha256: string; rows: PolicyRow[]; sourceRows: number } {
  assertPolicy(bytes.byteLength > 0 && bytes.byteLength <= SOURCE_LIMIT && SOURCE_IDS.includes(id));
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assertPolicy(!/<!DOCTYPE|<!ENTITY/i.test(xml) && !xml.includes("\u0000"));
  assertPolicy(XMLValidator.validate(xml) === true);
  const parsed: unknown = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false,
    processEntities: false, ignoreDeclaration: true, ignorePiTags: true, maxNestedTags: 16 }).parse(xml);
  assertPolicy(Array.isArray(parsed));
  const roots = parsed.filter(part => {
    if (!hasOwn(part, "#text")) return true;
    exactKeys(part, ["#text"]); assertPolicy(typeof part["#text"] === "string" && !part["#text"].trim()); return false;
  });
  assertPolicy(roots.length === 1);
  const root = element(roots[0]);
  assertPolicy(root.name === "registry" && root.attrs.id === id && root.attrs.xmlns === "http://www.iana.org/assignments");
  const index = SOURCE_IDS.indexOf(id), special = index % 2 === 1, family: Family = index < 2 ? 4 : 6;
  const rootFields = ["title", "category", "created", "updated", "xref", "registration_rule", "description", "note", "footnote", "people", special ? "registry" : "record"];
  schema(root, rootFields, ["title", "category", "updated", "people"], ["xref", "note", "footnote", "record"]);
  assertPolicy(text(root, "title") === SOURCE_TITLES[index]);
  const updated = text(root, "updated"); assertPolicy(utcTime(updated + "T00:00:00.000Z") !== null);
  const table = special ? one(root, "registry") : root;
  if (special) {
    assertPolicy(table.attrs.id === id + "-1");
    schema(table, ["title", "xref", "registration_rule", "note", "record"], ["title", "registration_rule"], ["xref", "note", "record"]);
    assertPolicy(text(table, "title") === SOURCE_TITLES[index]);
  }
  const footnotes = new Set<string>();
  for (const note of children(root, "footnote")) { assertPolicy(!!note.attrs.anchor && !footnotes.has(note.attrs.anchor)); footnotes.add(note.attrs.anchor); }
  const checkReferences = (node: Element): void => {
    if (node.name === "xref" && node.attrs.type === "note") assertPolicy(footnotes.has(node.attrs.data));
    node.children.forEach(checkReferences);
  };
  checkReferences(root);
  const records = children(table, "record"); assertPolicy(records.length > 0 && records.length <= ROW_LIMIT);
  const rows: PolicyRow[] = [], notes: unknown[] = [], seen = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    if (special) schema(row, ["address", "name", "spec", "allocation", "termination", "source", "destination", "forwardable", "global", "reserved"], ["address", "name", "spec", "allocation", "source", "destination", "forwardable", "global", "reserved"]);
    else if (family === 4) schema(row, ["prefix", "designation", "date", "whois", "rdap", "status", "xref"], ["prefix", "designation", "date", "status"], ["xref"]);
    else schema(row, ["prefix", "description", "whois", "status", "rdap", "notes"], ["prefix", "description", "whois", "status", "notes"]);
    const checkDate = (value: string) => {
      assertPolicy(/^\d{4}-\d{2}(?:-\d{2})?$/.test(value));
      const time = utcTime(value + (value.length === 7 ? "-01" : "") + "T00:00:00.000Z");
      assertPolicy(time !== null && time <= utcTime(updated + "T00:00:00.000Z")!);
    };
    for (const value of Object.values(row.attrs)) checkDate(value);
    for (const key of ["date", "allocation", "termination"]) for (const date of children(row, key)) checkDate(date.text.trim());
    let raw = text(row, special ? "address" : "prefix"), kind: PolicyRow["kind"];
    if (special) {
      kind = "special";
      for (const flag of ["source", "destination", "forwardable", "global", "reserved"]) {
        const value = text(row, flag);
        assertPolicy(["True", "False", "N/A"].includes(value) || value === "" && children(row, "termination").length === 1);
      }
    } else {
      const status = text(row, "status");
      assertPolicy((family === 4 ? ["ALLOCATED", "LEGACY", "RESERVED", "UNALLOCATED"] : ["ALLOCATED", "RESERVED"]).includes(status));
      kind = status === "ALLOCATED" || status === "LEGACY" ? "positive" : "reserved";
    }
    if (family === 4 && !special) {
      // IANA registry notation 001/8 is NOT accepted runtime IPv4 notation.
      assertPolicy(/^\d{3}\/8$/.test(raw) && Number(raw.slice(0, 3)) <= 255);
      raw = Number(raw.slice(0, 3)) + ".0.0.0/8";
    }
    const values = special ? raw.split(", ") : [raw]; assertPolicy(values.length <= 2);
    for (const value of values) {
      const prefix = numericPrefix(value, family); assertPolicy(prefix);
      const canonical = prefix.address.canonical + "/" + prefix.length;
      assertPolicy(!seen.has(canonical)); seen.add(canonical);
      if (!special) {
        if (family === 4 && kind === "positive") assertPolicy(prefix.address.value >= 1n << 24n && prefix.last < 224n << 24n);
        if (family === 6) assertPolicy(prefix.address.value >= 0x2000n << 112n && prefix.last < 0x4000n << 112n);
        // Allocation tables must not overlap or disagree internally. Special
        // purpose overlap is expected and always blocks, never an exception.
        assertPolicy(!rows.some(other => { const prior = numericPrefix(other.prefix, family)!; return prior.address.value <= prefix.last && prefix.address.value <= prior.last; }));
      }
      rows.push({ family, prefix: canonical, kind, source: id, row: i + 1 });
    }
    notes.push({ prefix: raw, annotations: row.children.filter(n => ["notes", "xref"].includes(n.name) || n.children.some(c => c.name === "xref")) });
  }
  if (family === 4 && !special) assertPolicy(records.length === 256 && seen.size === 256);
  // The explicit v6 reserved rows are also retained, including former 6bone.
  // No WHOIS, RDAP, xref or stylesheet URL is followed by this tool.
  const annotationsSha256 = sha256(canonicalJson({ root: annotationTree(root), table: special ? annotationTree(table) : null, records: notes }));
  return { updated, annotationsSha256, rows, sourceRows: records.length };
}

export function normalizeAddressPolicy(snapshots: Readonly<Record<SourceId, Uint8Array>>, manifest: PolicyManifest): PolicyData {
  assertPolicy(manifest?.formatVersion === ADDRESS_POLICY_FORMAT && manifest?.policyVersion === ADDRESS_POLICY_VERSION && Array.isArray(manifest.sources) && manifest.sources.length === 4);
  assertPolicy(Object.keys(snapshots).length === 4 && SOURCE_IDS.every(id => hasOwn(snapshots, id)));
  const rows: PolicyRow[] = [];
  for (let i = 0; i < SOURCE_IDS.length; i++) {
    const id = SOURCE_IDS[i], source = manifest.sources[i], bytes = snapshots[id];
    assertPolicy(bytes instanceof Uint8Array && bytes.byteLength <= SOURCE_LIMIT && source.id === id && source.bytes === bytes.byteLength && source.sha256 === sha256(bytes));
    const inspected = inspectRegistry(bytes, id);
    assertPolicy(source.updated === inspected.updated && source.rows === inspected.sourceRows && source.annotationsSha256 === inspected.annotationsSha256);
    rows.push(...inspected.rows); assertPolicy(rows.length <= ROW_LIMIT);
  }
  const normalized = { formatVersion: ADDRESS_POLICY_FORMAT, policyVersion: ADDRESS_POLICY_VERSION, rows };
  return inspectPolicyData({ manifest, normalized, manifestSha256: sha256(canonicalJson(manifest)) });
}
export function renderAddressPolicy(data: PolicyData): string {
  inspectPolicyData(data);
  return "// Generated by scripts/build-image-address-policy.ts; do not edit.\n// Public IANA data only; no runtime filesystem or network access.\nexport const IMAGE_ADDRESS_POLICY_DATA = {\n  manifest: " +
    JSON.stringify(data.manifest, null, 2).replace(/\n/g, "\n  ") + ",\n  normalized: {\n    formatVersion: 1,\n    policyVersion: " + JSON.stringify(data.normalized.policyVersion) + ",\n    rows: [\n" +
    data.normalized.rows.map(row => "      " + JSON.stringify(row)).join(",\n") + "\n    ],\n  },\n  manifestSha256: " + JSON.stringify(data.manifestSha256) + ",\n} as const;\n";
}

const sourceDirectory = new URL("../docs/data/image-address-policy-v1/", import.meta.url);
const outputFile = new URL("../src/infrastructure/ebay/imagePublicAddressPolicyData.ts", import.meta.url);
async function boundedRead(file: URL): Promise<Uint8Array> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assertPolicy((await handle.stat()).isFile());
    const buffer = Buffer.alloc(SOURCE_LIMIT + 1); let size = 0;
    while (size < buffer.length) { const read = await handle.read(buffer, size, buffer.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
    assertPolicy(size > 0 && size <= SOURCE_LIMIT); return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
export async function runAddressPolicyBuild(mode: "--check" | "--write"): Promise<void> {
  assertPolicy(mode === "--check" || mode === "--write");
  const manifest: PolicyManifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedRead(new URL("manifest.json", sourceDirectory))));
  const snapshots = {} as Record<SourceId, Uint8Array>;
  for (const id of SOURCE_IDS) snapshots[id] = await boundedRead(new URL(id + ".xml", sourceDirectory));
  const data = normalizeAddressPolicy(snapshots, manifest), rendered = renderAddressPolicy(data);
  if (mode === "--check") assertPolicy(new TextDecoder("utf-8", { fatal: true }).decode(await boundedRead(outputFile)) === rendered);
  else {
    // All validation precedes the write; atomic replacement, never partial data.
    const temporary = new URL(outputFile.href + "." + randomUUID() + ".tmp");
    let created = false;
    try { await writeFile(temporary, rendered, { flag: "wx" }); created = true; await rename(temporary, outputFile); }
    finally { if (created) await unlink(temporary).catch(() => {}); }
  }
  console.log(JSON.stringify({ normalized: true, matched: true, policyVersion: ADDRESS_POLICY_VERSION, normalizedSha256: data.manifest.normalizedSha256 }));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--write"].includes(args[0])) { console.error('{"normalized":false,"reason":"arguments"}'); process.exitCode = 1; }
  else await runAddressPolicyBuild(args[0] as "--check" | "--write").catch(() => { console.error('{"normalized":false,"reason":"source-or-output"}'); process.exitCode = 1; });
}

// Used only while preparing a newly reviewed manifest, not by the normal CLI.
export function sourceManifest(inspected: ReturnType<typeof inspectRegistry>, acquisition: Omit<SourceMetadata, "updated" | "rows" | "annotationsSha256">): SourceMetadata {
  return { ...acquisition, updated: inspected.updated, rows: inspected.sourceRows, annotationsSha256: inspected.annotationsSha256 };
}
export function manifestTimes(sources: readonly SourceMetadata[]): { validFrom: string; reviewCutoff: string } {
  const times = sources.map(s => utcTime(s.retrievedAt)); assertPolicy(times.length === 4 && times.every(t => t !== null));
  return { validFrom: new Date(Math.max(...times)).toISOString(), reviewCutoff: new Date(Math.min(...times) + REVIEW_INTERVAL).toISOString() };
}
export const approvedCoverage = { coverage: COVERAGE, exclusions: EXCLUSIONS };
