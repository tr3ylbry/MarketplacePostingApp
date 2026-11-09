import { EbayReadinessClient } from "../../infrastructure/ebay/ebayReadinessClient";
export function ebayReadinessGateway() {
  const database = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (process.env.MARKETPLACE_TEST_BUILD !== "1" || process.env.VERCEL || !["127.0.0.1", "localhost"].includes(database.hostname) || !database.pathname.endsWith("_test") || !process.env.TEST_EBAY_SECRET) throw new Error("Isolated eBay readiness tests required.");
  return new EbayReadinessClient(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.sandbox.ebay.com" || init?.method !== "GET" || ![
      "/sell/account/v1/privilege", "/sell/account/v1/program/get_opted_in_programs", "/sell/account/v1/fulfillment_policy",
      "/sell/account/v1/payment_policy", "/sell/account/v1/return_policy", "/sell/inventory/v1/location",
    ].includes(url.pathname)) throw new Error("Unexpected readiness test endpoint.");
    const headers = new Headers(init.headers); headers.set("x-test-secret", process.env.TEST_EBAY_SECRET!);
    return fetch("http://127.0.0.1:4313" + url.pathname + url.search, { ...init, headers });
  });
}
