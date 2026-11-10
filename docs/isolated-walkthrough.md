# Isolated local walkthrough

This replay uses the real application UI with **simulated providers and synthetic data**, not real seller acceptance. It demonstrates the current local preparation boundary, not eBay image export or publishing.

## Run the existing test environment

Use the repository's documented Node 24/dependency setup and an already running local PostgreSQL service. Configure the existing ignored `TEST_DATABASE_URL` for a separate disposable database ending in `_test`; never point it at development or production data. [Database/test setup](../README.md#validation).

From the repository root:

```sh
npm ci
npx playwright install chromium
npm run test:e2e -- --grep 'keyboard and mobile local walkthrough' --headed
```

Omit `--headed` for a headless replay. The same workflow runs in the full suite:

```sh
npm run check
```

Playwright starts the existing build-time test configuration on **127.0.0.1:3100**, with fake private storage on 4311, fake Reverb on 4312 and fake eBay on 4313. It applies committed migrations to the dedicated test database and creates a temporary authenticated synthetic app user using the existing test helpers; no GitHub sign-in or auth-bypass HTTP route is added. Temporary test encryption/authentication values are generated in memory, not copied into local configuration. The walkthrough's browser blocks non-loopback requests except an intercepted, locally fulfilled fake eBay consent redirect. Server-side test adapters route all provider work to loopback fakes. Nothing is deployed.

The server configuration refuses a nonlocal/non-`_test` database and Vercel use, and refuses to reuse an existing server. If these ports are occupied, stop only a test process you own; do not kill unrelated development services. A missing dedicated database/browser is a setup failure, not permission to use real providers or credentials. Normal builds continue to resolve the real adapters.

## What the replay does

1. **Create/edit:** choose eBay and Reverb by keyboard; verify selected state and visible focus. Attempt an incomplete save and read the focused error summary. Complete a clearly synthetic pedal listing with positive price and zero USD shipping. Open the exit dialog, check trapped focus, cancel with Escape, then save privately. Ordinary Save creates no provider resource.
2. **Manage private photos:** generate two small 500×600 PNGs in memory and upload through the normal UI to fake private storage. Include a long synthetic filename. Move the rear photo earlier, remove it and verify meaningful focus plus completion announcements; one photo remains. Edit/save the local listing. No personal photo or real Blob call is involved.
3. **Preview marketplaces:** open the local previews and move between them using the named Previous/Next buttons. Verify local-only messaging, position announcements, long description/filename wrapping and no page overflow at 320, 390 and 1280 pixels. Previews are pure formatting, not remote resources. They may show missing provider fields truthfully.
4. **Prepare eBay:** show the disconnected state, then use the intercepted fake connection and fake read-only permission flow. Merely opening/reloading preparation makes zero provider or private-byte validation requests. Explicitly browse synthetic category branches, choose a supported synthetic condition and prepare the read-only review; focus follows the result. Explicitly inspect simulated seller readiness and validate the saved photo. The fake seller's configured policies/locations are test fixtures, not evidence about a real account.
5. **Explain the boundary:** the photo result is temporary; Upload to eBay remains disabled and explains why. Validation performs no fake eBay call, no remote write or publication. Ordinary local Save/navigation still makes no provider call; a changed listing clears prior temporary preparation. The workflow verifies empty Web Storage and no MarketplaceListing publication. [Current media boundary](ebay-private-media.md), [proposed export privacy policy](photo-export-privacy.md).

Generated screenshots are in the workflow's ignored `test-results/` directory: `mobile-preview.png` and `desktop-preparation.png`. They contain synthetic content only. These are reproducible test artifacts, not a new demo subsystem or screenshots of a real account.

## Cleanup and evidence limits

The workflow removes only its synthetic local listing, user/connection and known fake photo/cleanup records in `finally`/test teardown; provider processes and in-memory objects stop when Playwright finishes. A force-killed test can leave test-database rows—never use a blanket deletion against development data to clean these up. Existing encrypted development connections, private originals, `.env.local` and the workspace file are untouched.

The broader suite also covers photo-review expiry without provider calls, clipboard denial, stale server responses, owner isolation, retention/retries and disconnected/partially configured readiness. This pass checks real Chromium focus and layouts with fake providers. It does **not** establish full WCAG conformance, manual VoiceOver/NVDA announcements, every mobile browser, real provider compatibility or sanitizer acceptance. The privacy specification's generated metadata/orientation cases are future acceptance requirements, not completed sanitizer tests.

A separate pre-existing limitation is photo-bundle memory: up to 40 files of 10 MiB can require roughly 400 MiB of source bytes plus ZIP/runtime allocations. Sequential downloads limit concurrency, not aggregate memory. Large-bundle streaming or an explicit total-byte budget needs a separate focused change; this pass does not claim large-bundle mobile reliability.

EPS transfer remains unimplemented and blocked pending authoritative Sandbox contract clarification, owner-reviewed privacy decisions and a separately reviewed/authorized transfer lifecycle. Stage 9B remains In Progress.
