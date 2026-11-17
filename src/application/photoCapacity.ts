import { PhotoDerivativeError } from "./photoDerivative";

// Shared by standalone derivatives and complete fake pipelines. Leases are
// process-local, opaque, never serialized, and cannot be borrowed concurrently.
export type PhotoCapacity = Readonly<object>;
const leases = new WeakMap<PhotoCapacity, { child: boolean; closing: boolean }>();
let active = 0;
export function acquirePhotoCapacity(): PhotoCapacity {
  if (active >= 2) throw new PhotoDerivativeError("busy");
  const lease = Object.freeze({}); leases.set(lease, { child: false, closing: false }); active++; return lease;
}
function finish(lease: PhotoCapacity) {
  if (leases.delete(lease)) active--;
}
export function releasePhotoCapacity(lease: PhotoCapacity) {
  const state = leases.get(lease); if (!state) return;
  state.closing = true;
  // Even an early parent release cannot free started native work's capacity.
  if (!state.child) finish(lease);
}
export function borrowPhotoCapacity(lease: PhotoCapacity): () => void {
  const state = leases.get(lease);
  if (!state || state.closing || state.child) throw new PhotoDerivativeError("busy");
  state.child = true; let settled = false;
  return () => { if (settled) return; settled = true; state.child = false; if (state.closing) finish(lease); };
}
