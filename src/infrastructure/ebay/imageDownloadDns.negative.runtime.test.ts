// @vitest-environment node
import { assertOfflineDnsGuards } from "../../test/offlineDnsGuards";
import dns from "node:dns";
import net from "node:net";
import { EventEmitter } from "node:events";
import { dnsNegativeFixtures, dnsFixturePacket, dnsFixtureFrame, dnsFixtureQuestions,
  dnsFixtureAddress, DNS_FIXTURE_HOST } from "../../test/imageDnsFixtures";
import { resolveImageDownloadAddresses } from "./imageDownloadDns";
import { startImageDownload } from "./imageDownloader";

const transport = vi.hoisted(() => ({
  peer: vi.fn(() => { throw Error("Unexpected peer/TLS construction."); }),
  http: vi.fn(() => { throw Error("Unexpected HTTP construction."); }),
}));
vi.mock("./imageDownloadTransport", () => ({ connectImagePeer: transport.peer, prepareImageHttp: transport.http }));
class FakeSocket extends EventEmitter {
  destroyed = false; autoClose = true;
  write = vi.fn((bytes: Buffer) => bytes.length > 0);
  setNoDelay() { return this; }
  destroy() {
    if (!this.destroyed) { this.destroyed = true; if (this.autoClose) queueMicrotask(() => this.emit("close")); }
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
  owned.length = 0;
  expect(transport.peer).not.toHaveBeenCalled(); expect(transport.http).not.toHaveBeenCalled();
  servers.mockRestore(); connect.mockRestore();
});
function connected() {
  socket.emit("connect");
  expect(servers).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledOnce();
  expect(connect.mock.calls[0][0]).toMatchObject({ host: "192.0.2.53", port: 53, family: 4, autoSelectFamily: false });
  expect(socket.write).toHaveBeenCalledOnce();
  const questions = dnsFixtureQuestions(socket.write.mock.calls[0][0]);
  expect(questions.map(q => q.type)).toEqual([1, 28]);
  return questions;
}
function begin() {
  const work = resolveImageDownloadAddresses(); owned.push(work);
  const observed = Promise.allSettled([work.ready, work.settled]);
  return { work, observed, questions: connected() };
}
function reply(question: { id: number; type: 1 | 28 }, options: Parameters<typeof dnsFixturePacket>[1]) {
  return dnsFixtureFrame(dnsFixturePacket(question.type, { ...options, id: question.id }));
}
it("blocks unexpected I/O before constructing a synthetic resolver", () => {
  servers.mockReturnValue(["192.0.2.53"]); assertOfflineDnsGuards();
});
for (const first of [1, 28] as const) {
  for (const negativeType of [1, 28] as const) it.each(dnsNegativeFixtures)(`retains type${negativeType} $reason with type${first} arriving first`, async ({ options, reason }) => {
    const { observed, questions } = begin();
    const replies = questions.map(q => reply(q, q.type === negativeType ? options : { answers: [dnsFixtureAddress(q.type)] }));
    if (first === 28) replies.reverse();
    socket.emit("data", Buffer.concat(replies));
    const expected = { status: "rejected", reason: { dns: { phase: "parse", reason, nativeCode: null } } };
    const [ready, settled] = await observed;
    expect(ready).toMatchObject(expected); expect(settled).toMatchObject(expected);
    expect(socket.write).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledOnce();
  });
}
it.each(dnsNegativeFixtures)("preserves first $reason through error, late reply, abort and actual close", async ({ options, reason }) => {
  socket.autoClose = false;
  const { work, observed, questions } = begin();
  let settled = false; void work.settled.then(() => { settled = true; }, () => { settled = true; });
  socket.emit("data", reply(questions[0], options));
  socket.emit("error", Object.assign(Error("SYNTHETIC-PRIVATE-MESSAGE"), { code: "ECONNRESET" }));
  socket.emit("data", reply(questions[1], { answers: [dnsFixtureAddress(28)] })); work.abort();
  await expect(work.ready).rejects.toMatchObject({ dns: { phase: "parse", reason, nativeCode: null } });
  await Promise.resolve(); expect(settled).toBe(false);
  socket.emit("close");
  const expected = { status: "rejected", reason: { dns: { phase: "parse", reason, nativeCode: null } } };
  for (const outcome of await observed) expect(outcome).toMatchObject(expected);
  expect(settled).toBe(true); expect(socket.write).toHaveBeenCalledOnce();
});
it.each(dnsNegativeFixtures)("propagates $reason before peer/TLS/HTTP and final-request callback", async ({ options, reason }) => {
  const now = Date.now(), until = now + 10_000, beforeRequest = vi.fn();
  const operation = startImageDownload({ url: `https://${DNS_FIXTURE_HOST}/synthetic/image.png?opaque=INVENTED`,
    responseReceivedAt: now, providerExpiresAt: now + 3_600_000,
    deadlines: { session: until, review: until, context: until, lease: until, access: until, refresh: until, request: until }, beforeRequest });
  try {
    const questions = connected(); socket.emit("data", reply(questions[0], options));
    const result = await operation.result;
    expect(result).toMatchObject({ data: null, diagnostic: { outcome: "refused", reason: "dns", bytes: 0,
      unverified: true, associated: false, dns: { phase: "parse", reason, nativeCode: null } } });
    expect(beforeRequest).not.toHaveBeenCalled(); expect(socket.write).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledOnce();
  } finally { operation.cancel(); socket.emit("close"); await operation.settled; }
});
it("does not replace a first native failure with a later negative diagnostic", async () => {
  const { observed, questions, work } = begin();
  socket.emit("error", Object.assign(Error("SYNTHETIC"), { code: "ECONNREFUSED" }));
  socket.emit("data", reply(questions[0], dnsNegativeFixtures[0].options)); work.abort();
  const [ready] = await observed;
  expect(ready).toMatchObject({ status: "rejected", reason: { dns: { phase: "exchange", reason: "native-error", nativeCode: "ECONNREFUSED" } } });
});
