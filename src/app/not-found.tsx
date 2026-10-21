import Link from "next/link";
export default function NotFound() {
  return <section className="panel"><h2>Listing not found</h2><Link href="/listings">Return to saved listings</Link></section>;
}
