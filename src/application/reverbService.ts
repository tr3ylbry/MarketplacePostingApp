import { z } from "zod";
import type { ListingRepository } from "./listingRepository";
import { ListingUnavailableError } from "./listingRepository";
import { ownerIdSchema } from "./owner";
import { ReverbDraftError, ReverbProviderError, type ReverbEnvironment, type ReverbGateway, type ReverbRemoteListing } from "./reverbGateway";
import type { DraftClaim, EncryptedCredential, ReverbConnection, ReverbRepository } from "./reverbRepository";
import { reverbDraftPayload, reverbSku } from "./reverbDraft";
import type { ProviderImageAccess } from "./imageStorage";

interface Cipher { encrypt(token: string, context: string): EncryptedCredential; decrypt(value: EncryptedCredential, context: string): string }
const tokenSchema = z.string().trim().min(10).max(4096).regex(/^[\x21-\x7e]+$/);
const choiceSchema = z.object({ categoryId: z.uuid(), conditionId: z.uuid(), shippingProfileId: z.string().max(200).optional() }).strict();
export function safeReverbError(error: unknown): string {
  if (error instanceof ReverbProviderError || error instanceof ReverbDraftError || error instanceof ListingUnavailableError) return error.message;
  if (error instanceof z.ZodError) return "Invalid Reverb input. Check your selections and token format.";
  return "Reverb operation could not be completed. Check server configuration; reconcile before retrying a draft.";
}
const context = (owner: string, env: ReverbEnvironment) => JSON.stringify(["reverb-pat-v1", owner, env]);
export function createReverbService(repo: ReverbRepository, listings: ListingRepository, gateway: ReverbGateway,
  cipher: Cipher, images: ProviderImageAccess, environment: ReverbEnvironment) {
  async function connected(owner: string) {
    ownerIdSchema.parse(owner);
    const connection = await repo.connection(owner, environment);
    if (!connection || connection.needsReconnect) throw new ReverbDraftError("Connect or replace your Reverb token in integration settings first.");
    return connection;
  }
  async function provider<T>(connection: ReverbConnection, operation: (token: string) => Promise<T>) {
    try { return await operation(cipher.decrypt(connection, context(connection.ownerId, environment))); }
    catch (error) {
      if (error instanceof ReverbProviderError && error.code === "auth") await repo.markReconnect(connection.ownerId, environment, connection.version);
      throw error;
    }
  }
  async function owned(owner: string, id: string) {
    ownerIdSchema.parse(owner); z.string().min(1).max(200).parse(id);
    const listing = await listings.getById(owner, id); if (!listing) throw new ListingUnavailableError(); return listing;
  }
  return {
    async status(owner: string) {
      ownerIdSchema.parse(owner); const c = await repo.connection(owner, environment);
      return { environment, connected: !!c, shopName: c?.shopName, connectedAt: c?.connectedAt, needsReconnect: c?.needsReconnect ?? false };
    },
    async connect(owner: string, input: unknown) {
      ownerIdSchema.parse(owner); const token = tokenSchema.parse(input);
      const encrypted = cipher.encrypt(token, context(owner, environment)); // Fail configuration before network.
      const shop = await gateway.shop(token); const now = new Date().toISOString();
      await repo.connect({ ...encrypted, ownerId: owner, environment, shopId: shop.id, shopName: shop.name,
        version: crypto.randomUUID(), connectedAt: now, updatedAt: now, needsReconnect: false });
    },
    async disconnect(owner: string) { ownerIdSchema.parse(owner); await repo.disconnect(owner, environment); },
    async options(owner: string, id: string) {
      const listing = await owned(owner, id); const c = await connected(owner);
      const [shop, categories, conditions] = await provider(c, token => Promise.all([gateway.shop(token), gateway.categories(token), gateway.conditions(token)]));
      if (shop.id !== c.shopId) throw new ReverbDraftError("Reverb shop changed. Reconnect first.");
      return { environment, shopName: shop.name, categories, conditions, shippingProfiles: shop.shippingProfiles,
        shippingRate: listing.shippingRate?.amount, unavailableImages: listing.images.filter(i => i.source.kind === "filename").length };
    },
    async prepare(owner: string, id: string, input: unknown) {
      const choice = choiceSchema.parse(input); const listing = await owned(owner, id); const c = await connected(owner);
      const [shop, categories, conditions] = await provider(c, token => Promise.all([gateway.shop(token), gateway.categories(token), gateway.conditions(token)]));
      const category = categories.find(v => v.id === choice.categoryId), condition = conditions.find(v => v.id === choice.conditionId);
      const shippingProfile = choice.shippingProfileId ? shop.shippingProfiles.find(v => v.id === choice.shippingProfileId) : undefined;
      if (shop.id !== c.shopId || !category || !condition || (choice.shippingProfileId && !shippingProfile)) throw new ReverbDraftError("Reverb selections changed or are unavailable. Reload and select again.");
      const selection = { category, condition, ...(shippingProfile ? { shippingProfile } : {}) };
      const payload = reverbDraftPayload(listing, selection);
      const review = { id: crypto.randomUUID(), ownerId: owner, listingId: id, environment, shopId: c.shopId,
        connectionVersion: c.version, listingVersion: listing.updatedAt, selection, expiresAt: new Date(Date.now() + 600000).toISOString() };
      await repo.prepare(review);
      return { reviewId: review.id, environment, shopName: shop.name, selection, payload, photoCount: listing.images.length, expiresAt: review.expiresAt };
    },
    async createDraft(owner: string, reviewId: string) {
      ownerIdSchema.parse(owner); z.uuid().parse(reviewId);
      const claim = await repo.claim(owner, environment, reviewId);
      try {
        const listing = await owned(owner, claim.review.listingId); const c = await connected(owner);
        if (c.version !== claim.review.connectionVersion || listing.updatedAt !== claim.review.listingVersion) throw new ReverbDraftError("Listing or connection changed. Prepare again.");
        const sku = reverbSku(listing.id);
        const accept = (matches: ReverbRemoteListing[]) => {
          if (matches.length > 1) throw new ReverbDraftError("Multiple Reverb listings match this SKU. Resolve duplicates manually on Reverb.");
          const match = matches[0];
          if (match && (match.sku !== sku || match.state !== "draft" || (claim.externalId && match.id !== claim.externalId))) throw new ReverbDraftError("Existing Reverb listing is not the expected draft. Resolve it on Reverb; no write was sent.");
          return match;
        };
        let remote = accept(await provider(c, token => gateway.findBySku(token, sku)));
        if (!remote) {
          if (claim.externalId || claim.postAttempted) throw new ReverbDraftError("A prior draft may exist but is not visible by SKU. No new POST was sent. Reconcile later or resolve manually on Reverb.");
          const payload = reverbDraftPayload(listing, claim.review.selection);
          const photos: string[] = [];
          // Only trusted, owner-loaded metadata reaches the signing capability.
          for (const image of [...listing.images].sort((a, b) => a.order - b.order)) {
            if (image.source.kind !== "vercel-blob") throw new ReverbDraftError("Re-upload unavailable photos.");
            photos.push(await images.createProviderReadAccess(image.source.pathname));
          }
          await repo.markPosting(claim);
          try { remote = accept([await provider(c, token => gateway.createDraft(token, { ...payload, photos, publish: false }))]); }
          catch (error) {
            // Never repeat POST. Authentication/rate errors do not cause extra traffic.
            if (error instanceof ReverbProviderError && ["unavailable", "malformed"].includes(error.code)) {
              remote = accept(await provider(c, token => gateway.findBySku(token, sku)));
              if (!remote) throw new ReverbDraftError("Reverb draft may have been created. Reconcile later before any further attempt.");
            } else {
              if (error instanceof ReverbProviderError && ["auth", "forbidden", "validation", "rate"].includes(error.code)) await repo.rejectedPost(claim);
              throw error;
            }
          }
        }
        if (!remote) throw new ReverbDraftError("Reconcile the draft before retrying.");
        await persist(claim, remote);
        return { externalListingId: remote.id, externalUrl: remote.url, status: "draft" as const, environment };
      } finally { await repo.release(claim).catch(() => { /* Lease expires; never log provider/DB errors. */ }); }
    },
  };
  async function persist(claim: DraftClaim, remote: ReverbRemoteListing) {
    try { await repo.finish(claim, remote); }
    catch { throw new ReverbDraftError("Reverb draft exists, but local persistence could not be confirmed. Prepare and reconcile before retrying; do not create another draft manually."); }
  }
}
