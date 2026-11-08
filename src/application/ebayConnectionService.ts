import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ownerIdSchema } from "./owner";
import { EBAY_SCOPES, EbayError, type EbayConfig, type EbayConnection, type EbayConnectionRepository, type EbayGateway, type EbayTokens, type TokenEnvelope } from "./ebayConnection";
interface Cipher { encrypt(value: string, aad: string): TokenEnvelope; decrypt(value: TokenEnvelope, aad: string): string }
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const stateValue = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const add = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000).toISOString();
const aad = (row: EbayConnection, kind: "access" | "refresh", seller: string) => JSON.stringify(["ebay-oauth-v1", kind, row.ownerId, "sandbox", row.id, row.configHash, seller]);
export function createEbayConnectionService(repo: EbayConnectionRepository, gateway: EbayGateway, cipher: Cipher, config: EbayConfig, clock = () => new Date()) {
  const scopes = (tokens: EbayTokens, previous: string[] = [...EBAY_SCOPES]) => {
    const granted = tokens.scopes ?? previous;
    if (!EBAY_SCOPES.every(s => granted.includes(s)) || granted.some(s => !(EBAY_SCOPES as readonly string[]).includes(s))) throw new EbayError("scopes");
    return granted;
  };
  const status = async (owner: string) => {
    ownerIdSchema.parse(owner); const row = await repo.connection(owner); const now = clock().toISOString();
    const state = !row || row.status === "disconnected" ? "not-connected" : row.configHash !== config.fingerprint ? "reconnect" : row.status !== "connected" ? row.status : !row.refreshExpiresAt || row.refreshExpiresAt <= now ? "reconnect" : !row.accessExpiresAt || row.accessExpiresAt <= now ? "expired" : "connected";
    return { environment: "sandbox" as const, state, sellerLabel: state === "not-connected" ? null : row?.sellerLabel ?? null, scopes: row?.scopes ?? [], connectedAt: row?.connectedAt ?? null };
  };
  return {
    status,
    async begin(owner: string, sessionId: string) {
      ownerIdSchema.parse(owner); if (!sessionId) throw new EbayError("state");
      const state = randomBytes(32).toString("base64url"), now = clock();
      await repo.begin(owner, hash(sessionId), config.fingerprint, hash(state), now.toISOString(), add(now, 600));
      const url = new URL("https://auth.sandbox.ebay.com/oauth2/authorize");
      url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.ruName, scope: EBAY_SCOPES.join(" "), state }).toString();
      return url.toString();
    },
    async complete(owner: string, sessionId: string, rawState: unknown, code: unknown, denied = false) {
      ownerIdSchema.parse(owner); if (!sessionId || !stateValue.safeParse(rawState).success) throw new EbayError("state");
      const row = await repo.consume(owner, hash(sessionId), config.fingerprint, hash(rawState as string), clock().toISOString());
      if (denied) return "denied" as const;
      if (!z.string().min(1).max(16000).refine(s => !/[\r\n\0]/.test(s)).safeParse(code).success) throw new EbayError("state");
      const issuedAt = clock();
      const tokens = await gateway.exchange(code as string), granted = scopes(tokens);
      if (!tokens.refreshToken || !tokens.refreshExpiresIn) throw new EbayError("auth");
      let identity;
      try { identity = await gateway.identity(tokens.accessToken); }
      catch { await repo.invalidate(owner, row.version, "identity-unverified"); throw new EbayError("identity"); }
      if (identity.source !== "trading-get-user" || !/^[a-f0-9]{64}$/.test(identity.sellerId) || !identity.label || (row.sellerId && row.sellerId !== identity.sellerId)) throw new EbayError("identity");
      const now = clock();
      await repo.connect(owner, row.version, { sellerId: identity.sellerId, sellerLabel: identity.label,
        access: cipher.encrypt(tokens.accessToken, aad(row, "access", identity.sellerId)), refresh: cipher.encrypt(tokens.refreshToken, aad(row, "refresh", identity.sellerId)),
        accessExpiresAt: add(issuedAt, tokens.expiresIn), refreshExpiresAt: add(issuedAt, tokens.refreshExpiresIn), scopes: granted }, now.toISOString());
      return "connected" as const;
    },
    async accessToken(owner: string): Promise<string> {
      ownerIdSchema.parse(owner); const row = await repo.connection(owner), now = clock();
      if (!row || row.status !== "connected" || row.configHash !== config.fingerprint || !row.sellerId || !row.access || !row.refresh || !row.refreshExpiresAt || row.refreshExpiresAt <= now.toISOString()) throw new EbayError("auth");
      if (row.accessExpiresAt && row.accessExpiresAt > add(now, 60)) {
        try { return cipher.decrypt(row.access, aad(row, "access", row.sellerId)); }
        catch { await repo.invalidate(owner, row.version, "reconnect"); throw new EbayError("auth"); }
      }
      const lease = randomUUID(); await repo.claim(owner, row.version, lease, now.toISOString(), add(now, 90));
      try {
        const tokens = await gateway.refresh(cipher.decrypt(row.refresh, aad(row, "refresh", row.sellerId))), granted = scopes(tokens, row.scopes);
        const identity = await gateway.identity(tokens.accessToken);
        if (identity.source !== "trading-get-user" || identity.sellerId !== row.sellerId) throw new EbayError("identity");
        const done = clock();
        await repo.finish(owner, row.version, lease, { sellerId: row.sellerId, sellerLabel: identity.label,
          access: cipher.encrypt(tokens.accessToken, aad(row, "access", row.sellerId)),
          refresh: tokens.refreshToken ? cipher.encrypt(tokens.refreshToken, aad(row, "refresh", row.sellerId)) : row.refresh,
          accessExpiresAt: add(now, tokens.expiresIn), refreshExpiresAt: tokens.refreshToken && tokens.refreshExpiresIn ? add(now, tokens.refreshExpiresIn) : row.refreshExpiresAt, scopes: granted }, done.toISOString());
        return tokens.accessToken;
      } catch (error) {
        // A lost refresh response may have rotated the credential. Reconnect
        // conservatively instead of blindly retrying a possibly spent token.
        await repo.invalidate(owner, row.version, error instanceof EbayError && error.code === "identity" ? "identity-unverified" : "reconnect", lease); throw error;
      }
    },
    async disconnect(owner: string) { ownerIdSchema.parse(owner); await repo.disconnect(owner); },
  };
}
