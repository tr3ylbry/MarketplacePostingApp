// @vitest-environment node
import { assertOfflineDnsGuards } from "../../test/offlineDnsGuards";
import dns from "node:dns";
import net from "node:net";
import { EventEmitter } from "node:events";
import { DNS_FIXTURE_ID, DNS_FIXTURE_TERMINAL, dnsFixtureAlias, dnsFixturePacket, dnsFixtureAddress,
  dnsFixtureFrame, dnsFixtureQuestions, dnsFixtureSoa, dnsFixtureNs, dnsFixtureName } from "../../test/imageDnsFixtures";
import { parseImageDnsAnswer, resolveImageDownloadAddresses } from "./imageDownloadDns";
import { inspectImageAddressSet } from "./imageAddressSetPolicy";

it("keeps the Type 3 regression entirely offline", () => {
  servers.mockReturnValue(["192.0.2.53"]);
  assertOfflineDnsGuards();
});
it.each([1, 28] as const)("accepts bounded Type 3 CNAME NODATA for type %i without caching or follow-up", type => {
  const bytes = dnsFixturePacket(type, { answers: [dnsFixtureAlias()] });
  expect(parseImageDnsAnswer(bytes, DNS_FIXTURE_ID, type)).toEqual({ code: 0, canonical: DNS_FIXTURE_TERMINAL, addresses: [] });
});

for (const type of [1, 28] as const) {
  it(`keeps SOA-less alias NXDOMAIN refused for type ${type}`, () => {
    expect(() => parseImageDnsAnswer(dnsFixturePacket(type, { flags: 0x8183, answers: [dnsFixtureAlias()] }), DNS_FIXTURE_ID, type))
      .toThrow(expect.objectContaining({ dns: { phase: "parse", reason: "missing-terminal-soa", nativeCode: null } }));
  });
  it.each([
    { authority: [dnsFixtureNs()] },
    { authority: [{ type: 16, data: Buffer.from([0]) }] },
    { additional: [dnsFixtureSoa()] },
    { additional: [{ owner: dnsFixtureName(""), type: 41, data: Buffer.alloc(0) }] },
  ])(`refuses authority/additional ambiguity for Type 3 type ${type}, case %#`, changes => {
    expect(() => parseImageDnsAnswer(dnsFixturePacket(type, { answers: [dnsFixtureAlias()], ...changes }), DNS_FIXTURE_ID, type))
      .toThrow(expect.objectContaining({ dns: { phase: "parse", reason: "missing-terminal-soa", nativeCode: null } }));
  });
  it.each(["id", "truncated", "trailing", "question-class", "cycle", "oversized", "wrong-answer-type"])(`retains bounded framing checks for type ${type}: %s`, kind => {
    let bytes = dnsFixturePacket(type, { answers: [dnsFixtureAlias()] });
    if (kind === "id") bytes.writeUInt16BE(DNS_FIXTURE_ID + 1);
    if (kind === "truncated") bytes.writeUInt16BE(0x8380, 2);
    if (kind === "trailing") bytes = Buffer.concat([bytes, Buffer.from([0])]);
    if (kind === "question-class") bytes.writeUInt16BE(3, 12 + dnsFixtureName("i.sandbox.ebayimg.com").length + 2);
    if (kind === "cycle") bytes = dnsFixturePacket(type, { answers: [dnsFixtureAlias("i.sandbox.ebayimg.com", "i.sandbox.ebayimg.com")] });
    if (kind === "oversized") bytes = Buffer.alloc(16_385);
    if (kind === "wrong-answer-type") bytes = dnsFixturePacket(type, { answers: [{ type: 16, data: Buffer.alloc(0) }] });
    expect(() => parseImageDnsAnswer(bytes, DNS_FIXTURE_ID, type)).toThrow();
  });
}

class FakeSocket extends EventEmitter {
  destroyed = false;
  write = vi.fn((bytes: Buffer) => bytes.length > 0);
  setNoDelay() { return this; }
  destroy() {
    if (!this.destroyed) { this.destroyed = true; queueMicrotask(() => this.emit("close")); }
    return this;
  }
}
let socket: FakeSocket, servers: ReturnType<typeof vi.spyOn>, connect: ReturnType<typeof vi.spyOn>;
const owned: Array<ReturnType<typeof resolveImageDownloadAddresses>> = [];
beforeEach(() => {
  socket = new FakeSocket();
  servers = vi.spyOn(dns, "getServers").mockReturnValue(["192.0.2.53", "198.51.100.53"]);
  connect = vi.spyOn(net, "createConnection").mockImplementation(() => socket as unknown as net.Socket);
});
afterEach(async () => {
  for (const work of owned) { work.abort(); socket.emit("close"); await Promise.allSettled([work.ready, work.settled]); }
  owned.length = 0; servers.mockRestore(); connect.mockRestore();
});
function begin() {
  const work = resolveImageDownloadAddresses(); owned.push(work);
  const observed = Promise.allSettled([work.ready, work.settled]);
  socket.emit("connect");
  expect(connect).toHaveBeenCalledOnce(); expect(servers).toHaveBeenCalledOnce(); expect(socket.write).toHaveBeenCalledOnce();
  const questions = dnsFixtureQuestions(socket.write.mock.calls[0][0]);
  expect(questions.map(q => q.type)).toEqual([1, 28]);
  return { work, observed, questions };
}
for (const positive of [1, 28] as const) {
  for (const first of [1, 28] as const) {
    it.each([false, true])(`combines public type${positive} and Type 3 NODATA with type${first} first, fragmented=%s`, async fragmented => {
      const { work, questions } = begin();
      const responses = questions.map(q => ({ type: q.type, bytes: dnsFixtureFrame(dnsFixturePacket(q.type, { id: q.id,
        answers: [dnsFixtureAlias(), ...(q.type === positive ? [dnsFixtureAddress(q.type, DNS_FIXTURE_TERMINAL)] : [])] })) }));
      if (first === 28) responses.reverse();
      const bytes = Buffer.concat(responses.map(r => r.bytes));
      if (fragmented) for (let i = 0; i < bytes.length; i += 3) socket.emit("data", bytes.subarray(i, i + 3));
      else socket.emit("data", bytes);
      const answers = await work.ready; await work.settled;
      expect(answers).toHaveLength(1); expect(answers[0].family).toBe(positive === 1 ? 4 : 6);
      expect(inspectImageAddressSet(answers, Date.parse("2026-11-27T08:00:00Z"))).toMatchObject({ reason: "candidate", networkAuthorized: false });
      expect(socket.write).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledOnce();
    });
  }
}
it("supplies no candidate when both supported replies contain no addresses", async () => {
  const { work, questions } = begin();
  socket.emit("data", Buffer.concat(questions.map(q => dnsFixtureFrame(dnsFixturePacket(q.type, { id: q.id, answers: [dnsFixtureAlias()] })))));
  const answers = await work.ready; await work.settled;
  expect(answers).toEqual([]);
  expect(inspectImageAddressSet(answers, Date.parse("2026-11-27T08:00:00Z"))).toMatchObject({ candidate: null, reason: "invalid-set", networkAuthorized: false });
  expect(socket.write).toHaveBeenCalledOnce();
});
it.each([false, true])("rejects the entire reported set when a private address appears, public-first=%s", publicFirst => {
  const privateRecord = { ...dnsFixtureAddress(1, DNS_FIXTURE_TERMINAL), data: Buffer.from([127, 0, 0, 1]) };
  const records = [dnsFixtureAddress(1, DNS_FIXTURE_TERMINAL), privateRecord]; if (!publicFirst) records.reverse();
  const parsed = parseImageDnsAnswer(dnsFixturePacket(1, { answers: [dnsFixtureAlias(), ...records] }), DNS_FIXTURE_ID, 1);
  expect(inspectImageAddressSet(parsed.addresses, Date.parse("2026-11-27T08:00:00Z"))).toMatchObject({ candidate: null, reason: "member-refused" });
});
it.each(["canonical", "rcode"])("retains paired-reply consistency for %s", async kind => {
  const { observed, questions } = begin();
  const responses = questions.map(q => dnsFixtureFrame(dnsFixturePacket(q.type, { id: q.id,
    ...(q.type === 28 && kind === "rcode" ? { flags: 0x8183, authority: [dnsFixtureSoa()] } : {}),
    answers: [dnsFixtureAlias("i.sandbox.ebayimg.com", q.type === 28 && kind === "canonical" ? "different.invalid.test" : DNS_FIXTURE_TERMINAL),
      ...(q.type === 1 ? [dnsFixtureAddress(1, DNS_FIXTURE_TERMINAL)] : [])] })));
  socket.emit("data", Buffer.concat(responses));
  const [ready, settled] = await observed;
  for (const result of [ready, settled]) expect(result).toMatchObject({ status: "rejected", reason: { dns: { phase: "combine", reason: "inconsistent-answers", nativeCode: null } } });
  expect(socket.write).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledOnce();
});
