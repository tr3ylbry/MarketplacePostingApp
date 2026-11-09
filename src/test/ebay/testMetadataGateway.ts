import type { EbayConfig } from "../../infrastructure/ebay/config";
import { EbayMetadataClient } from "../../infrastructure/ebay/ebayMetadataClient";

let client: EbayMetadataClient | undefined;
export function ebayMetadataGateway(config: EbayConfig) {
  const database = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (process.env.MARKETPLACE_TEST_BUILD !== "1" || process.env.VERCEL || !["127.0.0.1", "localhost"].includes(database.hostname) || !database.pathname.endsWith("_test") || !process.env.TEST_EBAY_SECRET) throw new Error("Isolated eBay metadata tests required.");
  client ??= new EbayMetadataClient(config, async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.sandbox.ebay.com" || !(url.pathname === "/identity/v1/oauth2/token" || url.pathname.startsWith("/commerce/taxonomy/v1/") || url.pathname === "/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies")) throw new Error("Unexpected metadata test endpoint.");
    const headers = new Headers(init?.headers); headers.set("x-test-secret", process.env.TEST_EBAY_SECRET!);
    return fetch("http://127.0.0.1:4313" + url.pathname + url.search, { ...init, headers });
  });
  return client;
}
