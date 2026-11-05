import { handleEbayCallback, callbackHeaders } from "../../../../../application/ebayCallback";
import { ebayService } from "../../../../../application/ebayServer";
import { ebaySession } from "../../../../../auth/ebaySession";
import { ebayRuntime } from "@ebay-runtime";
export async function GET(request: Request) {
  try { const { config } = ebayRuntime(); return await handleEbayCallback(request, "declined", { origin: config.origin, session: ebaySession, complete: (...args) => ebayService().complete(...args) }); }
  catch { return new Response("eBay callback unavailable.", { status: 503, headers: callbackHeaders }); }
}
