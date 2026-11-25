import { localOperatorRequest, LOCAL_IMAGE_OPERATOR_ORIGIN, LocalOperatorError, type LocalOperatorResponse } from "./localImageOperator";

export const localOperatorHeaders = { "Cache-Control":"private, no-store", "Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff" };
export interface LocalOperatorActor { ownerId:string; id:string; expiresAt:string }
export interface LocalOperatorHttpDependencies {
  enabled():boolean;
  session(headers:Headers):Promise<LocalOperatorActor|null>;
  status(actor:LocalOperatorActor):Promise<LocalOperatorResponse>;
  action(actor:LocalOperatorActor,input:ReturnType<typeof localOperatorRequest.parse>,headers:Headers):Promise<LocalOperatorResponse>;
}

// Rejected previews/foreign requests must not consume OAuth state or stop an
// activation. This runs before looking up any durable callback binding.
export function rejectLocalOperatorCallback(request:Request,path:"callback"|"declined"):Response|null {
  if(request.method!=="GET")return new Response(null,{status:405,headers:{...localOperatorHeaders,Allow:"GET"}});
  try {
    const url=new URL(request.url),h=request.headers;
    if(url.origin!==LOCAL_IMAGE_OPERATOR_ORIGIN||url.pathname!==`/api/integrations/ebay/${path}`||h.get("host")!=="127.0.0.1:3000"||
      (h.has("x-forwarded-host")&&h.get("x-forwarded-host")!=="127.0.0.1:3000")||
      (h.has("x-forwarded-proto")&&h.get("x-forwarded-proto")!=="https")||
      ["state","code","error"].some(k=>url.searchParams.getAll(k).length>1))throw Error();
    return null;
  }catch {return new Response("Invalid callback.",{status:400,headers:localOperatorHeaders});}
}

// No caller-supplied owner, host, content pin, credential or target is accepted.
export async function handleLocalOperatorRequest(request:Request,deps:LocalOperatorHttpDependencies) {
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:localOperatorHeaders});
  if(!deps.enabled())return new Response(null,{status:404,headers:localOperatorHeaders});
  try {
    const url=new URL(request.url),h=request.headers;
    if(url.origin!==LOCAL_IMAGE_OPERATOR_ORIGIN||url.pathname!=="/api/operator/ebay-image-verification"||url.search||
      h.get("host")!=="127.0.0.1:3000"||
      (h.has("x-forwarded-host")&&h.get("x-forwarded-host")!=="127.0.0.1:3000")||
      (h.has("x-forwarded-proto")&&h.get("x-forwarded-proto")!=="https"))throw new LocalOperatorError("origin");
    if(request.method!=="GET"&&request.method!=="POST")return new Response(null,{status:405,headers:{...localOperatorHeaders,Allow:"GET, POST"}});
    if(request.method==="POST"&&(h.get("origin")!==LOCAL_IMAGE_OPERATOR_ORIGIN||
      (h.has("sec-fetch-site")&&h.get("sec-fetch-site")!=="same-origin")||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h.get("content-type")??"")))throw new LocalOperatorError("origin");
    const actor=await deps.session(h);
    if(!actor||!Number.isFinite(Date.parse(actor.expiresAt))||Date.parse(actor.expiresAt)<=Date.now())throw new LocalOperatorError("auth");
    if(request.method==="GET")return json(await deps.status(actor));
    const reader=request.body?.getReader();
    if(!reader)throw new LocalOperatorError("context");
    const chunks:Uint8Array[]=[];let length=0;
    try {
      for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;
        if(length>1024){await reader.cancel();throw new LocalOperatorError("context");}chunks.push(part.value);}
    } finally {reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const input=localOperatorRequest.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
    return json(await deps.action(actor,input,h));
  } catch(error) {
    const status=error instanceof LocalOperatorError ? ({disabled:404,origin:403,auth:401,conflict:409,context:409,expired:409,unavailable:503}[error.code]) : 409;
    return json({error:"The diagnostic could not continue. Refresh its status; do not start another attempt."},status);
  }
}
