import { z } from "zod";

// Structural evidence only. These are application budgets, never EPS limits.
export const CAPTURE_BODY_BYTES = 65_536, CAPTURE_HEADER_BYTES = 16_384;
export const CAPTURE_IMAGE_BYTES = 1_048_576, CAPTURE_HTTP_MS = 10_000;
const kind = z.enum(["missing", "null", "string", "number", "boolean", "array", "object"]);
const segment = z.strictObject({ length: z.number().int().min(0).max(8192), shape: z.enum(["digits", "hex", "ascii", "encoded", "other"]), encoded: z.boolean() });
export const captureUrlShape = z.strictObject({
  kind, valid: z.boolean(), scheme: z.enum(["https", "http", "other"]).nullable(),
  hostname: z.string().max(253).regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/).nullable(),
  port: z.boolean(), query: z.boolean(), fragment: z.boolean(), userInfo: z.boolean(),
  segments: z.array(segment).max(16), truncated: z.boolean(),
});
export const captureReportSchema = z.strictObject({
  version: z.literal("sandbox-image-shape-v1"), status: z.number().int().min(100).max(599).nullable(),
  outcome: z.enum(["captured", "redirect", "headers", "body", "encoding", "json", "duplicate", "content-type", "transport", "cancelled"]),
  duplicateHeaders: z.boolean(), json: z.boolean(), topLevel: kind,
  location: captureUrlShape, imageUrl: captureUrlShape, maximumUrl: captureUrlShape,
  expiration: z.strictObject({ kind, syntax: z.enum(["missing", "invalid", "utc"]), normalized: z.iso.datetime().nullable() }),
});
export type CaptureReport = z.infer<typeof captureReportSchema>;
const type = (value: unknown): z.infer<typeof kind> => value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : ["string", "number", "boolean"].includes(typeof value) ? typeof value as "string" | "number" | "boolean" : "missing";
export function urlShape(value?: unknown): z.infer<typeof captureUrlShape> {
  const result: z.infer<typeof captureUrlShape> = { kind: type(value), valid: false, scheme: null, hostname: null, port: false, query: false, fragment: false, userInfo: false, segments: [], truncated: false };
  if (typeof value !== "string" || value.length > 8192 || !/^[\x21-\x7e]+$/.test(value) || /\\/.test(value)) return result;
  try {
    const url = new URL(value);
    result.scheme = url.protocol === "https:" ? "https" : url.protocol === "http:" ? "http" : "other";
    result.query = value.includes("?"); result.fragment = value.includes("#"); result.userInfo = !!(url.username || url.password); result.port = !!url.port;
    // DNS syntax validation is redaction, NOT an endpoint trust/URL-admission rule.
    if (!/^[a-z0-9.-]{1,253}$/.test(url.hostname) || url.hostname.split(".").some(p => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) return result;
    result.hostname = url.hostname;
    const parts = url.pathname.split("/").slice(1); result.truncated = parts.length > 16;
    result.segments = parts.slice(0,16).map(p => ({ length:p.length, encoded:p.includes("%"), shape:/%[a-f0-9]{2}/i.test(p)?"encoded":/^\d+$/.test(p)?"digits":/^[a-f0-9]+$/i.test(p)?"hex":/^[\x21-\x7e]*$/.test(p)?"ascii":"other" }));
    result.valid = ["https", "http"].includes(result.scheme); return result;
  } catch { return result; }
}
export function emptyCapture(outcome: CaptureReport["outcome"], status: number | null = null): CaptureReport {
  return { version:"sandbox-image-shape-v1",status,outcome,duplicateHeaders:false,json:false,topLevel:"missing",location:urlShape(),imageUrl:urlShape(),maximumUrl:urlShape(),expiration:{kind:"missing",syntax:"missing",normalized:null} };
}
// Validate budgets BEFORE recursive parsing/copying. Detect duplicate decoded
// keys at every depth, including escaped spellings, before JSON.parse loses them.
function boundedJson(text: string): unknown {
  let at=0, tokens=0;
  function space(){while (" \t\r\n".includes(text[at]??"\0")) at++;}
  function string(){const start=at++;for(;at<text.length;at++){if(text[at]==="\\"){at++;continue;}if(text[at]==='"'){at++;if(at-start>8194)throw Error("json");return JSON.parse(text.slice(start,at)) as string;}}throw Error("json");}
  function value(depth:number):void {
    if(depth>8 || ++tokens>4096)throw Error("json");space();const c=text[at];
    if(c==='"'){string();return;}
    if(c==="{"||c==="[") {at++;space();const close=c==="{"?"}":"]",seen=new Set<string>();if(text[at]===close){at++;return;}
      for(;;){space();if(c==="{"){if(text[at]!== '"')throw Error("json");const key=string();if(seen.has(key))throw Error("duplicate");if(seen.size>=128)throw Error("json");seen.add(key);space();if(text[at++]!==":")throw Error("json");}value(depth+1);space();if(text[at]===close){at++;return;}if(text[at++]!==",")throw Error("json");}
    }
    const literal=/(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
    literal.lastIndex=at;const token=literal.exec(text);if(!token)throw Error("json");at=literal.lastIndex;
  }
  value(0);space();if(at!==text.length)throw Error("json");return JSON.parse(text);
}
export function inspectCapture(status:number, rawHeaders:readonly string[], bytes:Uint8Array):CaptureReport {
  let report=emptyCapture("captured",status);
  try {
    if(rawHeaders.length>256 || rawHeaders.reduce((n,x)=>n+Buffer.byteLength(x)+4,0)>CAPTURE_HEADER_BYTES)return emptyCapture("headers",status);
    const headers=new Map<string,string[]>();for(let i=0;i<rawHeaders.length;i+=2){const key=rawHeaders[i].toLowerCase();headers.set(key,[...(headers.get(key)??[]),rawHeaders[i+1]]);}
    report.duplicateHeaders=[...headers.values()].some(v=>v.length>1);
    // Repeated headers are ambiguity; never choose an arbitrary Location/value.
    if(report.duplicateHeaders)return {...report,outcome:"duplicate"};
    report.location=urlShape(headers.get("location")?.[0]);
    if(status>=300&&status<400)return {...report,outcome:"redirect"};
    if(bytes.byteLength>CAPTURE_BODY_BYTES)return {...report,outcome:"body"};
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(headers.get("content-type")?.[0]??""))return {...report,outcome:"content-type"};
    if(headers.has("content-encoding")&&headers.get("content-encoding")![0]!=="identity")return {...report,outcome:"encoding"};
    let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{return {...report,outcome:"encoding"};}
    let parsed:unknown;try{parsed=boundedJson(text);}catch(e){return {...report,outcome:e instanceof Error&&e.message==="duplicate"?"duplicate":"json"};}
    report={...report,json:true,topLevel:type(parsed)};
    if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)){
      const body=parsed as Record<string,unknown>;report.imageUrl=urlShape(body.imageUrl);report.maximumUrl=urlShape(body.maxDimensionImageUrl);
      report.expiration.kind=type(body.expirationDate);report.expiration.syntax=body.expirationDate===undefined?"missing":"invalid";
      const expiry=body.expirationDate;
      if(typeof expiry==="string"&&expiry.length<=24&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expiry)&&z.iso.datetime().safeParse(expiry).success){report.expiration.syntax="utc";report.expiration.normalized=new Date(expiry).toISOString();}
    }
    return captureReportSchema.parse(report);
  }catch{return emptyCapture("json",status);}
}
