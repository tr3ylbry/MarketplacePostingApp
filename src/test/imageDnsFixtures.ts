// Invented wire packets only. These helpers never consult a resolver or socket.
export const DNS_FIXTURE_HOST = "i.sandbox.ebayimg.com", DNS_FIXTURE_ID = 0x4a31;
export const DNS_FIXTURE_TERMINAL = "terminal.invalid.test";
export type DnsFixtureRecord = { owner?: Buffer; type: number; klass?: number; data: Buffer };
export interface DnsFixtureOptions {
  id?: number; flags?: number;
  answers?: readonly DnsFixtureRecord[]; authority?: readonly DnsFixtureRecord[]; additional?: readonly DnsFixtureRecord[];
}
export function dnsFixtureName(value: string | readonly Buffer[]): Buffer {
  const labels = typeof value === "string" ? value ? value.split(".").map(v => Buffer.from(v, "latin1")) : [] : value;
  return Buffer.concat([...labels.map(v => Buffer.concat([Buffer.from([v.length]), v])), Buffer.from([0])]);
}
export function dnsFixturePointer(offset: number): Buffer {
  const bytes = Buffer.alloc(2); bytes.writeUInt16BE(0xc000 | offset); return bytes;
}
function record(value: DnsFixtureRecord): Buffer {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(value.type); header.writeUInt16BE(value.klass ?? 1, 2);
  header.writeUInt32BE(60, 4); header.writeUInt16BE(value.data.length, 8);
  return Buffer.concat([value.owner ?? dnsFixturePointer(12), header, value.data]);
}
export function dnsFixturePacket(type: 1 | 28, options: DnsFixtureOptions = {}): Buffer {
  const answers = options.answers ?? [], authority = options.authority ?? [], additional = options.additional ?? [];
  const header = Buffer.alloc(12), question = Buffer.alloc(4);
  header.writeUInt16BE(options.id ?? DNS_FIXTURE_ID); header.writeUInt16BE(options.flags ?? 0x8180, 2);
  header.writeUInt16BE(1, 4); header.writeUInt16BE(answers.length, 6);
  header.writeUInt16BE(authority.length, 8); header.writeUInt16BE(additional.length, 10);
  question.writeUInt16BE(type); question.writeUInt16BE(1, 2);
  return Buffer.concat([header, dnsFixtureName(DNS_FIXTURE_HOST), question, ...answers.map(record), ...authority.map(record), ...additional.map(record)]);
}
export const dnsFixtureAlias = (owner = DNS_FIXTURE_HOST, target = DNS_FIXTURE_TERMINAL): DnsFixtureRecord => ({
  owner: dnsFixtureName(owner), type: 5, data: dnsFixtureName(target),
});
export const dnsFixtureAddress = (type: 1 | 28, owner = DNS_FIXTURE_HOST): DnsFixtureRecord => ({
  owner: dnsFixtureName(owner), type,
  data: type === 1 ? Buffer.from([1, 1, 1, 1]) : Buffer.from([0x20, 1, 0x48, 0x60, 0x48, 0x60, 0, 0, 0, 0, 0, 0, 0, 0, 0x88, 0x88]),
});
export const dnsFixtureSoa = (owner = "invalid.test", klass = 1, data?: Buffer): DnsFixtureRecord => ({
  owner: dnsFixtureName(owner), type: 6, klass,
  data: data ?? Buffer.concat([dnsFixtureName("ns.invalid.test"), dnsFixtureName("hostmaster.invalid.test"), Buffer.alloc(20)]),
});
export const dnsFixtureNs = (): DnsFixtureRecord => ({ type: 2, data: dnsFixtureName("ns.invalid.test") });
export function dnsFixtureFrame(packet: Buffer): Buffer {
  const header = Buffer.alloc(2); header.writeUInt16BE(packet.length); return Buffer.concat([header, packet]);
}
export function dnsFixtureQuestions(written: Buffer): Array<{ id: number; type: 1 | 28 }> {
  const questions: Array<{ id: number; type: 1 | 28 }> = [];
  for (let at = 0; at < written.length;) {
    const length = written.readUInt16BE(at), question = written.subarray(at + 2, at + 2 + length);
    questions.push({ id: question.readUInt16BE(), type: question.readUInt16BE(question.length - 4) as 1 | 28 });
    at += length + 2;
  }
  return questions;
}
// Independent expected labels for the six pre-existing refusal conditions.
export const dnsNegativeFixtures = [
  { reason: "missing-terminal-soa", options: { answers: [dnsFixtureAlias()] } },
  { reason: "soa-count", options: { answers: [dnsFixtureAlias()], authority: [dnsFixtureSoa(), dnsFixtureSoa()] } },
  { reason: "soa-class", options: { answers: [dnsFixtureAlias()], authority: [dnsFixtureSoa("invalid.test", 3)] } },
  { reason: "soa-owner", options: { answers: [dnsFixtureAlias()], authority: [dnsFixtureSoa("elsewhere.test")] } },
  { reason: "soa-layout", options: { answers: [dnsFixtureAlias()], authority: [dnsFixtureSoa("invalid.test", 1, Buffer.alloc(21))] } },
  { reason: "ns-only-authority", options: { authority: [dnsFixtureNs()] } },
] as const;
