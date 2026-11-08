export const EBAY_SCOPES = ["https://api.ebay.com/oauth/api_scope"] as const;
export interface EbayConfig { clientId: string; clientSecret: string; ruName: string; origin: string; fingerprint: string }
// Stage 9A requests only the base scope for authenticated Trading GetUser.
// Inventory/account/identity permissions require a later reviewed scope expansion.
export interface EbayIdentity { sellerId: string; label: string; source: "trading-get-user" }
export interface EbayTokens {
  accessToken: string; expiresIn: number; refreshToken?: string; refreshExpiresIn?: number; scopes?: string[];
}
export interface EbayGateway {
  exchange(code: string): Promise<EbayTokens>;
  refresh(refreshToken: string): Promise<EbayTokens>;
  identity(accessToken: string): Promise<EbayIdentity>;
}
export type EbayErrorCode = "state" | "auth" | "identity" | "conflict" | "scopes" | "unavailable" | "config";
const messages: Record<EbayErrorCode, string> = {
  state: "Authorization expired or could not be verified. Start again from eBay settings.",
  auth: "eBay authorization requires reconnection.",
  identity: "The authenticated Sandbox seller identity could not be verified.",
  conflict: "The connection changed or another operation is running. Reload before trying again.",
  scopes: "eBay did not grant the required permissions. Reconnect your account.",
  unavailable: "eBay is temporarily unavailable. Please try again later.",
  config: "Ask the operator to configure local HTTPS and the eBay Sandbox integration.",
};
export class EbayError extends Error {
  constructor(readonly code: EbayErrorCode) { super(messages[code]); }
}
export const safeEbayError = (error: unknown) => error instanceof EbayError ? error.message : "The eBay operation could not be completed.";
export interface TokenEnvelope { ciphertext: string; iv: string; tag: string; keyVersion: 1 }
export interface EbayConnection {
  ownerId: string; environment: string; id: string; version: string; configHash: string;
  status: string; sellerId: string | null; sellerLabel: string | null;
  access: TokenEnvelope | null; refresh: TokenEnvelope | null;
  accessExpiresAt: string | null; refreshExpiresAt: string | null; scopes: string[];
  connectedAt: string | null; leaseToken: string | null; leaseUntil: string | null;
}
export interface EbayState {
  hash: string; ownerId: string; sessionHash: string; configHash: string; connectionVersion: string; expiresAt: string;
}
export type ConnectedValues = Pick<EbayConnection, "sellerId" | "sellerLabel" | "access" | "refresh" | "accessExpiresAt" | "refreshExpiresAt" | "scopes">;
export interface EbayConnectionRepository {
  connection(owner: string): Promise<EbayConnection | null>;
  begin(owner: string, sessionHash: string, configHash: string, stateHash: string, now: string, expires: string): Promise<void>;
  consume(owner: string, sessionHash: string, configHash: string, stateHash: string, now: string): Promise<EbayConnection>;
  connect(owner: string, version: string, values: ConnectedValues, now: string): Promise<void>;
  disconnect(owner: string): Promise<void>;
  claim(owner: string, version: string, token: string, now: string, until: string): Promise<EbayConnection>;
  finish(owner: string, version: string, lease: string, values: ConnectedValues, now: string): Promise<void>;
  invalidate(owner: string, version: string, status: "reconnect" | "identity-unverified", lease?: string): Promise<void>;
}
