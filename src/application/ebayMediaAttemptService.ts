import { z } from "zod";
import { ownerIdSchema } from "./owner";
import type { PrivateImageReader, ExportImageValidator } from "./ebayPrivateImages";
import { MAX_IMAGE_BYTES } from "../domain/listingImage";
import { mediaDigest, MEDIA_OPERATION_MS, MediaAttemptError, type MediaAttemptRepository, type MediaFixtureFactory, type SimulatedMediaGateway, type MediaOutcome } from "./ebayMediaAttempt";

let active = 0;
const id = z.string().min(1).max(200);
export function createMediaAttemptService(repository: MediaAttemptRepository, reader: PrivateImageReader,
  validator: ExportImageValidator, fixture: MediaFixtureFactory, gateway: SimulatedMediaGateway, configHash: string, clock = () => new Date()) {
  return {
    async simulate(owner: string, listingId: string, version: string, imageId: string) {
      ownerIdSchema.parse(owner); id.parse(listingId); id.parse(imageId); z.iso.datetime().parse(version);
      if (active >= 2) throw new MediaAttemptError("busy");
      active++;
      let claim: Awaited<ReturnType<MediaAttemptRepository["claim"]>> | undefined;
      let fenced = false;
      let outcome: MediaOutcome | undefined;
      try {
        claim = await repository.claim(owner, listingId, version, imageId, configHash, clock());
        if (claim.kind === "recorded") return claim.summary;
        const signal = AbortSignal.timeout(MEDIA_OPERATION_MS);
        const source = await reader.readPrivateImage(claim.claim.source, signal); signal.throwIfAborted();
        if (source.length !== claim.claim.source.size || source.length > MAX_IMAGE_BYTES) throw new MediaAttemptError("preparation");
        await validator.validate(source, claim.claim.source.contentType, signal); signal.throwIfAborted();
        const exported = await fixture.create(signal); signal.throwIfAborted();
        if (!exported.length || exported.length > 1024 * 1024) throw new MediaAttemptError("preparation");
        await validator.validate(exported, "image/png", signal); signal.throwIfAborted();
        await repository.markSending(claim.claim, { sourceDigest: mediaDigest(source), exportDigest: mediaDigest(exported), size: exported.length }, clock());
        fenced = true;
        // One call only. A failure/expired lease can never authorize another POST.
        outcome = await gateway.create(exported, signal);
        return await repository.settle(claim.claim, outcome, clock());
      } catch (error) {
        if (claim?.kind === "claimed") {
          try {
            if (!fenced) await repository.notSent(claim.claim); // Conditional: cannot reset an ambiguously committed send fence.
            else await repository.settle(claim.claim, outcome ?? { complete: false, imageId: null, imageUrl: null, expiresAt: null, responseStatus: null, reason: "transport" }, clock());
          } catch { /* The independently committed fence/lease remains durable. */ }
        }
        if (fenced) throw new MediaAttemptError("unknown");
        if (error instanceof MediaAttemptError) throw error;
        throw new MediaAttemptError("preparation");
      } finally { active--; }
    },
  };
}
