import { isIP } from "node:net";

// Positive coverage, NOT a short production denylist or a registry snapshot.
// These are invented test verdicts for example numeric addresses; no lookup.
export const MODEL_ADDRESS_POLICY = Object.freeze({
  version: "synthetic-positive-catalog-v1",
  source: "hand-authored offline test catalog; no IANA registry snapshot imported",
  coverage: "exact canonical fixture addresses only; all others unsupported/blocked",
});
const modeledPublic = new Set(["1.1.1.1", "8.8.8.8", "2001:4860:4860::8888"]);
export interface ModelAddress { address: string; family: 4 | 6 }
export function canonicalModelAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 45) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6 || value.includes("%")) return null;
  try { return new URL("https://[" + value + "]/").hostname.slice(1, -1); } catch { return null; }
}
export function selectModeledAddress(answers: readonly ModelAddress[]): string | null {
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > 16) return null;
  // Evaluate EVERY answer before selection, including mixed A/AAAA answers.
  const checked = answers.map(answer => {
    const address = canonicalModelAddress(answer?.address);
    return address && isIP(answer.address) === answer.family && modeledPublic.has(address) ? address : null;
  });
  return checked.every(a => a !== null) ? checked[0] : null;
}
