import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ownerIdSchema } from "./owner";
import { PROPOSED_MEDIA_PROFILE } from "./ebayMediaGrant";
import { PRIVATE_IMAGE_REVIEW_MS } from "./ebayPrivateImages";
import { PhotoDerivativeError, type PhotoDerivative } from "./photoDerivative";
import { acquirePhotoCapacity, releasePhotoCapacity } from "./photoCapacity";
import { mediaId, mediaHash, mediaRecipe, mediaSessionHash, realMediaDigest, realMediaContentSchema, RealMediaError,
  type RealMediaClaim, type RealMediaReviewGuard, type RealMediaSnapshot } from "./ebayRealMedia";
import { FAKE_MEDIA_OPERATION_MS, FAKE_MEDIA_SEND_MS, FAKE_MEDIA_RESPONSE_BYTES, FakeMediaError,
  type FakeMediaDependencies, type FakeMediaReview, type FakeMediaSummary } from "./ebayMediaWorkflow";

const sessionSchema = z.strictObject({ ownerId: ownerIdSchema, id: mediaId, expiresAt: z.iso.datetime() });
interface ReviewRecord { guard: RealMediaReviewGuard; sessionHash: string; actionHash: string; recipe: string; expires: number; deadline: number; profile: string }
const bindingKeys = ["ownerId", "listingId", "imageId", "listingVersion", "connectionId", "connectionVersion", "configHash", "grantHash",
  "sellerKey", "sourceVersion", "imageOrder", "mediaGrant", "accessExpiresAt"] as const;
const same = (a: RealMediaSnapshot, b: RealMediaSnapshot) => bindingKeys.every(key => a[key] === b[key]);
const summary = (value: { state: FakeMediaSummary["state"]; associated: boolean }): FakeMediaSummary => ({ ...value, simulation: true });

// Internal DI boundary, not a server action, browser API or production factory.
// Opaque process-bound reviews fail closed on copy/restart/another instance.
// Durable action consumption and send/content fences remain in PostgreSQL.
export function createFakeMediaWorkflow(deps: FakeMediaDependencies, clock = () => new Date(), monotonic = () => performance.now()) {
  const reviews = new WeakMap<object, ReviewRecord>();
  async function session() {
    const value = sessionSchema.safeParse(await deps.session());
    if (!value.success || Date.parse(value.data.expiresAt) <= clock().getTime()) throw new FakeMediaError("stale");
    return value.data;
  }
  function check(record: ReviewRecord, signal?: AbortSignal, deadline = Infinity) {
    if (signal?.aborted || monotonic() >= Math.min(deadline, record.deadline) || clock().getTime() >= record.expires || record.profile !== PROPOSED_MEDIA_PROFILE ||
      deps.configHash() !== record.guard.binding.configHash || deps.recipe() !== record.recipe) throw new FakeMediaError("stale");
  }
  async function current(record: ReviewRecord, signal?: AbortSignal, deadline?: number) {
    check(record, signal, deadline); const actor = await session(); check(record, signal, deadline);
    if (mediaSessionHash(actor.ownerId, actor.id) !== record.sessionHash) throw new FakeMediaError("stale");
    const b = record.guard.binding, latest = await deps.repository.snapshot(actor.ownerId, b.listingId, b.imageId);
    check(record, signal, deadline);
    if (!same(latest, b) || !latest.mediaGrant || Date.parse(actor.expiresAt) <= clock().getTime()) throw new FakeMediaError("stale");
  }
  function content(photo: PhotoDerivative, recipe: string) {
    const value = realMediaContentSchema.parse({ sourceDigest: photo.sourceDigest, derivativeDigest: photo.derivativeDigest,
      recipe: photo.recipe, contentType: photo.contentType, size: photo.size, width: photo.width, height: photo.height });
    if (value.recipe !== recipe || !Buffer.isBuffer(photo.bytes) || photo.bytes.length !== value.size ||
      realMediaDigest(photo.bytes) !== value.derivativeDigest) throw new FakeMediaError("stale");
    return value;
  }
  return {
    async prepare(listingId: string, imageId: string): Promise<FakeMediaReview> {
      try {
        mediaId.parse(listingId); mediaId.parse(imageId); const actor = await session();
        const binding = await deps.repository.snapshot(actor.ownerId, listingId, imageId);
        const recipe = mediaRecipe.parse(deps.recipe()); mediaHash.parse(deps.configHash());
        const now = clock().getTime(), access = Date.parse(binding.accessExpiresAt ?? "");
        if (!binding.mediaGrant || binding.ownerId !== actor.ownerId || binding.listingId !== listingId || binding.imageId !== imageId ||
          binding.configHash !== deps.configHash() || !Number.isFinite(access) || access <= now + FAKE_MEDIA_OPERATION_MS) throw new FakeMediaError("stale");
        const expires = Math.min(now + PRIVATE_IMAGE_REVIEW_MS, Date.parse(actor.expiresAt), access - FAKE_MEDIA_OPERATION_MS);
        if (expires <= now) throw new FakeMediaError("stale");
        const review = Object.freeze({ simulation: true as const, environment: "sandbox" as const, imageId,
          photoNumber: binding.imageOrder + 1, recipe, expiresAt: new Date(expires).toISOString() });
        reviews.set(review, { guard: { binding: Object.freeze({ ...binding }), sessionId: actor.id }, sessionHash: mediaSessionHash(actor.ownerId, actor.id),
          actionHash: realMediaDigest(randomUUID()), recipe, expires, deadline: monotonic() + PRIVATE_IMAGE_REVIEW_MS, profile: PROPOSED_MEDIA_PROFILE });
        return review;
      } catch (error) { if (error instanceof RealMediaError || error instanceof FakeMediaError) throw error; throw new FakeMediaError("unavailable"); }
    },
    async confirm(review: unknown, callerSignal?: AbortSignal): Promise<FakeMediaSummary> {
      const record = typeof review === "object" && review !== null ? reviews.get(review) : undefined;
      if (!record) throw new FakeMediaError("stale");
      reviews.delete(review as object); // Burn synchronously before any await, including failed/cancelled/busy confirmations.
      let capacity;
      try { capacity = acquirePhotoCapacity(); } catch (error) {
        if (error instanceof PhotoDerivativeError && error.code === "busy") throw new FakeMediaError("busy");
        throw new FakeMediaError("unavailable");
      }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), FAKE_MEDIA_OPERATION_MS);
      const deadline = monotonic() + FAKE_MEDIA_OPERATION_MS;
      let claim: RealMediaClaim | undefined;
      try {
        const signal = AbortSignal.any([controller.signal, ...(callerSignal ? [callerSignal] : [])]);
        await current(record, signal, deadline); const b = record.guard.binding;
        claim = await deps.repository.claim({ ownerId: b.ownerId, listingId: b.listingId, imageId: b.imageId, listingVersion: b.listingVersion,
          configHash: b.configHash, sessionHash: record.sessionHash, actionHash: record.actionHash, recipe: record.recipe }, record.guard);
        check(record, signal, deadline);
        const photo = await deps.derive(b.ownerId, b.listingId, b.listingVersion, b.imageId, signal, capacity);
        await current(record, signal, deadline); const data = content(photo, record.recipe); check(record, signal, deadline);
        claim = await deps.repository.fence(claim, data, record.guard);
        await current(record, signal, deadline);
        await deps.repository.beforeSend(claim, record.guard);
        const actor = await session(); check(record, signal, deadline);
        if (mediaSessionHash(actor.ownerId, actor.id) !== record.sessionHash) throw new FakeMediaError("stale");
        content(photo, record.recipe); // Exact immutable-fenced bytes, immediately before the single fake send.
        check(record, signal, deadline); if (Date.parse(actor.expiresAt) <= clock().getTime()) throw new FakeMediaError("stale");
        const sendSignal = AbortSignal.any([signal, AbortSignal.timeout(FAKE_MEDIA_SEND_MS)]);
        const response = await deps.create(photo.bytes, photo.contentType, sendSignal);
        const lateResponse = sendSignal.aborted;
        // A late response may still supply evidence. It cannot gain a current association.
        if (!(response instanceof Uint8Array) || !response.byteLength || response.byteLength > FAKE_MEDIA_RESPONSE_BYTES) throw new FakeMediaError("unavailable");
        const proof = await deps.admit(claim, response);
        for (let attempt = 0; attempt < 2; attempt++) {
          let responseOnly = lateResponse;
          try { await current(record, signal, deadline); content(photo, record.recipe); check(record, signal, deadline); } catch { responseOnly = true; }
          try {
            const result = await deps.repository.acknowledge(claim, proof, { guard: record.guard, responseOnly });
            if (result.associated) {
              try { await current(record, signal, deadline); content(photo, record.recipe); check(record, signal, deadline); }
              catch { return summary(await deps.repository.acknowledge(claim, proof, { guard: record.guard, responseOnly: true })); }
            }
            return summary(result);
          }
          catch { if (attempt === 1) throw new FakeMediaError("unavailable"); }
          // Retry only the identical local receipt acknowledgement, never create/fence/derivation.
        }
        throw new FakeMediaError("unavailable");
      } catch (error) {
        if (claim) {
          try { return summary(await deps.repository.notSent(claim)); } catch { return summary({ state: "unknown", associated: false }); }
        }
        if (error instanceof RealMediaError || error instanceof FakeMediaError) throw error;
        throw new FakeMediaError("unavailable");
      } finally { clearTimeout(timer); releasePhotoCapacity(capacity); }
    },
  };
}
