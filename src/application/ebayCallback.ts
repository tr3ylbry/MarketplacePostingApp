import { EbayError } from "./ebayConnection";
export const callbackHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
interface Dependencies {
  origin: string;
  session(headers: Headers): Promise<{ owner: string; sessionId: string } | null>;
  complete(owner: string, sessionId: string, state: unknown, code: unknown, denied: boolean): Promise<unknown>;
}
export async function handleEbayCallback(request: Request, path: "callback" | "declined", deps: Dependencies) {
  // Next may route HEAD through GET automatically; previews must not consume
  // OAuth state or exchange a code.
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...callbackHeaders, Allow: "GET" } });
  let url: URL;
  // next.config preserves the original transport URL rather than NextURL's
  // default loopback-to-localhost normalization. No hostname aliases are trusted.
  try { url = new URL(request.url); } catch { return new Response("Invalid callback.", { status: 400, headers: callbackHeaders }); }
  const expected = new URL(deps.origin);
  if (url.origin !== deps.origin || url.pathname !== `/api/integrations/ebay/${path}` || request.headers.get("host") !== expected.host || (request.headers.has("x-forwarded-host") && request.headers.get("x-forwarded-host") !== expected.host) || (request.headers.has("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== expected.protocol.slice(0,-1))) {
    return new Response("Invalid callback origin.", { status: 400, headers: callbackHeaders });
  }
  const clean = (outcome: string) => new Response(null, { status: 303, headers: { ...callbackHeaders, Location: `${deps.origin}/settings/integrations/ebay?result=${outcome}` } });
  try {
    const session = await deps.session(request.headers); if (!session) return clean("session-required");
    const denied = path === "declined" || url.searchParams.get("error") === "access_denied";
    if (["state", "code", "error"].some(k => url.searchParams.getAll(k).length > 1)) throw new EbayError("state");
    // Some provider decline redirects omit state. Do not mutate any pending
    // authorization or stored connection in that case; simply show cancellation.
    if (denied && !url.searchParams.has("state")) return clean("denied");
    if (url.searchParams.has("error") && !denied) return clean("failed");
    await deps.complete(session.owner, session.sessionId, url.searchParams.get("state"), url.searchParams.get("code"), denied);
    return clean(denied ? "denied" : "connected");
  } catch { return clean("failed"); }
}
