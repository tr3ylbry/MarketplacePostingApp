"use client";
import { useState } from "react";
import { authClient } from "../../auth/client";

export function AuthButton({ signOut = false }: { signOut?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function act() {
    setPending(true); setError(false);
    try {
      const result = signOut ? await authClient.signOut() : await authClient.signIn.social({ provider: "github", callbackURL: "/listings", errorCallbackURL: "/sign-in?error=1" });
      if (result.error) { setError(true); return; }
      // Full navigation drops user-specific React/router and session-photo state.
      if (signOut) window.location.assign("/sign-in");
    } catch { setError(true); }
    finally { setPending(false); }
  }
  return <><button className="secondary-button" disabled={pending} onClick={act} type="button">{pending ? "Please wait…" : signOut ? "Sign out" : "Sign in with GitHub"}</button>{error ? <p role="alert">Authentication could not be completed. Please try again.</p> : null}</>;
}
