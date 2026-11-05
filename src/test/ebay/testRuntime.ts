import { EbayClient } from "../../infrastructure/ebay/ebayClient";
import type { EbayConfig } from "../../infrastructure/ebay/config";
export function ebayRuntime() {
  const db = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (process.env.MARKETPLACE_TEST_BUILD !== "1" || process.env.VERCEL || !["localhost","127.0.0.1"].includes(db.hostname) || !db.pathname.endsWith("_test") || !process.env.TEST_EBAY_SECRET) throw new Error("Isolated eBay test configuration required.");
  const config: EbayConfig = { clientId: "fake-client", clientSecret: "fake-secret", ruName: "fake-sandbox-runame", origin: "http://127.0.0.1:3100", fingerprint: "fake-ebay-test-config" };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.sandbox.ebay.com" || !["/identity/v1/oauth2/token","/ws/api.dll"].includes(url.pathname)) throw new Error("Unexpected test endpoint.");
    const headers = new Headers(init?.headers); headers.set("x-test-secret",process.env.TEST_EBAY_SECRET!);
    return fetch("http://127.0.0.1:4313"+url.pathname,{...init,headers});
  };
  return { config, gateway: new EbayClient(config, transport) };
}
