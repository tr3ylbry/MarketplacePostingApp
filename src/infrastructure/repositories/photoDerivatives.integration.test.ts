import { randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createTestAuth } from "../../test/auth";
import { listingFixture } from "../../test/fixtures";
import { privacyFixture } from "../../test/photoPrivacyFixtures";
import { MemoryImageStorage } from "../../test/storage/memoryImageStorage";
import { createImageService } from "../../application/imageService";
import { createListingService } from "../../application/listingService";
import { createPhotoDerivativeService } from "../../application/photoDerivativeService";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import { photoTransformer } from "../storage/photoDerivative/transformPhoto";
import { DrizzleListingRepository } from "./drizzleListingRepository";
import { DrizzleImageRepository } from "./drizzleImageRepository";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import { cleanupImages } from "../storage/cleanupImages";
import * as schema from "../db/schema";

vi.mock("server-only",()=>({}));
const { db,pool,auth }=createTestAuth(),listings=new DrizzleListingRepository(db),images=new DrizzleImageRepository(db),connections=new DrizzleEbayConnectionRepository(db);
const transactions=new AsyncLocalStorage<boolean>();
let owner:string,foreign:string,storage:MemoryImageStorage,listingId:string,imageId:string;
const bytes=privacyFixture("metadata.jpg"),sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const reader={readPrivateImage:vi.fn()},transformer={transform:vi.fn(photoTransformer.transform)};
const service=()=>createPhotoDerivativeService(listings,images,connections,reader,transformer,"derivative-test-config");
async function derive(user=owner,signal?:AbortSignal){const listing=(await listings.getById(owner,listingId))!;return service().derive(user,listingId,listing.updatedAt,imageId,signal);}
beforeAll(()=>migrate(db,{migrationsFolder:"drizzle"}));
beforeEach(async()=>{
  vi.restoreAllMocks();vi.clearAllMocks();const helpers=(await auth.$context).test;
  owner=(await helpers.saveUser(helpers.createUser())).id;foreign=(await helpers.saveUser(helpers.createUser())).id;
  storage=new MemoryImageStorage();listingId=(await listings.create(owner,listingFixture())).id;
  const upload=await createImageService(images,storage).prepare(owner,listingId,{filename:"synthetic.jpg",contentType:"image/jpeg",size:bytes.length});imageId=upload.imageId;
  storage.objects.set(storage.uploads.get(imageId)!.pathname,{bytes:Buffer.from(bytes),type:"image/jpeg"});await createImageService(images,storage).finalize(owner,listingId,imageId);
  await db.insert(schema.ebayConnections).values({ownerId:owner,id:randomUUID(),version:randomUUID(),configHash:"derivative-test-config",status:"connected",sellerId:"synthetic-"+owner,sellerLabel:"Synthetic seller",
    access:{ciphertext:"synthetic-a",iv:"iv-a",tag:"tag-a",keyVersion:1},refresh:{ciphertext:"synthetic-r",iv:"iv-r",tag:"tag-r",keyVersion:1},
    accessExpiresAt:new Date(Date.now()-1000).toISOString(),refreshExpiresAt:new Date(Date.now()+86400000).toISOString(),connectedAt:new Date().toISOString(),scopes:[...EBAY_SCOPES]});
  const tx=db.transaction.bind(db);vi.spyOn(db,"transaction").mockImplementation((...args)=>transactions.run(true,()=>tx(...args)));
  reader.readPrivateImage.mockImplementation(async source=>{
    expect(transactions.getStore()).not.toBe(true);const row=(await db.select().from(schema.listingImages).where(eq(schema.listingImages.id,imageId)))[0];
    expect(Date.parse(row.providerRetainUntil!)).toBeGreaterThan(Date.now());return Buffer.from(storage.objects.get(source.pathname)!.bytes);
  });
  transformer.transform.mockImplementation(async(...args)=>{expect(transactions.getStore()).not.toBe(true);return photoTransformer.transform(...args);});
});
afterEach(async()=>{
  vi.useRealTimers();vi.restoreAllMocks();await db.delete(schema.listings).where(inArray(schema.listings.ownerId,[owner,foreign]));
  await db.delete(schema.users).where(inArray(schema.users.id,[owner,foreign]));const paths=[...storage.uploads.values()].map(u=>u.pathname);
  if(paths.length)await db.delete(schema.imageCleanup).where(inArray(schema.imageCleanup.pathname,paths));
});
afterAll(()=>pool.end());
it("creates internal actual-byte identities outside transactions, retains source, and preserves original product/credentials",async()=>{
  const before=await listings.getById(owner,listingId),connection=await connections.connection(owner),source=(await images.get(owner,listingId,imageId))!.source;
  if(source.kind!=="vercel-blob")throw Error();const original=Buffer.from(storage.objects.get(source.pathname)!.bytes);
  const result=await derive();expect(result.sourceDigest).toBe(sha(original));expect(result.derivativeDigest).toBe(sha(result.bytes));expect(result.derivativeDigest).not.toBe(result.sourceDigest);
  expect(storage.objects.get(source.pathname)!.bytes).toEqual(original);expect(await listings.getById(owner,listingId)).toEqual(before);expect(await connections.connection(owner)).toEqual(connection);
  expect(await db.select().from(schema.ebayMediaAttempts).where(eq(schema.ebayMediaAttempts.ownerId,owner))).toEqual([]);
  expect(await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.listingId,listingId))).toEqual([]);
  expect(Object.keys(result).sort()).toEqual(["bytes","contentType","derivativeDigest","height","recipe","size","sourceDigest","width"].sort());
});
it("denies cross-owner listing/image access before source reads or native work",async()=>{
  await expect(derive(foreign)).rejects.toMatchObject({code:"stale"});expect(reader.readPrivateImage).not.toHaveBeenCalled();expect(transformer.transform).not.toHaveBeenCalled();
});
it.each(["edit","source","reconnect","disconnect","expiry"])("rejects a native result after concurrent %s without persisting derivative bytes",async kind=>{
  transformer.transform.mockImplementationOnce(async(...args)=>{
    const result=await photoTransformer.transform(...args);
    if(kind==="edit"){const l=(await listings.getById(owner,listingId))!;await listings.update(owner,{...l,title:"Changed locally",updatedAt:new Date(Date.parse(l.updatedAt)+1000).toISOString()},l.updatedAt);}
    if(kind==="source")await db.update(schema.listingImages).set({byteSize:bytes.length+1}).where(eq(schema.listingImages.id,imageId));
    if(kind==="reconnect"||kind==="disconnect"||kind==="expiry")await db.update(schema.ebayConnections).set({version:randomUUID(),...(kind==="disconnect"?{status:"disconnected"}:{}),...(kind==="expiry"?{refreshExpiresAt:new Date(Date.now()-1).toISOString()}:{})}).where(eq(schema.ebayConnections.ownerId,owner));
    return result;
  });
  await expect(derive()).rejects.toMatchObject({code:"stale"});
});
it.each(["image","listing"])("retains physical source after %s deletion during native work, then cleans only its due orphan",async kind=>{
  const source=(await images.get(owner,listingId,imageId))!.source;if(source.kind!=="vercel-blob")throw Error();
  const unrelated=await listings.create(foreign,listingFixture());
  transformer.transform.mockImplementationOnce(async(...args)=>{
    const result=await photoTransformer.transform(...args);
    if(kind==="image")await createImageService(images,storage).remove(owner,listingId,imageId);else await createListingService(listings,storage).deleteListing(owner,listingId);
    expect(storage.objects.has(source.pathname)).toBe(true);return result;
  });
  await expect(derive()).rejects.toMatchObject({code:"stale"});
  const [entry]=await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname,source.pathname));expect(Date.parse(entry.notBefore)).toBeGreaterThan(Date.now()+15000);
  await cleanupImages(db,storage);expect(storage.deleted).not.toContain(source.pathname);
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.parse(entry.notBefore)+1);await cleanupImages(db,storage);
  expect(storage.objects.has(source.pathname)).toBe(false);expect(await listings.getById(foreign,unrelated.id)).not.toBeNull();
});
it("does not shorten longer retention on a failed transformation",async()=>{
  const longer=new Date(Date.now()+3600000).toISOString();await images.retainForProvider(owner,listingId,imageId,longer);
  transformer.transform.mockRejectedValueOnce(new Error("private native data"));await expect(derive()).rejects.toMatchObject({code:"invalid"});
  expect(new Date((await db.select().from(schema.listingImages).where(eq(schema.listingImages.id,imageId)))[0].providerRetainUntil!).toISOString()).toBe(longer);
});
it("fails before byte access if the retention transaction fails",async()=>{
  vi.spyOn(images,"retainForProvider").mockRejectedValueOnce(new Error("private DB failure"));await expect(derive()).rejects.toMatchObject({code:"invalid"});expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it("keeps cancelled operations from promoting real native output",async()=>{
  const c=new AbortController();transformer.transform.mockImplementationOnce(async(...args)=>{const result=await photoTransformer.transform(...args);c.abort();return result;});
  await expect(derive(owner,c.signal)).rejects.toMatchObject({code:"aborted"});expect(await listings.getById(owner,listingId)).not.toBeNull();
});
