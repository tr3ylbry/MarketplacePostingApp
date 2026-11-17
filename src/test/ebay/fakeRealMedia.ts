import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../infrastructure/db/schema";
import { DrizzleEbayRealMediaRepository } from "../../infrastructure/repositories/drizzleEbayRealMediaRepository";
import { DrizzleListingRepository } from "../../infrastructure/repositories/drizzleListingRepository";
import { DrizzleImageRepository } from "../../infrastructure/repositories/drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "../../infrastructure/repositories/drizzleEbayConnectionRepository";
import { disposableMediaDatabaseName, syntheticMediaEvidence } from "../../infrastructure/ebay/realMediaEvidence";
import { photoTransformer, PHOTO_RECIPE } from "../../infrastructure/storage/photoDerivative/transformPhoto";
import { createPhotoDerivativeService } from "../../application/photoDerivativeService";
import { createFakeMediaWorkflow } from "../../application/ebayMediaWorkflowService";
import { FAKE_MEDIA_RESPONSE_BYTES, type FakeMediaDependencies } from "../../application/ebayMediaWorkflow";
import type { PrivateImageReader } from "../../application/ebayPrivateImages";
import type { PhotoTransformer } from "../../application/photoDerivative";
import { RealMediaError } from "../../application/ebayRealMedia";

// Synthetic JSON envelope, NOT an HTTP adapter or a guessed eBay response/URL.
export function syntheticCreateReply(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({ status: 201,
    location: "https://media-contract.invalid.test/image/test_resource_" + randomBytes(8).toString("hex"),
    body: { imageUrl: "https://eps-contract.invalid.test/photo/test_visual_" + randomBytes(8).toString("hex") + ".png",
      expirationDate: new Date(Date.now() + 3600000).toISOString() }, ...overrides }));
}
// There is no production composition or environment switch. The exact existing
// proof namespace is required before construction AND again on every admission.
export async function composeFakeMediaWorkflow(db: NodePgDatabase<typeof schema>, options: {
  session: FakeMediaDependencies["session"]; reader: PrivateImageReader; configHash: () => string;
  create?: FakeMediaDependencies["create"]; transformer?: PhotoTransformer; recipe?: () => string;
  clock?: () => Date; monotonic?: () => number;
}) {
  if (process.env.NODE_ENV !== "test" || process.env.VERCEL) throw new RealMediaError("contract");
  const database = await db.execute(sql`SELECT current_database() AS name`);
  if (!disposableMediaDatabaseName.test(String(database.rows[0]?.name))) throw new RealMediaError("contract");
  const clock = options.clock ?? (() => new Date());
  const repository = new DrizzleEbayRealMediaRepository(db, clock), listings = new DrizzleListingRepository(db),
    images = new DrizzleImageRepository(db), connections = new DrizzleEbayConnectionRepository(db);
  const derivatives = createPhotoDerivativeService(listings, images, connections, options.reader,
    options.transformer ?? photoTransformer, options.configHash(), clock);
  const workflow = createFakeMediaWorkflow({ repository, session: options.session, configHash: options.configHash,
    recipe: options.recipe ?? (() => PHOTO_RECIPE), derive: derivatives.derive,
    create: options.create ?? (async (_bytes, _type, signal) => { signal.throwIfAborted(); return syntheticCreateReply(); }),
    async admit(claim, response) {
      try {
        if (!response.byteLength || response.byteLength > FAKE_MEDIA_RESPONSE_BYTES) throw new Error();
        const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response));
        return await syntheticMediaEvidence(db, claim.ownerId, claim.id, raw);
      } catch { throw new RealMediaError("contract"); }
    },
  }, clock, options.monotonic);
  return { workflow, repository, derivatives, listings, images, connections };
}
