// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { imageDnsQuestion,parseImageDnsAnswer } from "./imageDownloadDns";
const id=173;
function answer(type:1|28=1,count=1,flags=0x8180){
  const q=Buffer.from(imageDnsQuestion(id,type).subarray(2));q.writeUInt16BE(flags,2);q.writeUInt16BE(count,6);
  const records=Array.from({length:count},()=>{const n=type===1?4:16,r=Buffer.alloc(12+n);r.writeUInt16BE(0xc00c);r.writeUInt16BE(type,2);r.writeUInt16BE(1,4);r.writeUInt32BE(60,6);r.writeUInt16BE(n,10);if(type===1)r.set([1,1,1,1],12);else[0x2001,0x4860,0x4860,0,0,0,0,0x8888].forEach((v,i)=>r.writeUInt16BE(v,12+2*i));return r;});
  return Buffer.concat([q,...records]);
}
it("enforces external/private guards",assertOfflineGuards);
it.each([1,28] as const)("parses a complete compressed-owner type%i response",type=>{
  const r=parseImageDnsAnswer(answer(type),id,type);expect(r.code).toBe(0);expect(r.addresses).toHaveLength(1);expect(r.addresses[0].family).toBe(type===1?4:6);
});
it("accepts a direct NODATA report without claiming global absence",()=>{expect(parseImageDnsAnswer(answer(28,0),id,28).addresses).toEqual([]);});
it("keeps NXDOMAIN distinct from successful emptiness",()=>{expect(parseImageDnsAnswer(answer(1,0,0x8183),id,1).code).toBe(3);});
it.each([0x0180,0x8380,0x8100,0x8182,0x81c0,0x8980])("refuses incomplete/error flags %#",flags=>{expect(()=>parseImageDnsAnswer(answer(1,1,flags),id,1)).toThrow("Image download refused.");});
it.each(["id","question","type","class","size","forward","cycle","count","trailing","oversized","rdata","unexpected"])("refuses malformed DNS %#",kind=>{
  let p=answer();const qend=imageDnsQuestion(id,1).length-2;
  if(kind==="id")p.writeUInt16BE(id+1);
  if(kind==="question")p[13]=120;
  if(kind==="type")p.writeUInt16BE(28,qend-4);
  if(kind==="class")p.writeUInt16BE(3,qend-2);
  if(kind==="size")p=p.subarray(0,p.length-1);
  if(kind==="forward"){p[12]=0xc0;p[13]=20;}
  if(kind==="cycle"){p[12]=0xc0;p[13]=12;}
  if(kind==="count")p.writeUInt16BE(129,6);
  if(kind==="trailing")p=Buffer.concat([p,Buffer.from([0])]);
  if(kind==="oversized")p=Buffer.alloc(16_385);
  if(kind==="rdata")p.writeUInt16BE(5,qend+10);
  if(kind==="unexpected")p.writeUInt16BE(16,qend+2);
  expect(()=>parseImageDnsAnswer(p,id,1)).toThrow("Image download refused.");
});
it("refuses seventeen address records before returning an array",()=>{expect(()=>parseImageDnsAnswer(answer(1,17),id,1)).toThrow();});
it("supports a bounded complete CNAME chain and refuses its incomplete form",()=>{
  const q=Buffer.from(imageDnsQuestion(id,1).subarray(2));q.writeUInt16BE(0x8180,2);q.writeUInt16BE(2,6);
  const name=Buffer.from([5,...Buffer.from("alias"),7,...Buffer.from("invalid"),0]);
  const cname=Buffer.alloc(12);cname.writeUInt16BE(0xc00c);cname.writeUInt16BE(5,2);cname.writeUInt16BE(1,4);cname.writeUInt16BE(name.length,10);
  const address=Buffer.alloc(14);address.writeUInt16BE(1);address.writeUInt16BE(1,2);address.writeUInt16BE(4,8);address.set([1,1,1,1],10);
  const r=parseImageDnsAnswer(Buffer.concat([q,cname,name,name,address]),id,1);expect(r.canonical).toBe("alias.invalid");expect(r.addresses[0].address).toBe("1.1.1.1");
  q.writeUInt16BE(1,6);expect(()=>parseImageDnsAnswer(Buffer.concat([q,cname,name]),id,1)).toThrow();
});
