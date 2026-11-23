// Diagnostic policy, not a provider limit or usable-media admission contract.
export const IMAGE_COMPARISON = Object.freeze({
  version: "generated-rgb-marker-v1", width: 500, height: 600, channels: 3,
  encodedBytes: 1_048_576, metadataBytes: 65_536, chunks: 256, processingMs: 5_000,
  mae: 8, rmse: 16, tileMae: 22, anchorDelta: 10, markerMargin: 72,
});
export const MARKER = Object.freeze({ x: 106, y: 400, cell: 16, columns: 18, rows: 8, prefix: "1010010100111100" });
export const ORIENTATION_CUE = Object.freeze({ x:20,y:550,cell:12,columns:3,rows:2,bits:"100110" });
export const COLOR_ANCHORS = Object.freeze([
  { x: 24, y: 28, width: 68, height: 52, rgb: [224, 40, 40] },
  { x: 365, y: 38, width: 82, height: 64, rgb: [35, 180, 65] },
  { x: 35, y: 265, width: 94, height: 71, rgb: [35, 75, 220] },
  { x: 340, y: 285, width: 109, height: 49, rgb: [235, 190, 25] },
].map(a=>Object.freeze({...a,rgb:Object.freeze(a.rgb)})));
export type ComparisonReason = "matched" | "reference" | "unsupported" | "decode" | "geometry" | "orientation" | "marker" | "color" | "similarity" | "cancelled" | "deadline" | "context" | "busy";
export interface ImageComparisonDiagnostic {
  recipe: string; verdict: "match" | "mismatch" | "inconclusive"; reason: ComparisonReason;
  decoding: "not-run" | "passed" | "failed"; geometry: "not-run" | "passed" | "failed";
  orientation: "not-run" | "passed" | "failed";
  marker: "not-run" | "passed" | "failed"; color: "not-run" | "passed" | "failed";
  similarity: "not-run" | "passed" | "failed"; settlement: "settled" | "unsettled";
  metrics: { orientationErrors:number;orientationMargin:number;markerErrors: number; markerMargin: number; mae: number; rmse: number; tileMae: number; anchorDelta: number } | null;
  associated: false;
}
export class ImageComparisonError extends Error {
  constructor(readonly reason: ComparisonReason) { super("Diagnostic image verification refused."); }
}
