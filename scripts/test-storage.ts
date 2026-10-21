import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { matchesImageHeader, uploadInputSchema, READ_TTL_MS } from "../src/application/imageStorage";

const secret = process.env.TEST_STORAGE_SECRET;
if (!secret || process.env.VERCEL || process.env.MARKETPLACE_TEST_BUILD !== "1") throw new Error("Test storage is unavailable.");
const uploadSchema = uploadInputSchema.extend({ id: z.string(), listingId: z.string(), pathname: z.string(), expiresAt: z.string() });
type Upload = z.infer<typeof uploadSchema>;
const objects = new Map<string, { bytes: Buffer; upload: Upload; uploadedAt: string }>();
const capabilities = new Map<string, { operation: "put" | "get"; pathname: string; expires: number; upload?: Upload }>();
function grant(operation: "put" | "get", pathname: string, expires: number, upload?: Upload) {
  const id = randomUUID(); capabilities.set(id, { operation, pathname, expires, upload });
  return `http://127.0.0.1:4311/object/${id}`;
}
createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3100");
  response.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (request.url === "/health") { response.end("ready"); return; }
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  try {
    if (request.url?.startsWith("/control/") && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${secret}`) { response.writeHead(401).end(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 8192) throw new Error("Too large"); chunks.push(Buffer.from(chunk)); }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString());
      const operation = request.url.slice("/control/".length);
      let result: unknown = null;
      if (operation === "prepare") {
        const upload = uploadSchema.parse(input);
        result = grant("put", upload.pathname, Date.parse(upload.expiresAt), upload);
      } else {
        const { pathname } = z.object({ pathname: z.string() }).parse(input);
        if (operation === "delete") objects.delete(pathname);
        else if (operation === "read") result = grant("get", pathname, Date.now() + READ_TTL_MS);
        else if (operation === "verify") {
          const upload = uploadSchema.parse(input), object = objects.get(pathname);
          if (!object || object.bytes.length !== upload.size || object.upload.contentType !== upload.contentType || !matchesImageHeader(object.bytes, upload.contentType)) throw new Error("Invalid object");
          result = { kind: "vercel-blob", pathname, originalFilename: upload.filename, contentType: upload.contentType, size: upload.size, uploadedAt: object.uploadedAt };
        } else throw new Error("Unknown operation");
      }
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result)); return;
    }
    const capability = capabilities.get(request.url?.slice("/object/".length) ?? "");
    if (!request.url?.startsWith("/object/") || !capability || capability.expires <= Date.now()) { response.writeHead(403).end(); return; }
    if (request.method === "PUT" && capability.operation === "put" && capability.upload) {
      const upload = capability.upload;
      if (objects.has(capability.pathname) || request.headers["content-type"] !== upload.contentType) throw new Error("Invalid upload");
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > upload.size) throw new Error("Too large"); chunks.push(Buffer.from(chunk)); }
      if (objects.has(capability.pathname)) throw new Error("Already exists");
      objects.set(capability.pathname, { bytes: Buffer.concat(chunks), upload, uploadedAt: new Date().toISOString() });
      response.writeHead(201).end(); return;
    }
    if (request.method === "GET" && capability.operation === "get") {
      const object = objects.get(capability.pathname);
      if (!object) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", object.upload.contentType); response.end(object.bytes); return;
    }
    response.writeHead(403).end();
  } catch { response.writeHead(400).end("Storage operation rejected."); }
}).listen(4311, "127.0.0.1", () => console.log("Disposable test storage ready."));
