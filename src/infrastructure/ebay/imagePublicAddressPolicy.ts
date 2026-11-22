import { IMAGE_ADDRESS_POLICY_DATA } from "./imagePublicAddressPolicyData";
import { ADDRESS_POLICY_VERSION, inspectPolicyData, numericAddress, numericPrefix, within, type Family } from "./imageAddressPolicyFormat";

type Reason = "invalid-input" | "family-mismatch" | "policy-unavailable" | "invalid-time" | "before-acquisition" | "policy-stale" |
  "special-purpose" | "reserved" | "recognized-embedded" | "outside-coverage" | "covered-unicast";
export type ImageAddressClassification = Readonly<{
  classification: "public-candidate" | "blocked" | "unclassified";
  reason: Reason; policyVersion: typeof ADDRESS_POLICY_VERSION;
  address?: string; family?: Family;
}>;

function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
}
function compile() {
  try {
    const data = inspectPolicyData(IMAGE_ADDRESS_POLICY_DATA);
    freeze(data);
    return {
      validFrom: Date.parse(data.manifest.validFrom), reviewCutoff: Date.parse(data.manifest.reviewCutoff),
      rows: data.normalized.rows.map(row => ({ kind: row.kind, prefix: numericPrefix(row.prefix, row.family)! })),
    };
  } catch { return null; }
}
const policy = compile();
export const IMAGE_ADDRESS_POLICY = Object.freeze({
  policyVersion: ADDRESS_POLICY_VERSION,
  available: policy !== null,
  validFrom: policy?.validFrom ?? null,
  reviewCutoff: policy?.reviewCutoff ?? null,
});

/** Pure numeric classification, NOT a connection/ownership/HTTP permission. */
export function classifyImageAddress(value: unknown, family: unknown, evaluationTime: unknown): ImageAddressClassification {
  const address = numericAddress(value);
  const result = (classification: ImageAddressClassification["classification"], reason: Reason): ImageAddressClassification => Object.freeze({
    classification, reason, policyVersion: ADDRESS_POLICY_VERSION,
    ...(address ? { address: address.canonical, family: address.family } : {}),
  });
  if (!address) return result("unclassified", "invalid-input");
  if (family !== address.family) return result("unclassified", "family-mismatch");
  if (!policy) return result("unclassified", "policy-unavailable");
  if (typeof evaluationTime !== "number" || !Number.isSafeInteger(evaluationTime)) return result("unclassified", "invalid-time");
  if (evaluationTime < policy.validFrom) return result("unclassified", "before-acquisition");
  if (evaluationTime >= policy.reviewCutoff) return result("unclassified", "policy-stale");
  const matches = policy.rows.filter(row => within(address, row.prefix));
  if (matches.some(row => row.kind === "special")) return result("blocked", "special-purpose");
  if (address.embedded) return result("blocked", "recognized-embedded");
  if (matches.some(row => row.kind === "reserved")) return result("blocked", "reserved");
  if (matches.some(row => row.kind === "positive")) return result("public-candidate", "covered-unicast");
  return result("unclassified", "outside-coverage");
}
