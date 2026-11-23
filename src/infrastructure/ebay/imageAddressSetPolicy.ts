import { classifyImageAddress, IMAGE_ADDRESS_POLICY } from "./imagePublicAddressPolicy";
import { IMAGE_ADDRESS_POLICY_DATA } from "./imagePublicAddressPolicyData";
export type ImageAddressCandidate = Readonly<{ address: string; family: 4 | 6 }>;
export type ImageAddressSetDecision = Readonly<{
  candidate: ImageAddressCandidate | null;
  reason: "candidate" | "invalid-set" | "member-refused";
  policyVersion: string; dataHash: string; networkAuthorized: false;
}>;
/** Pure reported-set policy. Neither DNS provenance nor network permission. */
export function inspectImageAddressSet(input: unknown, at: unknown): ImageAddressSetDecision {
  const result = (candidate: ImageAddressCandidate | null, reason: ImageAddressSetDecision["reason"]): ImageAddressSetDecision => Object.freeze({
    candidate, reason, policyVersion: IMAGE_ADDRESS_POLICY.policyVersion,
    dataHash: IMAGE_ADDRESS_POLICY_DATA.manifest.normalizedSha256, networkAuthorized: false,
  });
  try {
  if (!Array.isArray(input) || input.length < 1 || input.length > 16) return result(null, "invalid-set");
  let first: ImageAddressCandidate | null = null, refused = false;
  for (let i = 0; i < input.length; i++) {
    const slot = Object.getOwnPropertyDescriptor(input, i);
    const item = slot && "value" in slot ? slot.value : null;
    if (!item || typeof item !== "object" || Reflect.ownKeys(item).length !== 2) { refused = true; continue; }
    const a = Object.getOwnPropertyDescriptor(item, "address"), f = Object.getOwnPropertyDescriptor(item, "family");
    if (!a || !f || !("value" in a) || !("value" in f) || typeof a.value !== "string" || a.value.length > 45 || ![4, 6].includes(f.value)) { refused = true; continue; }
    const verdict = classifyImageAddress(a.value, f.value, at);
    if (verdict.classification !== "public-candidate" || !verdict.address || !verdict.family) refused = true;
    else first ??= Object.freeze({ address: verdict.address, family: verdict.family });
  }
  return refused || !first ? result(null, "member-refused") : result(first, "candidate");
  } catch { return result(null, "invalid-set"); }
}
