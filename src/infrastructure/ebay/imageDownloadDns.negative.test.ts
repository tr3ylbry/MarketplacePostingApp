// @vitest-environment node
import { assertOfflineDnsGuards } from "../../test/offlineDnsGuards";
import { DNS_FIXTURE_HOST as HOST, DNS_FIXTURE_ID as ID, DNS_FIXTURE_TERMINAL as TERMINAL,
  dnsFixturePacket as packet, dnsFixtureAlias as alias, dnsFixtureAddress as address, dnsFixtureSoa as soa,
  dnsFixtureNs as ns, dnsFixtureName as name, dnsFixturePointer as pointer, dnsNegativeFixtures } from "../../test/imageDnsFixtures";
import { parseImageDnsAnswer } from "./imageDownloadDns";
import { ImageDnsRefusal } from "./imageDownloadDiagnostics";

function refusal(bytes: Buffer, type: 1 | 28, reason: string) {
  try { parseImageDnsAnswer(bytes, ID, type); throw Error("Expected synthetic refusal."); }
  catch (error) {
    expect(error).toBeInstanceOf(ImageDnsRefusal);
    expect(error).toMatchObject({ reason: "dns", dns: { phase: "parse", reason, nativeCode: null } });
  }
}
it("blocks offline DNS/private access before I/O", assertOfflineDnsGuards);
for (const type of [1, 28] as const) {
  for (const code of [0, 3]) {
    it.each(dnsNegativeFixtures)(`classifies $reason for synthetic type${type}/rcode${code}`, ({ reason, options }) => {
      const bytes = packet(type, { ...options, flags: 0x8180 | code });
      // This direct NXDOMAIN form was accepted before subcategories; do not repair its profile here.
      if (code === 3 && reason === "ns-only-authority") expect(parseImageDnsAnswer(bytes, ID, type)).toEqual({ code, canonical: HOST, addresses: [] });
      else refusal(bytes, type, reason);
    });
    it(`preserves direct empty and complete SOA-backed negatives type${type}/rcode${code}`, () => {
      expect(parseImageDnsAnswer(packet(type, { flags: 0x8180 | code }), ID, type)).toEqual({ code, canonical: HOST, addresses: [] });
      for (const owner of [TERMINAL, "invalid.test", "test", "", "INVALID.TEST"]) {
        const bytes = packet(type, { flags: 0x8180 | code, answers: [alias()], authority: [soa(owner), ns()] });
        expect(parseImageDnsAnswer(bytes, ID, type)).toEqual({ code, canonical: TERMINAL, addresses: [] });
      }
    });
  }
  it(`preserves complete direct and alias-positive type${type} results`, () => {
    for (const owner of [HOST, TERMINAL]) {
      const bytes = packet(type, { answers: [...(owner === HOST ? [] : [alias()]), address(type, owner)] });
      expect(parseImageDnsAnswer(bytes, ID, type)).toEqual({ code: 0, canonical: owner,
        addresses: [{ address: type === 1 ? "1.1.1.1" : "2001:4860:4860:0:0:0:0:8888", family: type === 1 ? 4 : 6 }] });
    }
  });
}
it.each([
  { label: "count before class/owner/layout", authority: [soa("elsewhere.test", 3, Buffer.from([0x40])), soa()], reason: "soa-count" },
  { label: "class before owner/layout", authority: [soa("elsewhere.test", 3, Buffer.from([0x40]))], reason: "soa-class" },
  { label: "owner before name/layout", authority: [soa("elsewhere.test", 1, Buffer.from([0x40]))], reason: "soa-owner" },
  { label: "framed name before numeric layout", authority: [soa("invalid.test", 1, Buffer.from([0x40]))], reason: "invalid-message" },
])("retains refusal precedence: $label", ({ authority, reason }) => refusal(packet(1, { answers: [alias()], authority }), 1, reason));
it.each(["elsewhere.test", "valid.test", "sub.terminal.invalid.test"])("retains label-boundary/ancestor rule for %s", owner => {
  refusal(packet(1, { answers: [alias()], authority: [soa(owner)] }), 1, "soa-owner");
});
it.each([19, 20, 21])("requires exactly twenty numeric bytes, not %i by inference", length => {
  const data = Buffer.concat([name("ns.invalid.test"), name("hostmaster.invalid.test"), Buffer.alloc(length)]);
  const bytes = packet(1, { answers: [alias()], authority: [soa("invalid.test", 1, data)] });
  if (length === 20) expect(parseImageDnsAnswer(bytes, ID, 1)).toEqual({ code: 0, canonical: TERMINAL, addresses: [] });
  else refusal(bytes, 1, "soa-layout");
});
it.each([Buffer.alloc(0), Buffer.from([0x40]), Buffer.from([63, 1]), pointer(0x3fff)])("keeps malformed SOA name framing invalid %#", data => {
  refusal(packet(1, { answers: [alias()], authority: [soa("invalid.test", 1, data)] }), 1, "invalid-message");
});
it("retains bounded compression and opaque SOA mailbox labels", () => {
  for (const names of [Buffer.concat([pointer(12), pointer(12)]), Buffer.concat([name("ns.invalid.test"), name([Buffer.from("host.name@box"), Buffer.from([0xff])])])]) {
    const bytes = packet(1, { answers: [alias()], authority: [soa("invalid.test", 1, Buffer.concat([names, Buffer.alloc(20)]))] });
    expect(parseImageDnsAnswer(bytes, ID, 1)).toEqual({ code: 0, canonical: TERMINAL, addresses: [] });
  }
});
it("does not promote additional SOA, or mislabel an NS authority with a CNAME", () => {
  refusal(packet(1, { answers: [alias()], additional: [soa()] }), 1, "missing-terminal-soa");
  refusal(packet(1, { answers: [alias()], authority: [ns()] }), 1, "missing-terminal-soa");
  refusal(packet(1, { authority: [ns()], additional: [soa()] }), 1, "ns-only-authority");
  expect(parseImageDnsAnswer(packet(1, { additional: [soa()] }), ID, 1)).toEqual({ code: 0, canonical: HOST, addresses: [] });
});
it("retains direct SOA class/count rules and skips unrelated SOA metadata for positives", () => {
  refusal(packet(1, { authority: [soa("sandbox.ebayimg.com", 3)] }), 1, "soa-class");
  refusal(packet(1, { authority: [soa(), soa()] }), 1, "soa-count");
  expect(parseImageDnsAnswer(packet(1, { answers: [address(1)], authority: [soa("elsewhere.test", 3), soa()] }), ID, 1).addresses).toHaveLength(1);
});
