// @vitest-environment node
import { assertOfflineGuards } from "../test/offlinePrototypeGuards";
import { inspectModeledImageUrl, retainModeledTarget, handoffModeledTarget, modeledExpiration, MODEL_IMAGE_ORIGIN } from "./offlineImageUrlPolicy";
import { selectModeledAddress, MODEL_ADDRESS_POLICY } from "./offlineImageAddressModel";

it("blocks actual network even if a future implementation accidentally invokes it", assertOfflineGuards);
const origin = MODEL_IMAGE_ORIGIN;
it.each(["/synthetic/a.png", "/a?", "/a?b=Two+Words&b=%2f%3A&x=&UP=CASE", "/a?x=%C3%A9", "/a%41?x=%3D%23%40"].map((suffix, id) => ({ suffix, id })))("preserves invented request target case$id exactly", ({ suffix }) => {
  const value = origin + suffix, target = retainModeledTarget(value)!;
  expect(inspectModeledImageUrl(value)).toEqual({ simulation: true, accepted: true });
  expect(JSON.stringify(target)).toBe("{}");
  expect(handoffModeledTarget(target, text => text)).toBe(suffix);
  expect(JSON.stringify(inspectModeledImageUrl(value))).not.toContain(suffix);
});
it.each([
  "http://i.sandbox.ebayimg.com/a", "HTTPS://i.sandbox.ebayimg.com/a", "https://I.SANDBOX.EBAYIMG.COM/a",
  "https://i.sandbox.ebayimg.com:443/a", "https://i.sandbox.ebayimg.com:8443/a",
  "https://i.sandbox.ebayimg.com./a", "https://i.sandbox.ebayimg.com.evil.invalid/a", "https://evil-i.sandbox.ebayimg.com/a",
  "https://i.ebayimg.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://user@i.sandbox.ebayimg.com/a",
  "https://@i.sandbox.ebayimg.com/a", "https://user:pass@i.sandbox.ebayimg.com/a",
  origin + "/a#", origin + "/a#fragment", origin + "/a ", origin + "/a\n", origin + "/a\x7f", origin + "/a\\b",
  origin + "/", origin + "/a//b", origin + "/a/./b", origin + "/a/../b", origin + "/a/", origin + "/%2e/b",
  origin + "/a%2Fb", origin + "/%5C", origin + "/%3f", origin + "/%25", origin + "/%2541", origin + "/%00",
  origin + "/%", origin + "/%a", origin + "/%GG", origin + "/a?x=%", origin + "/a?x=%0A",
  origin + "/a?x=%7f", origin + "/a?x=%5c", origin + "/a?x=%25", origin + "/a?x=%252f",
  origin + "/é", origin + "/a?'normalizes'", origin + "/" + "a".repeat(513), origin + "/" + Array(17).fill("a").join("/"),
].map((value, id) => ({ value, id })))("refuses normalization/ambiguous/unsupported invented case$id", ({ value }) => {
  expect(inspectModeledImageUrl(value)).toEqual({ simulation: true, accepted: false });
  expect(retainModeledTarget(value)).toBeNull();
});
it("accepts exact proposed byte/segment bounds and rejects overflow", () => {
  expect(inspectModeledImageUrl(origin + "/" + Array(16).fill("a").join("/")).accepted).toBe(true);
  expect(inspectModeledImageUrl(origin + "/" + "a".repeat(512)).accepted).toBe(true);
  const prefix = origin + "/a?x=";
  expect(inspectModeledImageUrl(prefix + "a".repeat(8192 - prefix.length)).accepted).toBe(true);
  expect(inspectModeledImageUrl(prefix + "a".repeat(8193 - prefix.length)).accepted).toBe(false);
});
it.each([null, {}, 1, undefined])("rejects nonstrings without reflecting them", value => expect(retainModeledTarget(value)).toBeNull());
it("cannot hand off forged or serialized targets", () => {
  const target = retainModeledTarget(origin + "/a?SECRET=synthetic")!;
  expect(() => handoffModeledTarget(JSON.parse(JSON.stringify(target)), () => {})).toThrow("Modeled target unavailable.");
});
it.each([undefined, null, "", "2026-02-30T00:00:00Z", "2026-01-01", "2026-01-01T00:00:00+00:00", "2026-01-01T24:00:00Z", "2026-01-01T00:00:00.1Z"])("requires strict UTC/calendar expiration: %s", value => expect(modeledExpiration(value)).toBeNull());
it.each(["2026-01-01T00:00:00Z", "2026-01-01T00:00:00.123Z"])("accepts legitimate UTC controls: %s", value => expect(modeledExpiration(value)).toBe(Date.parse(value)));
it.each(["0.0.0.0", "127.2.3.4", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "240.0.0.1",
  "::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "::ffff:0808:0808", "64:ff9b::808:808", "fe80::1%lo0", "8.8.4.4"])("blocks nonpublic/mapped/unsupported fixture coverage: %s", address => {
    const family = address.includes(":") ? 6 : 4;
    expect(selectModeledAddress([{ address, family }])).toBeNull();
    expect(selectModeledAddress([{ address: "1.1.1.1", family: 4 }, { address, family }])).toBeNull();
  });
it("checks every simulated answer before selecting exactly one positive fixture", () => {
  const read = vi.fn(() => "127.0.0.1");
  expect(selectModeledAddress([{ address: "0.0.0.0", family: 4 }, { get address() { return read(); }, family: 4 }])).toBeNull();
  expect(read).toHaveBeenCalled();
  expect(selectModeledAddress([{ address: "1.1.1.1", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }])).toBe("1.1.1.1");
  expect(selectModeledAddress([{ address: "2001:4860:4860:0:0:0:0:8888", family: 6 }])).toBe("2001:4860:4860::8888");
  expect(selectModeledAddress([{ address: "1.1.1.1", family: 6 }])).toBeNull();
  expect(selectModeledAddress([])).toBeNull();
  expect(selectModeledAddress(Array(17).fill({ address: "1.1.1.1", family: 4 }))).toBeNull();
  expect(MODEL_ADDRESS_POLICY.coverage).toContain("all others unsupported/blocked");
  expect(MODEL_ADDRESS_POLICY.source).toContain("no IANA registry snapshot");
});
