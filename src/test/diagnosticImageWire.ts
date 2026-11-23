import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import dns from "node:dns";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { SANDBOX_CAPTURE_URL } from "../infrastructure/ebay/captureClient";
import { localImageDns, localImageTls, DOWNLOAD_TEST_CA, DOWNLOAD_TEST_HOST, imageWireResponse } from "./imageDownloaderFixtures";

// TEST ONLY. All native substitutions are asserted before routing to fixtures.
// DNS never forwards; download trust/port/peer substitutions prove only local
// mechanics. The POST is observed over local HTTP, not a provider TLS proof.
export const SYNTHETIC_PRIMARY = `https://${DOWNLOAD_TEST_HOST}/synthetic/image%41.png?opaque=A%2fb+Q&x=&x=2`;
export async function diagnosticImageWire(databasePort?: number) {
  const allowed = new Set<number>(databasePort ? [databasePort] : []);
  const forbidden = vi.fn(() => { throw Error("Non-fixture network/private access forbidden."); });
  const connect = net.Socket.prototype.connect, tlsConnect = tls.connect, httpsRequest = https.request;
  const posts: Buffer[] = [], uploads: http.IncomingMessage[] = [];
  const response = { status: 201, body: () => JSON.stringify({ imageUrl: SYNTHETIC_PRIMARY, maxDimensionImageUrl: "https://not-used.invalid/maximum", expirationDate: new Date(Date.now() + 3_600_000).toISOString() }),
    headers: ["Content-Type", "application/json"] as string[],
    before: (async () => {}) as (request: http.IncomingMessage, body: Buffer) => Promise<void>,
    send: undefined as undefined | ((request: http.IncomingMessage, res: http.ServerResponse) => void),
    image: (socket: tls.TLSSocket) => { socket.end(imageWireResponse()); },
    dispatch: (() => {}) as (method: "POST" | "GET") => void,
  };
  const upload = http.createServer((req, res) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on("data", (part: Buffer) => { size += part.length; if (size > 1_050_624) req.destroy(); else chunks.push(part); });
    req.on("end", () => { void (async () => {
      const body = Buffer.concat(chunks); posts.push(body); uploads.push(req);
      await response.before(req, body);
      if (response.send) response.send(req, res);
      else { res.writeHead(response.status, response.headers); res.end(response.body()); }
    })().catch(() => res.destroy()); });
  });
  upload.listen(0, "127.0.0.1"); await once(upload, "listening");
  const uploadPort = (upload.address() as net.AddressInfo).port;
  const resolver = await localImageDns(), image = await localImageTls(s => response.image(s));
  for (const port of [uploadPort, resolver.port, image.port]) allowed.add(port);
  vi.stubGlobal("fetch", forbidden); vi.stubGlobal("WebSocket", forbidden);
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof values[0] === "number" ? { port: values[0], host: values[1] } : values[0] as { host?: string; port?: number };
    if (!options || options.host !== "127.0.0.1" || !allowed.has(Number(options.port))) return forbidden();
    return Reflect.apply(connect, this, args);
  } as typeof connect);
  for (const method of ["lookup", "resolve", "resolve4", "resolve6"] as const) {
    vi.spyOn(dns, method).mockImplementation(forbidden); vi.spyOn(dns.promises, method).mockImplementation(forbidden);
  }
  vi.spyOn(dns, "getServers").mockReturnValue([`127.0.0.1:${resolver.port}`]);
  vi.spyOn(tls, "connect").mockImplementation(((options: tls.ConnectionOptions & { host: string; port: number }) => {
    expect(options).toMatchObject({ host: "127.0.0.1", port: 443, servername: DOWNLOAD_TEST_HOST, rejectUnauthorized: true, autoSelectFamily: false });
    expect(options.ca).toEqual([...tls.rootCertificates]); expect(options.checkServerIdentity).toBe(tls.checkServerIdentity);
    const socket = tlsConnect({ ...options, port: image.port, ca: DOWNLOAD_TEST_CA });
    Object.defineProperty(socket, "remotePort", { get: () => 443 }); return socket;
  }) as typeof tls.connect);
  vi.spyOn(https, "request").mockImplementation(((...args: unknown[]) => {
    if (args[0] === SANDBOX_CAPTURE_URL) {
      const opts = args[1] as https.RequestOptions;
      expect(opts).toMatchObject({ method: "POST", agent: false, rejectUnauthorized: true, maxHeaderSize: 16_384 });
      response.dispatch("POST");
      return http.request(`http://127.0.0.1:${uploadPort}/commerce/media/v1_beta/image/create_image_from_file`, opts, args[2] as (res: http.IncomingMessage) => void);
    }
    const opts = args[0] as https.RequestOptions;
    if (opts?.hostname !== DOWNLOAD_TEST_HOST || opts.method !== "GET" || typeof opts.createConnection !== "function") return forbidden();
    // Construction occurs before authorization; GET bytes are observed by the
    // fixture later. This hook detects transactions, not dispatch permission.
    response.dispatch("GET");
    return Reflect.apply(httpsRequest, https, args);
  }) as typeof https.request);
  const privatePath = (p: unknown) => /(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.(?:aws|ssh|codex|agents|npmrc)(?:\/|$)/.test(String(p));
  const read = fs.readFileSync.bind(fs), readAsync = fs.promises.readFile.bind(fs.promises);
  vi.spyOn(fs, "readFileSync").mockImplementation(((p: never, ...args: never[]) => privatePath(p) ? forbidden() : read(p, ...args)) as typeof fs.readFileSync);
  vi.spyOn(fs.promises, "readFile").mockImplementation(((p: never, ...args: never[]) => privatePath(p) ? forbidden() : readAsync(p, ...args)) as typeof fs.promises.readFile);
  syncBuiltinESMExports();
  return { posts, uploads, response, resolver, image, allowed,
    async close() {
      upload.closeAllConnections(); await new Promise<void>(resolve => upload.close(() => resolve()));
      await resolver.close(); await image.close(); expect(forbidden).not.toHaveBeenCalled();
      vi.restoreAllMocks(); vi.unstubAllGlobals(); syncBuiltinESMExports();
    },
  };
}
