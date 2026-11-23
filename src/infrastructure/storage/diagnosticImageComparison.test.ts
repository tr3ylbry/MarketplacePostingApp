// @vitest-environment node
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { realMediaDigest } from "../../application/ebayRealMedia";
import { acquirePhotoCapacity,releasePhotoCapacity } from "../../application/photoCapacity";
import { IMAGE_COMPARISON as policy, MARKER } from "../../application/imageComparison";
import { verificationFixturePixels,generateVerificationFixture } from "./verificationFixture";
import { prepareImageReference,startImageComparison,discardImageReference,type ImageComparisonOperation } from "./diagnosticImageComparison";
import { inspectDiagnosticContainer } from "./diagnosticImageDecode";
import { markerPixels,visualMetrics } from "./visualMetrics";
import { mapPng, extraPng } from "../../test/photoPrivacyFixtures";
vi.mock("server-only",()=>({}));
const owned:ReturnType<typeof acquirePhotoCapacity>[]=[],refs:unknown[]=[],ops:ImageComparisonOperation[]=[];
const capacity=()=>{const c=acquirePhotoCapacity();owned.push(c);return c;};
const window=()=>({wallUntil:Date.now()+20_000,monoUntil:performance.now()+20_000});
const png=(raw:Buffer)=>sharp(raw,{raw:{width:500,height:600,channels:3}}).png().toBuffer();
let expected:Buffer;
beforeAll(async()=>{const raw=verificationFixturePixels(Buffer.from(Array.from({length:16},(_,i)=>i*13)));try{expected=await png(raw);}finally{raw.fill(0);}});
afterEach(async()=>{for(const op of ops){op.cancel();await op.settled;}ops.length=0;refs.forEach(discardImageReference);refs.length=0;owned.forEach(releasePhotoCapacity);owned.length=0;});
async function reference(){const binding={operationId:randomUUID(),derivativeDigest:realMediaDigest(expected)},lease=capacity(),signal=new AbortController();const ref=await prepareImageReference(expected,binding,window(),signal.signal,lease);refs.push(ref);return{ref,binding,lease,signal};}
async function compare(bytes:Buffer,mime="image/png"){
 const v=await reference(),op=startImageComparison(v.ref,v.binding,bytes,mime,window(),v.signal.signal,v.lease);ops.push(op);const result=await op.result;await op.settled;return result;
}
it("blocks real network, SDK, private configuration and database access",assertOfflineGuards);
it("generates distinct opaque RGB fixtures with a unique 128-bit visual marker",async()=>{
 const a=await generateVerificationFixture(),b=await generateVerificationFixture();
 expect(a.sourceDigest).not.toBe(b.sourceDigest);expect(inspectDiagnosticContainer(a.bytes,"image/png")).toBe("png");
 const m=await sharp(a.bytes).metadata();expect(m).toMatchObject({width:500,height:600,channels:3,depth:"uchar",hasAlpha:false});expect(m.exif||m.icc||m.xmp||m.iptc).toBeUndefined();
});
it.each(["png","jpeg95-444","jpeg85-420","jpeg70-progressive"])("fully decodes legitimate %s re-encoding against the exact export",async kind=>{
 const bytes=kind==="png"?await sharp(expected).png({compressionLevel:9,adaptiveFiltering:true,progressive:true}).toBuffer():await sharp(expected).jpeg({quality:kind.startsWith("jpeg95")?95:kind.startsWith("jpeg85")?85:70,chromaSubsampling:kind.includes("444")?"4:4:4":"4:2:0",progressive:kind.includes("progressive")}).toBuffer();
 const before=Buffer.from(expected),result=await compare(bytes,kind==="png"?"image/png":"image/jpeg");
 expect(realMediaDigest(bytes)).not.toBe(realMediaDigest(expected));expect(result).toMatchObject({verdict:"match",decoding:"passed",geometry:"passed",marker:"passed",color:"passed",similarity:"passed",associated:false,settlement:"settled"});expect(result.metrics?.markerErrors).toBe(0);expect(expected).toEqual(before);
});
it.each(["unrelated","other-marker","one-bit-marker","cue-only","missing-marker","crop","rotate","mirror","color","detail"])("refuses %s without transformation search",async kind=>{
 let raw=verificationFixturePixels(Buffer.from(Array.from({length:16},(_,i)=>i*13))),bytes:Buffer;
 if(kind==="unrelated")raw.fill(130);
 if(kind==="other-marker")raw=verificationFixturePixels(Buffer.alloc(16,0xee));
 if(kind==="one-bit-marker")for(let y=MARKER.y+16+4;y<MARKER.y+16+12;y++)for(let x=MARKER.x+2*16+4;x<MARKER.x+2*16+12;x++)for(let c=0;c<3;c++)raw[(y*500+x)*3+c]=255-raw[(y*500+x)*3+c];
 if(kind==="cue-only")for(let y=554;y<558;y++)for(let x=24;x<28;x++)for(let c=0;c<3;c++)raw[(y*500+x)*3+c]=255-raw[(y*500+x)*3+c];
 if(kind==="missing-marker")for(let y=MARKER.y;y<MARKER.y+128;y++)raw.fill(245,(y*500+MARKER.x)*3,(y*500+MARKER.x+288)*3);
 if(kind==="color")for(let i=0;i<raw.length;i+=3){raw[i]=255-raw[i];raw[i+1]=255-raw[i+1];}
 if(kind==="detail")for(let y=125;y<275;y++)raw.fill(245,(y*500+20)*3,(y*500+480)*3);
 bytes=await png(raw);raw.fill(0);
 if(kind==="crop")bytes=await sharp(bytes).extract({left:15,top:15,width:470,height:570}).resize(500,600).png().toBuffer();
 if(kind==="rotate")bytes=await sharp(bytes).rotate(90).png().toBuffer();
 if(kind==="mirror")bytes=await sharp(bytes).flop().png().toBuffer();
 const result=await compare(bytes);expect(result.verdict).not.toBe("match");expect(result.associated).toBe(false);
 if(kind==="other-marker"||kind==="missing-marker")expect(result.marker).toBe("failed");
 if(kind==="one-bit-marker")expect(result).toMatchObject({orientation:"passed",marker:"failed",similarity:"passed",color:"passed",metrics:{markerErrors:1}});
 if(kind==="cue-only")expect(result).toMatchObject({orientation:"failed",marker:"passed",similarity:"passed",color:"passed",metrics:{orientationErrors:1}});
 if(kind==="rotate")expect(result.geometry).toBe("failed");
});
it.each(["truncated","crc","partial-corruption","oversized","gif","alpha","gray","depth","huge","exif","icc","animation","metadata","chunk-count"])("fails closed on %s provider input",async kind=>{
 let bytes=Buffer.from(expected),mime="image/png";
 if(kind==="truncated")bytes=bytes.subarray(0,bytes.length-20);
 if(kind==="crc"){bytes=Buffer.from(bytes);bytes[bytes.length-1]^=1;}
 if(kind==="partial-corruption")bytes=mapPng(bytes,(type,data)=>{const v=Buffer.from(data);if(type==="IDAT")v.fill(0,Math.floor(v.length/3),Math.floor(v.length*2/3));return v;});
 if(kind==="oversized")bytes=Buffer.alloc(policy.encodedBytes+1);
 if(kind==="gif"){bytes=await sharp(expected).gif().toBuffer();mime="image/gif";}
 if(kind==="alpha")bytes=await sharp(expected).ensureAlpha().png().toBuffer();
 if(kind==="gray"){bytes=await sharp(expected).toColourspace("b-w").png().toBuffer();expect((await sharp(bytes).metadata()).channels).toBe(1);}
 if(kind==="depth")bytes=await sharp(expected).toColourspace("rgb16").png().toBuffer();
 if(kind==="huge")bytes=await sharp({create:{width:501,height:600,channels:3,background:"white"}}).png().toBuffer();
 if(kind==="exif")bytes=await sharp(expected).withExif({IFD0:{Orientation:"6"}}).png().toBuffer();
 if(kind==="icc")bytes=await sharp(expected).withIccProfile("p3").png().toBuffer();
 if(kind==="animation")bytes=await readFile(new URL("../../test/fixtures/image-comparison/animated.png",import.meta.url));
 if(kind==="metadata")bytes=await readFile(new URL("../../test/fixtures/image-comparison/metadata-over.png",import.meta.url));
 if(kind==="chunk-count")for(let i=0;i<260;i++)bytes=extraPng(bytes,"tEXt",Buffer.from("Comment\0x"));
 const result=await compare(bytes,mime);expect(result.verdict).toBe("inconclusive");expect(result.associated).toBe(false);
});
it("does not round numerical rejection boundaries down to a passing score",()=>{
 const reference=Buffer.alloc(900_000,100),returned=Buffer.alloc(900_000,108);returned[0]=109;
 const result=visualMetrics(reference,returned,()=>{});expect(result.mae).toBeGreaterThan(policy.mae);expect(result.mae).toBeLessThan(policy.mae+0.00001);
});
it.each(["independent.png","independent-q85.jpg"])("accepts independently encoded Pillow %s with the specified marker",async filename=>{
 const bytes=await readFile(new URL("../../test/fixtures/image-comparison/"+filename,import.meta.url));
 expect((await compare(bytes,filename.endsWith("jpg")?"image/jpeg":"image/png")).verdict).toBe("match");
});
it.each(["exif1","srgb-icc"])("accepts bounded standard JPEG %s metadata without requiring our export container",async kind=>{
 const image=sharp(expected).jpeg({quality:95});
 const bytes=await(kind==="exif1"?image.withExif({IFD0:{Orientation:"1"},IFD2:{ColorSpace:"1"}}):image.withIccProfile("srgb")).toBuffer();
 expect((await compare(bytes,"image/jpeg")).verdict).toBe("match");
});
it.each(["forged","clone","binding","digest","replay","cancelled","deadline"])("burns and rejects %s references",async kind=>{
 const value=await reference(),binding={...value.binding},w=window();let ref:unknown=value.ref;
 if(kind==="forged"||kind==="clone")ref={};if(kind==="binding")binding.operationId=randomUUID();if(kind==="digest")binding.derivativeDigest="0".repeat(64);
 if(kind==="cancelled")value.signal.abort();if(kind==="deadline")w.wallUntil=Date.now()-1;
 if(kind==="replay"){const first=startImageComparison(ref,binding,expected,"image/png",w,value.signal.signal,value.lease);ops.push(first);expect((await first.result).verdict).toBe("match");await first.settled;}
 const op=startImageComparison(ref,binding,expected,"image/png",w,value.signal.signal,value.lease);ops.push(op);expect((await op.result).verdict).toBe("inconclusive");await op.settled;
});
it("checks marker extraction with an independent centre-pixel vector",()=>{
 const raw=Buffer.alloc(500*600*3,20),bits=Array.from({length:144},(_,i)=>i%3===0?"1":"0").join("");
 for(let i=0;i<144;i++)for(let y=MARKER.y+Math.floor(i/18)*16+4;y<MARKER.y+Math.floor(i/18)*16+12;y++)for(let x=MARKER.x+i%18*16+4;x<MARKER.x+i%18*16+12;x++)raw.fill(bits[i]==="1"?235:20,(y*500+x)*3,(y*500+x)*3+3);
 expect(markerPixels(raw)).toEqual({bits,margin:107});expect(visualMetrics(raw,Buffer.from(raw),()=>{})).toMatchObject({mae:0,rmse:0,tileMae:0,markerErrors:0,anchorDelta:0});
});
