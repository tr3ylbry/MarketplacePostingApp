import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dns from "node:dns";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";

// Only the explicitly configured disposable PostgreSQL socket may connect.
// No local HTTP server, resolver lookup, provider client or private file fallback.
export function fakeUsableMediaDatabaseGuards() {
 const target=new URL(process.env.TEST_DATABASE_URL??"");
 if(!["postgres:","postgresql:"].includes(target.protocol)||target.hostname!=="127.0.0.1"||!/^\/[a-z][a-z0-9_]*_test$/.test(target.pathname)||target.search||target.hash)throw Error("Isolated database required.");
 const port=Number(target.port||5432),blocked=vi.fn(()=>{throw Error("Assessment attempted non-fixture access.");});
 vi.stubGlobal("fetch",blocked);vi.stubGlobal("WebSocket",blocked);
 const connect=net.Socket.prototype.connect;
 vi.spyOn(net.Socket.prototype,"connect").mockImplementation(function(this:net.Socket,...args:unknown[]){
  const values=Array.isArray(args[0])?args[0]:args;
  const options=typeof values[0]==="number"?{port:values[0],host:values[1]}:values[0] as {host?:string;port?:number};
  if(!options||options.host!=="127.0.0.1"||Number(options.port)!==port)return blocked();
  return Reflect.apply(connect,this,args);
 } as typeof connect);
 for(const object of [http,https]){vi.spyOn(object,"request").mockImplementation(blocked);vi.spyOn(object,"get").mockImplementation(blocked);}
 vi.spyOn(http2,"connect").mockImplementation(blocked);vi.spyOn(tls,"connect").mockImplementation(blocked);vi.spyOn(dgram,"createSocket").mockImplementation(blocked);
 vi.spyOn(dns,"getServers").mockImplementation(blocked);
 for(const key of ["lookup","resolve","resolve4","resolve6"] as const){vi.spyOn(dns,key).mockImplementation(blocked);vi.spyOn(dns.promises,key).mockImplementation(blocked);}
 const privatePath=(p:unknown)=>/(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.(?:aws|ssh|codex|agents|npmrc)(?:\/|$)/.test(String(p));
 const read=fs.readFileSync.bind(fs),readAsync=fs.promises.readFile.bind(fs.promises);
 vi.spyOn(fs,"readFileSync").mockImplementation(((p:never,...args:never[])=>privatePath(p)?blocked():read(p,...args)) as typeof fs.readFileSync);
 vi.spyOn(fs.promises,"readFile").mockImplementation(((p:never,...args:never[])=>privatePath(p)?blocked():readAsync(p,...args)) as typeof fs.promises.readFile);
 syncBuiltinESMExports();
 return {assertNoExternalAccess(){expect(blocked).not.toHaveBeenCalled();},restore(){expect(blocked).not.toHaveBeenCalled();vi.restoreAllMocks();vi.unstubAllGlobals();syncBuiltinESMExports();}};
}
