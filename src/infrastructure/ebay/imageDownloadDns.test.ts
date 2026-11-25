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

function dnsName(value:string){return Buffer.concat([...value.split(".").map(label=>Buffer.concat([Buffer.from([label.length]),Buffer.from(label)])),Buffer.from([0])]);}
function dnsRecord(owner:Buffer,type:number,data:Buffer,klass=1){
  const header=Buffer.alloc(10);header.writeUInt16BE(type);header.writeUInt16BE(klass,2);header.writeUInt32BE(60,4);header.writeUInt16BE(data.length,8);
  return Buffer.concat([owner,header,data]);
}
function negativeAlias(type:1|28,code=0,zone="invalid.test",authorityType=6,soaClass=1){
  const q=Buffer.from(imageDnsQuestion(id,type).subarray(2));q.writeUInt16BE(0x8180|code,2);q.writeUInt16BE(1,6);q.writeUInt16BE(1,8);
  const target=dnsName("alias.invalid.test"),times=Buffer.alloc(20);[1,3600,600,86400,60].forEach((n,i)=>times.writeUInt32BE(n,i*4));
  const rdata=authorityType===6?Buffer.concat([dnsName("ns.invalid.test"),dnsName("hostmaster.invalid.test"),times]):dnsName("ns.invalid.test");
  return Buffer.concat([q,dnsRecord(Buffer.from([0xc0,0x0c]),5,target),dnsRecord(dnsName(zone),authorityType,rdata,soaClass)]);
}
it.each([1,28] as const)("accepts terminal SOA-backed CNAME NODATA type%i without another lookup",type=>{
  const result=parseImageDnsAnswer(negativeAlias(type),id,type);expect(result).toEqual({code:0,canonical:"alias.invalid.test",addresses:[]});
});
it("accepts terminal SOA-backed CNAME NXDOMAIN without claiming addresses",()=>{
  expect(parseImageDnsAnswer(negativeAlias(28,3),id,28)).toEqual({code:3,canonical:"alias.invalid.test",addresses:[]});
});
it("keeps NS-only alias referrals refused",()=>{expect(()=>parseImageDnsAnswer(negativeAlias(28,0,"invalid.test",2),id,28)).toThrow();});
it("does not mistake a direct NS-only referral for completed NODATA",()=>{
  const q=Buffer.from(imageDnsQuestion(id,28).subarray(2));q.writeUInt16BE(0x8180,2);q.writeUInt16BE(1,8);
  const referral=Buffer.concat([q,dnsRecord(dnsName("sandbox.ebayimg.com"),2,dnsName("ns.invalid.test"))]);
  expect(()=>parseImageDnsAnswer(referral,id,28)).toThrow();
});
it("accepts a direct valid SOA-backed negative even with NS authority",()=>{
  const q=Buffer.from(imageDnsQuestion(id,28).subarray(2));q.writeUInt16BE(0x8180,2);q.writeUInt16BE(2,8);
  const soa=Buffer.concat([dnsName("ns.invalid.test"),dnsName("hostmaster.invalid.test"),Buffer.alloc(20)]);
  const response=Buffer.concat([q,dnsRecord(dnsName("sandbox.ebayimg.com"),6,soa),dnsRecord(dnsName("sandbox.ebayimg.com"),2,dnsName("ns.invalid.test"))]);
  expect(parseImageDnsAnswer(response,id,28)).toEqual({code:0,canonical:"i.sandbox.ebayimg.com",addresses:[]});
});
it("refuses an unrelated or wrong-class negative SOA",()=>{
  expect(()=>parseImageDnsAnswer(negativeAlias(28,0,"elsewhere.test"),id,28)).toThrow();
  expect(()=>parseImageDnsAnswer(negativeAlias(28,0,"valid.test"),id,28)).toThrow();
  expect(()=>parseImageDnsAnswer(negativeAlias(28,0,"invalid.test",6,3),id,28)).toThrow();
});
it("requires a single semantically framed SOA in authority, not additional data",()=>{
  const qend=imageDnsQuestion(id,28).length-2,cnameSize=dnsRecord(Buffer.from([0xc0,0x0c]),5,dnsName("alias.invalid.test")).length;
  const soaAt=qend+cnameSize,headerAt=soaAt+dnsName("invalid.test").length;
  const short=negativeAlias(28);short.writeUInt16BE(short.readUInt16BE(headerAt+8)-1,headerAt+8);
  expect(()=>parseImageDnsAnswer(short.subarray(0,-1),id,28)).toThrow();
  const duplicate=negativeAlias(28);duplicate.writeUInt16BE(2,8);
  expect(()=>parseImageDnsAnswer(Buffer.concat([duplicate,duplicate.subarray(soaAt)]),id,28)).toThrow();
  const additional=negativeAlias(28);additional.writeUInt16BE(0,8);additional.writeUInt16BE(1,10);
  expect(()=>parseImageDnsAnswer(additional,id,28)).toThrow();
});
it("treats SOA mailbox labels as bounded opaque framing without broadening CNAME labels",()=>{
  const q=Buffer.from(imageDnsQuestion(id,28).subarray(2));q.writeUInt16BE(0x8180,2);q.writeUInt16BE(1,6);q.writeUInt16BE(1,8);
  const mailbox=Buffer.concat([Buffer.from([9]),Buffer.from("host.name"),dnsName("invalid.test")]);
  const soa=Buffer.concat([dnsName("ns.invalid.test"),mailbox,Buffer.alloc(20)]);
  const packet=Buffer.concat([q,dnsRecord(Buffer.from([0xc0,0x0c]),5,dnsName("alias.invalid.test")),dnsRecord(dnsName("invalid.test"),6,soa)]);
  expect(parseImageDnsAnswer(packet,id,28).addresses).toEqual([]);
  const invalidCname=Buffer.concat([Buffer.from([9]),Buffer.from("host.name"),dnsName("invalid.test")]);
  expect(()=>parseImageDnsAnswer(Buffer.concat([q,dnsRecord(Buffer.from([0xc0,0x0c]),5,invalidCname),dnsRecord(dnsName("invalid.test"),6,soa)]),id,28)).toThrow();
});
