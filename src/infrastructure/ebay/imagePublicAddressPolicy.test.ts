// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { classifyImageAddress, IMAGE_ADDRESS_POLICY } from "./imagePublicAddressPolicy";
import { IMAGE_ADDRESS_POLICY_DATA } from "./imagePublicAddressPolicyData";
import { ADDRESS_POLICY_VERSION, canonicalJson, sha256 } from "./imageAddressPolicyFormat";

const now = Date.parse(IMAGE_ADDRESS_POLICY_DATA.manifest.validFrom);
it("intercepts forbidden external access before it occurs", assertOfflineGuards);
it("has a verified pinned policy and immutable input data", () => {
  expect(IMAGE_ADDRESS_POLICY.available).toBe(true);
  expect(Object.isFrozen(IMAGE_ADDRESS_POLICY_DATA.normalized.rows[0])).toBe(true);
  expect(IMAGE_ADDRESS_POLICY.policyVersion).toBe(ADDRESS_POLICY_VERSION);
});
// Independent test representation: padded hex bit strings, rather than the
// production group accumulator/prefix-range implementation.
function integer(address: string, family: number): bigint {
  if (family === 4) return BigInt("0x" + address.split(".").map(x => Number(x).toString(16).padStart(2, "0")).join(""));
  const [a, b] = address.split("::"), left = a ? a.split(":") : [], right = b ? b.split(":") : [];
  const groups = address.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return BigInt("0x" + groups.map(x => x.padStart(4, "0")).join(""));
}
function spelling(value: bigint, family: number): string {
  const hex = value.toString(16).padStart(family === 4 ? 8 : 32, "0");
  return family === 4 ? hex.match(/../g)!.map(x => Number.parseInt(x, 16)).join(".") : hex.match(/..../g)!.join(":");
}
function expected(value: bigint, family: number): string {
  const matched = IMAGE_ADDRESS_POLICY_DATA.normalized.rows.filter(row => {
    if (row.family !== family) return false;
    const [start, length] = row.prefix.split("/"), shift = BigInt((family === 4 ? 32 : 128) - Number(length));
    return value >> shift === integer(start, family) >> shift;
  });
  if (matched.some(r => r.kind === "special" || r.kind === "reserved")) return "blocked";
  if (family === 6 && (value >> 32n === 0n || value >> 32n === 65535n || ((value >> 32n) & 65535n) === 0x5efen && [0n, 0x200n].includes((value >> 48n) & 65535n))) return "blocked";
  return matched.some(r => r.kind === "positive") ? "public-candidate" : "unclassified";
}
it.each(IMAGE_ADDRESS_POLICY_DATA.normalized.rows.map((row, index) => ({ row, index })))("checks first/last/adjacent addresses for pinned prefix $index", ({ row }) => {
  const [address, length] = row.prefix.split("/"), bits = row.family === 4 ? 32 : 128;
  const first = integer(address, row.family), last = first + (1n << BigInt(bits - Number(length))) - 1n;
  for (const n of [first - 1n, first, last, last + 1n]) {
    if (n < 0 || n >= 1n << BigInt(bits)) continue;
    const result = classifyImageAddress(spelling(n, row.family), row.family, now);
    expect(result.classification).toBe(expected(n, row.family));
    expect(result.family).toBe(row.family);
  }
});
it.each([
  ["1.2.3.4", 4, "ipv4-address-space", 2],
  ["8.8.8.8", 4, "ipv4-address-space", 9],
  ["2001:200::1", 6, "ipv6-unicast-address-assignments", 2],
  ["2600::1", 6, "ipv6-unicast-address-assignments", 29],
] as const)("accepts an allocated/legacy control with source provenance: %s", (address, family, source, row) => {
  expect(classifyImageAddress(address, family, now).classification).toBe("public-candidate");
  const allocation = IMAGE_ADDRESS_POLICY_DATA.normalized.rows.find(r => r.source === source && r.row === row);
  expect(allocation?.kind).toBe("positive");
  expect(integer(address, family) >> BigInt((family === 4 ? 32 : 128) - Number(allocation!.prefix.split("/")[1]))).toBe(integer(allocation!.prefix.split("/")[0], family) >> BigInt((family === 4 ? 32 : 128) - Number(allocation!.prefix.split("/")[1])));
});
it.each(["192.0.0.9", "192.0.0.10", "192.31.196.1", "192.175.48.1", "2001:1::1", "2001:3::1", "2001:20::1", "2620:4f:8000::1"])("blocks globally reachable special-purpose exceptions: %s", address => {
  expect(classifyImageAddress(address, address.includes(":") ? 6 : 4, now)).toMatchObject({ classification: "blocked", reason: "special-purpose" });
});
it.each(["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
  "::", "::1", "::8.8.8.8", "::808:808", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "64:ff9b:1::808:808", "2001::1", "2002:808:808::1", "2001:db8::1", "3ffe:831f::1", "3fff::1", "fc00::1", "fe80::1",
  "2600::8.8.8.8", "2600::5efe:808:808", "2600::200:5efe:808:808"])("refuses private/special/reserved/recognized embedded control: %s", address => {
  expect(classifyImageAddress(address, address.includes(":") ? 6 : 4, now).classification).not.toBe("public-candidate");
});
it.each(["2000::1", "2300::1", "4000::1", "ff00::1"])("leaves unsupported/unallocated space NO-GO: %s", value => {
  expect(classifyImageAddress(value, 6, now).classification).not.toBe("public-candidate");
});
it.each([undefined, null, {}, [], 1, "", "example.invalid", "1.2.3", "1", "010.0.0.1", "0x08080808", "134744072", "1.2.3.256", "1.2.3.4/32", "1.2.3.4:443", " 8.8.8.8", "8.8.8.8\n", "\t8.8.8.8", "8.8.8.8\u0000", "[2600::1]", "2600::1%zone", "2600:::1", "2600::01.2.3.4", "f".repeat(46)])("rejects malformed or unsupported runtime notation without echo", value => {
  expect(classifyImageAddress(value, 4, now)).toEqual({ classification: "unclassified", reason: "invalid-input", policyVersion: ADDRESS_POLICY_VERSION });
});
it.each([undefined, 0, "4", 6, {}, null])("rejects invalid/mismatched family without coercion", family => {
  expect(classifyImageAddress("8.8.8.8", family, now)).toMatchObject({ classification: "unclassified", reason: "family-mismatch", family: 4 });
});
it("canonicalizes IPv6 numeric equivalence and selects the first longest zero run", () => {
  for (const input of ["2600:ABCD:0000:0000:0000:0000:0000:0001", "2600:abcd::1"]) expect(classifyImageAddress(input, 6, now)).toMatchObject({ classification: "public-candidate", address: "2600:abcd::1" });
  expect(classifyImageAddress("2600:0:0:1:0:0:2:3", 6, now).address).toBe("2600::1:0:0:2:3");
  expect(classifyImageAddress("2600:1:2:3:4:5:0:0", 6, now).address).toBe("2600:1:2:3:4:5::");
});
it("uses the latest acquisition as its start and earliest 90-day deadline as cutoff", () => {
  const start = Date.parse(IMAGE_ADDRESS_POLICY_DATA.manifest.validFrom), end = Date.parse(IMAGE_ADDRESS_POLICY_DATA.manifest.reviewCutoff);
  const times = IMAGE_ADDRESS_POLICY_DATA.manifest.sources.map(s => Date.parse(s.retrievedAt));
  expect(start).toBe(Math.max(...times)); expect(end).toBe(Math.min(...times) + 90 * 86400_000);
  expect(classifyImageAddress("8.8.8.8", 4, start - 1).reason).toBe("before-acquisition");
  expect(classifyImageAddress("8.8.8.8", 4, Math.min(...times)).reason).toBe("before-acquisition");
  expect(classifyImageAddress("8.8.8.8", 4, start).classification).toBe("public-candidate");
  expect(classifyImageAddress("8.8.8.8", 4, end - 1).classification).toBe("public-candidate");
  expect(classifyImageAddress("8.8.8.8", 4, end).reason).toBe("policy-stale");
});
it.each([undefined, null, NaN, Infinity, -Infinity, "2026-11-22", new Date(), 1.5])("refuses invalid evaluation time", time => {
  expect(classifyImageAddress("8.8.8.8", 4, time).reason).toBe("invalid-time");
});

describe("pinned data corruption fails closed, without a caller-selectable policy", () => {
  afterEach(() => { vi.doUnmock("./imagePublicAddressPolicyData"); vi.resetModules(); });
  it.each(["missing-version", "unknown-version", "rows", "metadata", "cutoff", "source", "shape"])("refuses %s", async change => {
    const data = structuredClone(IMAGE_ADDRESS_POLICY_DATA) as unknown as { manifest: Record<string, unknown>; normalized: { rows: Array<Record<string, unknown>> }; manifestSha256: string };
    if (change === "missing-version") delete data.manifest.policyVersion;
    if (change === "unknown-version") data.manifest.policyVersion = "unreviewed";
    if (change === "rows") data.normalized.rows[0].kind = "positive";
    if (change === "metadata") data.manifest.reviewer = "unreviewed";
    if (change === "cutoff") { data.manifest.reviewCutoff = "2030-01-01T00:00:00.000Z"; data.manifestSha256 = sha256(canonicalJson(data.manifest)); }
    if (change === "source") data.manifest.sources = [];
    if (change === "shape") data.manifest.extra = "synthetic-secret-marker";
    vi.resetModules(); vi.doMock("./imagePublicAddressPolicyData", () => ({ IMAGE_ADDRESS_POLICY_DATA: data }));
    const mod = await import("./imagePublicAddressPolicy");
    expect(mod.IMAGE_ADDRESS_POLICY.available).toBe(false);
    expect(mod.classifyImageAddress("8.8.8.8", 4, now)).toEqual({ classification: "unclassified", reason: "policy-unavailable", policyVersion: ADDRESS_POLICY_VERSION, address: "8.8.8.8", family: 4 });
  });
});
