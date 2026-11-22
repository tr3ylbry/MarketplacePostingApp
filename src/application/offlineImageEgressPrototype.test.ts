// @vitest-environment node
import "../test/offlinePrototypeGuards";
import { createOfflineImageEgressPrototype, type ModelContext, type ModelPorts, type ModelPeer, type ModelResponse, type ModelResource } from "./offlineImageEgressPrototype";
import { MODEL_IMAGE_HOST, MODEL_IMAGE_ORIGIN } from "./offlineImageUrlPolicy";
import { acquirePhotoCapacity, releasePhotoCapacity } from "./photoCapacity";

const wall = Date.parse("2026-01-01T00:00:00Z");
const secret = "SYNTHETIC_SECRET_MARKER";
const url = MODEL_IMAGE_ORIGIN + "/synthetic/a.png?X=" + secret + "&X=two+words&blank=&encoded=%2f%3A";
const binding = (): ModelContext => ({ owner: "owner", session: "session", seller: "seller", connection: "connection", connectionVersion: "v1",
  grant: "grant", configuration: "configuration", attempt: "attempt", action: "action", source: "source", derivative: "derivative",
  sessionUntil: wall + 120_000, reviewUntil: wall + 120_000, contextUntil: wall + 120_000 });
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const resource = <T>(value: T): ModelResource<T> => ({ ready: Promise.resolve(value), settled: Promise.resolve(), abort: vi.fn() });
async function* chunks(...sizes: number[]) { for (const size of sizes) yield new Uint8Array(size); }
async function flushUntil(test: () => boolean) { for (let i = 0; i < 60 && !test(); i++) await Promise.resolve(); expect(test()).toBe(true); }
function harness() {
  let now = wall, elapsed = 0;
  const b = binding();
  const peer: ModelPeer = { address: "1.1.1.1", host: MODEL_IMAGE_HOST, sni: MODEL_IMAGE_HOST, certificateHost: MODEL_IMAGE_HOST, authorized: true, encrypted: true, pooled: false, proxy: false };
  const response: ModelResponse = { status: 200, headers: [["Content-Type", "image/png"]], body: chunks(5, 7) };
  const connection = resource(peer), request = resource(response);
  const ports = { clock: { wall: () => now, elapsed: () => elapsed }, current: vi.fn(async () => ({ ...b })),
    resolve: vi.fn<ModelPorts["resolve"]>(async () => [{ address: "1.1.1.1", family: 4 }]),
    connect: vi.fn<ModelPorts["connect"]>(() => connection), request: vi.fn<ModelPorts["request"]>(() => request),
    intent: vi.fn<ModelPorts["intent"]>(async () => {}), outcome: vi.fn<ModelPorts["outcome"]>(async () => {}) } satisfies ModelPorts;
  const model = createOfflineImageEgressPrototype(ports);
  return { b, ports, model, peer, response, connection, request,
    issue: (value: unknown = url, expiry: unknown = new Date(wall + 180_000).toISOString(), field?: string) => model.issueSyntheticResponse(b, value, expiry, field),
    advance: (n: number) => { now += n; elapsed += n; }, setWall: (n: number) => { now = n; }, setElapsed: (n: number) => { elapsed = n; } };
}
afterEach(() => vi.useRealTimers());

it("models one pinned GET with exact opaque target and an explicit credential-free header set", async () => {
  const h = harness(), proof = h.issue();
  expect(JSON.stringify(proof)).toBe("{}"); expect(Object.isFrozen(proof)).toBe(true);
  const r = await h.model.verify(proof);
  expect(r).toEqual({ simulation: true, realRequestAllowed: false, associated: false, reason: "modeled", bytes: 12 });
  expect(h.ports.resolve).toHaveBeenCalledOnce(); expect(h.ports.resolve.mock.calls[0][0]).toBe(MODEL_IMAGE_HOST);
  expect(h.ports.connect).toHaveBeenCalledOnce();
  expect(h.ports.connect.mock.calls[0][0]).toEqual({ address: "1.1.1.1", port: 443, host: MODEL_IMAGE_HOST, sni: MODEL_IMAGE_HOST });
  expect(h.ports.request).toHaveBeenCalledOnce();
  expect(h.ports.request.mock.calls[0][0]).toBe(h.connection);
  expect(h.ports.request.mock.calls[0][1]).toEqual({ method: "GET", target: url.slice(MODEL_IMAGE_ORIGIN.length), headers: { Host: MODEL_IMAGE_HOST, Accept: "image/png, image/jpeg", "Accept-Encoding": "identity" } });
  expect(h.ports.intent).toHaveBeenCalledOnce(); expect(h.ports.outcome).toHaveBeenCalledWith(r);
  expect(JSON.stringify([r, h.ports.outcome.mock.calls])).not.toContain(secret);
  expect(h.connection.abort).toHaveBeenCalledOnce(); expect(h.request.abort).toHaveBeenCalledOnce();
});
it("does not forward extra context headers/options or permit non-primary fields", async () => {
  const h = harness();
  expect(() => h.model.issueSyntheticResponse({ ...h.b, headers: { Authorization: secret } } as ModelContext, url, "bad")).toThrow();
  expect((await h.model.verify(h.issue(url, new Date(wall + 180_000).toISOString(), "maxDimensionImageUrl"))).reason).toBe("policy");
  expect(h.ports.request).not.toHaveBeenCalled();
});
it.each([{}, null, "proof", 1])("rejects forged/serialized proofs without async calls: %s", async proof => {
  const h = harness(); expect((await h.model.verify(proof)).reason).toBe("proof"); expect(h.ports.current).not.toHaveBeenCalled();
});
it("rejects copied, serialized and foreign-instance proofs while preserving the legitimate original", async () => {
  const a = harness(), b = harness(), proof = a.issue();
  for (const fake of [{ ...proof }, JSON.parse(JSON.stringify(proof))]) expect((await a.model.verify(fake)).reason).toBe("proof");
  expect((await b.model.verify(proof)).reason).toBe("proof");
  expect((await a.model.verify(proof)).reason).toBe("modeled");
  expect((await a.model.verify(proof)).reason).toBe("proof");
  expect(() => a.issue()).toThrow();
});
it("burns proof/action before asynchronous intent and never retries an uncertain acknowledgement", async () => {
  const h = harness(), gate = deferred<void>(), proof = h.issue(); h.ports.intent.mockReturnValue(gate.promise);
  const pending = h.model.verify(proof);
  expect((await h.model.verify(proof)).reason).toBe("proof");
  await flushUntil(() => h.ports.intent.mock.calls.length === 1); gate.reject(Error(secret));
  expect((await pending).reason).toBe("unavailable"); expect(h.ports.resolve).not.toHaveBeenCalled();
  expect(() => h.model.issueSyntheticResponse({ ...h.b, attempt: "different" }, url, new Date(wall + 180_000).toISOString())).toThrow("Offline model refused.");
});
it.each(["owner", "session", "seller", "connection", "connectionVersion", "grant", "configuration", "attempt", "action", "source", "derivative"] as const)("rejects changed %s and consumes the proof", async field => {
  const h = harness(), proof = h.issue(); h.b[field] = "changed";
  expect((await h.model.verify(proof)).reason).toBe("context"); expect(h.ports.resolve).not.toHaveBeenCalled();
  expect((await h.model.verify(proof)).reason).toBe("proof");
});
it.each(["sessionUntil", "reviewUntil", "contextUntil"] as const)("respects %s shortening and its exact boundary", async key => {
  const h = harness(); h.b[key] = wall + 500; const proof = h.issue(); h.advance(500);
  expect((await h.model.verify(proof)).reason).toBe("deadline"); expect(h.ports.resolve).not.toHaveBeenCalled();
});
it("rechecks context after the last simulated connection wait before any request bytes", async () => {
  const h = harness(), gate = deferred<ModelPeer>(); h.connection.ready = gate.promise; const pending = h.model.verify(h.issue());
  await flushUntil(() => h.ports.connect.mock.calls.length === 1); h.b.connectionVersion = "new"; gate.resolve(h.peer);
  expect((await pending).reason).toBe("context"); expect(h.ports.request).not.toHaveBeenCalled();
});
it("rejects context changes after a modeled response without producing usable association", async () => {
  const h = harness(); h.response.body = (async function* () { yield new Uint8Array(1); h.b.session = "changed"; })();
  expect((await h.model.verify(h.issue())).reason).toBe("context"); expect(h.ports.outcome).not.toHaveBeenCalled();
});
it.each([undefined, "bad", "2026-02-30T00:00:00Z", "2026-01-01T00:00:00+00:00"])("rejects invalid expiration before async work: %s", async expiry => {
  const h = harness(); const proof = h.model.issueSyntheticResponse(h.b, url, expiry);
  expect((await h.model.verify(proof)).reason).toBe("expiry"); expect(h.ports.current).not.toHaveBeenCalled();
});
it.each([0, 59_999, 60_000])("refuses insufficient expiration headroom %s", async lifetime => {
  const h = harness(); expect((await h.model.verify(h.issue(url, new Date(wall + lifetime).toISOString()))).reason).toBe("deadline");
  expect(h.ports.request).not.toHaveBeenCalled();
});
it("accepts legitimate headroom and does not extend the 30-second residence deadline", async () => {
  const h = harness(); const proof = h.issue(); h.advance(30_000);
  expect((await h.model.verify(proof)).reason).toBe("deadline");
  const valid = harness(); expect((await valid.model.verify(valid.issue(url, new Date(wall + 60_001).toISOString()))).reason).toBe("modeled");
});
it.each(["wall", "elapsed"])("rejects a backwards %s clock", async kind => {
  const h = harness(), proof = h.issue(); if (kind === "wall") h.setWall(wall - 1); else h.setElapsed(-1);
  expect((await h.model.verify(proof)).reason).toBe("clock"); expect(h.ports.request).not.toHaveBeenCalled();
});
it("redacts issuance errors and does not return a URL-bearing error or proof", () => {
  const h = harness(); h.ports.clock.wall = () => { throw Error(url + secret); };
  expect(() => h.issue()).toThrow("Offline model refused.");
});
it.each(["wall", "elapsed"] as const)("redacts preflight %s clock errors without leaking capacity", async key => {
  const h = harness(), proof = h.issue(); h.ports.clock[key] = () => { throw Error(url + secret); };
  const r = await h.model.verify(proof); expect(r.reason).toBe("clock"); expect(JSON.stringify(r)).not.toContain(secret);
  const a = acquirePhotoCapacity(), b = acquirePhotoCapacity(); releasePhotoCapacity(a); releasePhotoCapacity(b);
});
it("bounds resolution/connect/body by one total deadline instead of additive windows", async () => {
  const h = harness(); h.ports.resolve.mockImplementation(async () => { h.advance(9999); return [{ address: "1.1.1.1", family: 4 }]; });
  h.ports.connect.mockImplementation(() => { h.advance(1); return h.connection; });
  expect((await h.model.verify(h.issue())).reason).toBe("deadline"); expect(h.ports.request).not.toHaveBeenCalled();
});
it("rechecks session deadlines after a delayed simulated DNS result", async () => {
  const h = harness(); h.b.sessionUntil = wall + 500;
  h.ports.resolve.mockImplementation(async () => { h.advance(500); return [{ address: "1.1.1.1", family: 4 }]; });
  expect((await h.model.verify(h.issue())).reason).toBe("deadline"); expect(h.ports.connect).not.toHaveBeenCalled();
});
it("expires unused opaque response proofs without retaining usable targets", async () => {
  vi.useFakeTimers(); const h = harness(), proof = h.issue();
  h.advance(30_000); await vi.advanceTimersByTimeAsync(30_000);
  expect((await h.model.verify(proof)).reason).toBe("proof"); expect(h.ports.resolve).not.toHaveBeenCalled();
  expect(() => h.issue()).toThrow();
  expect(() => h.model.issueSyntheticResponse({ ...h.b, attempt: "replacement" }, url, new Date(wall + 180_000).toISOString())).toThrow();
});
it("preserves action binding after policy refusal while allowing a genuinely fresh synthetic action/attempt", async () => {
  const h = harness(); expect((await h.model.verify(h.issue(MODEL_IMAGE_ORIGIN + "/bad#fragment"))).reason).toBe("policy");
  expect(() => h.model.issueSyntheticResponse({ ...h.b, attempt: "replacement" }, url, new Date(wall + 180_000).toISOString())).toThrow();
  h.b.attempt = "fresh"; h.b.action = "fresh-action";
  expect((await h.model.verify(h.issue())).reason).toBe("modeled");
});
it("discards raw errors from a streamed body and never retries", async () => {
  const h = harness(); h.response.body = (async function* () { yield new Uint8Array(2); throw Error(url + secret); })();
  const r = await h.model.verify(h.issue()); expect(r.reason).toBe("unavailable"); expect(JSON.stringify(r)).not.toContain(secret);
  expect(h.ports.request).toHaveBeenCalledOnce(); expect(h.ports.outcome).not.toHaveBeenCalled();
});
it.each(["connection", "request"] as const)("keeps %s settlement failure uncertain", async stage => {
  const h = harness(); h[stage].settled = Promise.reject(Error(secret));
  expect((await h.model.verify(h.issue())).reason).toBe("unavailable"); expect(h.ports.request).toHaveBeenCalledOnce();
});
it("keeps a failed resource close uncertain and redacted", async () => {
  const h = harness(); h.request.abort = () => { throw Error(url + secret); };
  const r = await h.model.verify(h.issue()); expect(r.reason).toBe("unavailable"); expect(JSON.stringify(r)).not.toContain(secret);
});
it("models IPv6 pinning without forwarding peer-controlled extras", async () => {
  const h = harness(); h.peer.address = "2001:4860:4860:0:0:0:0:8888";
  h.ports.resolve.mockResolvedValue([{ address: "2001:4860:4860::8888", family: 6 }]);
  Object.assign(h.peer, { Authorization: secret, Cookie: secret, Referer: url });
  expect((await h.model.verify(h.issue())).reason).toBe("modeled");
  expect(h.ports.connect.mock.calls[0][0].address).toBe("2001:4860:4860::8888");
  expect(JSON.stringify(h.ports.request.mock.calls[0][1].headers)).not.toContain(secret);
});
it("rejects mixed DNS before connection and models no second lookup or alternate address", async () => {
  const h = harness(); h.ports.resolve.mockResolvedValue([{ address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  expect((await h.model.verify(h.issue())).reason).toBe("address"); expect(h.ports.connect).not.toHaveBeenCalled();
  expect(h.ports.resolve).toHaveBeenCalledOnce();
});
it.each([{ address: "8.8.8.8" }, { pooled: true }, { proxy: true }, { authorized: false }, { encrypted: false }, { host: "other.invalid" }, { sni: "other.invalid" }, { certificateHost: "other.invalid" }])("verifies peer/TLS before sink: %s", async change => {
  const h = harness(); Object.assign(h.peer, change);
  expect(["peer", "tls"]).toContain((await h.model.verify(h.issue())).reason); expect(h.ports.request).not.toHaveBeenCalled();
  expect(h.ports.resolve).toHaveBeenCalledOnce(); expect(h.ports.connect).toHaveBeenCalledOnce();
});
it.each([301, 302, 307, 308, 401, 407, 404, 429, 500, 100, 101])("refuses status%s with no redirect/challenge/HEAD/retry fallback", async status => {
  const h = harness(); h.response.status = status;
  const r = await h.model.verify(h.issue()); expect(r.reason).not.toBe("modeled");
  expect(h.ports.request).toHaveBeenCalledOnce(); expect(h.ports.request.mock.calls[0][1].method).toBe("GET");
  expect(h.ports.resolve).toHaveBeenCalledOnce(); expect(h.ports.outcome).not.toHaveBeenCalled();
});
it.each([
  [["Content-Type", "image/png"], ["content-type", "image/png"]], [["Content-Type", "text/html"]],
  [["Content-Type", "image/png"], ["Content-Encoding", "gzip"]], [["Content-Type", "image/png"], ["Set-Cookie", secret]],
  [["Content-Type", "image/png"], ["Trailer", "Anything"]], [["Content-Type", "image/png"], ["X", "a\r\nb"]],
  [["Content-Type", "image/png"], ["X", "a\x01b"]],
  [["Content-Type", "image/png"], ["Content-Length", "1048577"]], [["Content-Type", "image/png"], ["Content-Length", "1e6"]],
].map((headers, id) => ({ headers: headers as [string, string][], id })))("refuses ambiguous/unsafe header case$id without reflecting values", async ({ headers }) => {
  const h = harness(); h.response.headers = headers; const r = await h.model.verify(h.issue()); expect(r.reason).toBe("headers");
  expect(JSON.stringify(r)).not.toContain(secret);
});
it("bounds header pairs and bytes with legitimate boundary controls", async () => {
  const h = harness(); h.response.headers = [["Content-Type", "image/png"], ...Array.from({ length: 128 }, (_, i) => ["X" + i, "a"] as const)];
  expect((await h.model.verify(h.issue())).reason).toBe("headers");
  const large = harness(); large.response.headers = [["Content-Type", "image/png"], ["X", "a".repeat(16_384)]];
  expect((await large.model.verify(large.issue())).reason).toBe("headers");
  const edge = harness(); edge.response.headers = [["Content-Type", "image/png"], ["X", "a".repeat(16_384 - 25 - 5)]];
  expect((await edge.model.verify(edge.issue())).reason).toBe("modeled");
});
it.each([0, 1_048_577])("bounds streamed bodies independently of Content-Length: %s", async size => {
  const h = harness(); h.response.body = chunks(size); expect((await h.model.verify(h.issue())).reason).toBe("body");
});
it("counts chunked bytes, accepts exactly1MiB and refuses mismatched length", async () => {
  const h = harness(); h.response.body = chunks(524288, 524288); expect((await h.model.verify(h.issue())).bytes).toBe(1_048_576);
  const mismatch = harness(); mismatch.response.headers = [["Content-Type", "image/png"], ["Content-Length", "99"]];
  expect((await mismatch.model.verify(mismatch.issue())).reason).toBe("body");
});
it.each(["current", "intent", "resolve", "outcome"] as const)("redacts thrown raw secrets from %s and does not retry", async stage => {
  const h = harness(); h.ports[stage].mockRejectedValue(Error(url + secret));
  const r = await h.model.verify(h.issue()); expect(r.reason).toBe("unavailable"); expect(JSON.stringify(r)).not.toContain(secret);
  expect(h.ports[stage]).toHaveBeenCalledOnce();
});
it("consumes cancellation before async work and during body iteration", async () => {
  const h = harness(), controller = new AbortController(), proof = h.issue(); controller.abort();
  expect((await h.model.verify(proof, controller.signal)).reason).toBe("cancelled"); expect(h.ports.current).not.toHaveBeenCalled();
  expect((await h.model.verify(proof)).reason).toBe("proof");
  const live = harness(), stop = new AbortController(); live.response.body = (async function* () { yield new Uint8Array(2); stop.abort(); yield new Uint8Array(2); })();
  expect((await live.model.verify(live.issue(), stop.signal)).reason).toBe("cancelled");
  expect(live.request.abort).toHaveBeenCalledOnce();
});
it("retains no-queue capacity through timeout and late settlement, including a consumed busy action", async () => {
  vi.useFakeTimers(); const h = harness(), settled = deferred<void>(); h.request.settled = settled.promise;
  const proof = h.issue(), pending = h.model.verify(proof);
  await flushUntil(() => vi.mocked(h.request.abort).mock.calls.length === 1);
  const other = acquirePhotoCapacity();
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).reason).toBe("deadline"); expect(h.request.abort).toHaveBeenCalledOnce();
    expect(() => acquirePhotoCapacity()).toThrow();
    const busy = harness(), busyProof = busy.issue(); expect((await busy.model.verify(busyProof)).reason).toBe("busy");
    expect((await busy.model.verify(busyProof)).reason).toBe("proof");
    settled.resolve(); await flushUntil(() => { try { const c = acquirePhotoCapacity(); releasePhotoCapacity(c); return true; } catch { return false; } });
    expect(h.ports.outcome).not.toHaveBeenCalled();
    expect((await h.model.verify(proof)).reason).toBe("proof");
  } finally { settled.resolve(); releasePhotoCapacity(other); }
});
it("aborts a pending connection immediately but holds its slot until late ready/settlement", async () => {
  const h = harness(), ready = deferred<ModelPeer>(), settled = deferred<void>(), controller = new AbortController();
  h.connection.ready = ready.promise; h.connection.settled = settled.promise;
  const proof = h.issue(), pending = h.model.verify(proof, controller.signal);
  await flushUntil(() => h.ports.connect.mock.calls.length === 1);
  const other = acquirePhotoCapacity();
  try {
    controller.abort(); expect((await pending).reason).toBe("cancelled");
    expect(h.connection.abort).toHaveBeenCalledOnce(); expect(() => acquirePhotoCapacity()).toThrow();
    ready.resolve(h.peer); settled.resolve();
    await flushUntil(() => { try { const c = acquirePhotoCapacity(); releasePhotoCapacity(c); return true; } catch { return false; } });
    expect(h.ports.request).not.toHaveBeenCalled(); expect((await h.model.verify(proof)).reason).toBe("proof");
  } finally { ready.resolve(h.peer); settled.resolve(); releasePhotoCapacity(other); }
});
it("does not release an uncooperative simulated resolver at the timeout boundary", async () => {
  vi.useFakeTimers(); const h = harness(), ready = deferred<readonly { address: string; family: 4 }[]>();
  h.ports.resolve.mockReturnValue(ready.promise); const pending = h.model.verify(h.issue());
  await flushUntil(() => h.ports.resolve.mock.calls.length === 1); const other = acquirePhotoCapacity();
  try {
    await vi.advanceTimersByTimeAsync(10_000); expect((await pending).reason).toBe("deadline");
    expect(() => acquirePhotoCapacity()).toThrow(); ready.resolve([{ address: "1.1.1.1", family: 4 }]);
    await flushUntil(() => { try { const c = acquirePhotoCapacity(); releasePhotoCapacity(c); return true; } catch { return false; } });
    expect(h.ports.connect).not.toHaveBeenCalled();
  } finally { ready.resolve([]); releasePhotoCapacity(other); }
});
