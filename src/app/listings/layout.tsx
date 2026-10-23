import { requireUser } from "../../auth/session";
import { AuthButton } from "../../features/auth/AuthButton";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function ListingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <><div>Signed in as {user.name} · <AuthButton signOut /> · <Link href="/settings/integrations/reverb">Reverb integration</Link></div>{children}</>;
}
