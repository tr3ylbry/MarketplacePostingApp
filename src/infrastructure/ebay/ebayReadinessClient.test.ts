import { EbayReadinessClient } from "./ebayReadinessClient";
import { readinessFixture } from "../../test/ebay/readinessFixtures";
const json = (body: unknown, status = 200) => Response.json(body, { status });
const transport = (missing = false) => vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(String(input));
  expect(url.origin).toBe("https://api.sandbox.ebay.com");
  expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-access");
  return json(readinessFixture(url.pathname, url.searchParams, missing));
});
it("uses only the six fixed seller-read endpoints and returns a minimal private-data-free summary", async () => {
  const fetch = transport(), result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(fetch.mock.calls.map(([u]) => new URL(String(u)).pathname)).toEqual([
    "/sell/account/v1/privilege", "/sell/account/v1/program/get_opted_in_programs", "/sell/account/v1/fulfillment_policy",
    "/sell/account/v1/payment_policy", "/sell/account/v1/return_policy", "/sell/inventory/v1/location",
  ]);
  expect(result).toMatchObject({ registrationComplete: true, businessPoliciesEnrolled: true, locations: [{ enabled: true, warehouse: true, addressComplete: true }, { enabled: false }] });
  expect(JSON.stringify(result)).not.toMatch(/private-fixture|fixture-access|addressLine|postalCode|phone|amount|https?:/);
});
it("reports empty existing settings and incomplete registration without inventing policies or a location", async () => {
  const result = await new EbayReadinessClient(transport(true)).inspect("fixture-access");
  expect(result).toMatchObject({ registrationComplete: false, zeroMonthlyQuantityLimit: true, businessPoliciesEnrolled: false, policies: { fulfillment: [], payment: [], return: [] }, locations: [] });
});
it.each(Array.from({ length: 14 }, (_, i) => i + 37))("accepts a %i-character merchant location key without truncation", async length => {
  const base = transport(), key = "k".repeat(length);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init);
    if (!new URL(String(input)).pathname.endsWith("/location")) return response;
    const body = await response.json(); body.locations[0].merchantLocationKey = key;
    return json(body);
  };
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result.locations[0]).toMatchObject({ key, enabled: true, warehouse: true, addressComplete: true });
});
it.each([51, 100])("rejects a %i-character merchant location key", async length => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init);
    if (!new URL(String(input)).pathname.endsWith("/location")) return response;
    const body = await response.json(); body.locations[0].merchantLocationKey = "k".repeat(length);
    return json(body);
  };
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
});
it.each(["", "   ", "key<markup>", "key\ncontrol", "key\0control"])("keeps rejecting invalid location key text %j", async key => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init);
    if (!new URL(String(input)).pathname.endsWith("/location")) return response;
    const body = await response.json(); body.locations[0].merchantLocationKey = key;
    return json(body);
  };
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
});
it.each([undefined, null, []])("does not infer a warehouse from absent or invalid GET locationTypes: %j", async types => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init);
    if (!new URL(String(input)).pathname.endsWith("/location")) return response;
    const body = await response.json(); body.locations[0].locationTypes = types;
    return json(body);
  };
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
});
it("still rejects an oversized otherwise-valid location response with a 50-character key", async () => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init);
    if (!new URL(String(input)).pathname.endsWith("/location")) return response;
    const body = await response.json(); body.locations[0].merchantLocationKey = "k".repeat(50); body.unused = "x".repeat(1024 * 1024);
    return json(body);
  };
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
});
it("keeps the aggregate response-size bound across individually valid pages", async () => {
  const base = transport();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input)), response = await base(input, init), body = await response.json();
    if (url.pathname.endsWith("/location")) {
      const offset = Number(url.searchParams.get("offset"));
      body.total = 5; body.offset = offset;
      body.locations = [{ ...body.locations[0], merchantLocationKey: String(offset).padStart(50, "k") }];
      if (offset < 4) body.next = `https://api.sandbox.ebay.com/sell/inventory/v1/location?limit=100&offset=${offset + 1}`;
    }
    body.unused = "x".repeat(900 * 1024);
    return json(body);
  });
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
  expect(fetch).toHaveBeenCalledTimes(10);
});
it.each([401, 403, 404, 429, 500])("maps HTTP %i without raw provider data or automatic retries", async status => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ message: "private-provider-error" }, status));
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.not.toThrow(/private-provider-error|fixture-access/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("bounds timeout, decoded bytes and invalid JSON/content types", async () => {
  for (const fetch of [
    async () => { throw new DOMException("private-provider-error", "TimeoutError"); },
    async () => new Response("x".repeat(1024 * 1024 + 1), { headers: { "Content-Type": "application/json" } }),
    async () => new Response("{", { headers: { "Content-Type": "application/json" } }),
    async () => new Response("<html>private-provider-error</html>"),
  ]) await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.not.toThrow(/private-provider-error|fixture-access/);
});
it.each(["marketplace", "duplicate", "id", "partial"])("rejects %s policy data rather than accepting a false readiness result", async kind => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init);
    if (!new URL(String(input)).pathname.endsWith("fulfillment_policy")) return response;
    const body = await response.json();
    if (kind === "marketplace") body.fulfillmentPolicies[0].marketplaceId = "EBAY_CA";
    if (kind === "duplicate") { body.fulfillmentPolicies.push(body.fulfillmentPolicies[0]); body.total++; }
    if (kind === "id") body.fulfillmentPolicies[0].fulfillmentPolicyId = "../../private";
    if (kind === "partial") body.total++;
    return json(body);
  };
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
});
it("reads every inventory-location page through a reconstructed fixed URL", async () => {
  const base = transport(), keys = ["a".repeat(37), "b".repeat(50)]; let pages = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/location")) return base(input, init);
    pages++;
    const original = readinessFixture(url.pathname, url.searchParams) as { locations: object[] };
    const offset = Number(url.searchParams.get("offset"));
    return json({ total: 2, offset, limit: 100, locations: [{ ...original.locations[offset], merchantLocationKey: keys[offset] }], ...(offset === 0 ? { next: "https://api.sandbox.ebay.com/sell/inventory/v1/location?limit=100&offset=1" } : {}) });
  };
  expect((await new EbayReadinessClient(fetch).inspect("fixture-access")).locations.map(l => l.key)).toEqual(keys);
  expect(pages).toBe(2);
});
it.each(["foreign-next", "duplicate", "changed-total", "missing-next"])("rejects %s inventory pagination", async kind => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/location")) return base(input, init);
    const original = readinessFixture(url.pathname, url.searchParams) as { locations: object[] };
    const offset = Number(url.searchParams.get("offset"));
    return json({ total: kind === "changed-total" && offset > 0 ? 3 : 2, offset, limit: 100,
      locations: [{ ...original.locations[offset], merchantLocationKey: String(kind === "duplicate" ? 0 : offset).padStart(50, "k") }],
      ...(offset === 0 && kind !== "missing-next" ? { next: `${kind === "foreign-next" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com"}/sell/inventory/v1/location?limit=100&offset=1` } : {}),
    });
  };
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
});
