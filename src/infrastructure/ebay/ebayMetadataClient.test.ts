import { EbayMetadataClient } from "./ebayMetadataClient";
import { metadataFixture } from "../../test/ebay/metadataFixtures";

const config = { clientId: "fake-client", clientSecret: "fake-secret", ruName: "fake-runame", origin: "https://127.0.0.1:3000", fingerprint: "fixture" };
const token = { access_token: "fake-application-token", expires_in: 7200, token_type: "Application Access Token" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const transport = () => vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(String(input));
  expect(url.origin).toBe("https://api.sandbox.ebay.com");
  expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  if (url.pathname === "/identity/v1/oauth2/token") {
    expect(init?.method).toBe("POST");
    expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("client_credentials");
    expect(new URLSearchParams(String(init?.body)).get("scope")).toBe("https://api.ebay.com/oauth/api_scope");
    return json(token);
  }
  expect(init?.method).toBe("GET");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fake-application-token");
  const fixture = metadataFixture(url.pathname, url.searchParams);
  return json(fixture ?? {}, fixture === undefined ? 404 : 200);
});

it("uses an application base-scope token and returns only immediate category children", async () => {
  const fetch = transport(), client = new EbayMetadataClient(config, fetch);
  const root = await client.browse();
  expect(root.category).toBeNull(); expect(root.children).toEqual([{ id: "100", name: "Synthetic musical instruments", leaf: false }]);
  const branch = await client.browse("100");
  expect(branch.children.map(c => c.id)).toEqual(["101", "102"]);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(1);
});
it("validates leaf membership and maps supported used conditions without refurbishing permissions", async () => {
  const result = await new EbayMetadataClient(config, transport()).requirements("101");
  expect(result.branch.category).toMatchObject({ id: "101", leaf: true });
  expect(result.aspects).toMatchObject([{ name: "Brand", required: true }, { name: "Model", required: true }]);
  expect(result.conditions).toEqual([{ id: "3000", name: "Used", supported: true }, { id: "2000", name: "Certified refurbished", supported: false }]);
  await expect(new EbayMetadataClient(config, transport()).requirements("100")).rejects.toMatchObject({ code: "category" });
});
it("rejects invalid category input before requesting any token", async () => {
  const fetch = transport(), client = new EbayMetadataClient(config, fetch);
  for (const id of ["../token", "https://api.ebay.com", "0", "101&x=1"]) await expect(client.browse(id)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("deduplicates concurrent application-token requests and renews after expiry", async () => {
  let now = 0; const fetch = transport(), client = new EbayMetadataClient(config, fetch, () => now);
  await Promise.all([client.browse(), client.browse("100")]);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(1);
  now = 7200 * 1000; await client.browse();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(2);
});
it.each([400, 401, 403, 404, 429, 500])("handles HTTP %i safely without echoing provider errors or silently retrying", async status => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ error_description: "private-provider-fixture" }, status));
  await expect(new EbayMetadataClient(config, fetch).browse()).rejects.not.toThrow(/private-provider-fixture|fake-secret/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("handles network timeout and malformed token safely", async () => {
  await expect(new EbayMetadataClient(config, async () => { throw new DOMException("private-fixture", "TimeoutError"); }).browse()).rejects.not.toThrow(/private-fixture/);
  for (const value of [{}, { ...token, scope: "https://api.ebay.com/oauth/api_scope/sell.inventory" }, { ...token, expires_in: -1 }]) {
    await expect(new EbayMetadataClient(config, async () => json(value)).browse()).rejects.toThrow();
  }
});
it("rejects oversized or non-JSON responses", async () => {
  await expect(new EbayMetadataClient(config, async () => new Response("x".repeat(65537), { headers: { "Content-Type": "application/json" } })).browse()).rejects.toThrow();
  await expect(new EbayMetadataClient(config, async () => new Response("<html>private-fixture</html>")).browse()).rejects.not.toThrow(/private-fixture/);
});
it("rejects mismatched tree/leaf/condition identities and missing aspect requirements", async () => {
  for (const kind of ["tree", "leaf", "condition", "aspect"]) {
    const base = transport();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const response = await base(input, init);
      if (url.pathname.endsWith("/get_category_subtree") && ["tree", "leaf"].includes(kind)) {
        const body = await response.json();
        if (kind === "tree") body.categoryTreeId = "99";
        else body.categorySubtreeNode.category.categoryId = "999";
        return json(body);
      }
      if (kind === "condition" && url.pathname.endsWith("/get_item_condition_policies")) {
        const body = await response.json(); body.itemConditionPolicies[0].categoryId = "999"; return json(body);
      }
      if (kind === "aspect" && url.pathname.endsWith("/get_item_aspects_for_category")) return json({});
      return response;
    };
    await expect(new EbayMetadataClient(config, fetch).requirements("101")).rejects.toThrow();
  }
});
it.each(["child", "aspect", "value", "condition"])("rejects ambiguous duplicate %s metadata", async kind => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), response = await base(input, init);
    const body = await response.json();
    if (kind === "child" && url.pathname.endsWith("/get_category_subtree")) {
      const duplicate = { category: { categoryId: "101", categoryName: "Synthetic duplicate" }, leafCategoryTreeNode: true };
      body.categorySubtreeNode.childCategoryTreeNodes = [duplicate, duplicate];
    }
    if (url.pathname.endsWith("/get_item_aspects_for_category")) {
      if (kind === "aspect") body.aspects.push(body.aspects[0]);
      if (kind === "value") body.aspects[0].aspectValues = [{ localizedValue: "Synthetic" }, { localizedValue: "Synthetic" }];
    }
    if (kind === "condition" && url.pathname.endsWith("/get_item_condition_policies")) {
      body.itemConditionPolicies[0].itemConditions.push(body.itemConditionPolicies[0].itemConditions[0]);
    }
    return json(body);
  };
  const client = new EbayMetadataClient(config, fetch);
  await expect(kind === "child" ? client.browse("100") : client.requirements("101")).rejects.toThrow();
});
it("accepts an explicitly empty aspect list without accepting a missing requirements field", async () => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("/get_item_aspects_for_category")) return json({ aspects: [] });
    return base(input, init);
  };
  expect((await new EbayMetadataClient(config, fetch).requirements("101")).aspects).toEqual([]);
});
