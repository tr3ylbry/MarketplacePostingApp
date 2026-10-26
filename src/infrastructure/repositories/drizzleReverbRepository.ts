import { and, eq, gt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ReverbDraftError, type ReverbEnvironment, type ReverbRemoteListing } from "../../application/reverbGateway";
import type { DraftClaim, DraftReview, ManagementClaim, ReverbConnection, ReverbRepository } from "../../application/reverbRepository";
import * as schema from "../db/schema";
import { lockOwnedListing } from "./drizzleImageRepository";
const { reverbConnections: connections, reverbDraftRequests: requests, reverbManagementLeases: leases, marketplaceListings: publications, listings } = schema;
type Transaction = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];
const unavailable = () => new ReverbDraftError("Review unavailable or stale. Prepare the draft again.");
const busy = () => new ReverbDraftError("A draft operation is in progress. Wait two minutes, then reconcile.");
const connectionWhere = (owner: string, env: ReverbEnvironment) => and(eq(connections.ownerId, owner), eq(connections.environment, env));
const requestWhere = (review: DraftReview) => and(eq(requests.ownerId, review.ownerId), eq(requests.id, review.id), eq(requests.environment, review.environment));
const leaseWhere = (listingId: string, environment: ReverbEnvironment) => and(eq(leases.listingId, listingId), eq(leases.environment, environment));
const scopedRequest = (listingId: string, environment: ReverbEnvironment) => and(eq(requests.listingId, listingId), eq(requests.environment, environment));
const identityConflict = () => new ReverbDraftError("Existing Reverb publication needs manual identity resolution.");

async function activePublication(tx: Transaction, listingId: string, env: ReverbEnvironment, shopId: string) {
  const rows = await tx.select().from(publications).where(and(eq(publications.listingId, listingId), eq(publications.marketplace, "reverb")));
  const scoped = rows.filter(p => !p.providerEnvironment || p.providerEnvironment === env);
  if (scoped.length > 1 || scoped.some(p => p.providerEnvironment !== env || p.providerShopId !== shopId)) throw identityConflict();
  return scoped[0];
}
async function excludeManagement(tx: Transaction, listingId: string, env: ReverbEnvironment) {
  const [lease] = await tx.select().from(leases).where(leaseWhere(listingId, env));
  if (lease && Date.parse(lease.expiresAt) > Date.now()) throw busy();
  // Fence expired management workers before permitting a new create/review.
  await tx.delete(leases).where(leaseWhere(listingId, env));
}

export class DrizzleReverbRepository implements ReverbRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async connection(owner: string, env: ReverbEnvironment) {
    return (await this.db.select().from(connections).where(connectionWhere(owner, env)))[0] ?? null;
  }
  async connect(value: ReverbConnection) {
    await this.db.insert(connections).values(value).onConflictDoUpdate({ target: [connections.ownerId, connections.environment], set: value });
  }
  async disconnect(owner: string, env: ReverbEnvironment) { await this.db.delete(connections).where(connectionWhere(owner, env)); }
  async markReconnect(owner: string, env: ReverbEnvironment, version: string) {
    await this.db.update(connections).set({ needsReconnect: true }).where(and(connectionWhere(owner, env), eq(connections.version, version)));
  }
  async prepare(review: DraftReview) {
    await this.db.transaction(async tx => {
      const listing = await lockOwnedListing(tx, review.ownerId, review.listingId);
      await excludeManagement(tx, review.listingId, review.environment);
      if (new Date(listing.updatedAt).toISOString() !== review.listingVersion) throw unavailable();
      const [connection] = await tx.select().from(connections).where(connectionWhere(review.ownerId, review.environment)).for("update");
      if (!connection || connection.version !== review.connectionVersion || connection.needsReconnect) throw unavailable();
      const [previous] = await tx.select().from(requests).where(and(eq(requests.listingId, review.listingId), eq(requests.environment, review.environment))).for("update");
      if (previous?.leaseUntil && Date.parse(previous.leaseUntil) > Date.now()) throw busy();
      if (previous?.postAttempted && previous.shopId !== review.shopId) throw new ReverbDraftError("This listing has a draft attempt for another shop. Resolve it before changing shops.");
      await tx.insert(requests).values(review).onConflictDoUpdate({ target: [requests.listingId, requests.environment], set: { ...review, leaseUntil: null, attemptId: null } });
    });
  }
  async claim(owner: string, env: ReverbEnvironment, reviewId: string): Promise<DraftClaim> {
    return this.db.transaction(async tx => {
      const [hint] = await tx.select().from(requests).where(and(eq(requests.ownerId, owner), eq(requests.environment, env), eq(requests.id, reviewId)));
      if (!hint) throw unavailable();
      const listing = await lockOwnedListing(tx, owner, hint.listingId);
      await excludeManagement(tx, hint.listingId, env);
      const [connection] = await tx.select().from(connections).where(connectionWhere(owner, env)).for("update");
      const [review] = await tx.select().from(requests).where(requestWhere(hint)).for("update");
      if (!review || !connection || connection.version !== review.connectionVersion || connection.needsReconnect || Date.parse(review.expiresAt) <= Date.now()
        || new Date(listing.updatedAt).toISOString() !== new Date(review.listingVersion).toISOString()) throw unavailable();
      if (review.leaseUntil && Date.parse(review.leaseUntil) > Date.now()) throw busy();
      const publication = await activePublication(tx, review.listingId, env, review.shopId);
      const attemptId = crypto.randomUUID();
      await tx.update(requests).set({ attemptId, leaseUntil: new Date(Date.now() + 120000).toISOString() }).where(requestWhere(review));
      return { review: { ...review, listingVersion: new Date(review.listingVersion).toISOString(), expiresAt: new Date(review.expiresAt).toISOString() }, attemptId,
        postAttempted: review.postAttempted, externalId: publication?.externalListingId ?? review.externalId ?? undefined };
    });
  }
  async markPosting(claim: DraftClaim) {
    // Durable fence before POST. Expired/stale workers cannot acquire permission.
    await this.db.transaction(async tx => {
      const listing = await lockOwnedListing(tx, claim.review.ownerId, claim.review.listingId);
      const [c] = await tx.select().from(connections).where(connectionWhere(claim.review.ownerId, claim.review.environment)).for("update");
      if (!c || c.version !== claim.review.connectionVersion || c.needsReconnect || new Date(listing.updatedAt).toISOString() !== claim.review.listingVersion) throw unavailable();
      const rows = await tx.update(requests).set({ postAttempted: true }).where(and(requestWhere(claim.review), eq(requests.attemptId, claim.attemptId),
        eq(requests.postAttempted, false), gt(requests.leaseUntil, new Date().toISOString()))).returning({ id: requests.id });
      if (!rows.length) throw unavailable();
    });
  }
  async finish(claim: DraftClaim, remote: ReverbRemoteListing) {
    await this.db.transaction(async tx => {
      const listing = await lockOwnedListing(tx, claim.review.ownerId, claim.review.listingId);
      const [request] = await tx.select().from(requests).where(requestWhere(claim.review)).for("update");
      if (!request || request.attemptId !== claim.attemptId) throw unavailable();
      const now = new Date().toISOString();
      const [existing] = await tx.select().from(publications).where(and(eq(publications.listingId, claim.review.listingId), eq(publications.marketplace, "reverb"), eq(publications.providerEnvironment, claim.review.environment), eq(publications.providerShopId, claim.review.shopId)));
      const publication = { id: existing?.id ?? `reverb:${claim.review.environment}:${claim.review.listingId}`, listingId: claim.review.listingId, marketplace: "reverb" as const,
        status: "draft" as const, externalListingId: remote.id, externalUrl: remote.url ?? null, publishedAt: null, lastSyncedAt: now,
        providerEnvironment: claim.review.environment, providerShopId: claim.review.shopId, providerState: remote.state, providerCheckedAt: now };
      await tx.insert(publications).values(publication).onConflictDoUpdate({ target: publications.id, set: publication });
      await tx.update(requests).set({ externalId: remote.id, leaseUntil: null, attemptId: null, postAttempted: true }).where(requestWhere(claim.review));
      await tx.update(listings).set({ updatedAt: new Date(Math.max(Date.now(), Date.parse(listing.updatedAt) + 1)).toISOString() }).where(eq(listings.id, claim.review.listingId));
    });
  }
  async rejectedPost(claim: DraftClaim) {
    // Only an explicit provider rejection permits a later, newly reviewed POST.
    // Network failures/5xx/malformed responses never clear this durable fence.
    await this.db.update(requests).set({ postAttempted: false }).where(and(requestWhere(claim.review), eq(requests.attemptId, claim.attemptId)));
  }
  async release(claim: DraftClaim) {
    await this.db.update(requests).set({ leaseUntil: null, attemptId: null }).where(and(requestWhere(claim.review), eq(requests.attemptId, claim.attemptId)));
  }
  async claimManagement(owner: string, env: ReverbEnvironment, listingId: string): Promise<ManagementClaim> {
    return this.db.transaction(async tx => {
      const listing = await lockOwnedListing(tx, owner, listingId);
      const [connection] = await tx.select().from(connections).where(connectionWhere(owner, env)).for("update");
      if (!connection || connection.needsReconnect) throw unavailable();
      const [request] = await tx.select().from(requests).where(scopedRequest(listingId, env)).for("update");
      if (request?.leaseUntil && Date.parse(request.leaseUntil) > Date.now()) throw busy();
      if (request?.postAttempted && request.shopId !== connection.shopId) throw identityConflict();
      const publication = await activePublication(tx, listingId, env, connection.shopId);
      if (publication?.externalListingId && request?.externalId && publication.externalListingId !== request.externalId) throw identityConflict();
      await excludeManagement(tx, listingId, env);
      // Revoke an expired create worker; never clear its durable POST fence.
      await tx.update(requests).set({ attemptId: null, leaseUntil: null }).where(scopedRequest(listingId, env));
      const token = crypto.randomUUID();
      await tx.insert(leases).values({ listingId, environment: env, token, expiresAt: new Date(Date.now() + 120000).toISOString() });
      return { ownerId: owner, listingId, environment: env, shopId: connection.shopId, connectionVersion: connection.version,
        listingVersion: new Date(listing.updatedAt).toISOString(), token,
        externalId: publication?.externalListingId ?? request?.externalId ?? undefined, postAttempted: request?.postAttempted ?? false };
    });
  }
  private async guardedManagement(tx: Transaction, claim: ManagementClaim) {
    const listing = await lockOwnedListing(tx, claim.ownerId, claim.listingId);
    const [connection] = await tx.select().from(connections).where(connectionWhere(claim.ownerId, claim.environment)).for("update");
    const [lease] = await tx.select().from(leases).where(leaseWhere(claim.listingId, claim.environment));
    if (!lease || lease.token !== claim.token || Date.parse(lease.expiresAt) <= Date.now()
      || !connection || connection.version !== claim.connectionVersion || connection.shopId !== claim.shopId || connection.needsReconnect
      || new Date(listing.updatedAt).toISOString() !== claim.listingVersion) throw unavailable();
    const publication = await activePublication(tx, claim.listingId, claim.environment, claim.shopId);
    const [request] = await tx.select().from(requests).where(scopedRequest(claim.listingId, claim.environment));
    if ((publication?.externalListingId ?? request?.externalId ?? undefined) !== claim.externalId) throw identityConflict();
    return { listing, publication };
  }
  async verifyManagement(claim: ManagementClaim) {
    await this.db.transaction(async tx => { await this.guardedManagement(tx, claim); });
  }
  async reconcile(claim: ManagementClaim, remote: ReverbRemoteListing | null) {
    await this.db.transaction(async tx => {
      const { listing, publication } = await this.guardedManagement(tx, claim);
      if (remote && claim.externalId && remote.id !== claim.externalId) throw identityConflict();
      if (!remote && !claim.externalId && claim.postAttempted) throw new ReverbDraftError("A previous draft request may have reached Reverb, but no matching listing is currently visible. Check again later before creating another draft.");
      const now = new Date().toISOString();
      const value = { id: publication?.id ?? `reverb:${claim.environment}:${claim.listingId}`, listingId: claim.listingId,
        marketplace: "reverb" as const, status: remote?.state === "draft" ? "draft" as const : publication?.status ?? "draft" as const,
        externalListingId: remote?.id ?? null, externalUrl: remote?.url ?? null,
        providerEnvironment: claim.environment, providerShopId: claim.shopId,
        providerState: remote?.state ?? "missing", providerCheckedAt: now, lastSyncedAt: now };
      await tx.insert(publications).values(value).onConflictDoUpdate({ target: publications.id, set: value });
      // Only a previously confirmed identity's absence can reset an attempted POST.
      if (remote || claim.externalId) await tx.update(requests).set({ externalId: remote?.id ?? null, postAttempted: !!remote,
        attemptId: null, leaseUntil: null }).where(scopedRequest(claim.listingId, claim.environment));
      await tx.update(listings).set({ updatedAt: new Date(Math.max(Date.now(), Date.parse(listing.updatedAt) + 1)).toISOString() }).where(eq(listings.id, claim.listingId));
    });
  }
  async releaseManagement(claim: ManagementClaim) {
    await this.db.delete(leases).where(and(leaseWhere(claim.listingId, claim.environment), eq(leases.token, claim.token)));
  }
}
