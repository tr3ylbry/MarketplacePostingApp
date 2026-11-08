import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { EbayError, type EbayGateway, type EbayIdentity, type EbayTokens } from "../../application/ebayConnection";
import type { EbayConfig } from "./config";
const secret = z.string().min(1).max(16000).refine(s => !/[\r\n\0]/.test(s));
const tokenSchema = z.object({ access_token: secret, expires_in: z.number().int().positive().max(86400), token_type: z.enum(["User Access Token", "Bearer", "bearer"]), refresh_token: secret.optional(), refresh_token_expires_in: z.number().int().positive().max(63072000).optional(), scope: z.string().max(4000).optional() });
const identitySchema = z.object({ GetUserResponse: z.object({ "@_xmlns": z.literal("urn:ebay:apis:eBLBaseComponents"), Ack: z.enum(["Success", "Warning"]), User: z.object({ EIASToken: z.string().min(16).max(2048).refine(s => !/[\s*<>]/.test(s) && !/mock|placeholder|redacted/i.test(s)), UserID: z.string().trim().min(1).max(100).refine(s => !/[<>*]/.test(s) && ![...s].some(c => c.charCodeAt(0) < 32)) }) }) });
export function parseTradingIdentity(body: string): EbayIdentity {
  try {
    if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) throw new Error();
    const parsed: unknown = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true, processEntities: false }).parse(body);
    const { User } = identitySchema.parse(parsed).GetUserResponse;
    // EIASToken is a stable user identifier, not an OAuth credential. Minimize it
    // to a provider/source-namespaced hash; never store the full profile response.
    return { sellerId: createHash("sha256").update("ebay-sandbox-eias-v1\0" + User.EIASToken).digest("hex"), label: User.UserID, source: "trading-get-user" };
  } catch { throw new EbayError("identity"); }
}
export class EbayClient implements EbayGateway {
  constructor(private readonly config: EbayConfig, private readonly transport: typeof fetch = fetch) {}
  private async request(path: "/identity/v1/oauth2/token" | "/ws/api.dll", headers: Record<string, string>, body: string) {
    try {
      const response = await this.transport("https://api.sandbox.ebay.com" + path, { method: "POST", headers, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
      const reader = response.body?.getReader(); if (!reader) throw new EbayError("unavailable");
      const parts: Uint8Array[] = []; let size = 0;
      try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > 65536) throw new EbayError("unavailable"); parts.push(r.value); } }
      finally { await reader.cancel().catch(() => undefined); }
      const text = Buffer.concat(parts).toString("utf8");
      if (!response.ok) {
        if ([400,401,403].includes(response.status)) {
          // Never include provider descriptions or raw bodies in errors.
          let reason: unknown; try { reason = (JSON.parse(text) as { error?: unknown }).error; } catch { /* Safe generic error below. */ }
          throw new EbayError(reason === "invalid_grant" || response.status === 401 ? "auth" : "unavailable");
        }
        throw new EbayError("unavailable");
      }
      return { text, contentType: response.headers.get("content-type") ?? "" };
    } catch (error) { if (error instanceof EbayError) throw error; throw new EbayError("unavailable"); }
  }
  private async token(body: URLSearchParams): Promise<EbayTokens> {
    const response = await this.request("/identity/v1/oauth2/token", { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: "Basic " + Buffer.from(this.config.clientId + ":" + this.config.clientSecret).toString("base64") }, body.toString());
    try {
      if (!/^application\/json\b/i.test(response.contentType)) throw new Error();
      const token = tokenSchema.parse(JSON.parse(response.text));
      if (token.refresh_token && !token.refresh_token_expires_in) throw new Error();
      return { accessToken: token.access_token, expiresIn: token.expires_in, refreshToken: token.refresh_token, refreshExpiresIn: token.refresh_token_expires_in, scopes: token.scope?.split(/\s+/).filter(Boolean) };
    } catch { throw new EbayError("auth"); }
  }
  exchange(code: string) { return this.token(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.config.ruName })); }
  refresh(refreshToken: string) { return this.token(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })); }
  async identity(accessToken: string) {
    // Commerce Identity explicitly returns mocks in Sandbox. Do not use it as
    // identity proof. GetUser without UserID resolves the token's own account.
    const response = await this.request("/ws/api.dll", { "Content-Type": "text/xml", "X-EBAY-API-CALL-NAME": "GetUser", "X-EBAY-API-SITEID": "0", "X-EBAY-API-COMPATIBILITY-LEVEL": "1489", "X-EBAY-API-IAF-TOKEN": accessToken }, '<?xml version="1.0" encoding="utf-8"?><GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents"><OutputSelector>User.EIASToken</OutputSelector><OutputSelector>User.UserID</OutputSelector></GetUserRequest>');
    if (!/^(text|application)\/xml\b/i.test(response.contentType)) throw new EbayError("identity");
    return parseTradingIdentity(response.text);
  }
}
export function ebayGateway(config: EbayConfig): EbayGateway { return new EbayClient(config); }
