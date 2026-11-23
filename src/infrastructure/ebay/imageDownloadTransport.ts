import tls from "node:tls";
import https from "node:https";
import type { TcpNetConnectOpts } from "node:net";
import type { ClientRequest, IncomingMessage } from "node:http";
import { numericAddress } from "./imageAddressPolicyFormat";
import type { ImageAddressCandidate } from "./imageAddressSetPolicy";
import { downloadDeferred, type ImageDownloadWork } from "./imageDownloadWork";
import { IMAGE_DOWNLOAD_HOST, IMAGE_DOWNLOAD_BODY_LIMIT, IMAGE_DOWNLOAD_HEADER_LIMIT, IMAGE_DOWNLOAD_WIRE_LIMIT,
  ImageDownloadRefusal, imageResponseHeaders, refuseDownload, type DownloadReason, type ImageResponseFacts } from "./imageDownloadPolicy";

export function verifyImagePeer(socket: tls.TLSSocket, candidate: ImageAddressCandidate): void {
  const peer = numericAddress(socket.remoteAddress);
  if (!peer || peer.canonical !== candidate.address || peer.family !== candidate.family || socket.remotePort !== 443) return refuseDownload("peer");
  if (socket.destroyed || !socket.encrypted || socket.authorized !== true || socket.authorizationError ||
    socket.alpnProtocol && socket.alpnProtocol !== "http/1.1" || tls.checkServerIdentity(IMAGE_DOWNLOAD_HOST, socket.getPeerCertificate(true))) return refuseDownload("tls");
}
export function connectImagePeer(candidate: ImageAddressCandidate): ImageDownloadWork<tls.TLSSocket> {
  const ready = downloadDeferred<tls.TLSSocket>(), settled = downloadDeferred<void>();
  let socket: tls.TLSSocket | undefined, verified = false;
  const fail = (reason: DownloadReason = "tls") => { ready.reject(new ImageDownloadRefusal(reason)); socket?.destroy(); };
  try {
    const options: tls.ConnectionOptions & TcpNetConnectOpts & { highWaterMark: number } = { host: candidate.address, family: candidate.family, port: 443, servername: IMAGE_DOWNLOAD_HOST,
      autoSelectFamily: false, lookup: () => { throw new ImageDownloadRefusal("tls"); },
      rejectUnauthorized: true, checkServerIdentity: tls.checkServerIdentity, ca: [...tls.rootCertificates],
      minVersion: "TLSv1.2", ALPNProtocols: ["http/1.1"], highWaterMark: 16_384 };
    socket = tls.connect(options);
    socket.pause();
    socket.on("error", () => fail());
    socket.once("close", () => { if (!verified) ready.reject(new ImageDownloadRefusal("tls")); settled.resolve(); });
    socket.once("secureConnect", () => {
      try { verifyImagePeer(socket!, candidate); if (socket!.readableLength) return fail(); verified = true; ready.resolve(socket!); }
      catch (e) { fail(e instanceof ImageDownloadRefusal ? e.reason : "tls"); }
    });
  } catch { fail(); if (!socket) settled.resolve(); }
  return { ready: ready.promise, settled: settled.promise, abort: () => fail() };
}
export interface ImageHttpBody { data: Uint8Array; mime: "image/png" | "image/jpeg" }
export interface ImageHttpWork extends ImageDownloadWork<ImageHttpBody> { attached: Promise<void>; send(): void; progress(): { bytes: number; exceeded: boolean; mime: "image/png" | "image/jpeg" | null } }
/** One preverified socket, no Agent/proxy/pool or second connection factory. */
export function prepareImageHttp(socket: tls.TLSSocket, candidate: ImageAddressCandidate, target: string, check: () => void): ImageHttpWork {
  const ready = downloadDeferred<ImageHttpBody>(), settled = downloadDeferred<void>(), attached = downloadDeferred<void>();
  let request: ClientRequest | undefined, response: IncomingMessage | undefined, handed = false, sent = false;
  let requestClosed = false, socketClosed = socket.closed, responseClosed = false, ended = false, failure: DownloadReason | null = null;
  let exceeded = false;
  let header = Buffer.alloc(0), facts: ImageResponseFacts | null = null, body: Buffer | null = null, bytes = 0, wire = 0, rawBody = 0;
  const finish = () => {
    if (!requestClosed || !socketClosed || response && !responseClosed) return;
    socket.off("data", monitor);
    if (!failure && ended && facts && body) {
      try { check(); ready.resolve({ data: Uint8Array.from(body.subarray(0, bytes)), mime: facts.mime }); }
      catch (e) { failure = e instanceof ImageDownloadRefusal ? e.reason : "transport"; }
    }
    if (failure || !ended) ready.reject(new ImageDownloadRefusal(failure ?? "transport"));
    body?.fill(0); body = null; header = Buffer.alloc(0); settled.resolve();
  };
  const fail = (reason: DownloadReason) => {
    failure ??= reason; attached.reject(new ImageDownloadRefusal(failure)); ready.reject(new ImageDownloadRefusal(failure));
    response?.destroy(); request?.destroy(); socket.destroy(); finish();
  };
  // Runs before Node's HTTP data listener. Raw byte/count limits supplement the
  // strict parser and avoid treating its header-count truncation as acceptance.
  const monitor = (chunk: Buffer) => {
    try {
      check(); if (!sent) return fail("transport");
      wire += chunk.length; if (wire > IMAGE_DOWNLOAD_WIRE_LIMIT) { exceeded = true; return fail("body"); };
      if (!facts) {
        const remaining = IMAGE_DOWNLOAD_HEADER_LIMIT + 1 - header.length;
        header = Buffer.concat([header, chunk.subarray(0, Math.max(0, remaining))]);
        const end = header.indexOf("\r\n\r\n");
        if (end < 0) { if (header.length > IMAGE_DOWNLOAD_HEADER_LIMIT) fail("headers"); return; }
        const total = end + 4;
        facts = imageResponseHeaders(header.subarray(0, total));
        rawBody = wire - total; header = Buffer.alloc(0);
      } else rawBody += chunk.length;
      if (facts.length !== null && rawBody > facts.length) fail("body");
    } catch (e) { fail(e instanceof ImageDownloadRefusal ? e.reason : "headers"); }
  };
  socket.prependListener("data", monitor);
  socket.once("close", () => { socketClosed = true; finish(); });
  socket.on("error", () => fail("transport"));
  try {
    check(); verifyImagePeer(socket, candidate);
    request = https.request({ hostname: IMAGE_DOWNLOAD_HOST, port: 443, method: "GET", path: target,
      setHost: false, headers: { Host: IMAGE_DOWNLOAD_HOST, Accept: "image/png, image/jpeg", "Accept-Encoding": "identity", Connection: "close" },
      maxHeaderSize: IMAGE_DOWNLOAD_HEADER_LIMIT, insecureHTTPParser: false, joinDuplicateHeaders: false,
      // Do not set agent:false: Node constructs an Agent in that case. A custom
      // createConnection with no agent uses ONLY this already verified socket.
      createConnection: () => { if (handed) return refuseDownload("transport"); handed = true; return socket; },
    });
    request.maxHeadersCount = 129; // Sentinel, never silently accept >128 pairs.
    request.once("socket", value => { if (value !== socket || request!.reusedSocket) fail("transport"); else attached.resolve(); });
    request.on("error", () => fail("transport"));
    request.once("close", () => { requestClosed = true; finish(); });
    for (const event of ["information", "upgrade", "connect"] as const) request.on(event, () => fail("status"));
    request.once("response", value => {
      response = value;
      value.once("close", () => { responseClosed = true; finish(); });
      value.on("error", () => fail("body")); value.once("aborted", () => fail("body"));
      try {
        check(); if (failure || !facts || value.statusCode !== 200 || value.rawHeaders.length / 2 > 128) return fail(failure ?? "headers");
        body = Buffer.alloc(IMAGE_DOWNLOAD_BODY_LIMIT);
      } catch { return fail("headers"); }
      value.on("data", (chunk: Buffer) => {
        try {
          check(); if (failure || !body || !Buffer.isBuffer(chunk)) return fail("body");
          if (bytes + chunk.length > IMAGE_DOWNLOAD_BODY_LIMIT) { bytes = IMAGE_DOWNLOAD_BODY_LIMIT; exceeded = true; return fail("body"); }
          chunk.copy(body, bytes); bytes += chunk.length;
        } catch (e) { fail(e instanceof ImageDownloadRefusal ? e.reason : "body"); }
      });
      value.once("end", () => {
        if (failure) return;
        if (!value.complete || !bytes || value.rawTrailers.length || facts!.length !== null && facts!.length !== bytes) return fail("body");
        ended = true; socket.destroy(); finish();
      });
    });
  } catch (e) { requestClosed = !request; fail(e instanceof ImageDownloadRefusal ? e.reason : "transport"); }
  return { ready: ready.promise, settled: settled.promise, attached: attached.promise,
    send: () => { try { check(); verifyImagePeer(socket, candidate); if (sent || failure || !request || !handed || socket.readableLength) return fail("transport"); sent = true; request.end(); socket.resume(); } catch (e) { fail(e instanceof ImageDownloadRefusal ? e.reason : "transport"); } },
    abort: () => fail("transport"), progress: () => ({ bytes, exceeded, mime: facts?.mime ?? null }) };
}
