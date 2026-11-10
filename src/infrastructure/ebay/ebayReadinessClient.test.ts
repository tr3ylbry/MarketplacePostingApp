import { EbayReadinessClient } from "./ebayReadinessClient";
import { readinessFixture } from "../../test/ebay/readinessFixtures";
const json = (body: unknown, status = 200) => Response.json(body, { status });
const eligibilityError = () => ({ errors: [{ errorId: 20403, domain: "API_ACCOUNT", category: "REQUEST", message: "User is not eligible for Business Policy" }] });
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
  expect(result).toMatchObject({ registrationComplete: false, zeroMonthlyQuantityLimit: true, businessPoliciesEnrolled: false, policies: { state: "not-enrolled" }, locations: [] });
});
it.each(Array.from({ length: 8 }, (_, mask) => mask))("accepts verified empty first-page metadata combination %i without inventing fields", async mask => {
  const base = transport(true), body: Record<string, unknown> = { locations: [] };
  if (mask & 1) body.total = 0;
  if (mask & 2) body.offset = 0;
  if (mask & 4) body.limit = 100;
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("/location") ? Promise.resolve(json(body)) : base(input, init));
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result).toEqual({ registrationComplete: false, zeroMonthlyQuantityLimit: true, businessPoliciesEnrolled: false, policies: { state: "not-enrolled" }, locations: [] });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.map(([u]) => new URL(String(u)).pathname)).toEqual([
    "/sell/account/v1/privilege", "/sell/account/v1/program/get_opted_in_programs", "/sell/inventory/v1/location",
  ]);
  expect(Object.fromEntries(new URL(String(fetch.mock.calls[2][0])).searchParams)).toEqual({ limit: "100", offset: "0" });
  expect(result).not.toHaveProperty("total"); expect(result).not.toHaveProperty("offset"); expect(result).not.toHaveProperty("limit");
});
it("discards a bounded current-page href rather than following, persisting or returning it", async () => {
  const base = transport(true), href = "https://api.sandbox.ebay.com/sell/inventory/v1/location?limit=100&offset=0";
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("/location") ? Promise.resolve(json({ locations: [], total: 0, offset: 0, limit: 100, href })) : base(input, init));
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result.locations).toEqual([]); expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(result)).not.toContain(href);
});
it.each([
  { total: 1 }, { total: -1 }, { total: "0" }, { total: null },
  { offset: 1 }, { offset: -1 }, { offset: "0" }, { offset: null },
  { limit: 0 }, { limit: 99 }, { limit: 101 }, { limit: "100" }, { limit: null },
  { next: "https://api.sandbox.ebay.com/sell/inventory/v1/location?limit=100&offset=1" },
  { next: "https://api.ebay.com/sell/inventory/v1/location?limit=100&offset=1" },
  { next: "" }, { next: null }, { prev: "https://api.sandbox.ebay.com/sell/inventory/v1/location" },
  { continuation: "private-fixture" }, { continuationToken: "private-fixture" }, { hasMore: true },
  { links: { next: "https://example.test/private-fixture" } }, { errors: [] },
])("rejects contradictory or unexpected empty-first-page metadata: %#", async change => {
  const base = transport(true), fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("/location") ? Promise.resolve(json({ locations: [], ...change })) : base(input, init));
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([undefined, null, {}, "", [null], [{}], ["invalid"]])("does not infer an empty collection from missing/malformed locations: %j", async locations => {
  const base = transport(true), fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("/location") ? Promise.resolve(json({ total: 0, offset: 0, limit: 100, locations })) : base(input, init));
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each(["total", "offset", "limit"])("still requires %s for a nonempty location page", async field => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init); if (!new URL(String(input)).pathname.endsWith("/location")) return response;
    const body = await response.json(); delete body[field]; return json(body);
  };
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
});
it.each([{}, { total: 2, offset: 1, limit: 100 }, { total: 0, offset: 1, limit: 100 }])("rejects an empty later page while pagination is incomplete: %#", async metadata => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const url = new URL(String(input));if (!url.pathname.endsWith("/location")) return base(input, init);
    if (url.searchParams.get("offset") === "1") return Promise.resolve(json({ locations: [], ...metadata }));
    const fixture = readinessFixture(url.pathname, url.searchParams) as { locations: object[] };
    return Promise.resolve(json({ total: 2, offset: 0, limit: 100, locations: [fixture.locations[0]], next: "https://api.sandbox.ebay.com/sell/inventory/v1/location?limit=100&offset=1" }));
  });
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
  expect(fetch).toHaveBeenCalledTimes(7);
});
it.each(["STORE", "FULFILLMENT_CENTER", "PROVIDER_FUTURE_TYPE"])("keeps a nonempty %s location visible as an unsupported warehouse type", async type => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await base(input, init); if (!new URL(String(input)).pathname.endsWith("/location")) return response;
    const body = await response.json(); body.locations[0].locationTypes = [type]; return json(body);
  };
  expect((await new EbayReadinessClient(fetch).inspect("fixture-access")).locations[0]).toMatchObject({ enabled: true, warehouse: false, addressComplete: true });
});
it.each([400, 401, 403, 429, 500, 202, 206])("never treats location HTTP %i as a completed empty page", async status => {
  const base = transport(true), fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("/location") ? Promise.resolve(json({ locations: [] }, status)) : base(input, init));
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toBeInstanceOf(Error);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each(["oversize", "json"])("retains the %s response safeguard before accepting an empty page", async kind => {
  const base = transport(true), fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    if (!new URL(String(input)).pathname.endsWith("/location")) return base(input, init);
    return Promise.resolve(kind === "oversize" ? json({ locations: [], padding: "x".repeat(1024 * 1024) }) : new Response('{"locations":[]', { headers: { "Content-Type": "application/json" } }));
  });
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.not.toThrow(/fixture-access|padding/);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("skips all policy requests when programs are empty but still inspects existing locations", async () => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => new URL(String(input)).pathname.endsWith("get_opted_in_programs") ? json({ programs: [] }) : base(input, init));
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result.policies).toEqual({ state: "not-enrolled" });
  expect(result.policies).not.toHaveProperty("collections");
  expect(result.businessPoliciesEnrolled).toBe(false); expect(result.locations).toHaveLength(2);
  expect(fetch.mock.calls.map(([u]) => new URL(String(u)).pathname)).toEqual([
    "/sell/account/v1/privilege", "/sell/account/v1/program/get_opted_in_programs", "/sell/inventory/v1/location",
  ]);
});
it("accepts complete, genuinely empty policy collections for an enrolled seller", async () => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input)), kind = ["fulfillment", "payment", "return"].find(k => url.pathname.endsWith(k + "_policy"));
    return kind ? json({ total: 0, [kind + "Policies"]: [] }) : base(input, init);
  });
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result.policies).toEqual({ state: "available", collections: { fulfillment: [], payment: [], return: [] } });
  expect(fetch).toHaveBeenCalledTimes(6);
});
it.each(["fulfillment", "payment", "return"])("recognizes the verified %s eligibility rejection, discards partial collections and reads locations", async kind => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => new URL(String(input)).pathname.endsWith(kind + "_policy") ? json(eligibilityError(), 400) : base(input, init));
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result.businessPoliciesEnrolled).toBe(true); expect(result.policies).toEqual({ state: "ineligible" });
  expect(result.locations).toHaveLength(2);
  const paths = fetch.mock.calls.map(([u]) => new URL(String(u)).pathname);
  expect(paths[paths.length - 1]).toBe("/sell/inventory/v1/location");
  expect(paths.filter(p => p.endsWith("_policy"))).toHaveLength(["fulfillment", "payment", "return"].indexOf(kind) + 1);
  expect(JSON.stringify(result)).not.toMatch(/Business Policy|API_ACCOUNT|20403|fixture-access|private-fixture/);
});
it("can recognize the known eligibility template in longMessage while discarding unrelated provider fields", async () => {
  const base = transport(), body = { errors: [{ errorId: 20403, domain: "API_ACCOUNT", category: "REQUEST", message: "private-provider-message", longMessage: "User is not eligible for Business Policy.", parameters: [{ name: "private-parameter", value: "private-fixture" }] }], account: "private-fixture" };
  const fetch: typeof globalThis.fetch = (input, init) => new URL(String(input)).pathname.endsWith("fulfillment_policy") ? Promise.resolve(json(body, 400)) : base(input, init);
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result.policies).toEqual({ state: "ineligible" });
  expect(JSON.stringify(result)).not.toMatch(/private-|longMessage|parameters|20403|API_ACCOUNT/);
});
it.each([
  { errorId: 20402 }, { domain: "API_INVENTORY" }, { category: "APPLICATION" },
  { message: "Invalid marketplaceId" }, { message: undefined },
])("does not reinterpret an unrelated policy 400 as eligibility or empty policies: %o", async change => {
  const base = transport(), body = eligibilityError(); Object.assign(body.errors[0], change);
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("fulfillment_policy") ? Promise.resolve(json(body, 400)) : base(input, init));
  const result = await new EbayReadinessClient(fetch).inspect("fixture-access");
  expect(result.policies).toEqual({ state: "unknown-failure" });
  expect(result.policies).not.toHaveProperty("collections"); expect(result.locations).toHaveLength(2);
  expect(fetch).toHaveBeenCalledTimes(4); // No remaining policy requests or retries.
});
it("does not hide an additional unknown error behind a recognized eligibility entry", async () => {
  const base = transport(), body = eligibilityError(); body.errors.push({ ...body.errors[0], errorId: 20415, message: "private-provider-message" });
  const fetch: typeof globalThis.fetch = (input, init) => new URL(String(input)).pathname.endsWith("fulfillment_policy") ? Promise.resolve(json(body, 400)) : base(input, init);
  expect((await new EbayReadinessClient(fetch).inspect("fixture-access")).policies).toEqual({ state: "unknown-failure" });
});
it.each([
  {}, { errors: null }, { errors: [] }, { errors: [null] },
  { errors: [{ errorId: "20403", domain: "API_ACCOUNT", category: "REQUEST" }] },
  { errors: [{ errorId: 20403.5, domain: "API_ACCOUNT", category: "REQUEST" }] },
  { errors: [{ errorId: 20403, domain: "private/domain", category: "REQUEST" }] },
  { errors: [{ errorId: 20403, domain: "API_ACCOUNT", category: "private-category" }] },
  { errors: [{ errorId: 20403, domain: "API_ACCOUNT", category: "REQUEST", message: 123 }] },
  { errors: Array.from({ length: 11 }, () => eligibilityError().errors[0]) },
])("rejects a malformed policy error envelope without continuing: %#", async body => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("fulfillment_policy") ? Promise.resolve(json(body, 400)) : base(input, init));
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each(["envelope", "message", "longMessage", "json", "content-type"])("bounds and safely rejects a policy error's %s", async kind => {
  const base = transport();
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    if (!new URL(String(input)).pathname.endsWith("fulfillment_policy")) return base(input, init);
    const body = { ...eligibilityError(), unused: kind === "envelope" ? "x".repeat(16 * 1024) : "" };
    const response = kind === "json" ? new Response("{", { status: 400, headers: { "Content-Type": "application/json" } }) :
      kind === "content-type" ? new Response("private-provider-error", { status: 400 }) :
      json({ ...body, errors: body.errors.map(e => ({ ...e, ...(kind === "message" ? { message: "x".repeat(513) } : kind === "longMessage" ? { longMessage: "x".repeat(2049) } : {}) })) }, 400);
    return Promise.resolve(response);
  });
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.not.toThrow(/private-provider-error|fixture-access|20403/);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([{}, { programs: null }, { programs: [{}] }, { programs: "invalid" }])("fails before policies/locations if enrollment cannot be established: %#", async body => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("get_opted_in_programs") ? Promise.resolve(json(body)) : base(input, init));
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 404, 429, 500])("aborts independent reads after policy HTTP %i rather than hiding it as ineligibility", async status => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>((input, init) => new URL(String(input)).pathname.endsWith("fulfillment_policy") ? Promise.resolve(json(eligibilityError(), status)) : base(input, init));
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toBeInstanceOf(Error);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([15000, 45000])("honors the %i ms abort boundary even when a transport returns after abort", async limit => {
  const base = transport(), controller = new AbortController(), original = AbortSignal.timeout;
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === limit ? controller.signal : original(ms));
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("get_opted_in_programs")) { controller.abort(); return json({ programs: [] }); }
    return base(input, init);
  });
  try {
    await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(15000); expect(timeout).toHaveBeenCalledWith(45000);
  } finally { timeout.mockRestore(); }
});
it.each([true, false])("never requests an eleventh location page (not enrolled: %s)", async notEnrolled => {
  const base = transport(), fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (notEnrolled && url.pathname.endsWith("get_opted_in_programs")) return json({ programs: [] });
    if (!url.pathname.endsWith("/location")) return base(input, init);
    const fixture = readinessFixture(url.pathname, url.searchParams) as { locations: object[] }, offset = Number(url.searchParams.get("offset"));
    return json({ total: 11, offset, limit: 100, locations: [{ ...fixture.locations[0], merchantLocationKey: String(offset).padStart(50, "k") }], next: `https://api.sandbox.ebay.com/sell/inventory/v1/location?limit=100&offset=${offset + 1}` });
  });
  await expect(new EbayReadinessClient(fetch).inspect("fixture-access")).rejects.toMatchObject({ code: "malformed" });
  expect(fetch).toHaveBeenCalledTimes(notEnrolled ? 12 : 15);
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
it.each([undefined, null, [], {}, [123], [null], [""]])("does not infer a warehouse from absent or invalid GET locationTypes: %j", async types => {
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
