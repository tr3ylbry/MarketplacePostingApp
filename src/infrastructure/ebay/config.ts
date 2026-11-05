import { createHash } from "node:crypto";
import { EBAY_SCOPES, EbayError, type EbayConfig } from "../../application/ebayConnection";
export type { EbayConfig } from "../../application/ebayConnection";
export const EBAY_ORIGIN = "https://127.0.0.1:3000";
export function ebayConfig(env: Record<string, string | undefined>): EbayConfig {
  if (env.VERCEL || env.EBAY_ENVIRONMENT !== "sandbox" || env.BETTER_AUTH_URL !== EBAY_ORIGIN || !env.EBAY_SANDBOX_CLIENT_ID || !env.EBAY_SANDBOX_CLIENT_SECRET || !/^[A-Za-z0-9_-]{10,200}$/.test(env.EBAY_SANDBOX_RUNAME ?? "")) throw new EbayError("config");
  const clientId = env.EBAY_SANDBOX_CLIENT_ID, ruName = env.EBAY_SANDBOX_RUNAME!;
  return { clientId, clientSecret: env.EBAY_SANDBOX_CLIENT_SECRET, ruName, origin: EBAY_ORIGIN,
    fingerprint: createHash("sha256").update(JSON.stringify(["sandbox", clientId, ruName, EBAY_ORIGIN, EBAY_SCOPES])).digest("hex") };
}
