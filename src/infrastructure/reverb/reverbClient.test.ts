// @vitest-environment node
import { vi, describe, it, expect } from "vitest";
import { ReverbClient, reverbEnvironment } from "./reverbClient";
import { ReverbProviderError, type ReverbPayload } from "../../application/reverbGateway";
const token = "fake-personal-token", uuid = "14d6cc96-ed7b-4521-bc21-7713c61e9dc5";
const remote = { id: 123, sku: "crosslist-test", state: { slug: "draft" } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const payload: ReverbPayload = { publish: false, sku: remote.sku, title: "Test guitar", make: "Fender", model: "Strat", description: "A clean guitar", categories: [{ uuid }], condition: { uuid }, photos: ["https://private.example/image?capability=fake"], price: { amount: "250.00", currency: "USD" } };
describe("Reverb HTTP boundary", () => {
  it.each(["sandbox", "live"] as const)("uses pinned %s host, headers and safe shop response", async env => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 1, name: "Shop", shipping_profiles: [{ id: 2, name: "US" }] }));
    expect(await new ReverbClient(env, request).shop(token)).toEqual({ id: "1", name: "Shop", shippingProfiles: [{ id: "2", name: "US" }] });
    const [url, init] = request.mock.calls[0]; expect(String(url)).toBe(env === "sandbox" ? "https://sandbox.reverb.com/api/shop" : "https://api.reverb.com/api/shop");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}`, "Accept-Version": "3.0", Accept: "application/hal+json", "Content-Type": "application/hal+json" });
    expect(init?.redirect).toBe("error"); expect(init?.signal).toBeDefined();
  });
  it("fetches provider categories and authenticated conditions", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ categories: [{ uuid, full_name: "Guitars / Electric", listable: true }, { uuid, full_name: "Hidden", listable: false }] })).mockResolvedValueOnce(response({ conditions: [{ uuid, display_name: "Good" }] }));
    const client = new ReverbClient("sandbox", request);
    expect(await client.categories(token)).toEqual([{ id: uuid, name: "Guitars / Electric" }]);
    expect(await client.conditions(token)).toEqual([{ id: uuid, name: "Good" }]);
  });
  it("accepts provider-observed legacy category GUIDs without relaxing other fields", async () => {
    const legacy = "12345678-abcd-0123-7123-123456789abc";
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ categories: [{ uuid: legacy, full_name: "Effects / Test", listable: true }] }));
    expect(await new ReverbClient("sandbox", request).categories(token)).toEqual([{ id: legacy, name: "Effects / Test" }]);
    for (const item of [{ uuid: "not-a-guid", full_name: "Test", listable: true }, { uuid: legacy, full_name: "", listable: true }, { uuid: legacy, full_name: "Test", listable: null }]) {
      request.mockResolvedValueOnce(response({ categories: [item] }));
      await expect(new ReverbClient("sandbox", request).categories(token)).rejects.toBeInstanceOf(ReverbProviderError);
    }
  });
  it("looks up exact SKU with state=all and refuses unsafe pagination", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ listings: [remote], _links: {} })).mockResolvedValueOnce(response({ listings: [], _links: { next: { href: "https://evil.test/api/my/listings" } } }));
    const client = new ReverbClient("sandbox", request); expect(await client.findBySku(token, remote.sku)).toEqual([{ id: "123", sku: remote.sku, state: "draft" }]);
    expect(String(request.mock.calls[0][0])).toContain("state=all");
    await expect(client.findBySku(token, remote.sku)).rejects.toBeInstanceOf(ReverbProviderError);
  });
  it("forces publish=false even if a runtime caller overrides it and omits hostile web links", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ listing: { ...remote, _links: { web: { href: "https://evil.test/token" } } } }, 201));
    const result = await new ReverbClient("sandbox", request).createDraft(token, { ...payload, publish: true } as unknown as ReverbPayload);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).publish).toBe(false); expect(result.url).toBeUndefined();
  });
  it.each([[400,"validation"],[401,"auth"],[403,"forbidden"],[404,"missing"],[409,"conflict"],[412,"validation"],[429,"rate"],[500,"unavailable"],[503,"unavailable"]])("maps HTTP %i without response/token leakage", async (status, code) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ message: token }, Number(status)));
    const error = await new ReverbClient("sandbox", request).shop(token).catch(e => e);
    expect(error.code).toBe(code); expect(JSON.stringify(error)).not.toContain(token); expect(error.message).not.toContain(token);
  });
  it("rejects malformed, credential-echoing and timeout responses safely", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ unexpected: true })).mockResolvedValueOnce(response({ id: 1, name: token })).mockRejectedValueOnce(new DOMException(token, "TimeoutError"));
    const client = new ReverbClient("sandbox", request);
    for (let i = 0; i < 3; i++) await expect(client.shop(token)).rejects.toBeInstanceOf(ReverbProviderError);
  });
  it("defaults to sandbox and rejects arbitrary environment values", () => {
    vi.stubEnv("REVERB_ENVIRONMENT", undefined); expect(reverbEnvironment()).toBe("sandbox");
    vi.stubEnv("REVERB_ENVIRONMENT", "https://evil.test"); expect(() => reverbEnvironment()).toThrow(); vi.unstubAllEnvs();
  });
});
