import { randomBytes } from "node:crypto";
import { EbayClient, parseTradingIdentity } from "./ebayClient";
import { EbayTokenCipher } from "./tokenCipher";
import { ebayConfig } from "./config";
import { EBAY_SCOPES } from "../../application/ebayConnection";
const config = { clientId: "fake-client", clientSecret: "fake-secret", ruName: "fake-sandbox-runame", origin: "https://127.0.0.1:3000", fingerprint: "fake-config" };
const tokens = { access_token: "fake-access", token_type: "User Access Token", expires_in: 7200, refresh_token: "fake-refresh", refresh_token_expires_in: 47304000 };
const xml = (eias = "opaque-stable-seller-identity-a", name = "TESTUSER_SellerA") => `<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><EIASToken>${eias}</EIASToken><UserID>${name}</UserID><Email>discard@example.test</Email></User></GetUserResponse>`;
it("pins Sandbox hosts, posts the exact RuName, and uses bounded nonredirecting token requests", async () => {
  const request = vi.fn(async () => Response.json(tokens)); const client = new EbayClient(config, request);
  expect(await client.exchange("fake-code")).toMatchObject({ accessToken: "fake-access", refreshToken: "fake-refresh" });
  const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
  expect(new URLSearchParams(options.body as string).get("redirect_uri")).toBe(config.ruName);
  expect(options).toMatchObject({ redirect: "error", cache: "no-store" }); expect(options.signal).toBeDefined();
});
it("preserves the meaning of an omitted refresh replacement and scopes", async () => {
  const client = new EbayClient(config, async () => Response.json({ access_token: "renewed", expires_in: 7200, token_type: "User Access Token" }));
  expect(await client.refresh("old-refresh")).toMatchObject({ accessToken: "renewed", refreshToken: undefined, scopes: undefined });
});
it("accepts independently expiring rotated refresh tokens", async () => {
  const client = new EbayClient(config, async () => Response.json({ ...tokens, refresh_token: "rotated", scope: EBAY_SCOPES.join(" ") }));
  expect(await client.refresh("old")).toMatchObject({ refreshToken: "rotated", scopes: [...EBAY_SCOPES] });
});
it.each([400,401,403,429,500,503])("maps HTTP %i without raw errors or credential disclosure", async status => {
  const client = new EbayClient(config, async () => Response.json({ error: "invalid_grant", error_description: "private-token-or-profile" }, { status }));
  await expect(client.exchange("private-code")).rejects.toThrow(/eBay/);
  try { await client.exchange("private-code"); } catch (error) { expect(String(error)).not.toMatch(/private-|fake-secret/); }
});
it.each([{}, { ...tokens, expires_in: -1 }, { ...tokens, refresh_token_expires_in: undefined }, { ...tokens, token_type: "unexpected" }])("fails closed on malformed token responses", async body => {
  await expect(new EbayClient(config, async () => Response.json(body)).exchange("code")).rejects.toThrow();
});
it("rejects oversized, non-JSON, redirect and timeout responses safely", async () => {
  for (const transport of [async () => new Response("x".repeat(70000)), async () => new Response("not-json", {headers:{"content-type":"application/json"}}), async () => { throw new DOMException("private-url", "TimeoutError"); }]) {
    await expect(new EbayClient(config, transport).exchange("code")).rejects.toThrow(/eBay/);
  }
});
it("extracts only authenticated stable GetUser identity and discards profile PII", async () => {
  const first = parseTradingIdentity(xml()), renamed = parseTradingIdentity(xml(undefined, "TESTUSER_Renamed"));
  expect(first.sellerId).toBe(renamed.sellerId); expect(first.sellerId).not.toBe(parseTradingIdentity(xml("different-stable-identity-b")).sellerId);
  expect(JSON.stringify(first)).not.toContain("discard@example.test"); expect(first.source).toBe("trading-get-user");
  const request = vi.fn(async () => new Response(xml(), { headers: { "content-type": "text/xml" } }));
  await new EbayClient(config, request).identity("private-access");
  const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.sandbox.ebay.com/ws/api.dll");
  expect(options.headers).toMatchObject({"X-EBAY-API-CALL-NAME":"GetUser","X-EBAY-API-IAF-TOKEN":"private-access"});
  expect(options.body).not.toMatch(/<UserID>|RequesterCredentials|AddItem/);
});
it.each([xml("mock-static-identity"), xml("masked*************"), xml().replace("Success","Failure"), xml().replace('urn:ebay:apis:eBLBaseComponents','wrong-namespace'), xml().replace(/<EIASToken>.*?<\/EIASToken>/,''), '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml(), '{"userId":"mock-identity"}', '<GetUserResponse>'])('rejects untrusted/mocked/unsafe identity structure', body => {
  expect(() => parseTradingIdentity(body)).toThrow("identity could not be verified");
});
it("encrypts each token with independent nonces and rejects swapping/tampering/key mismatch", () => {
  const cipher = new EbayTokenCipher(randomBytes(32).toString("hex")); const a=cipher.encrypt("access","owner-a/access"), b=cipher.encrypt("refresh","owner-a/refresh");
  expect(a.iv).not.toBe(b.iv); expect(JSON.stringify(a)).not.toContain("access");
  expect(cipher.decrypt(a,"owner-a/access")).toBe("access");
  for (const aad of ["owner-b/access","owner-a/refresh","live/access"]) expect(()=>cipher.decrypt(a,aad)).toThrow();
  expect(()=>cipher.decrypt({...a,tag:"00".repeat(16)},"owner-a/access")).toThrow();
  expect(()=>new EbayTokenCipher(randomBytes(32).toString("hex")).decrypt(a,"owner-a/access")).toThrow();
});
it("rejects production, public origins, nonregistered HTTP origins and missing Sandbox configuration", () => {
  const env={ EBAY_ENVIRONMENT:"sandbox", EBAY_SANDBOX_CLIENT_ID:"client", EBAY_SANDBOX_CLIENT_SECRET:"secret", EBAY_SANDBOX_RUNAME:"existing-sandbox-runame", BETTER_AUTH_URL:config.origin };
  expect(ebayConfig(env).origin).toBe(config.origin);
  for(const patch of [{EBAY_ENVIRONMENT:"production"},{VERCEL:"1"},{BETTER_AUTH_URL:"http://127.0.0.1:3000"},{BETTER_AUTH_URL:"https://localhost:3000"},{EBAY_SANDBOX_RUNAME:"https://127.0.0.1:3000/callback"},{EBAY_SANDBOX_CLIENT_SECRET:""}]) expect(()=>ebayConfig({...env,...patch})).toThrow();
});
