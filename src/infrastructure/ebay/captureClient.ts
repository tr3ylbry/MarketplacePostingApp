import "server-only";
import { randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { CAPTURE_BODY_BYTES, CAPTURE_HEADER_BYTES, CAPTURE_HTTP_MS, CAPTURE_IMAGE_BYTES, emptyCapture, inspectCapture, type CaptureReport } from "../../application/ebayCaptureReport";

export const SANDBOX_CAPTURE_URL = "https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/create_image_from_file";
// Internal transport seam, not a URL/host option. Tests exercise Node's real
// request/parser through a loopback adapter; normal code always uses TLS below.
export type CaptureRequest = typeof httpsRequest;
export function createCaptureClient(request: CaptureRequest = httpsRequest) {
  return {
    async capture(bytes:Buffer, token:string, signal:AbortSignal):Promise<CaptureReport> {
      if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>CAPTURE_IMAGE_BYTES||!token||token.length>16000||/[\r\n\0]/.test(token)||signal.aborted)return emptyCapture("cancelled");
      const boundary="marketplace-"+randomBytes(24).toString("hex");
      const prefix=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="sandbox-discovery.png"\r\nContent-Type: image/png\r\n\r\n`);
      const suffix=Buffer.from(`\r\n--${boundary}--\r\n`);
      if(prefix.length+suffix.length>2048)return emptyCapture("body");
      // Deliberately bounded multipart framing, no FormData copies, files or URLs.
      const body=Buffer.concat([prefix,bytes,suffix]);
      return new Promise<CaptureReport>(resolve=>{
        let response:IncomingMessage|undefined,report:CaptureReport|undefined,requestClosed=false,responseClosed=false;
        const done=()=>{if(requestClosed&&(!response||responseClosed)){clearTimeout(timer);signal.removeEventListener("abort",abort);resolve(report??emptyCapture("transport"));}};
        const req=request(SANDBOX_CAPTURE_URL,{method:"POST",agent:false,rejectUnauthorized:true,maxHeaderSize:CAPTURE_HEADER_BYTES,
          headers:{Authorization:`Bearer ${token}`,Accept:"application/json","Accept-Encoding":"identity","Content-Type":`multipart/form-data; boundary=${boundary}`,"Content-Length":body.length}},res=>{
          response=res;const status=res.statusCode??500;
          // Node's parser bounds raw header bytes, including duplicate headers.
          // Preserve rawHeaders rather than a coalescing Headers abstraction.
          const raw=res.rawHeaders;let count=0;const buffer=Buffer.alloc(CAPTURE_BODY_BYTES);
          const stop=(reason:CaptureReport["outcome"])=>{report=emptyCapture(reason,status);res.destroy();req.destroy();};
          res.on("close",()=>{responseClosed=true;done();});res.on("error",()=>{report??=emptyCapture("transport",status);});
          if(raw.length>256||raw.reduce((n,x)=>n+Buffer.byteLength(x)+4,0)>CAPTURE_HEADER_BYTES){stop("headers");return;}
          if(status>=300&&status<400){report=inspectCapture(status,raw,Buffer.alloc(0));res.destroy();req.destroy();return;}
          // Trailer fields are never accepted as a second response-header channel.
          res.on("data",(chunk:Buffer)=>{if(count+chunk.length>buffer.length){stop("body");return;}chunk.copy(buffer,count);count+=chunk.length;});
          res.on("end",()=>{if(!report)report=res.rawTrailers.length?emptyCapture("headers",status):inspectCapture(status,raw,buffer.subarray(0,count));});
        });
        const abort=()=>{report??=emptyCapture("cancelled",response?.statusCode??null);req.destroy();response?.destroy();};
        const timer=setTimeout(abort,CAPTURE_HTTP_MS);signal.addEventListener("abort",abort,{once:true});
        req.on("information",()=>{report=emptyCapture("headers");req.destroy();});
        req.on("upgrade",(_res,socket)=>{report=emptyCapture("headers");socket.destroy();req.destroy();});
        req.on("error",(error:NodeJS.ErrnoException)=>{report??=emptyCapture(error.code==="HPE_HEADER_OVERFLOW"?"headers":"transport");});
        req.on("close",()=>{requestClosed=true;done();});
        if(signal.aborted)abort();else {try{req.end(body);}catch{report=emptyCapture("transport");req.destroy();}}
      }).catch(()=>emptyCapture("transport"));
    },
  };
}
