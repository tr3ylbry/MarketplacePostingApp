import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./server";
import { ownerIdSchema } from "../application/owner";
export async function ebaySession(requestHeaders?: Headers) {
  const session = await getAuth().api.getSession({ headers: requestHeaders ?? await headers() });
  if (!session || !ownerIdSchema.safeParse(session.user.id).success || !session.session.id) return null;
  return { owner: session.user.id, sessionId: session.session.id };
}
export async function requireEbaySession() {
  const session = await ebaySession(); if (!session) redirect("/sign-in"); return session;
}
