// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import dns from "node:dns";
import net from "node:net";
import { EventEmitter } from "node:events";
import { resolveImageDownloadAddresses, IMAGE_DNS_MESSAGE_LIMIT } from "./imageDownloadDns";
import { ImageDnsRefusal } from "./imageDownloadDiagnostics";

class FakeSocket extends EventEmitter {
  destroyed = false;
  autoClose = true;
  setNoDelay() { return this; }
  write = vi.fn((data: Buffer) => data.length > 0);
  destroy() { if (!this.destroyed) { this.destroyed = true; if (this.autoClose) queueMicrotask(() => this.emit("close")); } return this; }
}
let servers: ReturnType<typeof vi.spyOn>, connect: ReturnType<typeof vi.spyOn>, socket: FakeSocket;
beforeEach(() => {
  socket = new FakeSocket();
  servers = vi.spyOn(dns, "getServers").mockReturnValue(["127.0.0.1:43111"]);
  connect = vi.spyOn(net, "createConnection").mockImplementation(() => socket as unknown as net.Socket);
});
afterEach(() => { servers.mockRestore(); connect.mockRestore(); });
async function failure(work: ReturnType<typeof resolveImageDownloadAddresses>) {
  const [ready] = await Promise.allSettled([work.ready, work.settled]);
  if (ready.status !== "rejected" || !(ready.reason instanceof ImageDnsRefusal)) throw Error("Expected bounded DNS refusal.");
  return ready.reason;
}
it("enforces offline/private access guards", assertOfflineGuards);
it.each([{ values: [] }, { values: ["invalid-server"] }, { values: ["127.0.0.1:0"] }, { values: ["[::1]:65536"] }])("refuses invalid configured numeric server %# before construction", ({ values }) => {
  servers.mockReturnValue(values);
  const work = resolveImageDownloadAddresses();
  expect(connect).not.toHaveBeenCalled();
  return expect(failure(work)).resolves.toMatchObject({ dns: { phase: "configuration", reason: "invalid-server", nativeCode: null } });
});
it("distinguishes an allowlisted configuration error without disclosing its message", async () => {
  servers.mockImplementation(() => { throw Object.assign(Error("PRIVATE-MESSAGE"), { code: "EPERM" }); });
  const error = await failure(resolveImageDownloadAddresses());
  expect(error.dns).toEqual({ phase: "configuration", reason: "native-error", nativeCode: "EPERM" });
  expect(JSON.stringify(error)).not.toContain("PRIVATE-"); expect(connect).not.toHaveBeenCalled();
});
it.each([
  { value: "1.1.1.1", host: "1.1.1.1", port: 53, family: 4 },
  { value: "1.1.1.1:5353", host: "1.1.1.1", port: 5353, family: 4 },
  { value: "::1", host: "::1", port: 53, family: 6 },
  { value: "[::1]:5353", host: "::1", port: 5353, family: 6 },
])("retains documented numeric server form $value without another lookup", async ({ value, ...expected }) => {
  servers.mockReturnValue([value, "127.0.0.1:43112"]);
  const work = resolveImageDownloadAddresses();
  expect(connect).toHaveBeenCalledOnce(); expect(connect.mock.calls[0][0]).toMatchObject({ ...expected, autoSelectFamily: false });
  work.abort(); await failure(work);
});
it.each(["EPERM", "EACCES", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH"])("classifies connection %s with one construction and no fallback", async code => {
  const work = resolveImageDownloadAddresses();
  socket.emit("error", Object.assign(Error("PRIVATE-SOCKET"), { code, address: "PRIVATE-ADDRESS" }));
  const error = await failure(work);
  expect(error.dns).toEqual({ phase: "connect", reason: "native-error", nativeCode: code });
  expect(connect).toHaveBeenCalledOnce(); expect(servers).toHaveBeenCalledOnce(); expect(socket.write).not.toHaveBeenCalled();
  expect(JSON.stringify(error)).not.toContain("PRIVATE-");
});
it("classifies a synchronous construction error", async () => {
  connect.mockImplementation(() => { throw Object.assign(Error("PRIVATE-CREATE"), { code: "EINVAL" }); });
  expect((await failure(resolveImageDownloadAddresses())).dns).toEqual({ phase: "connect", reason: "native-error", nativeCode: "EINVAL" });
});
it("classifies exchange errors after connect and keeps the first cause through abort", async () => {
  const work = resolveImageDownloadAddresses(); socket.emit("connect");
  socket.emit("error", Object.assign(Error("PRIVATE-EXCHANGE"), { code: "ECONNRESET" })); work.abort();
  expect((await failure(work)).dns).toEqual({ phase: "exchange", reason: "native-error", nativeCode: "ECONNRESET" });
  expect(socket.write).toHaveBeenCalledOnce();
});
it("classifies a closed incomplete exchange without inventing an errno", async () => {
  const work = resolveImageDownloadAddresses(); socket.emit("connect"); socket.destroy();
  expect((await failure(work)).dns).toEqual({ phase: "exchange", reason: "closed", nativeCode: null });
});
it("classifies framing and limits before message parsing", async () => {
  const work = resolveImageDownloadAddresses(); socket.emit("connect"); socket.emit("data", Buffer.from([0, 11]));
  expect((await failure(work)).dns).toEqual({ phase: "framing", reason: "invalid-frame", nativeCode: null });
});
it("classifies aggregate reply limit without retaining input bytes", async () => {
  const work = resolveImageDownloadAddresses(); socket.emit("connect"); socket.emit("data", Buffer.alloc(2 * (IMAGE_DNS_MESSAGE_LIMIT + 2) + 1));
  expect((await failure(work)).dns).toEqual({ phase: "framing", reason: "limit", nativeCode: null });
});
it("classifies valid-ID malformed messages separately from framing", async () => {
  const work = resolveImageDownloadAddresses(); socket.emit("connect");
  const question = socket.write.mock.calls[0][0], response = Buffer.from(question.subarray(0, question.readUInt16BE() + 2));
  response.writeUInt16BE(0x0180, 4); socket.emit("data", response);
  expect((await failure(work)).dns).toEqual({ phase: "parse", reason: "invalid-message", nativeCode: null });
});
it("distinguishes inconsistent complete family replies without a follow-up", async () => {
  const work = resolveImageDownloadAddresses(); socket.emit("connect");
  const questions = socket.write.mock.calls[0][0], firstLength = questions.readUInt16BE() + 2;
  const a = Buffer.from(questions.subarray(0, firstLength)), aaaa = Buffer.from(questions.subarray(firstLength));
  a.writeUInt16BE(0x8180, 4); aaaa.writeUInt16BE(0x8183, 4);
  socket.emit("data", Buffer.concat([a, aaaa]));
  expect((await failure(work)).dns).toEqual({ phase: "combine", reason: "inconsistent-answers", nativeCode: null });
  expect(connect).toHaveBeenCalledOnce(); expect(socket.write).toHaveBeenCalledOnce();
});
it("records intentional abort without releasing before socket close", async () => {
  socket.autoClose = false;
  const work = resolveImageDownloadAddresses(); let settled = false;
  void work.settled.then(() => { settled = true; }, () => { settled = true; }); work.abort();
  await expect(work.ready).rejects.toMatchObject({ dns: { reason: "aborted" } });
  await Promise.resolve(); expect(settled).toBe(false); socket.emit("close");
  expect((await failure(work)).dns).toEqual({ phase: "connect", reason: "aborted", nativeCode: null });
  expect(settled).toBe(true);
  expect(socket.destroyed).toBe(true);
});
