import { z } from "zod";
import { providerStateSchema } from "../../domain/marketplaceListing";
import { ReverbProviderError, type ReverbEnvironment, type ReverbGateway, type ReverbPayload } from "../../application/reverbGateway";

export const reverbHosts = { sandbox: "https://sandbox.reverb.com", live: "https://api.reverb.com" } as const;
export function reverbEnvironment(): ReverbEnvironment {
  return z.enum(["sandbox", "live"]).parse(process.env.REVERB_ENVIRONMENT ?? "sandbox");
}
const id = z.union([z.string().min(1).max(200), z.number().int().nonnegative()]).transform(String);
const label = z.string().min(1).max(500);
const shopSchema = z.object({ id, name: label, shipping_profiles: z.array(z.object({ id, name: label })).default([]) });
const linksSchema = z.object({ next: z.object({ href: z.string() }).nullable().optional() }).optional();
const remoteSchema = z.object({ id, sku: z.string().min(1).max(200), state: z.object({ slug: providerStateSchema.refine(s => s !== "missing") }),
  _links: z.object({ web: z.object({ href: z.string() }).optional() }).optional() });

// Only this adapter performs Reverb HTTP. Tokens and provider response bodies
// never become errors, logs, or return values. Redirects cannot forward tokens.
export class ReverbClient implements ReverbGateway {
  constructor(readonly environment: ReverbEnvironment, private readonly request: typeof fetch = fetch) {}
  private async call(token: string, path: string, body?: ReverbPayload, method = body ? "POST" : "GET"): Promise<unknown> {
    try {
      const response = await this.request(new URL(path, reverbHosts[this.environment]), {
        method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, "Accept-Version": "3.0", Accept: "application/hal+json",
          "Content-Type": "application/hal+json", "User-Agent": "MarketplacePostingApp/1.0 (draft integration)" },
        ...(body ? { body: JSON.stringify({ ...body, publish: false }) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status;
        throw new ReverbProviderError(status === 401 ? "auth" : status === 403 ? "forbidden" : status === 404 ? "missing"
          : status === 409 ? "conflict" : status === 429 ? "rate" : status >= 500 ? "unavailable" : "validation");
      }
      // DELETE may return an empty body. Absence is verified by a separate SKU lookup.
      if (method === "DELETE") { await response.body?.cancel(); return undefined; }
      // Bounded reads also cover chunked/malicious responses; timeout remains active.
      const reader = response.body?.getReader();
      if (!reader) throw new ReverbProviderError("malformed");
      let size = 0; const chunks: Uint8Array[] = [];
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > 2_000_000) throw new ReverbProviderError("malformed"); chunks.push(value); }
      } finally { await reader.cancel(); }
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.includes(token)) throw new ReverbProviderError("malformed");
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof ReverbProviderError) throw error;
      throw new ReverbProviderError(error instanceof SyntaxError ? "malformed" : "unavailable");
    }
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new ReverbProviderError("malformed");
    return result.data;
  }
  async shop(token: string) {
    const value = this.parse(shopSchema, await this.call(token, "/api/shop"));
    return { id: value.id, name: value.name, shippingProfiles: value.shipping_profiles };
  }
  async categories(token: string) {
    // Reverb includes legacy GUIDs without RFC UUID version/variant bits.
    const value = this.parse(z.object({ categories: z.array(z.object({ uuid: z.guid(), full_name: label, listable: z.boolean() })) }), await this.call(token, "/api/categories/flat"));
    return value.categories.filter(c => c.listable).map(c => ({ id: c.uuid, name: c.full_name }));
  }
  async conditions(token: string) {
    const value = this.parse(z.object({ conditions: z.array(z.object({ uuid: z.uuid(), display_name: label })) }), await this.call(token, "/api/listing_conditions"));
    return value.conditions.map(c => ({ id: c.uuid, name: c.display_name }));
  }
  private remote(value: unknown) {
    const row = this.parse(remoteSchema, value);
    const webHost = this.environment === "sandbox" ? "https://sandbox.reverb.com" : "https://reverb.com";
    let url: string | undefined;
    if (row._links?.web) {
      try { const candidate = new URL(row._links.web.href, webHost);
        if (candidate.origin === webHost && !candidate.username && !candidate.password && !candidate.search && !candidate.hash && candidate.pathname.startsWith("/item/")) url = candidate.href;
      } catch { /* Omit untrusted links. */ }
    }
    return { id: row.id, sku: row.sku, state: row.state.slug, ...(url ? { url } : {}) };
  }
  async findBySku(token: string, sku: string) {
    let path = `/api/my/listings?${new URLSearchParams({ sku, state: "all", per_page: "50" })}`;
    const found = new Map<string, ReturnType<ReverbClient["remote"]>>();
    for (let page = 0; page < 20; page++) {
      const result = this.parse(z.object({ listings: z.array(z.unknown()), _links: linksSchema }), await this.call(token, path));
      for (const item of result.listings) { const remote = this.remote(item); if (remote.sku === sku) found.set(remote.id, remote); }
      const next = result._links?.next?.href;
      if (!next) return [...found.values()];
      let url: URL;
      try { url = new URL(next, reverbHosts[this.environment]); } catch { throw new ReverbProviderError("malformed"); }
      if (url.origin !== reverbHosts[this.environment] || url.pathname.replace(/\/$/, "") !== "/api/my/listings" || url.username || url.password || url.hash
        || url.searchParams.get("sku") !== sku || url.searchParams.get("state") !== "all") throw new ReverbProviderError("malformed");
      path = url.pathname + url.search;
    }
    throw new ReverbProviderError("malformed"); // Incomplete pagination is never proof of absence.
  }
  async createDraft(token: string, payload: ReverbPayload) {
    const result = await this.call(token, "/api/listings", { ...payload, publish: false });
    // Create returns a listing envelope; accept a direct resource as well.
    const envelope = z.object({ listing: z.unknown() }).safeParse(result);
    return this.remote(envelope.success ? envelope.data.listing : result);
  }
  async deleteDraft(token: string, remoteId: string) {
    const safeId = this.parse(z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), remoteId);
    await this.call(token, `/api/listings/${encodeURIComponent(safeId)}`, undefined, "DELETE");
  }
}
export const reverbGateway = () => new ReverbClient(reverbEnvironment());
