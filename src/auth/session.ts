import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./server";
import { ownerIdSchema } from "../application/owner";

export async function requireUser() {
  const requestHeaders = await headers();
  const session = await (async () => {
    try { return await getAuth().api.getSession({ headers: requestHeaders }); }
    catch { throw new Error("Authentication is temporarily unavailable."); }
  })();
  if (!session || !ownerIdSchema.safeParse(session.user.id).success) redirect("/sign-in");
  return { id: session.user.id, name: session.user.name };
}
