import { acquirePhotoCapacity, borrowPhotoCapacity, releasePhotoCapacity } from "./photoCapacity";
import { MODEL_IMAGE_HOST, modeledExpiration, retainModeledTarget, handoffModeledTarget, discardModeledTarget, type ModeledTarget } from "./offlineImageUrlPolicy";
import { canonicalModelAddress, selectModeledAddress, type ModelAddress } from "./offlineImageAddressModel";

// Mock ports only. No DNS resolver, HTTP/socket client, SDK, persistence, runtime
// composition or real response handoff is implemented or imported here.
export interface ModelContext {
  owner: string; session: string; seller: string; connection: string; connectionVersion: string;
  grant: string; configuration: string; attempt: string; action: string; source: string; derivative: string;
  sessionUntil: number; reviewUntil: number; contextUntil: number;
}
export interface ModelResource<T> { ready: Promise<T>; settled: Promise<void>; abort(): void }
export interface ModelPeer {
  address: string; host: string; sni: string; certificateHost: string;
  authorized: boolean; encrypted: boolean; pooled: boolean; proxy: boolean;
}
export interface ModelResponse { status: number; headers: readonly (readonly [string, string])[]; body: AsyncIterable<Uint8Array> }
export interface ModelPorts {
  clock: { wall(): number; elapsed(): number };
  current(): Promise<ModelContext>;
  resolve(host: string, signal: AbortSignal): Promise<readonly ModelAddress[]>;
  connect(options: Readonly<{ address: string; port: 443; host: string; sni: string }>, signal: AbortSignal): ModelResource<ModelPeer>;
  // The target is restricted to this mock seam, never returned in diagnostics.
  request(connection: ModelResource<ModelPeer>, plan: Readonly<{ method: "GET"; target: string; headers: Readonly<Record<string, string>> }>, signal: AbortSignal): ModelResource<ModelResponse>;
  // Future crash-safe intent/outcome design gate, represented by MOCKS only.
  intent(context: Readonly<ModelContext>, signal: AbortSignal): Promise<void>;
  outcome(result: ModelDiagnostic): Promise<void>;
}
type Reason = "modeled" | "proof" | "policy" | "expiry" | "context" | "clock" | "deadline" | "cancelled" |
  "busy" | "address" | "peer" | "tls" | "redirect" | "challenge" | "headers" | "response" | "body" | "unavailable";
export interface ModelDiagnostic {
  simulation: true; realRequestAllowed: false; associated: false; reason: Reason; bytes: number;
}
const result = (reason: Reason, bytes = 0): ModelDiagnostic => Object.freeze({ simulation: true, realRequestAllowed: false, associated: false, reason, bytes });
class Refusal extends Error { constructor(readonly reason: Reason) { super("Offline model refused."); } }
function headerControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) <= 31 || value.charCodeAt(i) === 127) return true;
  return false;
}
const fields = ["owner", "session", "seller", "connection", "connectionVersion", "grant", "configuration", "attempt", "action", "source", "derivative",
  "sessionUntil", "reviewUntil", "contextUntil"] as const;
function context(value: ModelContext): Readonly<ModelContext> {
  if (!value || Object.keys(value).length !== fields.length || fields.some(k =>
    k.endsWith("Until") ? !Number.isFinite(value[k]) : typeof value[k] !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(String(value[k])))) throw new Refusal("context");
  return Object.freeze({ ...value });
}
interface Proof {
  binding: Readonly<ModelContext>; target: ModeledTarget | null; expires: number | null; wall: number; elapsed: number;
  timer?: ReturnType<typeof setTimeout>;
}
export function createOfflineImageEgressPrototype(ports: ModelPorts) {
  const proofs = new WeakMap<object, Proof>(), issued = new Set<string>(), issuedActions = new Set<string>(), consumed = new Set<string>();
  return {
    // Synthetic issuance only. Empty opaque objects carry no serialized URL or
    // identity. Copied/serialized/foreign-instance objects cannot regain proof.
    issueSyntheticResponse(binding: ModelContext, primary: unknown, expiry: unknown, field: string = "imageUrl"): object {
      let target: ModeledTarget | null = null;
      try {
        const b = context(binding), key = JSON.stringify([b.owner, b.attempt]), action = JSON.stringify([b.owner, b.action]);
        if (issued.has(key) || issuedActions.has(action)) throw new Refusal("proof");
        issued.add(key); issuedActions.add(action); // Binding survives expiry/refusal.
        const proof = Object.freeze(Object.create(null)) as object;
        target = field === "imageUrl" ? retainModeledTarget(primary) : null;
        const p: Proof = { binding: b, target,
          expires: modeledExpiration(expiry), wall: ports.clock.wall(), elapsed: ports.clock.elapsed() };
        if (![p.wall, p.elapsed].every(Number.isFinite)) throw new Refusal("clock");
        const lifetime = Math.min(30_000, (p.expires ?? p.wall) - 60_000 - p.wall, b.sessionUntil - p.wall, b.reviewUntil - p.wall, b.contextUntil - p.wall);
        if (Number.isFinite(lifetime) && lifetime > 0) {
          p.timer = setTimeout(() => { discardModeledTarget(p.target); proofs.delete(proof); }, lifetime);
          p.timer.unref();
        } else { discardModeledTarget(p.target); }
        proofs.set(proof, p);
        return proof;
      } catch { discardModeledTarget(target); throw new Refusal("proof"); }
    },
    async verify(proof: unknown, callerSignal?: AbortSignal): Promise<ModelDiagnostic> {
      const p = proof && typeof proof === "object" ? proofs.get(proof) : undefined;
      if (!p) return result("proof");
      proofs.delete(proof as object);
      if (p.timer) clearTimeout(p.timer);
      const discard = () => discardModeledTarget(p.target);
      const action = JSON.stringify([p.binding.owner, p.binding.action]);
      if (consumed.has(action)) { discard(); return result("proof"); }
      consumed.add(action); // Burn synchronously before ALL async work/refusal.
      if (!p.target) { discard(); return result("policy"); }
      if (p.expires === null) { discard(); return result("expiry"); }
      if (callerSignal?.aborted) { discard(); return result("cancelled"); }
      let start: number, until: number, remaining: number;
      try {
        start = ports.clock.elapsed();
        const wall = ports.clock.wall();
        until = Math.min(p.wall + 30_000, p.expires - 60_000, p.binding.sessionUntil, p.binding.reviewUntil, p.binding.contextUntil);
        if (![wall, start, until].every(Number.isFinite) || wall < p.wall || start < p.elapsed) throw new Refusal("clock");
        remaining = Math.min(10_000, until - wall, 30_000 - (start - p.elapsed));
      } catch { discard(); return result("clock"); }
      let capacity: ReturnType<typeof acquirePhotoCapacity>;
      try { capacity = acquirePhotoCapacity(); } catch { discard(); return result("busy"); }
      const finish = borrowPhotoCapacity(capacity), controller = new AbortController();
      const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const resources: Array<ModelResource<unknown>> = [];
      const settlements: Array<Promise<boolean>> = [];
      let stopFailed = false;
      const stopped = new WeakSet<object>();
      const stop = (resource: ModelResource<unknown>) => {
        if (stopped.has(resource)) return; stopped.add(resource);
        try { resource.abort(); } catch { stopFailed = true; }
      };
      const track = (resource: ModelResource<unknown>) => {
        resources.push(resource);
        // Attach rejection handling as soon as work starts, even if ready waits.
        settlements.push(resource.settled.then(() => true, () => false));
        if (signal.aborted) stop(resource);
      };
      let lastWall = p.wall, lastElapsed = p.elapsed;
      const check = () => {
        if (signal.aborted) throw new Refusal(callerSignal?.aborted ? "cancelled" : "deadline");
        const wall = ports.clock.wall(), elapsed = ports.clock.elapsed();
        if (![wall, elapsed, start, until].every(Number.isFinite) || wall < lastWall || elapsed < lastElapsed) throw new Refusal("clock");
        lastWall = wall; lastElapsed = elapsed;
        if (wall >= until || elapsed >= p.elapsed + 30_000 || elapsed >= start + 10_000) throw new Refusal("deadline");
      };
      let removeAbort = () => {};
      const aborted = new Promise<ModelDiagnostic>(resolve => {
        const abort = () => { resources.forEach(stop); resolve(result(callerSignal?.aborted ? "cancelled" : "deadline")); };
        signal.addEventListener("abort", abort, { once: true }); removeAbort = () => signal.removeEventListener("abort", abort);
      });
      if (Number.isFinite(remaining) && remaining > 0) timer = setTimeout(() => controller.abort(), remaining);
      const work = (async (): Promise<ModelDiagnostic> => {
        let diagnostic: ModelDiagnostic;
        let settled: boolean;
        try {
          check();
          const current = context(await ports.current()); check();
          if (fields.some(k => current[k] !== p.binding[k])) throw new Refusal("context");
          await ports.intent(p.binding, signal); check();
          const address = selectModeledAddress(await ports.resolve(MODEL_IMAGE_HOST, signal)); check();
          if (!address) throw new Refusal("address");
          const connection = ports.connect(Object.freeze({ address, port: 443, host: MODEL_IMAGE_HOST, sni: MODEL_IMAGE_HOST }), signal);
          track(connection);
          const peer = await connection.ready; check();
          const latest = context(await ports.current()); check();
          if (fields.some(k => latest[k] !== p.binding[k])) throw new Refusal("context");
          if (canonicalModelAddress(peer.address) !== address || peer.pooled || peer.proxy) throw new Refusal("peer");
          if (!peer.encrypted || !peer.authorized || peer.host !== MODEL_IMAGE_HOST || peer.sni !== MODEL_IMAGE_HOST || peer.certificateHost !== MODEL_IMAGE_HOST) throw new Refusal("tls");
          // No caller-controlled options/headers, credentials, referrer or URL.
          check();
          const request = handoffModeledTarget(p.target!, target => ports.request(connection, Object.freeze({ method: "GET", target, headers: Object.freeze({
            Host: MODEL_IMAGE_HOST, Accept: "image/png, image/jpeg", "Accept-Encoding": "identity",
          }) }), signal));
          track(request);
          const response = await request.ready; check();
          if (response.status >= 300 && response.status < 400) throw new Refusal("redirect");
          if ([401, 407].includes(response.status)) throw new Refusal("challenge");
          if (response.status !== 200) throw new Refusal("response");
          if (response.headers.length > 128) throw new Refusal("headers");
          const headers = new Map<string, string>(); let size = 0;
          for (const [key, value] of response.headers) {
            if (typeof key !== "string" || typeof value !== "string" || key.length > 16_384 || value.length > 16_384 ||
              (size += Buffer.byteLength(key) + Buffer.byteLength(value) + 4) > 16_384 || !/^[A-Za-z0-9-]+$/.test(key) ||
              headerControl(value) || headers.has(key.toLowerCase())) throw new Refusal("headers");
            headers.set(key.toLowerCase(), value);
          }
          if (headers.has("set-cookie") || headers.has("trailer") || !/^image\/(png|jpeg)$/i.test(headers.get("content-type") ?? "") ||
            headers.has("content-encoding") && headers.get("content-encoding") !== "identity") throw new Refusal("headers");
          const length = headers.get("content-length");
          if (length !== undefined && (!/^\d{1,10}$/.test(length) || Number(length) > 1_048_576)) throw new Refusal("headers");
          let bytes = 0;
          for await (const chunk of response.body) {
            check(); if (!(chunk instanceof Uint8Array) || (bytes += chunk.byteLength) > 1_048_576) throw new Refusal("body");
          }
          check(); if (!bytes || length !== undefined && bytes !== Number(length)) throw new Refusal("body");
          const final = context(await ports.current()); check();
          if (fields.some(k => final[k] !== p.binding[k])) throw new Refusal("context");
          diagnostic = result("modeled", bytes);
        } catch (error) { diagnostic = result(error instanceof Refusal ? error.reason : "unavailable"); }
        finally {
          resources.forEach(stop);
          settled = (await Promise.all(settlements)).every(Boolean);
        }
        try {
          if (!settled || stopFailed) return result("unavailable");
          if (diagnostic.reason === "modeled") {
            const latest = context(await ports.current()); check();
            if (fields.some(k => latest[k] !== p.binding[k])) throw new Refusal("context");
            await ports.outcome(diagnostic); check();
            const acknowledged = context(await ports.current()); check();
            if (fields.some(k => acknowledged[k] !== p.binding[k])) throw new Refusal("context");
          }
          return diagnostic;
        } catch (error) { return result(error instanceof Refusal ? error.reason : "unavailable"); }
        finally { finish(); } // All started work must settle before capacity frees.
      })();
      try { return await Promise.race([work, aborted]); }
      finally { if (timer) clearTimeout(timer); removeAbort(); discard(); releasePhotoCapacity(capacity); }
    },
  };
}
