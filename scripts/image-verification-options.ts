import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";

export interface VerificationPins {
  head: string; database: string; listing: string; image: string; listingVersion: string;
  seller: string; connectionVersion: string; sourceDigest: string; derivativeDigest: string;
}
export type VerificationOptions =
  | { mode: "help" }
  | { mode: "rehearse-input" }
  | { mode: "fixture"; output: string }
  | { mode: "cleanup-fixture"; pins: VerificationPins }
  | { mode: "approve-one-post-one-get"; pins: VerificationPins; comparisonRecipe: string };

export function imageVerificationOptions(args: string[]): VerificationOptions {
  const { values: v } = parseArgs({ args, options: {
    help: { type: "boolean" }, "rehearse-input": { type: "boolean" }, fixture: { type: "string" },
    "approve-one-post-one-get": { type: "boolean" }, "cleanup-fixture": { type: "boolean" },
    "reviewed-head": { type: "string" }, database: { type: "string" }, listing: { type: "string" }, image: { type: "string" },
    "listing-version": { type: "string" }, "seller-key": { type: "string" }, "connection-version": { type: "string" },
    "source-digest": { type: "string" }, "derivative-digest": { type: "string" }, "comparison-recipe": { type: "string" },
  } });
  const modes = ["help", "rehearse-input", "fixture", "approve-one-post-one-get", "cleanup-fixture"] as const;
  const chosen = modes.filter(k => v[k]);
  if (chosen.length !== 1) throw Error("Choose one explicit mode.");
  const mode = chosen[0], operational = mode === "approve-one-post-one-get" || mode === "cleanup-fixture";
  const keys = ["reviewed-head", "database", "listing", "image", "listing-version", "seller-key", "connection-version", "source-digest", "derivative-digest"] as const;
  const allowed = new Set([mode, ...(operational ? keys : []), ...(mode === "approve-one-post-one-get" ? ["comparison-recipe"] : [])]);
  if (Object.keys(v).some(k => !allowed.has(k))) throw Error("Conflicting options.");
  if (mode === "help" || mode === "rehearse-input") return { mode };
  if (mode === "fixture") {
    if (!v.fixture || !isAbsolute(v.fixture) || v.fixture.length > 2048 || Array.from(v.fixture).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)) throw Error("Invalid fixture output.");
    return { mode, output: v.fixture };
  }
  const hash = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (keys.some(k => !v[k]) || !/^[a-f0-9]{40}$/.test(v["reviewed-head"]!) || !/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(v.database!) ||
    [v.listing!, v.image!, v["connection-version"]!].some(s => !uuid.test(s)) ||
    [v["seller-key"]!, v["source-digest"]!, v["derivative-digest"]!].some(s => !hash.test(s)) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v["listing-version"]!) ||
    new Date(v["listing-version"]!).toISOString() !== v["listing-version"]) throw Error("Missing exact bindings.");
  const pins: VerificationPins = { head: v["reviewed-head"]!, database: v.database!, listing: v.listing!, image: v.image!, listingVersion: v["listing-version"]!,
    seller: v["seller-key"]!, connectionVersion: v["connection-version"]!, sourceDigest: v["source-digest"]!, derivativeDigest: v["derivative-digest"]! };
  if (mode === "cleanup-fixture") return { mode, pins };
  if (!/^[\x21-\x7e]{20,512}$/.test(v["comparison-recipe"] ?? "")) throw Error("Exact comparison recipe required.");
  return { mode, pins, comparisonRecipe: v["comparison-recipe"]! };
}
