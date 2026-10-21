"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="panel" role="alert"><h2>Unable to load listings</h2><p>Check the database connection and try again.</p><button onClick={reset} type="button">Try again</button></section>;
}
