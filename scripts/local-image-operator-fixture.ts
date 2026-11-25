import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../src/infrastructure/db/schema";
import type { ListingRepository } from "../src/application/listingRepository";
import type { ImageRepository } from "../src/application/imageRepository";
import type { PhotoTransformer } from "../src/application/photoDerivative";
import type { PrivateImageReader } from "../src/application/ebayPrivateImages";
import type { ImageStorage, ImageUpload } from "../src/application/imageStorage";
import { ownerIdSchema } from "../src/application/owner";
import { realMediaDigest } from "../src/application/ebayRealMedia";
import { acquirePhotoCapacity, borrowPhotoCapacity, releasePhotoCapacity } from "../src/application/photoCapacity";
import { createListing } from "../src/domain/listing";
import type { generateVerificationFixture } from "../src/infrastructure/storage/verificationFixture";

const actorSchema = z.strictObject({ ownerId: ownerIdSchema, id: z.string().min(1).max(200), expiresAt: z.iso.datetime() });
export type LocalFixtureActor = z.infer<typeof actorSchema>;
export interface LocalFixtureInput {
  // Reserved durably by the operator before entering this irreversible setup.
  listingId: string;
  signal: AbortSignal;
  onContent(sourceDigest: string, derivativeDigest: string): Promise<void>;
  // Trusted, post-lock database authorization supplied by the runtime. The
  // initial authenticated actor alone cannot prove a session/grant stays live.
  authorizeContext(): Promise<void>;
}
type Generated = Awaited<ReturnType<typeof generateVerificationFixture>>;
type Storage = PrivateImageReader & {
  writeGeneratedFixture(upload: ImageUpload, bytes: Buffer, signal: AbortSignal): Promise<void>;
  verifyUpload(upload: ImageUpload, signal: AbortSignal): ReturnType<ImageStorage["verifyUpload"]>;
};
interface FixtureDependencies {
  listings: Pick<ListingRepository, "getById" | "create">;
  images: Pick<ImageRepository, "reserve" | "finalize">;
  storage: Storage;
  generate(): Promise<Generated>;
  transformer: PhotoTransformer;
  recipe: string;
}
export class LocalFixtureError extends Error {
  constructor() { super("Generated image preparation stopped. Do not repeat it; inspect the recorded outcome."); }
}

// The durable activation remains the cross-process one-use guard. This
// additional process-local guard also rejects repeated/overlapping calls after
// an uncertain setup, even if a failed create left no visible listing.
export function createInjectedLocalOperatorFixturePreparer(deps: FixtureDependencies) {
  const started = new Set<string>();
  return async function prepareLocalOperatorFixture(inputActor: LocalFixtureActor, input: LocalFixtureInput) {
    const actor = actorSchema.parse(inputActor), listingId = z.uuid().parse(input.listingId);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45_000)]);
    const live = () => { signal.throwIfAborted(); if (!(Date.parse(actor.expiresAt) > Date.now())) throw new LocalFixtureError(); };
    const authorize = async () => { live(); await input.authorizeContext(); live(); };
    live();
    if (started.has(listingId)) throw new LocalFixtureError();
    started.add(listingId);
    let source: Generated | undefined, photo: Awaited<ReturnType<PhotoTransformer["transform"]>> | undefined, read: Buffer | undefined;
    const capacity = acquirePhotoCapacity(), finish = borrowPhotoCapacity(capacity);
    try {
      // A reserved ID is created once, never upserted or reused. The normal
      // repository's unique key serializes competing creators across processes.
      if (await deps.listings.getById(actor.ownerId, listingId)) throw new LocalFixtureError();
      live();
      const nativeSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]), deadline = performance.now() + 5_000;
      source = await deps.generate(); live(); nativeSignal.throwIfAborted();
      if (source.bytes.length > 1_048_576 || source.sourceDigest !== realMediaDigest(source.bytes)) throw new LocalFixtureError();
      photo = await deps.transformer.transform(source.bytes, "image/png", nativeSignal, deadline); live(); nativeSignal.throwIfAborted();
      if (source.sourceDigest !== realMediaDigest(source.bytes) || photo.sourceDigest !== source.sourceDigest ||
        photo.derivativeDigest !== realMediaDigest(photo.bytes) || photo.recipe !== deps.recipe || photo.contentType !== "image/png" ||
        photo.width !== 500 || photo.height !== 600 || photo.size !== photo.bytes.length || photo.size > 1_048_576) throw new LocalFixtureError();
      // Preserve content pins before any local listing or remote object starts.
      await input.onContent(source.sourceDigest, photo.derivativeDigest); live();
      const listing = { ...createListing({ title: `SANDBOX M3 Generated ${source.sourceDigest.slice(0, 12)}`,
        description: "Generated non-personal image for the approved local Sandbox diagnostic only. Not for publication.",
        askingPrice: { amount: 1, currency: "USD" }, selectedPlatforms: ["ebay"] }), id: listingId };
      await deps.listings.create(actor.ownerId, listing); await authorize();
      const upload = await deps.images.reserve(actor.ownerId, listingId, { filename: "generated.png", contentType: "image/png", size: source.bytes.length });
      // Both preceding repository calls can wait on locks. Authorize again
      // after their completion, immediately before starting the private write.
      await authorize();
      // Every native/storage operation is outside the repositories' transactions.
      await deps.storage.writeGeneratedFixture(upload, source.bytes, signal); await authorize();
      const verified = await deps.storage.verifyUpload(upload, signal); await authorize();
      read = await deps.storage.readPrivateImage(verified, signal); await authorize();
      if (realMediaDigest(read) !== source.sourceDigest) throw new LocalFixtureError();
      await deps.images.finalize(actor.ownerId, listingId, upload.id, verified); live();
      const saved = await deps.listings.getById(actor.ownerId, listingId); live();
      if (!saved || saved.id !== listingId || saved.title !== listing.title || saved.images.length !== 1 ||
        saved.images[0].id !== upload.id || saved.images[0].order !== 0 || saved.images[0].source.kind !== "vercel-blob" ||
        saved.images[0].source.pathname !== verified.pathname || !Number.isFinite(Date.parse(saved.updatedAt))) throw new LocalFixtureError();
      return { imageId: upload.id, listingVersion: saved.updatedAt };
    } catch { throw new LocalFixtureError(); }
    finally { source?.bytes.fill(0); photo?.bytes.fill(0); read?.fill(0); finish(); releasePhotoCapacity(capacity); }
  };
}

// No pool, authentication or configuration discovery is performed here. The
// trusted local operator supplies its already-verified database and environment.
export function createLocalOperatorFixturePreparer(db: NodePgDatabase<typeof schema>, env: NodeJS.ProcessEnv = process.env) {
  let prepare: Promise<ReturnType<typeof createInjectedLocalOperatorFixturePreparer>> | undefined;
  return async (actor: LocalFixtureActor, input: LocalFixtureInput) => {
    prepare ??= Promise.all([
      import("../src/infrastructure/repositories/drizzleListingRepository"), import("../src/infrastructure/repositories/drizzleImageRepository"),
      import("../src/infrastructure/storage/vercelBlobImageStorage"), import("../src/infrastructure/storage/verificationFixture"),
      import("../src/infrastructure/storage/photoDerivative/transformPhoto"),
    ]).then(([{ DrizzleListingRepository }, { DrizzleImageRepository }, { VercelBlobImageStorage }, { generateVerificationFixture }, { photoTransformer, PHOTO_RECIPE }]) =>
      createInjectedLocalOperatorFixturePreparer({ listings: new DrizzleListingRepository(db), images: new DrizzleImageRepository(db),
        storage: new VercelBlobImageStorage(env), generate: generateVerificationFixture, transformer: photoTransformer, recipe: PHOTO_RECIPE }));
    return (await prepare)(actor, input);
  };
}
