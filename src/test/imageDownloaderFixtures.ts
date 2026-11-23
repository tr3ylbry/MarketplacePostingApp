import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import { DOWNLOAD_TEST_CA, DOWNLOAD_TEST_KEY as key, DOWNLOAD_TEST_CERT as cert, DOWNLOAD_TEST_WRONG_HOST as wrong } from "./imageDownloaderCertificates";
export { DOWNLOAD_TEST_CA };
export const DOWNLOAD_TEST_HOST = "i.sandbox.ebayimg.com";
export function dnsFixtureResponse(question: Buffer, addresses = ["1.1.1.1"], flags = 0x8180): Buffer {
  const type = question.readUInt16BE(question.length - 4), body = Buffer.from(question);
  body.writeUInt16BE(flags, 2); const values = type === 1 ? addresses : []; body.writeUInt16BE(values.length, 6);
  const records = values.map(address => {
    const rr = Buffer.alloc(16); rr.writeUInt16BE(0xc00c); rr.writeUInt16BE(1, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(60, 6); rr.writeUInt16BE(4, 10);
    rr.set(address.split(".").map(Number),12); return rr;
  });
  const message = Buffer.concat([body,...records]), frame = Buffer.alloc(2); frame.writeUInt16BE(message.length); return Buffer.concat([frame,message]);
}
export async function localImageDns(respond: (question: Buffer, socket: net.Socket, index: number) => void = (q,s) => { s.write(dnsFixtureResponse(q)); }) {
  const sockets = new Set<net.Socket>(), questions: Buffer[] = [];
  let connections=0;
  const server = net.createServer(socket => {
    connections++;
    sockets.add(socket); socket.on("error",()=>{}); socket.on("close",()=>sockets.delete(socket)); let b = Buffer.alloc(0);
    socket.on("data",chunk => {
      b = Buffer.concat([b,Buffer.from(chunk)]);
      while(b.length>=2 && b.length>=b.readUInt16BE()+2){const n=b.readUInt16BE(),q=Buffer.from(b.subarray(2,n+2));b=b.subarray(n+2);questions.push(q);respond(q,socket,questions.length-1);}
    });
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");const port=(server.address() as net.AddressInfo).port;
  return {port,questions,sockets,get connections(){return connections;},async close(){for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
export async function localImageTls(respond: (socket: tls.TLSSocket, request: Buffer) => void, wrongHost = false, greeting?: Buffer) {
  const sockets = new Set<net.Socket>(), requests: Buffer[] = [], snis: string[] = [];
  const server = tls.createServer({key,cert:wrongHost?wrong:cert,ALPNProtocols:["http/1.1"]},socket=>{
    sockets.add(socket);snis.push(socket.servername || "");if(greeting)socket.write(greeting);socket.on("error",()=>{});socket.on("close",()=>sockets.delete(socket));let b=Buffer.alloc(0),sent=false;
    socket.on("data",chunk=>{b=Buffer.concat([b,Buffer.from(chunk)]);if(!sent&&b.includes("\r\n\r\n")){sent=true;requests.push(b);respond(socket,b);}});
  });
  server.on("tlsClientError",()=>{});server.on("connection",s=>{sockets.add(s);s.on("close",()=>sockets.delete(s));});
  server.listen(0,"127.0.0.1");await once(server,"listening");const port=(server.address() as net.AddressInfo).port;
  return {port,requests,snis,sockets,async close(){for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
export const imageWireResponse = (body: Buffer = Buffer.from([137,80,78,71]), headers = "", mime: "image/png" | "image/jpeg" = "image/png") => Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: ${mime}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n${headers}\r\n`),body]);
