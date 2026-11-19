import { and,eq,sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DrizzleListingRepository } from "../../infrastructure/repositories/drizzleListingRepository";
import { DrizzleEbayInventoryRepository } from "../../infrastructure/repositories/drizzleEbayInventoryRepository";
import { createInventoryInspection } from "../../application/ebayInventoryInspectionService";
import { inventoryDigest } from "../../application/ebayInventoryPersistence";
import { InventoryInspectionError, type InspectionDependencies, type InspectionFixture, type InspectionSnapshot } from "../../application/ebayInventoryInspection";
import { preparationSelection,requirementsFixture } from "./preparationFixtures";
import * as schema from "../../infrastructure/db/schema";

export function inspectionFixture():InspectionFixture {
  // Unknown coverage is the default. Explicit synthetic-complete controls are
  // fixture assertions, not evidence about any current eBay endpoint.
  return { version:"inventory-inspection-fixture-v1",samples:[{ item:"unknown",content:"unknown",contentDigest:null,
    offersComplete:false,listings:"unknown",groups:"unknown",related:[],code:"none" }] };
}
// The only composition. Never import from production runtime, routes or actions.
export async function composeFakeInventoryInspection(db:NodePgDatabase<typeof schema>,options:{
  session:InspectionDependencies["session"];observer?:InspectionDependencies["observer"];workMs?:number;
}) {
  async function isolated() {
    if(process.env.NODE_ENV!=="test" || process.env.VERCEL)throw new InventoryInspectionError("isolation");
    const result=await db.execute(sql`SELECT current_database() AS name`);
    if(!/^marketplace_inventory_[a-f0-9]{24}_test$/.test(String(result.rows[0]?.name)))throw new InventoryInspectionError("isolation");
  }
  await isolated();
  const repository=new DrizzleEbayInventoryRepository(db),listings=new DrizzleListingRepository(db);
  async function time() { await isolated();const result=await db.execute(sql`SELECT clock_timestamp() AS at`);return new Date(result.rows[0].at as string).toISOString(); }
  const deps:InspectionDependencies={ session:options.session,repository:{
    async claim(input) { await isolated();return repository.claim(input); },
    async acknowledge(claim,value) { await isolated();return repository.acknowledge(claim,value); },
  },time,
    async load(actor,listingId):Promise<InspectionSnapshot> {
      await isolated();const listing=await listings.getById(actor.ownerId,listingId);
      const [c]=await db.select({ id:schema.ebayConnections.id,version:schema.ebayConnections.version,status:schema.ebayConnections.status,
        environment:schema.ebayConnections.environment,seller:schema.ebayConnections.sellerId,config:schema.ebayConnections.configHash,
        credentialExpiry:schema.ebayConnections.refreshExpiresAt,grant:sql<string>`public.real_media_grant_version(${schema.ebayConnections.scopes})` })
        .from(schema.ebayConnections).where(eq(schema.ebayConnections.ownerId,actor.ownerId));
      const [s]=await db.select({expiresAt:schema.sessions.expiresAt}).from(schema.sessions).where(and(eq(schema.sessions.id,actor.id),eq(schema.sessions.userId,actor.ownerId)));
      const checkedAt=await time();
      if(!listing || !c || c.environment!=="sandbox" || c.status!=="connected" || !c.seller || !/^[a-f0-9]{64}$/.test(c.seller) ||
        !s || s.expiresAt.getTime()<=Date.parse(checkedAt) || !c.credentialExpiry || Date.parse(c.credentialExpiry)<=Date.parse(checkedAt))throw new InventoryInspectionError("stale");
      const binding={ ownerId:actor.ownerId,listingId,listingVersion:listing.updatedAt,environment:"sandbox" as const,sellerKey:c.seller,
        connectionId:c.id,connectionVersion:c.version,configHash:c.config,grantHash:c.grant };
      const photos=await db.select({ imageId:schema.listingImages.id,imageOrder:schema.listingImages.order,
        sourceVersion:sql<string>`public.real_media_source_version(${schema.listingImages.id})` }).from(schema.listingImages).where(eq(schema.listingImages.listingId,listingId));
      return { listing,binding,photos:photos.sort((a,b)=>a.imageOrder-b.imageOrder).map(p=>({...binding,...p})),
        sessionExpiresAt:s.expiresAt.toISOString(),credentialExpiresAt:new Date(c.credentialExpiry).toISOString(),checkedAt };
    },
    async lease(claim) {
      await isolated();const [row]=await db.select({lease:schema.ebayInventoryAttempts.leaseUntil,state:schema.ebayInventoryAttempts.state})
        .from(schema.ebayInventoryAttempts).where(and(eq(schema.ebayInventoryAttempts.id,claim.id),eq(schema.ebayInventoryAttempts.ownerId,claim.ownerId),
          eq(schema.ebayInventoryAttempts.claimHash,inventoryDigest(claim.token)),eq(schema.ebayInventoryAttempts.actionHash,claim.actionHash),eq(schema.ebayInventoryAttempts.sessionHash,claim.sessionHash)));
      if(!row || row.state!=="preparing")throw new InventoryInspectionError("stale");return new Date(row.lease).toISOString();
    },
    observer:options.observer??{async inspect(_sku,signal){signal.throwIfAborted();return inspectionFixture();}},
    planning:()=>({ selection:preparationSelection(),requirements:requirementsFixture() }),
  };
  return { workflow:createInventoryInspection(deps,options.workMs),repository,listings };
}
