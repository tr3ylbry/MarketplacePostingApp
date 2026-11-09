export type EbayPolicyKind = "fulfillment" | "payment" | "return";
export interface EbayPolicyCandidate {
  id: string;
  name: string;
  categoryTypes: ("ALL_EXCLUDING_MOTORS_VEHICLES" | "MOTORS_VEHICLES")[];
}
export interface EbayLocationCandidate {
  key: string;
  name: string | null;
  enabled: boolean;
  warehouse: boolean;
  addressComplete: boolean;
}
export interface EbaySellerReadiness {
  registrationComplete: boolean;
  zeroMonthlyQuantityLimit: boolean;
  businessPoliciesEnrolled: boolean;
  policies: Record<EbayPolicyKind, EbayPolicyCandidate[]>;
  locations: EbayLocationCandidate[];
}
// GETs only. A readiness result is never a capability to stage or publish.
export interface EbayReadinessGateway { inspect(accessToken: string): Promise<EbaySellerReadiness> }
export class EbayReadinessError extends Error {
  constructor(readonly code: "authorization" | "forbidden" | "rate-limit" | "malformed" | "unavailable" | "stale") {
    super({
      authorization: "eBay rejected this authorization. Reconnect in eBay connection settings.",
      forbidden: "eBay did not allow these seller reads. Check seller access and granted read-only permissions; no account setting was changed.",
      "rate-limit": "eBay limited seller checks. Wait before checking again.",
      malformed: "The complete eBay readiness response could not be verified. No readiness result was accepted.",
      unavailable: "eBay seller checks are temporarily unavailable. Try again later.",
      stale: "The listing or eBay connection changed. Reload before checking again.",
    }[code]);
  }
}
