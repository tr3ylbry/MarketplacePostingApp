import { parseArgs } from "node:util";

export function captureOptions(args: string[]) {
  const { values: v } = parseArgs({ args, options: {
    help: { type: "boolean" }, fixture: { type: "string" }, "rehearse-input": { type: "boolean" },
    "check-session": { type: "boolean" }, "reviewed-head": { type: "string" },
    "seller-key": { type: "string" }, "source-digest": { type: "string" },
    listing: { type: "string" }, image: { type: "string" },
    "approve-one-create": { type: "boolean" }, "approve-media-consent": { type: "boolean" },
  } });
  const modes = ["help", "fixture", "rehearse-input", "check-session", "approve-one-create", "approve-media-consent"] as const;
  const chosen = modes.filter(k => v[k]);
  if (chosen.length !== 1) throw Error("Choose exactly one mode.");
  const mode = chosen[0];
  const real = mode === "approve-one-create" || mode === "approve-media-consent";
  const allowed = new Set<string>([mode, ...(real ? ["reviewed-head", "seller-key"] : []),
    ...(mode === "approve-one-create" ? ["listing", "image", "source-digest"] : [])]);
  if (Object.keys(v).some(k => !allowed.has(k))) throw Error("Conflicting options.");
  if (mode === "fixture" && !v.fixture?.startsWith("/")) throw Error("Use an absolute fixture output.");
  if (real && (!/^[a-f0-9]{40}$/.test(v["reviewed-head"] ?? "") || !/^[a-f0-9]{64}$/.test(v["seller-key"] ?? ""))) throw Error();
  if (mode === "approve-one-create" && (!v.listing || !v.image || !/^[a-f0-9]{64}$/.test(v["source-digest"] ?? ""))) throw Error();
  return { mode, values: v };
}
