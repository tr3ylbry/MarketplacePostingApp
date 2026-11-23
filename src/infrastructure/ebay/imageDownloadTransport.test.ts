// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import type { TLSSocket } from "node:tls";
import { verifyImagePeer } from "./imageDownloadTransport";
const candidate={address:"1.1.1.1",family:4 as const};
const good=()=>({remoteAddress:"1.1.1.1",remotePort:443,encrypted:true,authorized:true,authorizationError:null,destroyed:false,alpnProtocol:"http/1.1",getPeerCertificate:()=>({subjectaltname:"DNS:i.sandbox.ebayimg.com"})});
it("guards external/private access",assertOfflineGuards);
it("checks legitimate synthetic peer facts without claiming native chain proof",()=>{expect(()=>verifyImagePeer(good() as unknown as TLSSocket,candidate)).not.toThrow();});
it.each([{remoteAddress:"127.0.0.1"},{remotePort:444},{authorized:false},{encrypted:false},{authorizationError:"untrusted"},{destroyed:true},{alpnProtocol:"h2"},{remoteAddress:"::ffff:1.1.1.1"},{getPeerCertificate:()=>({subjectaltname:"DNS:other.invalid"})}])("refuses adverse peer/TLS facts %#",change=>{expect(()=>verifyImagePeer({...good(),...change} as unknown as TLSSocket,candidate)).toThrow("Image download refused.");});
it("compares IPv6 peers canonically",()=>{expect(()=>verifyImagePeer({...good(),remoteAddress:"2001:4860:4860:0:0:0:0:8888"} as unknown as TLSSocket,{address:"2001:4860:4860::8888",family:6})).not.toThrow();});
