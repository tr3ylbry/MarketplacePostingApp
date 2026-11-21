# Local session handoff (no marketplace requests)

The manual capture tool has two **local-only** modes. They never load the eBay/Blob/derivative composition, create OAuth state or media records, open consent, or exchange/refresh credentials. Neither requires eBay credentials, seller identifiers, listing/image IDs or Blob configuration. Normal application authentication is unchanged. Use Node 24 and the existing local database/auth configuration.

These checks do **not** authorize consent or capture. A future provider experiment still needs a separately approved reviewed commit and request budget.

## 1. Rehearse native copy/paste without a cookie

Start the existing trusted loopback app with `npm run dev:https` and open `https://127.0.0.1:3000`. Do not bypass a certificate warning or change trust/auth configuration. Use normal GitHub sign-in if needed. Leave marketplace buttons alone.

In **your own Terminal**, from the repository, run:

```bash
node --conditions=react-server --import tsx scripts/ebay-capture-discovery.ts --rehearse-input
```

Use the existing **Search inventory titles** field on `/listings` as a harmless copy target. Fill it with the exact text below; do not submit a search. Unlike selecting a styled heading, a field makes its case, spacing and selection boundaries explicit:

```text
MARKETPLACE POSTING ASSISTANT
```

After the Terminal hidden prompt appears, click **inside that Chrome field**, press **⌘A**, then **⌘C** yourself. Switch to Terminal, use native **⌘V**, then press **Enter separately**. Do not press Search or Enter in Chrome. No pasted text should appear in Terminal. Success is `{"rehearsal":true,"matched":true}` with exit 0 (`echo $?` checks the exit code). A mismatch/error is exit 1 and is not evidence of a successful system clipboard transfer or broken authentication. Do not inspect/debug a real cookie to explain a harmless mismatch. Stop before using a real cookie unless this exact native procedure succeeds. Clear the unsubmitted search field afterward; no application data is written.

A browser automation session's clipboard is not proof of the operating-system clipboard. Do not use an assistant clipboard API or an alternate tool/file to work around refused Terminal control. The owner performs native copy/paste. Automated synthetic PTY tests are separate evidence, not proof that this live native handoff succeeded.

## 2. Check the real local session only

Confirm privately that the browser is signed into the intended application account at **`https://127.0.0.1:3000`** and that a reload retains it. The HTTPS scheme/host/port and secure cookie name matter; HTTP sessions are not interchangeable.

First run this command in your own Terminal, **before copying a cookie**:

```bash
node --conditions=react-server --import tsx scripts/ebay-capture-discovery.ts --check-session
```

Only once its hidden prompt is waiting:

1. In that Chrome app tab, open DevTools → Application → Cookies → `https://127.0.0.1:3000`.
2. Locate **`__Secure-better-auth.session_token`**. Check Secure/HttpOnly/SameSite=Lax without sharing its value. Do not take screenshots or copy the table, headers or unrelated cookies.
3. Use native Copy for **only that cookie's Value**. Do not put it in chat, a file, a command, an environment variable or a clipboard artifact.
4. Return to the waiting hidden prompt yourself. Type the literal prefix `__Secure-better-auth.session_token=`, paste the Value using native ⌘V, then press Enter separately. The prefix and value stay hidden.
5. Report only the bounded JSON booleans/failure category and exit code. Replace clipboard contents yourself with harmless text afterward. Never send the cookie here.

Success is `{"authenticated":true,"live":true,"originMatches":true}`, exit 0. `originMatches` confirms the configured exact local HTTPS origin; it does not independently prove browser TLS trust or the intended human account. No identity/session IDs, tokens, cookies or credential digests are printed. Failed validation returns exit 1 and a fixed category such as `format`, `too-long`, `cancelled`, `eof`, `configuration`, `unauthenticated` or `unavailable`. Do not alter authentication security or retry a real provider mode to make a local check pass.

Only one exact `name=value` pair is accepted. Pasted commands, `Cookie:`/`Set-Cookie:` headers, raw values, insecure cookie aliases, additional cookies, whitespace/control characters and oversized input are rejected. The tool does not silently trim/repair credentials. Recognized bracketed-paste frames may span reads; pasted newlines/other escape sequences fail closed and cannot submit trailing lines to the shell. Ctrl+C/Ctrl+D bytes **inside an active paste** invalidate and clear its contents but keep the reader hidden through the intact closing frame; submit separately afterward to receive the fixed failure category. They must not release later pasted bytes to the shell. Outside a paste, intentional Ctrl+C/Ctrl+D still cancel/end input; actual stream EOF, I/O errors and catchable process signals still clean up immediately. Raw/echo state and handlers are restored on success and catchable failure/signals; an OS crash, SIGKILL or terminal-device failure cannot be repaired by the stopped process.

## Read-only authentication boundary

Both local checking and real manual modes use the same input parser and genuine Better Auth session reader. The reader uses the existing secret, secure cookie naming, exact origin and database adapter. It cannot accept an owner/session ID as authentication. Normal app auth options, GitHub callback URLs, cookie security and CSRF behavior are not changed.

In the installed Better Auth version, `disableRefresh` alone does not prevent deletion of expired session rows. The manual reader uses supported GET `deferSessionRefresh`, `disableRefresh` and disabled cookie cache on a **separate PostgreSQL connection with enforced read-only transactions**. It checks the read-only setting before validation. Old-but-live sessions are not renewed; expired/revoked/tampered sessions fail. Any internally generated cookie-clearing headers for rejected sessions are discarded, never forwarded; a live result with Set-Cookie fails closed. No replacement cookies are emitted or records modified.

Both the read-only and execution pool use one validated local factory. The PostgreSQL parser permits query parameters to override the authority's host/port, so checking `URL.hostname` alone is insufficient. The manual tool accepts only the non-destination query keys `application_name`, `connect_timeout`, `options` and `sslmode` (disable/prefer/require/verify-ca/verify-full). Query names are decoded once: an encoded spelling of an allowed name is accepted; duplicates after decoding, unknown/destination selectors, double-encoded aliases, SSL file paths and verification-bypass modes are rejected **before pool construction**. This limited manual-tool profile does not change normal application database configuration. The session pool replaces any supplied startup `options` with its enforced read-only setting; the execution pool preserves allowed settings. These guards can be tested using pure parsing, mocked pools and in-memory streams without connecting to a database or running a native PTY/live handoff. Those tests do not substitute for later authorized runtime verification.

The modes are mutually exclusive with fixture/consent/capture and their arguments. Real modes retain explicit approval flags, exact reviewed-head and clean-checkout guards. This handoff fix supplies no session bridge, endpoint, extension, authentication bypass or new provider permission.

Synthetic regression evidence must use signed sessions in disposable databases, blocked external networking, forbidden provider construction and real OS PTYs. Record actual check exits and live native results separately; a synthetic pass does not replace an owner-observed native rehearsal/session check.
