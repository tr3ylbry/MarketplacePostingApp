import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { assertOfflineGuards } from "./offlinePrototypeGuards";

// Additional guard coverage for packet-only DNS tests. Per-test socket mocks
// replace this blocker, and restoring them never exposes actual resolver access.
const blocked = vi.fn(() => { throw Error("Offline DNS test attempted forbidden I/O."); });
const resolverDescriptors = [dns, dns.promises].map(scope => ({ scope,
  resolver: Object.getOwnPropertyDescriptor(scope, "Resolver")!, servers: Object.getOwnPropertyDescriptor(scope, "getServers"),
}));
for (const scope of [dns, dns.promises]) {
  Object.defineProperty(scope, "getServers", { configurable: true, writable: true, value: () => ["192.0.2.53"] });
  for (const key of Object.getOwnPropertyNames(scope)) {
    const value = (scope as unknown as Record<string, unknown>)[key];
    if (/^(?:lookup|resolve|reverse|setServers)/.test(key) && typeof value === "function" && !vi.isMockFunction(value)) {
      vi.spyOn(scope as unknown as Record<string, (...args: unknown[]) => unknown>, key).mockImplementation(blocked);
    }
  }
  Object.defineProperty(scope, "Resolver", { configurable: true, writable: true, value: class { constructor() { blocked(); } } });
}
vi.spyOn(net, "createConnection").mockImplementation(blocked);
vi.spyOn(net, "connect").mockImplementation(blocked);
vi.spyOn(net.Server.prototype, "listen").mockImplementation(blocked);
vi.spyOn(tls, "createServer").mockImplementation(blocked);
vi.spyOn(http, "createServer").mockImplementation(blocked);
vi.spyOn(https, "createServer").mockImplementation(blocked);
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) vi.spyOn(cp, method).mockImplementation(blocked);
function privatePath(value: unknown): boolean {
  let path: string;
  try { path = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : String(value); }
  catch { return true; }
  return /(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.(?:aws|ssh|codex|agents|npmrc)(?:\/|$)|(?:^|\/)resolv\.conf$|\/etc\/resolver(?:\/|$)|SystemConfiguration|\.(?:pcap|pcapng)$/i.test(path);
}
for (const method of ["readFile", "open", "openSync", "createReadStream", "stat", "statSync", "lstat", "lstatSync", "access", "accessSync", "existsSync", "readdir", "readdirSync"] as const) {
  const original = fs[method].bind(fs) as (...args: unknown[]) => unknown;
  vi.spyOn(fs, method).mockImplementation(((...args: unknown[]) => privatePath(args[0]) ? blocked() : original(...args)) as never);
}
for (const method of ["open", "stat", "lstat"] as const) {
  const original = fs.promises[method].bind(fs.promises) as (...args: unknown[]) => unknown;
  vi.spyOn(fs.promises, method).mockImplementation(((...args: unknown[]) => privatePath(args[0]) ? blocked() : original(...args)) as never);
}
// Capture implementations, not bound spies: wrapping a spy with itself recurses.
// Preserve the original guard's own private-read assertion and call counter.
const originalPrivate = (value: unknown) => /(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.(?:aws|ssh|codex|agents|npmrc)(?:\/|$)/.test(String(value));
const readSync = vi.mocked(fs.readFileSync).getMockImplementation()!;
vi.spyOn(fs, "readFileSync").mockImplementation(((p: never, ...args: never[]) => privatePath(p) && !originalPrivate(p) ? blocked() : Reflect.apply(readSync, fs, [p, ...args])) as typeof fs.readFileSync);
const readPromise = vi.mocked(fs.promises.readFile).getMockImplementation()!;
vi.spyOn(fs.promises, "readFile").mockImplementation(((p: never, ...args: never[]) => privatePath(p) && !originalPrivate(p) ? blocked() : Reflect.apply(readPromise, fs.promises, [p, ...args])) as typeof fs.promises.readFile);
syncBuiltinESMExports();
afterEach(() => expect(blocked).not.toHaveBeenCalled());
afterAll(() => {
  // Restore spies before descriptors so a per-test getServers spy cannot leave
  // its invented replacement installed for another file in the same worker.
  vi.restoreAllMocks();
  for (const { scope, resolver, servers } of resolverDescriptors) {
    Object.defineProperty(scope, "Resolver", resolver);
    if (servers) Object.defineProperty(scope, "getServers", servers); else Reflect.deleteProperty(scope, "getServers");
  }
  syncBuiltinESMExports();
});

export function assertOfflineDnsGuards() {
  assertOfflineGuards();
  expect(dns.getServers()).toEqual(["192.0.2.53"]);
  expect(dns.promises.getServers()).toEqual(["192.0.2.53"]);
  expect(() => dns.resolveAny("invented.invalid.test", () => {})).toThrow("Offline DNS test");
  expect(() => new dns.Resolver()).toThrow("Offline DNS test");
  expect(() => new dns.promises.Resolver()).toThrow("Offline DNS test");
  expect(() => net.connect(53, "192.0.2.53")).toThrow("Offline DNS test");
  expect(() => new net.Server().listen(0, "127.0.0.1")).toThrow("Offline DNS test");
  expect(() => fs.openSync("/synthetic/.env.local", "r")).toThrow("Offline DNS test");
  expect(() => fs.readFile("/etc/resolv.conf", () => {})).toThrow("Offline DNS test");
  expect(() => fs.createReadStream("/synthetic/capture.pcap")).toThrow("Offline DNS test");
  expect(() => fs.readFileSync("/synthetic/resolv.conf")).toThrow("Offline DNS test");
  expect(() => fs.promises.readFile("/synthetic/resolv.conf")).toThrow("Offline DNS test");
  expect(() => cp.execFileSync("/not-executed")).toThrow("Offline DNS test");
  expect(blocked).toHaveBeenCalledTimes(11); blocked.mockClear();
}
