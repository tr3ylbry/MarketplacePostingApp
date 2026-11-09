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
it("accepts a realistic large tree within 8 MiB and caches only its root projection", async () => {
  const base = transport();
  let version = "1";
  const full = (version: string) => ({ categoryTreeId: "0", categoryTreeVersion: version, rootCategoryNode: {
    childCategoryTreeNodes: Array.from({ length: 20 }, (_, i) => ({
      category: { categoryId: String(i + 1), categoryName: "Synthetic branch" },
      childCategoryTreeNodes: Array.from({ length: 850 }, (_, j) => ({
        category: { categoryId: String(1000 + i * 850 + j), categoryName: "Synthetic leaf " + "x".repeat(150) },
        categoryTreeNodeLevel: 2, leafCategoryTreeNode: true,
      })),
    })),
  } });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("get_default_category_tree_id")) return json({ categoryTreeId: "0", categoryTreeVersion: version });
    if (url.pathname.endsWith("category_tree/0")) return json(full(version));
    return base(input, init);
  });
  expect(JSON.stringify(full(version)).length).toBeGreaterThan(4 * 1024 * 1024);
  const client = new EbayMetadataClient(config, fetch);
  const first = await client.browse();
  expect(first.children).toHaveLength(20);
  expect(JSON.stringify(first)).not.toMatch(/Synthetic leaf|childCategoryTreeNodes/);
  first.children[0].name = "Mutated caller copy";
  expect((await client.browse()).children[0].name).toBe("Synthetic branch");
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("category_tree/0"))).toHaveLength(1);
  version = "2";
  expect((await client.browse()).treeVersion).toBe("2");
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("category_tree/0"))).toHaveLength(2);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes("get_default_category_tree_id"))).toHaveLength(3);
  expect(new Headers(fetch.mock.calls.find(([url]) => String(url).endsWith("category_tree/0"))?.[1]?.headers).get("Accept-Encoding")).toBe("gzip");
});
it("shares a concurrent full-tree request without sharing mutable results", async () => {
  const base = transport();
  const fetch = vi.fn<typeof globalThis.fetch>((...args) => base(...args));
  const client = new EbayMetadataClient(config, fetch);
  const [a, b] = await Promise.all([client.browse(), client.browse()]);
  a.children.pop(); expect(b.children).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("category_tree/0"))).toHaveLength(1);
});
it.each(["nodes", "depth", "size"])("rejects a %s budget breach without caching a partial root", async kind => {
  const base = transport();
  let rootRequests = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (!new URL(String(input)).pathname.endsWith("category_tree/0")) return base(input, init);
    rootRequests++;
    if (kind === "size") return json({ padding: "x".repeat(8 * 1024 * 1024) });
    let node: object = { category: { categoryId: "101", categoryName: "Synthetic" }, leafCategoryTreeNode: true };
    if (kind === "depth") for (let i = 0; i < 13; i++) node = { childCategoryTreeNodes: [node] };
    else node = { childCategoryTreeNodes: Array.from({ length: 50 }, () => ({ childCategoryTreeNodes: Array.from({ length: 1000 }, () => ({})) })) };
    return json({ categoryTreeId: "0", categoryTreeVersion: "fixture-1", rootCategoryNode: node });
  };
  const client = new EbayMetadataClient(config, fetch);
  await expect(client.browse()).rejects.toMatchObject({ code: "unavailable" });
  await expect(client.browse()).rejects.toMatchObject({ code: "unavailable" });
  expect(rootRequests).toBe(2);
});
it("serializes full-tree fetches even if concurrent callers observe different versions", async () => {
  const base = transport(); let defaults = 0, roots = 0, active = 0, maximum = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("get_default_category_tree_id")) return json({ categoryTreeId: "0", categoryTreeVersion: String(++defaults) });
    if (url.pathname.endsWith("category_tree/0")) {
      const version = String(++roots); maximum = Math.max(maximum, ++active);
      if (version === "1") await gate;
      active--;
      return json({ ...(metadataFixture(url.pathname, url.searchParams) as object), categoryTreeVersion: version });
    }
    return base(input, init);
  };
  const client = new EbayMetadataClient(config, fetch);
  const first = client.browse();
  await vi.waitFor(() => expect(roots).toBe(1));
  const second = client.browse();
  await vi.waitFor(() => expect(defaults).toBe(2));
  expect(roots).toBe(1); release();
  expect((await first).treeVersion).toBe("1"); expect((await second).treeVersion).toBe("2");
  expect(maximum).toBe(1); expect(roots).toBe(2);
});
it("does not reuse an old root when the provider version changes but the body is stale", async () => {
  const base = transport(); let version = "fixture-1";
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("get_default_category_tree_id")) return json({ categoryTreeId: "0", categoryTreeVersion: version });
    return base(input, init);
  };
  const client = new EbayMetadataClient(config, fetch);
  await client.browse(); version = "new-version";
  await expect(client.browse()).rejects.toMatchObject({ code: "unavailable" });
});
it("accepts observed optional constraint/condition fields while retaining the used-condition allowlist", async () => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("get_item_aspects_for_category")) return json({ aspects: ["Brand", "Type"].map(localizedAspectName => ({
      localizedAspectName, aspectConstraint: { aspectDataType: "STRING", itemToAspectCardinality: "SINGLE", aspectMode: "FREE_TEXT", aspectRequired: true,
        aspectUsage: "RECOMMENDED", aspectEnabledForVariations: false, aspectApplicableTo: ["PRODUCT"] },
    })) });
    if (path.endsWith("get_item_condition_policies")) return json({ itemConditionPolicies: [{ categoryTreeId: "0", categoryId: "101", itemConditionRequired: true,
      itemConditions: [{ conditionId: "1000", conditionDescription: "New" }, { conditionId: "1500", conditionDescription: "Open box" },
        { conditionId: "3000", conditionDescription: "Used" }, { conditionId: "7000", conditionDescription: "For parts or not working" }],
    }] });
    return base(input, init);
  };
  const result = await new EbayMetadataClient(config, fetch).requirements("101");
  expect(result.aspects).toHaveLength(2);
  expect(result.aspects[0]).toMatchObject({ required: true, maxLength: 65, values: [] });
  expect(result.conditions.filter(c => c.supported).map(c => c.id)).toEqual(["3000", "7000"]);
  expect(JSON.stringify(result)).not.toMatch(/aspectUsage|aspectApplicableTo/);
});
it.each(["empty", "missing"])("fails closed for a %s condition policy", async kind => {
  const base = transport();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("get_item_condition_policies")) return json(kind === "empty" ? { itemConditionPolicies: [] } : {});
    return base(input, init);
  };
  await expect(new EbayMetadataClient(config, fetch).requirements("101")).rejects.toMatchObject({ code: "unavailable" });
});
