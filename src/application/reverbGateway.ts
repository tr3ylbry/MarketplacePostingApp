export type ReverbEnvironment = "sandbox" | "live";
export interface ReverbOption { id: string; name: string }
export interface ReverbShop extends ReverbOption { shippingProfiles: ReverbOption[] }
export interface ReverbRemoteListing { id: string; sku: string; state: string; url?: string }
export interface ReverbPayload {
  publish: false; sku: string; title: string; make: string; model: string;
  description: string; year?: string; finish?: string;
  categories: { uuid: string }[]; condition: { uuid: string };
  price: { amount: string; currency: "USD" }; photos: string[];
  shipping_profile_id?: string;
  shipping?: { rates: { rate: { amount: string; currency: "USD" }; region_code: "US_CON" }[] };
}
export interface ReverbGateway {
  shop(token: string): Promise<ReverbShop>;
  categories(token: string): Promise<ReverbOption[]>;
  conditions(token: string): Promise<ReverbOption[]>;
  findBySku(token: string, sku: string): Promise<ReverbRemoteListing[]>;
  createDraft(token: string, payload: ReverbPayload): Promise<ReverbRemoteListing>;
  deleteDraft(token: string, id: string): Promise<void>;
}
export type ReverbErrorCode = "auth" | "forbidden" | "validation" | "missing" | "conflict" | "rate" | "unavailable" | "malformed";
const messages: Record<ReverbErrorCode, string> = {
  auth: "Reverb requires a replacement token. Reconnect your account.",
  forbidden: "Reverb denied this operation. Check token scopes and shop setup.",
  validation: "Reverb rejected the draft. Check the listing and complete your shop setup on Reverb.",
  missing: "The Reverb resource is unavailable.", conflict: "Reverb reported a conflict. Reconcile before retrying.",
  rate: "Reverb is rate limiting requests. Wait before trying again.",
  unavailable: "Reverb is temporarily unavailable. Reconcile before retrying a draft.",
  malformed: "Reverb returned an unexpected response. Reconcile before retrying a draft.",
};
export class ReverbProviderError extends Error {
  constructor(public readonly code: ReverbErrorCode) { super(messages[code]); }
}
export class ReverbDraftError extends Error {}
