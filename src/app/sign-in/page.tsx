import { AuthButton } from "../../features/auth/AuthButton";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <section className="panel"><h2>Sign in</h2><p>Your inventory is private to your account.</p>
    {error ? <p role="alert">Sign-in was unsuccessful. Please try again.</p> : null}<AuthButton />
  </section>;
}
