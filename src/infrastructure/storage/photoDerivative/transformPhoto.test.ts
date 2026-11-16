// @vitest-environment node
import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { alphaPng, extraPng, jpegSegment, mapJpeg, mapPng, metadataBudgetJpeg, orientationJpeg, privacyFixture, solidPng } from "../../../test/photoPrivacyFixtures";
import { MAX_IMAGE_BYTES } from "../../../domain/listingImage";
import { MAX_PHOTO_METADATA_BYTES } from "../../../application/photoDerivative";
import { classifyPhoto, dimensions, encodedBudget, finalContainer } from "./photoContainer";
import { createPhotoTransformer, photoTransformer, PHOTO_RECIPE } from "./transformPhoto";

vi.mock("server-only", () => ({}));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const transform = (bytes: Buffer, type = "image/jpeg", signal = new AbortController().signal) => photoTransformer.transform(bytes, type, signal, performance.now() + 15_000);

it("removes the generated EXIF/GPS/thumbnail/XMP/IPTC/comment payloads and hashes exact distinct bytes", async () => {
  const bytes = privacyFixture("metadata.jpg"), snapshot = Buffer.from(bytes), result = await transform(bytes);
  expect(bytes).toEqual(snapshot); expect(result.sourceDigest).toBe(sha(bytes)); expect(result.derivativeDigest).toBe(sha(result.bytes));
  expect(result.sourceDigest).not.toBe(result.derivativeDigest); expect(result.recipe).toBe(PHOTO_RECIPE);
  expect(result.bytes.includes(Buffer.from("SYNTHETIC_"))).toBe(false);
  const m = await sharp(result.bytes).metadata(); expect(m.exif || m.xmp || m.iptc || m.icc || m.orientation).toBeFalsy();
  expect(finalContainer(result.bytes, "image/jpeg")).toEqual(result.bytes);
});
const corners = [[0,1,2,3],[1,0,3,2],[3,2,1,0],[2,3,0,1],[0,2,1,3],[2,0,3,1],[3,1,2,0],[1,3,0,2]];
it.each([1,2,3,4,5,6,7,8])("applies EXIF orientation %i, including the correct mirrored corner positions", async orientation => {
  const input = orientationJpeg(orientation), original = await sharp(input).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const result = await transform(input), output = await sharp(result.bytes).raw().toBuffer({resolveWithObject:true});
  expect([result.width,result.height]).toEqual(orientation >= 5 ? [480,640] : [640,480]);
  const sample = (b: Buffer, w: number, h: number, n: number) => { const x = n % 2 ? w-25 : 25, y = n >= 2 ? h-25 : 25; return [...b.subarray((y*w+x)*3,(y*w+x)*3+3)]; };
  for(let i=0;i<4;i++) { const actual=sample(output.data,result.width,result.height,i), expected=sample(original.data,640,480,corners[orientation-1][i]);
    actual.forEach((v,j)=>expect(Math.abs(v-expected[j])).toBeLessThan(8)); }
});
it.each([0,9,65535])("rejects invalid explicit EXIF orientation %i", async o => { await expect(transform(orientationJpeg(o))).rejects.toMatchObject({code:"invalid"}); });
it.each(["conflict","xmp-only","duplicate-exif","duplicate-xmp","malformed-exif","entity","duplicate-orientation","namespace","depth","color"])("fails closed for %s metadata", async kind => {
  let bytes=privacyFixture("metadata.jpg");
  if(kind==="conflict")bytes=orientationJpeg(6,8);
  if(kind==="xmp-only")bytes=mapJpeg(orientationJpeg(6), (m,b)=>m===225&&b.toString("ascii",0,6)==="Exif\0\0"?null:b);
  if(kind==="duplicate-exif"||kind==="duplicate-xmp"){
    let duplicate:Buffer|undefined;mapJpeg(bytes,(m,b)=>{if(m===225&&(b.toString("ascii",0,6)==="Exif\0\0")===(kind==="duplicate-exif"))duplicate=jpegSegment(m,b);return b;});
    bytes=Buffer.concat([bytes.subarray(0,2),duplicate!,bytes.subarray(2)]);
  }
  if(kind==="malformed-exif")bytes=mapJpeg(bytes,(m,b)=>{if(m!==225||b.toString("ascii",0,6)!=="Exif\0\0")return b;const c=Buffer.from(b);c.writeUInt32LE(0x7fffffff,10);return c;});
  if(["entity","duplicate-orientation","namespace","depth","color"].includes(kind))bytes=mapJpeg(bytes,(m,b)=>{
    if(m!==225||b.toString("ascii",0,6)==="Exif\0\0")return b;
    let s=b.toString();if(kind==="entity")s=s.replace("<x:xmpmeta","<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///unread'>]><x:xmpmeta");
    if(kind==="duplicate-orientation")s=s.replace('tiff:Orientation="1"','tiff:Orientation="1" tiff:Orientation="1"');
    if(kind==="namespace")s=s.replace("http://ns.adobe.com/tiff/1.0/","urn:unsupported");
    if(kind==="depth")s=s.replace("</x:xmpmeta>","<rdf:Bag>".repeat(20)+"</rdf:Bag>".repeat(20)+"</x:xmpmeta>");
    if(kind==="color")s=s.replace('tiff:Orientation="1"','tiff:Orientation="1" tiff:Gamma="2.2"');return Buffer.from(s);
  });
  await expect(transform(bytes)).rejects.toMatchObject({code:"invalid"});
});
it.each(["srgb","uncalibrated","unsupported","conflicting-profile","calibrated-profile"])("handles explicit EXIF color interpretation %s conservatively",async kind=>{
  const base=kind.includes("profile")?await sharp(await solidPng()).withIccProfile("p3").jpeg().toBuffer():mapJpeg(privacyFixture("metadata.jpg"),(m,b)=>m===225?null:b);
  const t=Buffer.alloc(56);t.write("II");t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);t.writeUInt16LE(2,8);
  t.writeUInt16LE(274,10);t.writeUInt16LE(3,12);t.writeUInt32LE(1,14);t.writeUInt16LE(1,18);
  t.writeUInt16LE(34665,22);t.writeUInt16LE(4,24);t.writeUInt32LE(1,26);t.writeUInt32LE(38,30);
  t.writeUInt16LE(1,38);t.writeUInt16LE(40961,40);t.writeUInt16LE(3,42);t.writeUInt32LE(1,44);t.writeUInt16LE(kind==="uncalibrated"||kind==="calibrated-profile"?65535:kind==="unsupported"?2:1,48);
  const input=Buffer.concat([base.subarray(0,2),jpegSegment(225,Buffer.concat([Buffer.from("Exif\0\0"),t])),base.subarray(2)]);
  if(kind==="srgb"||kind==="calibrated-profile")await expect(transform(input)).resolves.toMatchObject({width:kind==="srgb"?640:500});else await expect(transform(input)).rejects.toMatchObject({code:"invalid"});
});
it("accepts bounded xpacket wrappers and progressive JPEG input without retaining either",async()=>{
  const source=mapJpeg(privacyFixture("metadata.jpg"),(m,b)=>{
    const prefix="http://ns.adobe.com/xap/1.0/\0";
    if(m!==225||!b.subarray(0,prefix.length).equals(Buffer.from(prefix)))return b;
    return Buffer.from(prefix+'<?xpacket begin="" id="synthetic"?>'+b.subarray(prefix.length).toString()+'<?xpacket end="w"?>');
  });
  await expect(transform(source)).resolves.toMatchObject({width:640});
  await expect(transform(await sharp(await solidPng()).jpeg({progressive:true}).toBuffer())).resolves.toMatchObject({width:500});
});
it("handles a JPEG with no EXIF/XMP as orientation one",async()=>{
  const bytes=mapJpeg(privacyFixture("metadata.jpg"),(m,b)=>m===225?null:b);expect((await transform(bytes)).width).toBe(640);
});
it("preserves PNG RGBA, including semi-transparent edges, and omits text and pHYs",async()=>{
  let input=alphaPng();const density=Buffer.alloc(9);density.writeUInt32BE(11811);density.writeUInt32BE(5906,4);density[8]=1;
  input=extraPng(input,"pHYs",density);const before=sha(input),result=await transform(input,"image/png");
  const [a,b]=await Promise.all([sharp(input).raw().toBuffer(),sharp(result.bytes).raw().toBuffer()]);expect(a).toEqual(b);expect(sha(input)).toBe(before);
  const names:string[]=[];mapPng(result.bytes,(t,b)=>{names.push(t);return b;});expect(names.every(n=>["IHDR","IDAT","IEND"].includes(n))).toBe(true);
  expect(result.bytes.includes(Buffer.from("SYNTHETIC_"))).toBe(false);
});
it.each(["iCCP","zTXt","iTXt","eXIf","vpAg","acTL","PLTE"])("does not expand PNG admission to %s",async type=>{
  await expect(transform(extraPng(await solidPng(),type,Buffer.from("synthetic")),"image/png")).rejects.toMatchObject({code:"invalid"});
});
it("rejects gamma-only/conflicting color signaling and permits explicit standard sRGB signaling",async()=>{
  const source=await solidPng(),gamma=Buffer.alloc(4);gamma.writeUInt32BE(100000);
  await expect(transform(extraPng(source,"gAMA",gamma),"image/png")).rejects.toMatchObject({code:"invalid"});
  gamma.writeUInt32BE(45455);await expect(transform(extraPng(source,"gAMA",gamma),"image/png")).rejects.toMatchObject({code:"invalid"});
  await expect(transform(extraPng(extraPng(source,"gAMA",gamma),"sRGB",Buffer.from([0])),"image/png")).resolves.toMatchObject({contentType:"image/png"});
});
it.each(["srgb","p3"])("admits only the exact bounded built-in %s JPEG profile and strips it after conversion",async profile=>{
  const input=await sharp(await solidPng()).withIccProfile(profile).jpeg({quality:98,chromaSubsampling:"4:4:4"}).toBuffer();
  const source=await sharp(input).metadata(),result=await transform(input);expect(source.icc?.length).toBe(480);expect((await sharp(result.bytes).metadata()).icc).toBeUndefined();
  const pixel=await sharp(result.bytes).raw().toBuffer();[68,102,136].forEach((v,i)=>expect(Math.abs(pixel[i]-v)).toBeLessThanOrEqual(3));
  const bad=mapJpeg(input,(m,b)=>{if(m!==226)return b;const copy=Buffer.from(b);copy[copy.length-1]^=1;return copy;});
  await expect(transform(bad)).rejects.toMatchObject({code:"invalid"});
});
it("rejects ICC duplicate/gapped chunk sets before the encoder",async()=>{
  const source=await sharp(await solidPng()).withIccProfile("srgb").jpeg().toBuffer();let chunk:Buffer|undefined;
  mapJpeg(source,(m,b)=>{if(m===226)chunk=jpegSegment(m,b);return b;});
  await expect(transform(Buffer.concat([source.subarray(0,2),chunk!,source.subarray(2)]))).rejects.toMatchObject({code:"invalid"});
  const missing=mapJpeg(source,(m,b)=>{if(m!==226)return b;const copy=Buffer.from(b);copy[13]=2;return copy;});
  await expect(transform(missing)).rejects.toMatchObject({code:"invalid"});
});
it("admits complete split chunks for an exact profile, but refuses a different otherwise-valid sRGB profile",async()=>{
  const source=await sharp(await solidPng()).withIccProfile("srgb").jpeg().toBuffer();let profile:Buffer|undefined;
  const bare=mapJpeg(source,(m,b)=>{if(m===226){profile=b.subarray(14);return null;}return b;});
  const chunk=(n:number,p:Buffer)=>jpegSegment(226,Buffer.concat([Buffer.from("ICC_PROFILE\0"),Buffer.from([n,2]),p]));
  const split=Buffer.concat([bare.subarray(0,2),chunk(1,profile!.subarray(0,240)),chunk(2,profile!.subarray(240)),bare.subarray(2)]);
  await expect(transform(split)).resolves.toMatchObject({width:500,height:600});
  const other=privacyFixture("other-valid-srgb.icc"),foreign=Buffer.concat([bare.subarray(0,2),jpegSegment(226,Buffer.concat([Buffer.from("ICC_PROFILE\0\x01\x01"),other])),bare.subarray(2)]);
  await expect(transform(foreign)).rejects.toMatchObject({code:"invalid"});
});
it("supports classic big-endian EXIF without mistaking invalid/duplicate IFDs for missing orientation",async()=>{
  const original=mapJpeg(privacyFixture("metadata.jpg"),(m,b)=>m===225?null:b),tiff=Buffer.alloc(26);
  tiff.write("MM");tiff.writeUInt16BE(42,2);tiff.writeUInt32BE(8,4);tiff.writeUInt16BE(1,8);tiff.writeUInt16BE(274,10);tiff.writeUInt16BE(3,12);tiff.writeUInt32BE(1,14);tiff.writeUInt16BE(6,18);
  const input=Buffer.concat([original.subarray(0,2),jpegSegment(225,Buffer.concat([Buffer.from("Exif\0\0"),tiff])),original.subarray(2)]);
  await expect(transform(input)).resolves.toMatchObject({width:480,height:640});
  const duplicate=mapJpeg(privacyFixture("metadata.jpg"),(m,b)=>{if(m!==225||b.toString("ascii",0,6)!=="Exif\0\0")return b;const c=Buffer.from(b),offset=c.readUInt32LE(10)+6;c.writeUInt16LE(274,offset+2);return c;});
  await expect(transform(duplicate)).rejects.toMatchObject({code:"invalid"});
});
it.each(["jpeg","png"])("normalizes unprofiled grayscale %s to untagged RGB",async format=>{
  const pipeline=sharp({create:{width:500,height:600,channels:3,background:"#888888"}}).toColourspace("b-w");
  const input=await (format==="jpeg"?pipeline.jpeg():pipeline.png()).toBuffer(),result=await transform(input,"image/"+format);
  const m=await sharp(result.bytes).metadata();expect(m.space).toBe("srgb");expect(m.channels).toBe(3);expect(m.icc).toBeUndefined();
});
it.each(["cmyk","16bit"])("rejects unsupported %s rather than converting permissively",async kind=>{
  const p=sharp({create:{width:500,height:600,channels:3,background:"red"}});
  const bytes=await (kind==="cmyk"?p.toColourspace("cmyk").jpeg():p.toColourspace("rgb16").png()).toBuffer();
  await expect(transform(bytes,kind==="cmyk"?"image/jpeg":"image/png")).rejects.toMatchObject({code:"invalid"});
});
it.each(["truncated","concatenated","spoofed","corrupt-crc","malformed-text","iptc"])("rejects %s input with a safe error",async kind=>{
  let b=privacyFixture("metadata.jpg"),type="image/jpeg";
  if(kind==="truncated")b=b.subarray(0,b.length-5);
  if(kind==="concatenated")b=Buffer.concat([b,b]);
  if(kind==="spoofed")type="image/png";
  if(kind==="corrupt-crc"){b=await solidPng();b[40]^=1;type="image/png";}
  if(kind==="malformed-text"){b=extraPng(await solidPng(),"tEXt",Buffer.from("no separator"));type="image/png";}
  if(kind==="iptc")b=mapJpeg(b,(m,d)=>m===237?Buffer.from("malformed private metadata"):d);
  await expect(transform(b,type)).rejects.toThrow("supported orientation");
});
it("enforces exact encoded and aggregate metadata budgets",async()=>{
  expect(()=>encodedBudget(Buffer.alloc(MAX_IMAGE_BYTES))).not.toThrow();expect(()=>encodedBudget(Buffer.alloc(MAX_IMAGE_BYTES+1))).toThrow();
  expect(classifyPhoto(metadataBudgetJpeg(MAX_PHOTO_METADATA_BYTES),"image/jpeg").metadataBytes).toBe(MAX_PHOTO_METADATA_BYTES);
  await expect(transform(metadataBudgetJpeg(MAX_PHOTO_METADATA_BYTES))).resolves.toMatchObject({width:640});
  await expect(transform(metadataBudgetJpeg(MAX_PHOTO_METADATA_BYTES+1))).rejects.toMatchObject({code:"invalid"});
});
it("enforces the actual PNG ancillary metadata budget at and above its exact boundary",async()=>{
  const source=mapPng(await solidPng(),(t,b)=>["IHDR","IDAT","IEND"].includes(t)?b:null);
  const payload=Buffer.alloc(MAX_PHOTO_METADATA_BYTES-12,65);payload[0]=88;payload[1]=0;
  await expect(transform(extraPng(source,"tEXt",payload),"image/png")).resolves.toMatchObject({width:500});
  await expect(transform(extraPng(source,"tEXt",Buffer.concat([payload,Buffer.from("A")])),"image/png")).rejects.toMatchObject({code:"invalid"});
});
it("handles exact side/pixel limits and refuses over-limit headers before allocating pixels",async()=>{
  expect(()=>dimensions(4096,4096)).not.toThrow();expect(()=>dimensions(4096,4097)).toThrow();expect(()=>dimensions(4097,1)).toThrow();expect(()=>dimensions(499,499)).toThrow();
  expect((await transform(await solidPng(4096,1),"image/png")).width).toBe(4096);
  const forged=mapPng(await solidPng(),(t,b)=>{if(t!=="IHDR")return b;const copy=Buffer.from(b);copy.writeUInt32BE(4097);return copy;});
  await expect(transform(forged,"image/png")).rejects.toMatchObject({code:"invalid"});
});
it("fully decodes a generated image at the exact 16M-pixel boundary",async()=>{
  const result=await transform(await solidPng(4096,4096),"image/png");expect([result.width,result.height]).toEqual([4096,4096]);
},15000);
it.each(["oversize","metadata","wrong-dimensions","wrong-mime","trailer","crc"])("rejects injected %s encoder output",async kind=>{
  const source=await solidPng();let encoded=Buffer.from(source);
  if(kind==="oversize")encoded=Buffer.alloc(MAX_IMAGE_BYTES+1);
  if(kind==="metadata")encoded=extraPng(source,"tEXt",Buffer.from("Owner\0SYNTHETIC_PRIVATE"));
  if(kind==="wrong-dimensions")encoded=await solidPng(600,600);
  if(kind==="wrong-mime")encoded=await sharp(source).jpeg().toBuffer();
  if(kind==="trailer")encoded=Buffer.concat([source,Buffer.from("private")]);
  if(kind==="crc")encoded[40]^=1;
  await expect(createPhotoTransformer(async()=>encoded).transform(source,"image/png",new AbortController().signal,performance.now()+15000)).rejects.toMatchObject({code:"invalid"});
});
it("rejects a late encoder result after cancellation without promoting original bytes",async()=>{
  const bytes=await solidPng(),controller=new AbortController();let complete!:(b:Buffer)=>void;
  const encoder=vi.fn(()=>new Promise<Buffer>(resolve=>{complete=resolve;}));
  const work=createPhotoTransformer(encoder).transform(bytes,"image/png",controller.signal,performance.now()+15000);
  await vi.waitFor(()=>expect(encoder).toHaveBeenCalledOnce());controller.abort();complete(bytes);
  await expect(work).rejects.toMatchObject({code:"aborted"});
});
it("refuses pre-aborted/expired work and strips raw encoder exceptions",async()=>{
  const encoder=vi.fn(async()=>{throw new Error("Bearer secret https://private.invalid/path");}),t=createPhotoTransformer(encoder),bytes=await solidPng();
  const c=new AbortController();c.abort();await expect(t.transform(bytes,"image/png",c.signal,performance.now()+15000)).rejects.toMatchObject({code:"aborted"});
  await expect(t.transform(bytes,"image/png",new AbortController().signal,performance.now()-1)).rejects.toMatchObject({code:"aborted"});expect(encoder).not.toHaveBeenCalled();
  await expect(t.transform(bytes,"image/png",new AbortController().signal,performance.now()+15000)).rejects.not.toThrow(/Bearer|private\.invalid/);
});
it("meets the named fine-mesh Q95/4:4:4 quality regression target without a universal fidelity claim",async()=>{
  const input=privacyFixture("fine-mesh.jpg"),result=await transform(input);
  const [a,b]=await Promise.all([sharp(input).raw().toBuffer(),sharp(result.bytes).raw().toBuffer()]);let squared=0;
  for(let i=0;i<a.length;i++)squared+=(a[i]-b[i])**2;
  expect(10*Math.log10(255**2/(squared/a.length))).toBeGreaterThan(39);expect(result.size).toBeLessThan(input.length);
});
it("has no client or provider entry point and leaves simulation composition hard-disabled",()=>{
  const server=readFileSync(new URL("../../../application/photoDerivativeServer.ts",import.meta.url),"utf8");
  expect(server).toContain('import "server-only"');expect(server).toContain("await requireUser()");expect(server).not.toContain('"use server"');
  const runtime=readFileSync(new URL("../../ebay/mediaRuntime.ts",import.meta.url),"utf8");expect(runtime).toContain("return { enabled: false }");
});
