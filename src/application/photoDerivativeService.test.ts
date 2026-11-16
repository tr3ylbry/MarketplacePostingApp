// @vitest-environment node
import { createPhotoDerivativeService } from "./photoDerivativeService";
import { EBAY_SCOPES, type EbayConnection } from "./ebayConnection";
import { listingFixture } from "../test/fixtures";
import { blobImageSourceSchema, type ListingImage } from "../domain/listingImage";
import type { Listing } from "../domain/listing";
import { PRIVATE_IMAGE_REVIEW_MS } from "./ebayPrivateImages";
import { CLEANUP_GRACE_MS } from "./imageStorage";
import { PHOTO_DERIVATIVE_MS, type PhotoDerivative } from "./photoDerivative";

const owner="derivative-owner",now=new Date("2026-11-16T10:00:00Z");
let listing:Listing,image:ListingImage,connection:EbayConnection;
const listings={getById:vi.fn()},images={get:vi.fn(),retainForProvider:vi.fn()},connections={connection:vi.fn()};
const reader={readPrivateImage:vi.fn()},transformer={transform:vi.fn()};
const result:PhotoDerivative={bytes:Buffer.from("generated derivative"),width:500,height:600,size:20,contentType:"image/png",sourceDigest:"source-digest",derivativeDigest:"actual-export-digest",recipe:"test-recipe"};
const service=()=>createPhotoDerivativeService(listings,images,connections,reader,transformer,"config",()=>now);
const derive=(signal?:AbortSignal)=>service().derive(owner,listing.id,listing.updatedAt,image.id,signal);
beforeEach(()=>{
  vi.restoreAllMocks();vi.resetAllMocks();listing=listingFixture();
  image={id:"4ea3182c-53f6-49ba-b208-aadf2e4d6e5b",listingId:listing.id,order:0,source:blobImageSourceSchema.parse({kind:"vercel-blob",pathname:"images/4ea3182c-53f6-49ba-b208-aadf2e4d6e5b/photo.png",originalFilename:"private-name.png",contentType:"image/png",size:12,uploadedAt:now.toISOString()})};
  connection={ownerId:owner,environment:"sandbox",id:"connection",version:"v1",configHash:"config",status:"connected",sellerId:"verified-test-seller",sellerLabel:"Synthetic seller",access:{ciphertext:"encrypted-a",iv:"iv1",tag:"tag1",keyVersion:1},refresh:{ciphertext:"encrypted-r",iv:"iv2",tag:"tag2",keyVersion:1},accessExpiresAt:"2026-11-01T00:00:00Z",refreshExpiresAt:"2027-01-01T00:00:00Z",connectedAt:now.toISOString(),scopes:[...EBAY_SCOPES],leaseToken:null,leaseUntil:null};
  listings.getById.mockImplementation(async user=>user===owner?{...listing}:null);
  images.get.mockImplementation(async()=>({...image,source:{...image.source}}));
  images.retainForProvider.mockResolvedValue(image.source.kind==="vercel-blob"?image.source.pathname:"");
  connections.connection.mockImplementation(async()=>({...connection,scopes:[...connection.scopes]}));
  reader.readPrivateImage.mockResolvedValue(Buffer.alloc(12));transformer.transform.mockResolvedValue(result);
});
afterEach(()=>{vi.restoreAllMocks();});
it("commits an owner-scoped source hold before reads and returns only an internal derivative",async()=>{
  reader.readPrivateImage.mockImplementation(async()=>{expect(images.retainForProvider).toHaveBeenCalledWith(owner,listing.id,image.id,new Date(now.getTime()+PRIVATE_IMAGE_REVIEW_MS+CLEANUP_GRACE_MS).toISOString());return Buffer.alloc(12);});
  expect(await derive()).toBe(result);expect(transformer.transform).toHaveBeenCalledOnce();expect(connections.connection).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toMatch(/pathname|private-name|ciphertext|seller|capability|Bearer/);
});
it("denies foreign identity before connection/storage access",async()=>{
  await expect(service().derive("foreign",listing.id,listing.updatedAt,image.id)).rejects.toMatchObject({code:"stale"});expect(connections.connection).not.toHaveBeenCalled();expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["missing","version","image-id","image-listing","legacy","webp"])("denies invalid %s input before retention/reading",async kind=>{
  if(kind==="missing")listings.getById.mockResolvedValue(null);
  const version=kind==="version"?"2000-01-01T00:00:00.000Z":listing.updatedAt;
  if(kind==="image-id")image.id="other";
  if(kind==="image-listing")image.listingId="other";
  if(kind==="legacy")image.source={kind:"filename",name:"legacy.png"};
  if(kind==="webp")image.source={...image.source,contentType:"image/webp"} as ListingImage["source"];
  await expect(service().derive(owner,listing.id,version,"4ea3182c-53f6-49ba-b208-aadf2e4d6e5b")).rejects.toBeInstanceOf(Error);
  expect(images.retainForProvider).not.toHaveBeenCalled();expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["owner","environment","status","seller","config","expiry","scope","ciphertext"])("denies unusable connection %s without token/provider access",async kind=>{
  if(kind==="owner")connection.ownerId="foreign";
  if(kind==="environment")connection.environment="production";
  if(kind==="status")connection.status="disconnected";
  if(kind==="seller")connection.sellerId=null;
  if(kind==="config")connection.configHash="other";
  if(kind==="expiry")connection.refreshExpiresAt=now.toISOString();
  if(kind==="scope")connection.scopes=["unsupported"];
  if(kind==="ciphertext")connection.access=null;
  await expect(derive()).rejects.toMatchObject({code:"unavailable"});expect(images.retainForProvider).not.toHaveBeenCalled();expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it.each(["image","listing","version","source","connection","disconnect","seller","scope","expiry"])("discards internal bytes after a concurrent %s change",async kind=>{
  transformer.transform.mockImplementationOnce(async()=>{
    if(kind==="image")images.get.mockResolvedValue(null);
    if(kind==="listing")listings.getById.mockResolvedValue(null);
    if(kind==="version")listing.updatedAt="2000-01-01T00:00:00.000Z";
    if(kind==="source"&&image.source.kind==="vercel-blob")image.source={...image.source,size:13};
    if(kind==="connection")connection.version="v2";
    if(kind==="disconnect")connection.status="disconnected";
    if(kind==="seller")connection.sellerId="changed";
    if(kind==="scope")connection.scopes=["unsupported"];
    if(kind==="expiry")connection.refreshExpiresAt=now.toISOString();return result;
  });
  await expect(derive()).rejects.toMatchObject({code:"stale"});
});
it("never reads after retention failure or a mismatched trusted pathname",async()=>{
  images.retainForProvider.mockRejectedValueOnce(new Error("private DB failure"));await expect(derive()).rejects.toMatchObject({code:"invalid"});
  images.retainForProvider.mockResolvedValueOnce("other");await expect(derive()).rejects.toMatchObject({code:"stale"});expect(reader.readPrivateImage).not.toHaveBeenCalled();
});
it("rejects changed byte length and exposes no raw storage/encoder failure details",async()=>{
  reader.readPrivateImage.mockResolvedValueOnce(Buffer.alloc(13));await expect(derive()).rejects.toMatchObject({code:"invalid"});
  for(const fn of [reader.readPrivateImage,transformer.transform]){fn.mockRejectedValueOnce(new Error("Bearer private-token images/private-name"));await expect(derive()).rejects.not.toThrow(/private-token|private-name/);}
});
it("holds two global capacity slots after abort until both started native-style operations settle",async()=>{
  const releases:((value:PhotoDerivative)=>void)[]=[];
  transformer.transform.mockImplementation(()=>new Promise<PhotoDerivative>(resolve=>releases.push(resolve)));
  const c=new AbortController(),a=derive(c.signal),b=derive(c.signal);const settled=Promise.allSettled([a,b]);
  await vi.waitFor(()=>expect(releases).toHaveLength(2));c.abort();
  await expect(derive()).rejects.toMatchObject({code:"busy"});expect(transformer.transform).toHaveBeenCalledTimes(2);
  releases[0](result);await expect(a).rejects.toMatchObject({code:"aborted"});
  releases[1](result);const outcomes=await settled;expect(outcomes.every(r=>r.status==="rejected"&&r.reason.code==="aborted")).toBe(true);
  transformer.transform.mockResolvedValue(result);await expect(derive()).resolves.toBe(result);
});
it("checks the wall eligibility deadline without a Promise.race that releases native capacity",async()=>{
  const start=performance.now();transformer.transform.mockImplementation(async()=>{vi.spyOn(performance,"now").mockReturnValue(start+PHOTO_DERIVATIVE_MS+1000);return result;});
  await expect(derive()).rejects.toMatchObject({code:"aborted"});
});
it("does not start work for a pre-aborted call",async()=>{
  const c=new AbortController();c.abort();await expect(derive(c.signal)).rejects.toMatchObject({code:"aborted"});expect(listings.getById).not.toHaveBeenCalled();
});
