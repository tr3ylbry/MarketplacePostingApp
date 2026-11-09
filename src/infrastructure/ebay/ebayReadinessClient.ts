import { z } from "zod";
import { EbayReadinessError, type EbayPolicyKind, type EbayReadinessGateway, type EbaySellerReadiness } from "../../application/ebayReadiness";

const origin = "https://api.sandbox.ebay.com";
const text = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[<>]/.test(s) && ![...s].some(c => c.charCodeAt(0) < 32));
const policyId = z.string().regex(/^[1-9][0-9]{0,31}$/);
const categoryType = z.enum(["ALL_EXCLUDING_MOTORS_VEHICLES", "MOTORS_VEHICLES"]);
const policy = z.object({ name: text(64), marketplaceId: z.literal("EBAY_US"), categoryTypes: z.array(z.object({ name: categoryType })).min(1).max(2) });
const privileges = z.object({ sellerRegistrationCompleted: z.boolean(), sellingLimit: z.object({ quantity: z.number().int().nonnegative().optional() }).optional() });
const programs = z.object({ programs: z.array(z.object({ programType: text(100) })).max(100) });
const addressPart = text(128).optional();
const location = z.object({
  merchantLocationKey: text(50), merchantLocationStatus: z.enum(["ENABLED", "DISABLED"]), name: text(256).optional(),
  locationTypes: z.array(text(50)).min(1).max(10),
  location: z.object({ address: z.object({ country: z.string().regex(/^[A-Z]{2}$/), postalCode: text(16).optional(), city: addressPart, stateOrProvince: addressPart }) }),
});
const locationPage = z.object({
  locations: z.array(location).max(100), total: z.number().int().min(0).max(1000),
  offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100), next: z.string().max(2048).optional(),
});
type AccountPath = "/sell/account/v1/privilege" | "/sell/account/v1/program/get_opted_in_programs" | `/sell/account/v1/${EbayPolicyKind}_policy`;
type ReadPath = AccountPath | "/sell/inventory/v1/location";

export class EbayReadinessClient implements EbayReadinessGateway {
  constructor(private readonly transport: typeof fetch = fetch) {}
  async inspect(accessToken: string): Promise<EbaySellerReadiness> {
    if (!accessToken || accessToken.length > 16000 || /[\r\n\0]/.test(accessToken)) throw new EbayReadinessError("authorization");
    const overall = AbortSignal.timeout(45000);
    let requests = 0, bytes = 0;
    const get = async (path: ReadPath, query: Record<string, string> = {}): Promise<unknown> => {
      if (++requests > 15) throw new EbayReadinessError("malformed");
      const url = new URL(origin + path); url.search = new URLSearchParams(query).toString();
      try {
        const response = await this.transport(url.toString(), { method: "GET", redirect: "error", cache: "no-store",
          signal: AbortSignal.any([overall, AbortSignal.timeout(15000)]),
          headers: { Authorization: "Bearer " + accessToken, Accept: "application/json", "Content-Language": "en-US", "Accept-Encoding": "gzip" } });
        if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) {
          await response.body?.cancel().catch(() => undefined);
          throw new EbayReadinessError(response.status === 401 ? "authorization" : response.status === 403 ? "forbidden" : response.status === 429 ? "rate-limit" : "unavailable");
        }
        const reader = response.body?.getReader(); if (!reader) throw new EbayReadinessError("malformed");
        let size = 0; const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength; bytes += next.value.byteLength;
            if (size > 1024 * 1024 || bytes > 8 * 1024 * 1024) throw new EbayReadinessError("malformed");
            chunks.push(next.value);
          }
        } finally { await reader.cancel().catch(() => undefined); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (error) {
        if (error instanceof EbayReadinessError) throw error;
        throw new EbayReadinessError("unavailable");
      }
    };
    try {
      const seller = privileges.parse(await get("/sell/account/v1/privilege"));
      const enrollment = programs.parse(await get("/sell/account/v1/program/get_opted_in_programs"));
      const policies = {} as EbaySellerReadiness["policies"];
      for (const kind of ["fulfillment", "payment", "return"] as const) {
        const listKey = kind + "Policies", idKey = kind + "PolicyId";
        const body = await get(`/sell/account/v1/${kind}_policy`, { marketplace_id: "EBAY_US" });
        const raw = z.object({ total: z.number().int().min(0).max(500), next: z.string().max(2048).optional() }).parse(body);
        const list = z.object({ [listKey]: z.array(z.unknown()).max(500) }).parse(body)[listKey];
        // Account v1 lists all policies; pagination fields are reserved, not supported request parameters.
        if (raw.next || raw.total !== list.length) throw new EbayReadinessError("malformed");
        policies[kind] = list.map(value => {
          const p = policy.parse(value), id = z.object({ [idKey]: policyId }).parse(value)[idKey];
          return { id, name: p.name, categoryTypes: p.categoryTypes.map(t => t.name) };
        });
        if (new Set(policies[kind].map(p => p.id)).size !== list.length || policies[kind].some(p => new Set(p.categoryTypes).size !== p.categoryTypes.length || (kind === "return" && p.categoryTypes.includes("MOTORS_VEHICLES")))) throw new EbayReadinessError("malformed");
      }
      const locations: EbaySellerReadiness["locations"] = []; let offset = 0, total: number | undefined;
      for (let page = 0; page < 10; page++) {
        const result = locationPage.parse(await get("/sell/inventory/v1/location", { limit: "100", offset: String(offset) }));
        if (result.offset !== offset || result.limit !== 100 || (total !== undefined && total !== result.total)) throw new EbayReadinessError("malformed");
        total = result.total;
        for (const l of result.locations) {
          const a = l.location.address;
          locations.push({ key: l.merchantLocationKey, name: l.name ?? null, enabled: l.merchantLocationStatus === "ENABLED", warehouse: l.locationTypes.includes("WAREHOUSE"),
            addressComplete: !!(a.postalCode || (a.city && a.stateOrProvince)) });
        }
        offset += result.locations.length;
        if (new Set(locations.map(l => l.key)).size !== locations.length || offset > total) throw new EbayReadinessError("malformed");
        if (offset === total) {
          if (result.next) throw new EbayReadinessError("malformed");
          return { registrationComplete: seller.sellerRegistrationCompleted, zeroMonthlyQuantityLimit: seller.sellingLimit?.quantity === 0,
            businessPoliciesEnrolled: enrollment.programs.some(p => p.programType === "SELLING_POLICY_MANAGEMENT"), policies, locations };
        }
        if (!result.locations.length || !result.next) throw new EbayReadinessError("malformed");
        const next = new URL(result.next);
        if (next.origin !== origin || next.username || next.password || next.hash || next.pathname !== "/sell/inventory/v1/location" ||
            [...next.searchParams.keys()].length !== 2 || next.searchParams.getAll("offset").length !== 1 || next.searchParams.getAll("limit").length !== 1 ||
            next.searchParams.get("offset") !== String(offset) || next.searchParams.get("limit") !== "100") throw new EbayReadinessError("malformed");
        // Reconstruct the next fixed endpoint; never follow the provider's URL.
      }
      throw new EbayReadinessError("malformed");
    } catch (error) {
      if (error instanceof EbayReadinessError) throw error;
      throw new EbayReadinessError("malformed");
    }
  }
}
