import { handleEbayCallback, callbackHeaders } from "../../../../../application/ebayCallback";
import { ebayService } from "../../../../../application/ebayServer";
import { ebaySession } from "../../../../../auth/ebaySession";
import { ebayRuntime } from "@ebay-runtime";
import { localImageOperatorCallback } from "../../../../../../scripts/local-image-operator-runtime";
export async function GET(request: Request) {
  try { const operator=await localImageOperatorCallback(request,"declined");if(operator)return operator;
    const { config } = ebayRuntime(); return await handleEbayCallback(request, "declined", { origin: config.origin, session: ebaySession, complete: (...args) => ebayService().complete(...args) }); }
  catch { return new Response("eBay callback unavailable.", { status: 503, headers: callbackHeaders }); }
}
