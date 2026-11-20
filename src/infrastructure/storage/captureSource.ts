import "server-only";
import { get } from "@vercel/blob";
import { blobImageSourceSchema } from "../../domain/listingImage";
import { PrivateImagePreparationError, type PrivateImageReader } from "../../application/ebayPrivateImages";
import { collectPrivateImage } from "./readPrivateImage";

// Operation-local credentials explicitly supplied to the SDK. Never let a
// one-shot capture consult CLI/Keychain discovery or refresh its Blob identity.
type Credentials = { token:string; oidcToken?:never; storeId?:never } | { oidcToken:string; storeId:string; token?:never };
export function captureSource(env:Record<string,string|undefined>):PrivateImageReader {
  const valid=(value:string|undefined):value is string=>!!value&&value.length<=16000&&!/[^\x21-\x7e]/.test(value);
  let credentials:Credentials;
  if(valid(env.BLOB_READ_WRITE_TOKEN))credentials={token:env.BLOB_READ_WRITE_TOKEN};
  else if(valid(env.VERCEL_OIDC_TOKEN)&&/^(?:store_)?[a-zA-Z0-9_-]{1,100}$/.test(env.BLOB_STORE_ID??""))credentials={oidcToken:env.VERCEL_OIDC_TOKEN,storeId:env.BLOB_STORE_ID!};
  else throw new PrivateImagePreparationError("invalid");
  return {async readPrivateImage(source,signal){
    try {
      const trusted=blobImageSourceSchema.parse(source);signal.throwIfAborted();
      const result=await get(trusted.pathname,{...credentials,access:"private",useCache:false,abortSignal:signal});
      if(!result||result.statusCode!==200)throw new PrivateImagePreparationError("invalid");
      return await collectPrivateImage(trusted,{...result.blob,stream:result.stream},signal);
    }catch{throw new PrivateImagePreparationError("invalid");}
  }};
}
