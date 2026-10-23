import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
if (process.env.MARKETPLACE_TEST_BUILD !== "1" || process.env.VERCEL || !process.env.TEST_REVERB_SECRET) throw new Error("Test Reverb requires an isolated local test build.");
const categoryId = "14d6cc96-ed7b-4521-bc21-7713c61e9dc5", conditionId = "f7a3f48c-972a-44c6-b01a-0cd27488d3f6";
const accounts = new Map<string, Map<string, { id: string; sku: string; state: { slug: string } }>>();
let posts = 0;
createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4312");
  const send = (data: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/hal+json" }); response.end(JSON.stringify(data)); };
  if (url.pathname === "/health") return send({ ok: true });
  if (request.headers["x-test-secret"] !== process.env.TEST_REVERB_SECRET) return send({}, 403);
  if (url.pathname === "/stats") return send({ posts });
  const token = request.headers.authorization;
  if (!token?.startsWith("Bearer fake-reverb-")) return send({}, 401);
  let listings = accounts.get(token); if (!listings) { listings = new Map(); accounts.set(token, listings); }
  if (url.pathname === "/api/shop") return send({ id: "shop-test", name: "Sandbox Test Shop", shipping_profiles: [{ id: "profile-test", name: "Test shipping profile" }] });
  if (url.pathname === "/api/categories/flat") return send({ categories: [{ uuid: categoryId, full_name: "Guitars / Electric", listable: true }] });
  if (url.pathname === "/api/listing_conditions") return send({ conditions: [{ uuid: conditionId, display_name: "Good" }] });
  if (url.pathname === "/api/my/listings") return send({ listings: [...listings.values()].filter(l => l.sku === url.searchParams.get("sku")), _links: {} });
  if (url.pathname === "/api/listings" && request.method === "POST") {
    try {
      let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 100000) throw new Error(); }
      const payload = z.object({ publish: z.literal(false), sku: z.string(), photos: z.array(z.url()).min(1) }).parse(JSON.parse(body));
      for (const photo of payload.photos) { const url = new URL(photo); if (url.origin !== "http://127.0.0.1:4311") throw new Error(); const image = await fetch(url); if (!image.ok || !(await image.arrayBuffer()).byteLength) throw new Error(); }
      const row = { id: randomUUID(), sku: payload.sku, state: { slug: "draft" } }; listings.set(row.id, row); posts++; return send({ listing: row }, 201);
    } catch { return send({}, 412); }
  }
  send({}, 404);
}).listen(4312, "127.0.0.1");
