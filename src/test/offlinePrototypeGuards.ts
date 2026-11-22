import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dns from "node:dns";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";
const blocked = vi.fn(() => { throw Error("Offline prototype attempted forbidden access."); });
vi.stubGlobal("fetch", blocked);
vi.stubGlobal("WebSocket", blocked);
vi.spyOn(net.Socket.prototype, "connect").mockImplementation(blocked);
vi.spyOn(tls, "connect").mockImplementation(blocked);
vi.spyOn(http, "request").mockImplementation(blocked);
vi.spyOn(http, "get").mockImplementation(blocked);
vi.spyOn(https, "request").mockImplementation(blocked);
vi.spyOn(https, "get").mockImplementation(blocked);
vi.spyOn(http2, "connect").mockImplementation(blocked);
vi.spyOn(dgram, "createSocket").mockImplementation(blocked);
for (const method of ["lookup", "resolve", "resolve4", "resolve6"] as const) {
  vi.spyOn(dns, method).mockImplementation(blocked);
  vi.spyOn(dns.promises, method).mockImplementation(blocked);
}
const privatePath = (value: unknown) => /(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.(?:aws|ssh|codex|agents|npmrc)(?:\/|$)/.test(String(value));
const read = fs.readFileSync.bind(fs);
vi.spyOn(fs, "readFileSync").mockImplementation(((p: never, ...args: never[]) => privatePath(p) ? blocked() : read(p, ...args)) as typeof fs.readFileSync);
const readAsync = fs.promises.readFile.bind(fs.promises);
vi.spyOn(fs.promises, "readFile").mockImplementation(((p: never, ...args: never[]) => privatePath(p) ? blocked() : readAsync(p, ...args)) as typeof fs.promises.readFile);
syncBuiltinESMExports();
vi.mock("dotenv", () => { throw Error("Environment loading forbidden."); });
vi.mock("@vercel/blob", () => { throw Error("Provider SDK access forbidden."); });
vi.mock("pg", () => { throw Error("Database construction forbidden."); });
vi.mock("node:child_process", () => ({ spawn: blocked, spawnSync: blocked, exec: blocked, execSync: blocked, execFile: blocked, execFileSync: blocked, fork: blocked }));
afterEach(() => expect(blocked).not.toHaveBeenCalled());
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); syncBuiltinESMExports(); });
export function assertOfflineGuards() {
  expect(() => https.get("https://guard.invalid.test")).toThrow("Offline prototype attempted forbidden access.");
  expect(() => dns.lookup("127.0.0.1", () => {})).toThrow("Offline prototype attempted forbidden access.");
  expect(() => fs.readFileSync("/synthetic/.env.local")).toThrow("Offline prototype attempted forbidden access.");
  expect(blocked).toHaveBeenCalledTimes(3); blocked.mockClear();
}
