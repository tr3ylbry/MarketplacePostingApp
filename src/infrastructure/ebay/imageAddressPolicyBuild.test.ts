// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { readFileSync } from "node:fs";
import { inspectRegistry, manifestTimes, normalizeAddressPolicy, renderAddressPolicy, runAddressPolicyBuild } from "../../../scripts/build-image-address-policy";
import { ADDRESS_POLICY_VERSION, canonicalJson, inspectPolicyData, numericAddress, numericPrefix, sha256, SOURCE_IDS, SOURCE_LIMIT, ROW_LIMIT, type SourceId, type PolicyManifest } from "./imageAddressPolicyFormat";
import { IMAGE_ADDRESS_POLICY_DATA } from "./imagePublicAddressPolicyData";

const directory = new URL("../../../docs/data/image-address-policy-v1/", import.meta.url);
const sources = Object.fromEntries(SOURCE_IDS.map(id => [id, readFileSync(new URL(id + ".xml", directory))])) as unknown as Record<SourceId, Uint8Array>;
const manifest = JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8")) as PolicyManifest;
const clone = () => structuredClone(manifest);
const bytes = (text: string) => new TextEncoder().encode(text);
const sourceText = (id: SourceId) => new TextDecoder().decode(sources[id]);
it("blocks external access in the source-processing suite", assertOfflineGuards);
it("reproduces the exact checked-in module from all four exact snapshots", () => {
  const data = normalizeAddressPolicy(sources, manifest);
  expect(data).toEqual(IMAGE_ADDRESS_POLICY_DATA);
  expect(renderAddressPolicy(data)).toBe(readFileSync(new URL("./imagePublicAddressPolicyData.ts", import.meta.url), "utf8"));
  expect(manifest.sources.map(s => s.rows)).toEqual([256, 25, 51, 25]);
  expect(data.normalized.rows).toHaveLength(358);
  expect(sha256(canonicalJson(data.normalized))).toBe(manifest.normalizedSha256);
});
it("the check command verifies only public source/generated files and emits fixed metadata", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runAddressPolicyBuild("--check");
    expect(output).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ normalized: true, matched: true, policyVersion: ADDRESS_POLICY_VERSION, normalizedSha256: manifest.normalizedSha256 }));
  } finally { output.mockRestore(); }
});
it("refuses invalid build modes before reading or writing", async () => {
  await expect(runAddressPolicyBuild("unreviewed" as "--check")).rejects.toThrow("Address policy data rejected.");
});
it.each(SOURCE_IDS)("validates provenance, row count and reviewed annotations for %s", id => {
  const source = manifest.sources.find(s => s.id === id)!;
  const inspected = inspectRegistry(sources[id], id);
  expect(sha256(sources[id])).toBe(source.sha256);
  expect(inspected).toMatchObject({ updated: source.updated, sourceRows: source.rows, annotationsSha256: source.annotationsSha256 });
});
it("handles the one comma-separated special row without inventing an address grammar", () => {
  const special = inspectRegistry(sources["iana-ipv4-special-registry"], "iana-ipv4-special-registry");
  expect(special.rows).toHaveLength(26);
  const split = special.rows.filter(r => r.row === 13);
  expect(split.map(r => r.prefix)).toEqual(["192.0.0.170/32", "192.0.0.171/32"]);
  expect(split.every(r => r.kind === "special")).toBe(true);
});
it("supports IANA padded /8 source notation while runtime IPv4 stays strict", () => {
  expect(inspectRegistry(sources["ipv4-address-space"], "ipv4-address-space").rows[1].prefix).toBe("1.0.0.0/8");
  expect(numericAddress("001.0.0.0")).toBeNull(); expect(numericPrefix("001/8", 4)).toBeNull();
});
it.each(SOURCE_IDS)("rejects changed source bytes before normalizing %s", id => {
  const changed = { ...sources, [id]: bytes(sourceText(id) + "\n") };
  expect(() => normalizeAddressPolicy(changed, manifest)).toThrow("Address policy data rejected.");
});
it.each(["status", "schema", "duplicate", "contradiction", "missing-row", "footnote", "truncation", "entity", "depth", "encoding", "date"])("refuses unsupported/unsafe allocation input: %s", change => {
  const id = "ipv4-address-space";
  let xml = sourceText(id);
  if (change === "status") xml = xml.replace("<status>ALLOCATED</status>", "<status>UNREVIEWED</status>");
  if (change === "schema") xml = xml.replace("<status>ALLOCATED</status>", "<extra>True</extra><status>ALLOCATED</status>");
  if (change === "duplicate") xml = xml.replace("<prefix>002/8</prefix>", "<prefix>001/8</prefix>");
  if (change === "contradiction") xml = xml.replace("<prefix>000/8</prefix>", "<prefix>001/8</prefix>");
  if (change === "missing-row") xml = xml.replace(/<record>\s*<prefix>001\/8<\/prefix>[\s\S]*?<\/record>/, "");
  if (change === "footnote") xml = xml.replace('data="2"', 'data="unreviewed"');
  if (change === "truncation") xml = xml.slice(0, -100);
  if (change === "entity") xml = xml.replace("<registry", '<!DOCTYPE registry [<!ENTITY unsafe "unsafe">]><registry');
  if (change === "depth") xml = xml.replace("<people/>", "<people>".repeat(18) + "</people>".repeat(18));
  if (change === "date") xml = xml.replace("<date>1981-09</date>", "<date>2025-13</date>");
  const data = change === "encoding" ? new Uint8Array([0xc0, 0x80]) : bytes(xml);
  expect(() => inspectRegistry(data, id)).toThrow();
});
it("does not silently accept changed reviewed footnote meaning even with a new raw hash", () => {
  const id = "ipv4-address-space", xml = sourceText(id).replace("UNALLOCATED: not yet allocated or reserved.", "UNALLOCATED: globally reachable.");
  expect(xml).not.toBe(sourceText(id));
  const changed = { ...sources, [id]: bytes(xml) }, m = clone();
  m.sources[0].sha256 = sha256(changed[id]); m.sources[0].bytes = changed[id].length;
  expect(() => normalizeAddressPolicy(changed, m)).toThrow("Address policy data rejected.");
});
it("rejects overlapping positive/reserved allocation records", () => {
  const id = "ipv6-unicast-address-assignments";
  expect(() => inspectRegistry(bytes(sourceText(id).replace("<prefix>3fff::/20</prefix>", "<prefix>2600::/12</prefix>")), id)).toThrow();
});
it("retains nested special-purpose blocks and terminated records regardless of reachability flags", () => {
  const rows = inspectRegistry(sources["iana-ipv6-special-registry"], "iana-ipv6-special-registry").rows;
  for (const prefix of ["2001::/23", "2001:1::1/128", "2001:10::/28", "2002::/16"]) expect(rows.find(r => r.prefix === prefix)?.kind).toBe("special");
});
it("rejects malformed prefixes, host bits, duplicates and unsupported special flags", () => {
  const id = "iana-ipv4-special-registry", xml = sourceText(id);
  for (const replacement of ["10.0.0.1/8", "010.0.0.0/8", "0.0.0.0/8", "10.0.0.0/33", "10.0.0.0/8,10.1.0.0/16"]) expect(() => inspectRegistry(bytes(xml.replace("10.0.0.0/8", replacement)), id)).toThrow();
  expect(() => inspectRegistry(bytes(xml.replace("<source>True</source>", "<source>Maybe</source>")), id)).toThrow();
});
it("enforces byte and record budgets before accepting any partial result", () => {
  expect(() => inspectRegistry(new Uint8Array(SOURCE_LIMIT + 1), "ipv4-address-space")).toThrow();
  const xml = '<registry xmlns="http://www.iana.org/assignments" id="ipv4-address-space"><title>IPv4 Address Space</title><category>test</category><updated>2025-10-10</updated><people/>' + "<record/>".repeat(ROW_LIMIT + 1) + "</registry>";
  expect(() => inspectRegistry(bytes(xml), "ipv4-address-space")).toThrow();
  const m = clone(); m.sources[0].rows = ROW_LIMIT + 1;
  expect(() => normalizeAddressPolicy(sources, m)).toThrow();
});
it.each(["version", "format", "time", "cutoff", "location", "missing-source", "digest"])("rejects unreviewed manifest configuration: %s", change => {
  const m = clone();
  if (change === "version") m.policyVersion = "unknown";
  if (change === "format") (m as unknown as Record<string, unknown>).formatVersion = 2;
  if (change === "time") m.sources[0].retrievedAt = "2026-02-30T00:00:00.000Z";
  if (change === "cutoff") m.reviewCutoff = "2027-02-21T20:31:27.970Z";
  if (change === "location") m.sources[0].url = "https://other.invalid/source.xml";
  if (change === "missing-source") m.sources.pop();
  if (change === "digest") m.normalizedSha256 = "0".repeat(64);
  expect(() => normalizeAddressPolicy(sources, m)).toThrow();
});
it("does not let a recomputed wrapper hash turn unknown format or incomplete data into a policy", () => {
  const data = structuredClone(IMAGE_ADDRESS_POLICY_DATA) as unknown as { manifest: PolicyManifest; normalized: { formatVersion: number; policyVersion: string; rows: unknown[] }; manifestSha256: string };
  data.normalized.rows.pop(); data.manifest.normalizedSha256 = sha256(canonicalJson(data.normalized)); data.manifestSha256 = sha256(canonicalJson(data.manifest));
  expect(() => inspectPolicyData(data)).toThrow();
});
it("refuses acquisition dates that cannot define an honest review interval", () => {
  const m = clone(); m.sources[0].retrievedAt = "invalid";
  expect(() => manifestTimes(m.sources)).toThrow();
});
