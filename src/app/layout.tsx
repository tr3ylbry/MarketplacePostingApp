import type { Metadata } from "next";
import Link from "next/link";
import "../styles.css";

export const metadata: Metadata = { title: "Marketplace Posting Assistant", description: "Draft once and prepare listings for each marketplace." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><main className="app-shell">
    <section className="hero">
      <p className="eyebrow">Marketplace Posting Assistant</p>
      <h1>Create once.<br />Tailor per marketplace.<br />Track what&apos;s live.</h1>
      <p className="hero-copy">Choose where an item is going, save it to your inventory, and prepare marketplace drafts.</p>
      <nav aria-label="Main navigation"><Link href="/listings">Saved listings</Link>{" · "}<Link href="/listings/new">Create a listing</Link></nav>
    </section>
    {children}
  </main></body></html>;
}
