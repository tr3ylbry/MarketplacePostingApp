export const EBAY_SCOPES = ["https://api.ebay.com/oauth/api_scope"] as const;
export const EBAY_READINESS_SCOPES = [...EBAY_SCOPES,
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
] as const;
export type EbayAuthorizationProfile = "identity" | "readiness";
export const ebayScopesFor = (profile: EbayAuthorizationProfile): readonly string[] => profile === "readiness" ? EBAY_READINESS_SCOPES : EBAY_SCOPES;
export function sameEbayScopes(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every(s => actual.includes(s));
}
export const hasEbayReadinessScopes = (scopes: readonly string[]) => sameEbayScopes(scopes, EBAY_READINESS_SCOPES);
export const validEbayScopes = (scopes: readonly string[]) => sameEbayScopes(scopes, EBAY_SCOPES) || hasEbayReadinessScopes(scopes);
export interface EbayConfig { clientId: string; clientSecret: string; ruName: string; origin: string; fingerprint: string }
// The base identity grant remains unchanged. Seller checks require a separate,
// explicit read-only authorization profile; neither profile permits resource writes.
export interface EbayIdentity { sellerId: string; label: string; source: "trading-get-user" }
export interface EbayTokens {
  accessToken: string; expiresIn: number; refreshToken?: string; refreshExpiresIn?: number; scopes?: string[];
}
export interface EbayGateway {
  exchange(code: string): Promise<EbayTokens>;
  refresh(refreshToken: string): Promise<EbayTokens>;
  identity(accessToken: string): Promise<EbayIdentity>;
}
export type EbayErrorCode = "state" | "auth" | "identity" | "conflict" | "scopes" | "permissions" | "unavailable" | "config";
const messages: Record<EbayErrorCode, string> = {
  state: "Authorization expired or could not be verified. Start again from eBay settings.",
  auth: "eBay authorization requires reconnection.",
  identity: "The authenticated Sandbox seller identity could not be verified.",
  conflict: "The connection changed or another operation is running. Reload before trying again.",
  scopes: "eBay did not grant the required permissions. Reconnect your account.",
  permissions: "Authorize the additional read-only seller permissions in eBay connection settings first. Your existing connection is preserved.",
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
  requestedScopes: string[];
}
export type ConnectedValues = Pick<EbayConnection, "sellerId" | "sellerLabel" | "access" | "refresh" | "accessExpiresAt" | "refreshExpiresAt" | "scopes">;
export interface EbayConnectionRepository {
  connection(owner: string): Promise<EbayConnection | null>;
  begin(owner: string, sessionHash: string, configHash: string, stateHash: string, now: string, expires: string, requestedScopes?: readonly string[]): Promise<void>;
  consume(owner: string, sessionHash: string, configHash: string, stateHash: string, now: string): Promise<EbayConnection & { requestedScopes: string[] }>;
  connect(owner: string, version: string, values: ConnectedValues, now: string): Promise<void>;
  disconnect(owner: string): Promise<void>;
  claim(owner: string, version: string, token: string, now: string, until: string): Promise<EbayConnection>;
  finish(owner: string, version: string, lease: string, values: ConnectedValues, now: string): Promise<EbayConnection>;
  invalidate(owner: string, version: string, status: "reconnect" | "identity-unverified", lease?: string): Promise<void>;
}
