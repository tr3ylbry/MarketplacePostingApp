import dns from "node:dns";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { IMAGE_DOWNLOAD_HOST } from "./imageDownloadPolicy";
import { downloadDeferred, type ImageDownloadWork } from "./imageDownloadWork";
import type { ImageAddressCandidate } from "./imageAddressSetPolicy";
import { ImageDnsRefusal, type ImageDnsDiagnostic } from "./imageDownloadDiagnostics";

export const IMAGE_DNS_MESSAGE_LIMIT = 16_384;
type NegativeSoaReason = "missing-terminal-soa" | "soa-count" | "soa-class" | "soa-owner" | "soa-layout";
const bad = (reason: "invalid-message" | NegativeSoaReason | "ns-only-authority" = "invalid-message"): never => { throw new ImageDnsRefusal("parse", reason); };
function nameAt(packet: Buffer, start: number, opaqueLabels = false): { name: string; end: number } {
  let at = start, end = -1, hops = 0, length = 0;
  const labels: string[] = [];
  for (let count = 0; count < 128; count++) {
    if (at >= packet.length) return bad();
    const size = packet[at++];
    if ((size & 192) === 192) {
      if (at >= packet.length || ++hops > 16) return bad();
      const pointer = ((size & 63) << 8) | packet[at++];
      if (pointer >= at - 2) return bad(); // Backward compression only; no cycles.
      if (end < 0) end = at;
      at = pointer; continue;
    }
    if (size > 63 || at + size > packet.length) return bad();
    if (size === 0) return { name: labels.join(".").toLowerCase(), end: end < 0 ? at : end };
    if ((length += size + 1) > 254) return bad();
    if (!opaqueLabels) {
      const label = packet.subarray(at, at + size).toString("latin1");
      if (!/^[a-z0-9_-]+$/i.test(label)) return bad();
      labels.push(label);
    }
    at += size;
  }
  return bad();
}
export function imageDnsQuestion(id: number, type: 1 | 28): Buffer {
  const name = Buffer.concat(IMAGE_DOWNLOAD_HOST.split(".").map(s => Buffer.concat([Buffer.from([s.length]), Buffer.from(s, "ascii")])));
  const packet = Buffer.alloc(12 + name.length + 5);
  packet.writeUInt16BE(id); packet.writeUInt16BE(0x0100, 2); packet.writeUInt16BE(1, 4);
  name.copy(packet, 12); packet.writeUInt16BE(type, 13 + name.length); packet.writeUInt16BE(1, 15 + name.length);
  const frame = Buffer.alloc(packet.length + 2); frame.writeUInt16BE(packet.length); packet.copy(frame, 2); return frame;
}
export interface ImageDnsAnswer { code: 0 | 3; canonical: string; addresses: readonly ImageAddressCandidate[] }
interface NegativeSoa { owner: string; klass: number; start: number; end: number }
function terminalNegativeSoaRefusal(packet: Buffer, records: readonly NegativeSoa[], canonical: string): NegativeSoaReason | null {
  if (records.length === 0) return "missing-terminal-soa";
  if (records.length !== 1) return "soa-count";
  const soa = records[0];
  if (soa.klass !== 1) return "soa-class";
  if (soa.owner && canonical !== soa.owner && !canonical.endsWith("." + soa.owner)) return "soa-owner";
  // RFC1035 SOA contains two wire-format names and five uint32 fields.
  // Those names are framing only, not connection candidates; mailbox labels
  // need not use the preferred hostname alphabet enforced for CNAME targets.
  const mname = nameAt(packet, soa.start, true), rname = nameAt(packet, mname.end, true);
  return rname.end + 20 === soa.end ? null : "soa-layout";
}
/** Restrictive bounded DNS grammar. No CNAME follow-up, search list or repair. */
export function parseImageDnsAnswer(packet: Buffer, id: number, type: 1 | 28): ImageDnsAnswer {
  if (packet.length < 12 || packet.length > IMAGE_DNS_MESSAGE_LIMIT || packet.readUInt16BE(0) !== id) return bad();
  const flags = packet.readUInt16BE(2), code = flags & 15;
  if (!(flags & 0x8000) || (flags & 0x7800) || (flags & 0x0200) || !(flags & 0x0080) || (flags & 0x0040) || ![0, 3].includes(code) || packet.readUInt16BE(4) !== 1) return bad();
  const answers = packet.readUInt16BE(6), authority = packet.readUInt16BE(8), additional = packet.readUInt16BE(10);
  if (answers + authority + additional > 128) return bad();
  const q = nameAt(packet, 12); let at = q.end;
  if (q.name !== IMAGE_DOWNLOAD_HOST || at + 4 > packet.length || packet.readUInt16BE(at) !== type || packet.readUInt16BE(at + 2) !== 1) return bad();
  at += 4;
  const aliases = new Map<string, string>(), records: Array<{ owner: string; address: string; family: 4 | 6 }> = [];
  const negativeSoas: NegativeSoa[] = [];
  let authorityNameServer = false;
  for (let i = 0; i < answers + authority + additional; i++) {
    const owner = nameAt(packet, at); at = owner.end;
    if (at + 10 > packet.length) return bad();
    const kind = packet.readUInt16BE(at), klass = packet.readUInt16BE(at + 2), size = packet.readUInt16BE(at + 8); at += 10;
    const end = at + size; if (end > packet.length) return bad();
    if (i < answers) {
      if (klass !== 1) return bad();
      if (kind === 5) {
        const target = nameAt(packet, at);
        if (target.end !== end || !target.name || aliases.has(owner.name) || aliases.size >= 8) return bad();
        aliases.set(owner.name, target.name);
      } else {
        if (kind !== type || records.length >= 16 || size !== (type === 1 ? 4 : 16)) return bad();
        const address = type === 1 ? [...packet.subarray(at, end)].join(".") : Array.from({ length: 8 }, (_, n) => packet.readUInt16BE(at + n * 2).toString(16)).join(":");
        records.push({ owner: owner.name, address, family: type === 1 ? 4 : 6 });
      }
    } else if (i < answers + authority) {
      if (kind === 6) negativeSoas.push({ owner: owner.name, klass, start: at, end });
      if (kind === 2) authorityNameServer = true;
    }
    at = end;
  }
  if (at !== packet.length || code === 3 && records.length) return bad();
  let canonical = IMAGE_DOWNLOAD_HOST;
  const seen = new Set<string>();
  while (aliases.has(canonical)) {
    if (seen.has(canonical)) return bad();
    seen.add(canonical); canonical = aliases.get(canonical)!;
  }
  if (seen.size !== aliases.size || records.some(r => r.owner !== canonical)) return bad();
  // RFC2308 section2.2 Type3 NODATA may follow CNAMEs with empty authority.
  // Accept only NOERROR with no authority/additional records in that case.
  // It supplies no address, negative cache entry or follow-up permission;
  // the paired reply must still agree and the full address set must pass.
  // SOA-bearing negatives retain their semantic checks; referrals refuse.
  const uncachedType3 = code === 0 && authority === 0 && additional === 0;
  if (records.length === 0 && !uncachedType3) {
    if (aliases.size || negativeSoas.length) {
      const refusal = terminalNegativeSoaRefusal(packet, negativeSoas, canonical);
      if (refusal) return bad(refusal);
    } else if (code === 0 && authorityNameServer) return bad("ns-only-authority");
  }
  return { code: code as 0 | 3, canonical, addresses: records.map(({ address, family }) => Object.freeze({ address, family })) };
}
function configuredServer(): { host: string; port: number; family: 4 | 6 } {
  // OS recursive resolver configuration only; no hostname or credential lookup.
  // Pin the first numeric server. No alternate server, UDP or TCP retry.
  const value = dns.getServers()[0];
  const invalid = (): never => { throw new ImageDnsRefusal("configuration", "invalid-server"); };
  if (!value || value.length > 64) return invalid();
  let host = value, port = 53;
  if (value.startsWith("[")) {
    const m = /^\[([^\]]+)\](?::([0-9]{1,5}))?$/.exec(value); if (!m) return invalid();
    host = m[1]; port = m[2] ? Number(m[2]) : 53;
  } else if (net.isIP(value) === 0) {
    const m = /^([^:]+):([0-9]{1,5})$/.exec(value); if (!m) return invalid(); host = m[1]; port = Number(m[2]);
  }
  const family = net.isIP(host);
  if ((family !== 4 && family !== 6) || port < 1 || port > 65535) return invalid();
  return { host, port, family };
}
export function resolveImageDownloadAddresses(): ImageDownloadWork<readonly ImageAddressCandidate[]> {
  const ready = downloadDeferred<readonly ImageAddressCandidate[]>(), settled = downloadDeferred<void>();
  let socket: net.Socket | undefined, buffer = Buffer.alloc(0), failed = false, complete = false, total = 0;
  let phase: ImageDnsDiagnostic["phase"] = "configuration", failure: ImageDnsRefusal | undefined;
  const fail = (reason: ImageDnsDiagnostic["reason"], error?: unknown) => {
    failure ??= error instanceof ImageDnsRefusal ? error : new ImageDnsRefusal(phase, reason, error);
    failed = true; ready.reject(failure); socket?.destroy();
  };
  try {
    const server = configuredServer(), first = randomBytes(2).readUInt16BE(), second = first ^ 0xffff;
    const expected = new Map<number, 1 | 28>([[first, 1], [second, 28]]), replies = new Map<number, ImageDnsAnswer>();
    phase = "connect";
    socket = net.createConnection({ ...server, autoSelectFamily: false, lookup: () => { throw new ImageDnsRefusal("configuration", "invalid-server"); } });
    socket.on("error", error => fail("native-error", error));
    socket.once("close", () => {
      if (!complete) { failure ??= new ImageDnsRefusal(phase, "closed"); ready.reject(failure); }
      buffer = Buffer.alloc(0); if (failed || !complete) settled.reject(failure); else settled.resolve();
    });
    socket.once("connect", () => {
      if (failed) return;
      phase = "exchange";
      try { socket!.setNoDelay(true); socket!.write(Buffer.concat([imageDnsQuestion(first, 1), imageDnsQuestion(second, 28)])); }
      catch (error) { fail("native-error", error); }
    });
    socket.on("data", chunk => {
      try {
        if (failed || complete || !Buffer.isBuffer(chunk)) return fail("invalid-frame");
        phase = "framing";
        total += chunk.length;
        if (total > 2 * (IMAGE_DNS_MESSAGE_LIMIT + 2)) return fail("limit");
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const length = buffer.readUInt16BE();
          if (length < 12 || length > IMAGE_DNS_MESSAGE_LIMIT) return fail("invalid-frame");
          if (buffer.length < length + 2) break;
          const packet = buffer.subarray(2, length + 2), id = packet.readUInt16BE(), type = expected.get(id);
          if (!type || replies.has(type)) return fail("invalid-frame");
          replies.set(type, parseImageDnsAnswer(packet, id, type)); buffer = buffer.subarray(length + 2);
        }
        phase = "exchange";
        if (replies.size === 2) {
          phase = "combine";
          const a = replies.get(1)!, aaaa = replies.get(28)!;
          if (buffer.length || a.code !== aaaa.code || a.canonical !== aaaa.canonical || a.addresses.length + aaaa.addresses.length > 16) return fail("inconsistent-answers");
          complete = true; ready.resolve(Object.freeze([...replies.values()].flatMap(reply => reply.addresses))); socket!.destroy();
        }
      } catch (error) { fail(error instanceof ImageDnsRefusal ? "invalid-message" : "native-error", error); }
    });
  } catch (error) { fail(error instanceof ImageDnsRefusal ? "invalid-server" : "native-error", error); if (!socket) settled.resolve(); }
  return { ready: ready.promise, settled: settled.promise, abort: () => fail("aborted") };
}
