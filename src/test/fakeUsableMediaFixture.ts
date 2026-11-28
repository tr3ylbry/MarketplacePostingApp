import { randomUUID } from "node:crypto";
import { mediaSessionHash, realMediaDigest } from "../application/ebayRealMedia";
import { IMAGE_COMPARISON_RECIPE } from "../infrastructure/storage/diagnosticImageDecode";
import { PHOTO_RECIPE } from "../infrastructure/storage/photoDerivative/transformPhoto";
import { FAKE_ADMISSION_CONSUMER, FAKE_ADMISSION_IDENTITY, type FakeAdmissionDependencies, type FakeAdmissionObservation, type FakeAdmissionSnapshot } from "../infrastructure/ebay/fakeUsableMediaAdmission";

// Generated data only. The IDs deliberately differ; the query is invented and
// has no claimed provider/signature meaning. No URL goes to a network client.
export const FAKE_PRIMARY = "https://eps-contract.invalid.test/photo/test_visual_"+"b".repeat(16)+".png?opaque=P%2fb+Q&x=&x=2";
export const FAKE_MAXIMUM = "https://eps-contract.invalid.test/photo/test_visual_"+"c".repeat(16)+".png?opaque=M%2fx+N&x=&x=2";
export const FAKE_LOCATION = "https://media-contract.invalid.test/image/test_resource_"+"a".repeat(16);
export function fakeUsableMediaFixture(reference: Buffer, field: FakeAdmissionSnapshot["targetField"]="maxDimensionImageUrl") {
  const start=Date.now(),iso=(ms:number)=>new Date(start+ms).toISOString(),owner=randomUUID(),session=randomUUID();
  let elapsed=0;
  const actor={ownerId:owner,id:session,expiresAt:iso(60_000)};
  const snapshot:FakeAdmissionSnapshot={ownerId:owner,environment:"sandbox",attemptId:randomUUID(),operation:"normal",revision:1,postIntentAt:iso(-1000),
    actionHash:realMediaDigest(randomUUID()),sessionHash:mediaSessionHash(owner,session),sellerKey:realMediaDigest(owner),connectionId:randomUUID(),connectionVersion:randomUUID(),
    configHash:realMediaDigest("synthetic-config"),grantHash:realMediaDigest("synthetic-grant"),listingId:randomUUID(),listingVersion:iso(-2000),imageId:randomUUID(),
    sourceVersion:realMediaDigest("synthetic-source-version"),imageOrder:0,sourceDigest:realMediaDigest(reference),derivativeDigest:realMediaDigest(reference),recipe:PHOTO_RECIPE,comparisonRecipe:IMAGE_COMPARISON_RECIPE,
    targetField:field,consumer:FAKE_ADMISSION_CONSUMER,identityPolicy:FAKE_ADMISSION_IDENTITY,sessionExpiresAt:actor.expiresAt,accessExpiresAt:iso(60_000),refreshExpiresAt:iso(120_000),
    reviewUntil:iso(60_000),leaseUntil:iso(60_000),disposition:"current"};
  const body={imageUrl:FAKE_PRIMARY,maxDimensionImageUrl:FAKE_MAXIMUM,expirationDate:iso(3_600_000)};
  const observation:FakeAdmissionObservation={response:{status:201,rawHeaders:["Content-Type","application/json","Location",FAKE_LOCATION],body:Buffer.from(JSON.stringify(body))},
    reference:Buffer.from(reference),image:{target:field==="imageUrl"?FAKE_PRIMARY:FAKE_MAXIMUM,mime:"image/png",bytes:Buffer.from(reference)}};
  const deps:FakeAdmissionDependencies={session:async()=>({...actor}),snapshot:async()=>({...snapshot}),observation:async()=>observation,
    clock:()=>Date.now()+elapsed,monotonic:()=>performance.now()+elapsed};
  return {actor,snapshot,observation,body,deps,advance(ms:number){elapsed+=ms;},setBody(patch:Record<string,unknown>){observation.response.body=Buffer.from(JSON.stringify({...body,...patch}));}};
}
export const fakeAdmissionFact=(kind:"response"|"validation"|"identity"|"settlement",outcome:"passed"|"refused"|"unknown"="passed")=>Buffer.from(JSON.stringify({
  version:"fake-admission-fact-v1",kind,outcome,reason:outcome==="passed"?({response:"bounded",validation:"validated",identity:"verified",settlement:"settled"} as const)[kind]:"changed",
}));
