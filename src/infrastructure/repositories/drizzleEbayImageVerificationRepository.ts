import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ownerIdSchema } from "../../application/owner";
import { mediaHash, mediaId, mediaSessionHash, realMediaDigest, type RealMediaClaim, type RealMediaReviewGuard } from "../../application/ebayRealMedia";
import {
  VerificationPersistenceError, verificationReservationSchema, verificationReferenceSchema, verificationIntentSchema,
  verificationCloseReason, verificationEnvelope, type VerificationReference, type VerificationReservation,
  type VerificationAcknowledgement, type VerificationStatus, type VerificationOutcomeInput, type VerificationCloseReason,
} from "../../application/ebayImageVerificationPersistence";
import * as schema from "../db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const reservations = schema.ebayImageVerifications, outcomes = schema.ebayImageVerificationOutcomes;
type Parent = typeof schema.ebayRealMediaAttempts.$inferSelect;
const bindingSchema = z.strictObject({
  ownerId: ownerIdSchema, listingId: mediaId, imageId: mediaId, listingVersion: z.iso.datetime(),
  connectionId: mediaId, connectionVersion: mediaId, configHash: mediaHash, grantHash: mediaHash, sellerKey: mediaHash,
  sourceVersion: mediaHash, imageOrder: z.number().int().nonnegative(), mediaGrant: z.literal(true), accessExpiresAt: z.iso.datetime(),
});
const guardSchema = z.strictObject({ binding: bindingSchema, sessionId: mediaId, leaseDeadline: z.iso.datetime().optional() });
function owns(parent: Parent | undefined, claim: RealMediaClaim): parent is Parent {
  return !!parent && parent.ownerId === claim.ownerId && parent.id === claim.id && parent.listingId === claim.listingId && parent.imageId === claim.imageId &&
    parent.claimHash === realMediaDigest(claim.token) && parent.actionHash === claim.actionHash && parent.sessionHash === claim.sessionHash && claim.revision <= parent.revision;
}
function refuse(): never { throw new VerificationPersistenceError(); }

// Internal local persistence only. No authentication/HTTP/SDK/configuration
// construction, dependency injection gateway or positive network permission.
export class DrizzleEbayImageVerificationRepository {
  constructor(private readonly db: Database) {}
  private async protect<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch { throw new VerificationPersistenceError(); }
  }
  private async lockContext(tx: Transaction, claim: RealMediaClaim, rawGuard: RealMediaReviewGuard): Promise<Parent> {
    const guard = guardSchema.parse(rawGuard), b = guard.binding;
    if (b.ownerId !== claim.ownerId || b.listingId !== claim.listingId || b.imageId !== claim.imageId || mediaSessionHash(claim.ownerId, guard.sessionId) !== claim.sessionHash) refuse();
    // Blocking locks in the established order, ALL before SQL wall-time auth.
    const [listing] = await tx.select({ id: schema.listings.id }).from(schema.listings).where(and(eq(schema.listings.id, claim.listingId), eq(schema.listings.ownerId, claim.ownerId))).for("update");
    const [connection] = await tx.select().from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId, claim.ownerId)).for("update");
    const [image] = await tx.select({ id: schema.listingImages.id }).from(schema.listingImages).where(and(eq(schema.listingImages.id, claim.imageId), eq(schema.listingImages.listingId, claim.listingId))).for("update");
    const [session] = await tx.select({ id: schema.sessions.id }).from(schema.sessions).where(and(eq(schema.sessions.id, guard.sessionId), eq(schema.sessions.userId, claim.ownerId))).for("share");
    const [parent] = await tx.select().from(schema.ebayRealMediaAttempts).where(and(eq(schema.ebayRealMediaAttempts.id, claim.id), eq(schema.ebayRealMediaAttempts.ownerId, claim.ownerId))).for("update");
    if (!listing || !connection || !image || !session || !owns(parent, claim) ||
      b.listingVersion !== new Date(parent.listingVersion).toISOString() || b.connectionId !== parent.connectionId || b.connectionVersion !== parent.connectionVersion ||
      b.configHash !== parent.configHash || b.grantHash !== parent.grantHash || b.sellerKey !== parent.sellerKey || b.sourceVersion !== parent.sourceVersion || b.imageOrder !== parent.imageOrder ||
      b.accessExpiresAt !== (connection.accessExpiresAt ? new Date(connection.accessExpiresAt).toISOString() : null)) refuse();
    return parent;
  }
  private async lockRetained(tx: Transaction, ref: VerificationReference) {
    // Late evidence does not require a live/deleted product or renewed session.
    const [parent] = await tx.select().from(schema.ebayRealMediaAttempts).where(and(eq(schema.ebayRealMediaAttempts.id, ref.parent.id), eq(schema.ebayRealMediaAttempts.ownerId, ref.ownerId))).for("update");
    if (!owns(parent, ref.parent)) refuse();
    const [row] = await tx.select().from(reservations).where(and(eq(reservations.id, ref.id), eq(reservations.ownerId, ref.ownerId))).for("update");
    if (!row || row.uploadAttemptId !== parent.id || row.actionHash !== ref.actionHash || ref.revision > row.revision) refuse();
    return row;
  }
  async reserveVerification(input: VerificationReservation): Promise<VerificationReference> {
    return this.protect(async () => {
      const { guard, ...raw } = input, value = verificationReservationSchema.parse(raw);
      return this.db.transaction(async tx => {
        const acquired = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('image-verification:' || ${value.parent.ownerId} || ':' || ${value.actionHash},0)) AS acquired`);
        if (acquired.rows[0]?.acquired !== true) refuse();
        const parent = await this.lockContext(tx, value.parent, guard);
        if (parent.revision !== value.parent.revision) refuse();
        const [saved] = await tx.insert(reservations).values({
          id: randomUUID(), ownerId: value.parent.ownerId, uploadAttemptId: parent.id, actionHash: value.actionHash,
          expectedSourceDigest: value.sourceDigest, expectedDerivativeDigest: value.derivativeDigest, parentPreparingRevision: parent.revision,
          ...value.policy, reviewUntil: value.reviewUntil, leaseUntil: value.reviewUntil,
          createdAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`, reviewDueAt: sql`clock_timestamp()`, dispositionDueAt: sql`clock_timestamp()`,
        }).returning();
        return { id: saved.id, ownerId: saved.ownerId, actionHash: saved.actionHash, parent: value.parent, revision: saved.revision };
      });
    });
  }
  async recordRequestIntent(input: VerificationReference, guard: RealMediaReviewGuard, times: { responseReceivedAt: string; providerExpiresAt: string }): Promise<VerificationReference> {
    return this.protect(async () => {
      const ref = verificationReferenceSchema.parse(input), intent = verificationIntentSchema.parse(times);
      return this.db.transaction(async tx => {
        const parent = await this.lockContext(tx, ref.parent, guard);
        const [row] = await tx.select().from(reservations).where(and(eq(reservations.id, ref.id), eq(reservations.ownerId, ref.ownerId))).for("update");
        if (!row || row.uploadAttemptId !== parent.id || row.actionHash !== ref.actionHash || parent.revision !== ref.parent.revision || parent.revision !== row.parentPreparingRevision + 1 ||
          row.phase !== "prepared" || row.revision !== ref.revision) refuse();
        const [saved] = await tx.update(reservations).set({ phase: "intent-recorded", revision: row.revision + 1,
          ...intent, requestIntentAt: sql`clock_timestamp()` }).where(and(eq(reservations.id, row.id), eq(reservations.revision, ref.revision))).returning();
        if (!saved) refuse();
        return { ...ref, revision: saved.revision };
      });
    });
  }
  async checkIntentContext(input: VerificationReference, guard: RealMediaReviewGuard): Promise<void> {
    return this.protect(async () => {
      const ref = verificationReferenceSchema.parse(input);
      await this.db.transaction(async tx => {
        await this.lockContext(tx, ref.parent, guard);
        const row = await this.lockRetained(tx, ref);
        if (row.revision !== ref.revision) refuse();
        // Read-only authoritative check after the last blocking row read. No
        // subsequent asynchronous snapshot, renewal or permission construction.
        await tx.execute(sql`SELECT public.image_verification_intent_time(${row.id},${row.ownerId},${realMediaDigest(ref.parent.token)},${ref.parent.revision},${ref.revision})`);
      });
    });
  }
  async closePrepared(input: VerificationReference, reason: VerificationCloseReason): Promise<void> {
    return this.protect(async () => {
      const ref = verificationReferenceSchema.parse(input), code = verificationCloseReason.parse(reason);
      await this.db.transaction(async tx => {
        const row = await this.lockRetained(tx, ref);
        if (row.phase === "closed" && row.closeReason === code) return;
        if (row.phase !== "prepared" || row.revision !== ref.revision) refuse();
        await tx.update(reservations).set({ phase: "closed", closeReason: code, revision: row.revision + 1 }).where(eq(reservations.id, row.id));
      });
    });
  }
  async recordOutcome(input: VerificationReference, raw: VerificationOutcomeInput): Promise<VerificationAcknowledgement> {
    return this.protect(async () => {
      const ref = verificationReferenceSchema.parse(input), envelope = verificationEnvelope(raw.envelope);
      const intentRevision = z.union([z.literal(1), z.null()]).parse(raw.intentRevision);
      if (Object.keys(raw).length !== 2) refuse();
      return this.db.transaction(async tx => {
        const row = await this.lockRetained(tx, ref);
        if (row.phase === "intent-recorded" && ref.parent.revision !== row.parentPreparingRevision + 1) refuse();
        const [inserted] = await tx.insert(outcomes).values({ id: randomUUID(), verificationId: row.id, ownerId: row.ownerId, intentRevision,
          envelope, fingerprint: realMediaDigest("pending"), late: true, protocolConflict: false, recordedAt: sql`clock_timestamp()` }).onConflictDoNothing().returning();
        const [saved] = inserted ? [inserted] : await tx.select().from(outcomes).where(and(eq(outcomes.verificationId, row.id),
          eq(outcomes.fingerprint, sql`public.image_verification_outcome_fingerprint(${JSON.stringify(envelope)}::jsonb,${intentRevision})`)));
        const [current] = await tx.select({ overflow: reservations.evidenceOverflow }).from(reservations).where(eq(reservations.id, row.id));
        if (!saved && !current?.overflow) refuse();
        return { evidenceId: saved?.id ?? null, late: saved?.late ?? true, overflow: !saved, associated: false };
      });
    });
  }
  async status(ownerId: string, id: string): Promise<VerificationStatus | null> {
    return this.protect(async () => {
      ownerIdSchema.parse(ownerId); mediaId.parse(id);
      const result = await this.db.execute(sql`SELECT v.phase,v.evidence_overflow AS overflow,
        EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes e WHERE e.verification_id=v.id) AS has_outcome,
        EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes e WHERE e.verification_id=v.id AND e.late) AS late,
        v.evidence_overflow OR EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes e WHERE e.verification_id=v.id AND e.protocol_conflict) OR
        EXISTS(SELECT 1 FROM public.ebay_image_verification_outcomes e JOIN public.ebay_image_verification_outcomes f ON f.verification_id=e.verification_id AND f.id<>e.id
          WHERE e.verification_id=v.id AND e.envelope->>'settlement'='settled' AND f.envelope->>'settlement'='settled'
          AND e.envelope->'httpStatus'<>'null'::jsonb AND f.envelope->'httpStatus'<>'null'::jsonb
          AND ROW(e.envelope->'httpStatus',e.envelope->'bytes',e.envelope->'mime',e.envelope->'exceeded') IS DISTINCT FROM
              ROW(f.envelope->'httpStatus',f.envelope->'bytes',f.envelope->'mime',f.envelope->'exceeded')) AS conflict,
        NOT public.image_verification_context_current(v.upload_attempt_id,v.owner_id) OR
        (v.phase='intent-recorded' AND NOT EXISTS(SELECT 1 FROM public.ebay_real_media_attempts a WHERE a.id=v.upload_attempt_id AND a.revision=v.parent_preparing_revision+1 AND a.post_intent_at IS NOT NULL AND a.source_digest=v.expected_source_digest AND a.derivative_digest=v.expected_derivative_digest)) OR v.lease_until<=clock_timestamp() OR v.review_until<=clock_timestamp() OR
        NOT public.image_verification_profile_valid(v.contract_version,v.address_policy_version,v.address_policy_data_hash,clock_timestamp()) AS detached
        FROM public.ebay_image_verifications v WHERE v.id=${id} AND v.owner_id=${ownerId}`);
      const row = result.rows[0];
      return row ? { phase: row.phase as VerificationStatus["phase"], hasOutcome: Boolean(row.has_outcome), late: Boolean(row.late),
        conflict: Boolean(row.conflict), overflow: Boolean(row.overflow), detached: Boolean(row.detached), associated: false } : null;
    });
  }
}
