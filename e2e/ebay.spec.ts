import { test, expect } from "@playwright/test";
import { createTestAuth } from "../src/test/auth";
const {pool,auth}=createTestAuth();
test.use({trace:"off"});
let owner:string;
test.beforeEach(async({context})=>{const h=(await auth.$context).test;const user=await h.saveUser(h.createUser());owner=user.id;await context.addCookies(await h.getCookies({userId:owner}));});
test.afterEach(async()=>{
  // A timed-out UI assertion must not strand this test owner's local fixtures.
  const { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../src/infrastructure/db/schema");
  const repository = new DrizzleListingRepository(drizzle(pool, { schema }));
  for (const listing of await repository.list(owner)) await repository.delete(owner, listing.id);
  await(await auth.$context).test.deleteUser(owner);
});
test.afterAll(()=>pool.end());
test("explicit fake OAuth connection, reload, refresh, disconnect and browser privacy; passive navigation calls no provider",async({page,context,request})=>{
  const stats=async()=>await(await request.get("http://127.0.0.1:4313/stats",{headers:{"x-test-secret":process.env.TEST_EBAY_SECRET!}})).json() as {exchanges:number;refreshes:number;identities:number};
  const before=await stats();await page.goto("/settings/integrations/ebay");await expect(page.getByText("Not connected",{exact:true})).toBeVisible();await page.reload();expect(await stats()).toEqual(before);
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**",async route=>{
    const url=new URL(route.request().url());expect(url.searchParams.get("redirect_uri")).toBe("fake-sandbox-runame");
    await route.fulfill({status:302,headers:{location:`http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=seller-a`},body:""});
  });
  const bodies:string[]=[];page.on("response",r=>{if(r.url().startsWith("http://127.0.0.1:3100/settings/integrations/ebay"))void r.text().then(t=>bodies.push(t)).catch(()=>undefined);});
  await page.getByRole("button",{name:"Connect eBay Sandbox",exact:true}).click();await expect(page.getByText("Connected",{exact:true})).toBeVisible();await expect(page.getByText("Verified seller: TESTUSER_seller-a")).toBeVisible();
  expect(page.url()).not.toMatch(/code=|state=/);const connected=await stats();expect(connected.exchanges-before.exchanges).toBe(1);
  await page.reload();expect(await stats()).toEqual(connected);
  const stored=await page.evaluate(()=>({local:Object.values(localStorage),session:Object.values(sessionStorage),cookie:document.cookie}));
  expect(JSON.stringify(stored)).not.toMatch(/fake-access|fake-refresh|ciphertext|authTag|seller-a|Bearer/);expect(stored.cookie).not.toContain("session_token");
  expect(bodies.join(" ")).not.toMatch(/fake-access|fake-refresh|ciphertext|leaseToken/);
  const row=await pool.query("SELECT access, refresh, seller_id FROM ebay_connections WHERE owner_id=$1",[owner]);
  expect(row.rows).toHaveLength(1);expect(JSON.stringify(row.rows[0])).not.toMatch(/fake-access|fake-refresh/);
  await pool.query("UPDATE ebay_connections SET access_expires_at=now()-interval '1 minute' WHERE owner_id=$1",[owner]);
  await page.getByRole("button",{name:"Check eBay authorization",exact:true}).click();await expect(page.getByRole("status").last()).toContainText("Authorization checked");expect((await stats()).refreshes-connected.refreshes).toBe(1);
  const foreign=await context.browser()!.newContext();try{
    const h=(await auth.$context).test,user=await h.saveUser(h.createUser());
    try{await foreign.addCookies(await h.getCookies({userId:user.id}));const p=await foreign.newPage();await p.goto("http://127.0.0.1:3100/settings/integrations/ebay");await expect(p.getByText("Not connected",{exact:true})).toBeVisible();await expect(p.getByText(/TESTUSER_seller-a/)).toHaveCount(0);}finally{await h.deleteUser(user.id);}
  }finally{await foreign.close();}
  await page.getByRole("button",{name:"Disconnect eBay",exact:true}).click();await expect(page.getByText("Not connected",{exact:true})).toBeVisible();
  expect((await pool.query("SELECT access,refresh FROM ebay_connections WHERE owner_id=$1",[owner])).rows[0]).toEqual({access:null,refresh:null});
});
test("fake denied consent cannot persist a connection and callback replay fails",async({page})=>{
  let callback="";
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**",async route=>{const url=new URL(route.request().url());callback=`http://127.0.0.1:3100/api/integrations/ebay/declined?state=${url.searchParams.get("state")}`;await route.fulfill({status:302,headers:{location:callback},body:""});});
  await page.goto("/settings/integrations/ebay");await page.getByRole("button",{name:"Connect eBay Sandbox",exact:true}).click();await expect(page.getByText("Authorization was cancelled.",{exact:true})).toBeVisible();await expect(page.getByText("Not connected",{exact:true})).toBeVisible();
  const result=await page.request.get(callback,{maxRedirects:0});expect(result.headers().location).toContain("result=failed");
});

test("explicit read-only category/aspect/condition preparation; passive navigation and local save make no provider calls", async ({ page, request }) => {
  const stats = async () => await (await request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } })).json();
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=seller-a` }, body: "" });
  });
  await page.goto("/settings/integrations/ebay");
  await page.getByRole("button", { name: "Connect eBay Sandbox", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const { listingFixture } = await import("../src/test/fixtures");
  const { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../src/infrastructure/db/schema");
  const repository = new DrizzleListingRepository(drizzle(pool, { schema }));
  const listing = await repository.create(owner, listingFixture());
  try {
    const before = await stats();
    const bodies: string[] = [];
    page.on("response", r => { if (r.url().includes(`/listings/${listing.id}/ebay`)) void r.text().then(t => bodies.push(t)).catch(() => undefined); });
    await page.goto(`/listings/${listing.id}/ebay`); await page.reload();
    await expect(page.getByRole("button", { name: "Load eBay categories" })).toBeEnabled();
    expect(await stats()).toEqual(before);
    await page.getByRole("button", { name: "Load eBay categories" }).click();
    await page.getByRole("button", { name: "Browse Synthetic musical instruments" }).click();
    await page.getByRole("button", { name: "Select Synthetic effects pedals" }).click();
    await page.getByLabel("eBay condition").selectOption("3000");
    await page.getByRole("button", { name: "Prepare eBay review" }).click();
    const review = page.getByRole("region", { name: "eBay preparation review" });
    // The review has no staging/publishing action and exposes no provider token or source URL.
    await expect(page.getByRole("heading", { name: "Read-only eBay review" })).toBeVisible();
    await expect(review).toBeVisible();
    await expect(review.getByText(listing.askingPrice.amount.toFixed(2) + " USD", { exact: true })).toBeVisible();
    await expect(page.getByText("Not ready for remote staging. Remaining work:")).toBeVisible();
    await expect(page.getByText(/^mpa-ebay-[a-f0-9]{32}$/)).toBeVisible();
    expect(bodies.join(" ")).not.toMatch(/fake-application-|fake-access-|fake-refresh-|ciphertext|authTag/);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length }))).toEqual({ local: 0, session: 0 });
    const loaded = await stats(); expect(loaded.metadataReads).toBeGreaterThan(before.metadataReads);
    expect(loaded.exchanges).toBe(before.exchanges); expect(loaded.identities).toBe(before.identities);
    await page.goto(`/listings/${listing.id}/edit`);
    await page.getByLabel("Title", { exact: false }).first().fill("Locally edited metadata fixture");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeDisabled();
    expect(await stats()).toEqual(loaded);
    expect(await review.count()).toBe(0);
  } finally { await repository.delete(owner, listing.id); }
});

test("explicit read-only permission upgrade and seller checks; no passive calls, browser secrets, or resource mutations", async ({ page, request }) => {
  const stats = async () => await (await request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } })).json();
  let upgrade = false;
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**", async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(upgrade ? [
      "https://api.ebay.com/oauth/api_scope", "https://api.ebay.com/oauth/api_scope/sell.account.readonly", "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
    ] : ["https://api.ebay.com/oauth/api_scope"]);
    await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=${upgrade ? "seller-a-readiness" : "seller-a"}` }, body: "" });
  });
  const { listingFixture } = await import("../src/test/fixtures");
  const { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../src/infrastructure/db/schema");
  const repository = new DrizzleListingRepository(drizzle(pool, { schema })), listing = await repository.create(owner, listingFixture());
  try {
    await page.goto(`/listings/${listing.id}/ebay`);
    await expect(page.getByRole("button", { name: "Check eBay Seller Readiness" })).toBeDisabled();
    await page.goto("/settings/integrations/ebay");
    await page.getByRole("button", { name: "Connect eBay Sandbox", exact: true }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const base = await stats();
    await page.goto(`/listings/${listing.id}/ebay`); await page.reload();
    await expect(page.getByText(/Additional read-only permissions are required/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Check eBay Seller Readiness" })).toBeDisabled();
    expect(await stats()).toEqual(base);
    await page.getByRole("link", { name: "eBay connection and permissions" }).click();
    upgrade = true;
    await page.getByRole("button", { name: "Authorize read-only seller checks", exact: true }).click();
    await expect(page.getByText("Permissions: Account identity, read-only account settings/business policies and read-only inventory locations.", { exact: true })).toBeVisible();
    const authorized = await stats();
    expect(authorized.exchanges - base.exchanges).toBe(1);
    const bodies: string[] = [];
    page.on("response", r => { if (r.url().includes(`/listings/${listing.id}/ebay`)) void r.text().then(t => bodies.push(t)).catch(() => undefined); });
    await page.goto(`/listings/${listing.id}/ebay`); await page.reload();
    await expect(page.getByRole("button", { name: "Check eBay Seller Readiness" })).toBeEnabled();
    expect(await stats()).toEqual(authorized);
    await page.getByRole("button", { name: "Check eBay Seller Readiness" }).click();
    const report = page.getByRole("region", { name: "Seller readiness result" });
    await expect(report).toBeVisible();
    await expect(report.getByText("Enrolled", { exact: true })).toBeVisible();
    await expect(report.getByText(/write eligibility remains unverified/)).toBeVisible();
    await page.getByLabel("Fulfillment policy", { exact: true }).selectOption("100");
    await page.getByLabel("Inventory warehouse location").selectOption("fixture-warehouse-0");
    await expect(page.getByRole("option", { name: /fixture-warehouse-1/ })).toBeDisabled();
    const checked = await stats();
    expect(checked.readinessReads - authorized.readinessReads).toBe(6); expect(checked.mutations).toBe(0);
    expect(bodies.join(" ")).not.toMatch(/fake-access|fake-refresh|private-fixture|ciphertext|authTag|addressLine|postalCode/);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length }))).toEqual({ local: 0, session: 0 });
    await page.goto(`/listings/${listing.id}/edit`);
    await page.getByLabel("Title", { exact: false }).first().fill("Readiness local save fixture");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeDisabled();
    expect(await stats()).toEqual(checked);
    await pool.query("UPDATE ebay_connections SET status='reconnect' WHERE owner_id=$1", [owner]);
    await page.goto(`/listings/${listing.id}/ebay`);
    await expect(page.getByRole("button", { name: "Check eBay Seller Readiness" })).toBeDisabled();
    expect(await stats()).toEqual(checked);
    await page.goto("/settings/integrations/ebay");
    await page.getByRole("button", { name: "Disconnect eBay", exact: true }).click();
    await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
    const disconnected = await stats();
    await page.goto(`/listings/${listing.id}/ebay`);
    await expect(page.getByRole("button", { name: "Check eBay Seller Readiness" })).toBeDisabled();
    expect(await stats()).toEqual(disconnected);
  } finally { await repository.delete(owner, listing.id); }
});

test("unenrolled seller accepts sparse empty locations, skips policies, and preserves browser privacy", async ({ page, request }) => {
  const stats = async () => await (await request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } })).json();
  let upgrade = false;
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=${upgrade ? "seller-b-readiness" : "seller-b"}` }, body: "" });
  });
  const { listingFixture } = await import("../src/test/fixtures");
  const { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../src/infrastructure/db/schema");
  const repository = new DrizzleListingRepository(drizzle(pool, { schema })), listing = await repository.create(owner, listingFixture());
  try {
    await page.goto("/settings/integrations/ebay");
    await page.getByRole("button", { name: "Connect eBay Sandbox", exact: true }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    upgrade = true;
    await page.getByRole("button", { name: "Authorize read-only seller checks", exact: true }).click();
    await expect(page.getByText("Permissions: Account identity, read-only account settings/business policies and read-only inventory locations.", { exact: true })).toBeVisible();
    const authorized = await stats();
    const bodies: string[] = [];
    page.on("response", r => { if (r.url().includes(`/listings/${listing.id}/ebay`)) void r.text().then(t => bodies.push(t)).catch(() => undefined); });
    await page.goto(`/listings/${listing.id}/ebay`); await page.reload();
    await expect(page.getByRole("button", { name: "Check eBay Seller Readiness" })).toBeEnabled();
    expect(await stats()).toEqual(authorized);
    await page.getByRole("button", { name: "Check eBay Seller Readiness" }).click();
    const report = page.getByRole("region", { name: "Seller readiness result" });
    await expect(report).toBeVisible();
    await expect(report.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/Incomplete — finish seller registration/)).toBeVisible();
    await expect(page.getByText(/Not enrolled — manage business policies/)).toBeVisible();
    await expect(page.getByText(/Business policies are unavailable because/)).toBeVisible();
    await expect(page.getByText(/No usable enabled warehouse/)).toBeVisible();
    await expect(page.getByLabel("Fulfillment policy", { exact: true })).toHaveValue("");
    for (const kind of ["Fulfillment", "Payment", "Return"]) await expect(page.getByLabel(kind + " policy", { exact: true })).toBeDisabled();
    await expect(page.getByText(/No existing non-motor EBAY_US policy/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /create.*offer|stage.*inventory|publish/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload to eBay — unavailable", exact: true })).toBeDisabled();
    const checked = await stats();
    expect(checked.readinessReads - authorized.readinessReads).toBe(3);
    expect(checked.exchanges).toBe(authorized.exchanges); expect(checked.refreshes).toBe(authorized.refreshes); expect(checked.mutations).toBe(0);
    expect(bodies.join(" ")).not.toMatch(/fake-access|fake-refresh|private-fixture|ciphertext|authTag|addressLine|postalCode|longMessage/);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length, cookies: document.cookie }))).toEqual({ local: 0, session: 0, cookies: "" });
    await page.reload(); expect(await stats()).toEqual(checked);
  } finally { await repository.delete(owner, listing.id); }
});

test("private-photo preparation validates explicit bytes, retains source, and never uploads to eBay", async ({ page, request }) => {
  const stats = async () => (await request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } })).json();
  const storageReads = async () => (await request.post("http://127.0.0.1:4311/control/stats", {
    headers: { Authorization: `Bearer ${process.env.TEST_STORAGE_SECRET}` }, data: {},
  })).json();
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=seller-a` }, body: "" });
  });
  await page.goto("/settings/integrations/ebay"); await page.getByRole("button", { name: "Connect eBay Sandbox", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const { listingFixture } = await import("../src/test/fixtures"), { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository");
  const { drizzle } = await import("drizzle-orm/node-postgres"), schema = await import("../src/infrastructure/db/schema"), sharp = (await import("sharp")).default;
  const repository = new DrizzleListingRepository(drizzle(pool, { schema })), listing = await repository.create(owner, listingFixture());
  let pathname: string | undefined;
  try {
    const pixels = await sharp({ create: { width: 500, height: 600, channels: 3, background: "#446688" } }).png().toBuffer();
    await page.goto(`/listings/${listing.id}/edit`); await expect(page.getByLabel("Upload photos")).toBeEnabled();
    await page.getByLabel("Upload photos").setInputFiles({ name: "private-preparation.png", mimeType: "image/png", buffer: pixels });
    await expect(page.getByRole("img", { name: "private-preparation.png", exact: true })).toBeVisible();
    await expect(page.getByText("Uploading", { exact: false })).toHaveCount(0);
    const row = (await pool.query("SELECT pathname FROM listing_images WHERE listing_id=$1", [listing.id])).rows[0]; pathname = row.pathname;
    const providerBefore = await stats(), storageBefore = await storageReads();
    const bodies: string[] = []; page.on("response", response => { if (new URL(response.url()).pathname === `/listings/${listing.id}/ebay`) void response.text().then(body => bodies.push(body)).catch(() => undefined); });
    await page.goto(`/listings/${listing.id}/ebay`); await page.reload();
    await expect(page.getByRole("button", { name: "Validate photo 1", exact: true })).toBeEnabled();
    expect(await stats()).toEqual(providerBefore); expect(await storageReads()).toEqual(storageBefore);
    await page.getByRole("button", { name: "Validate photo 1", exact: true }).click();
    await expect(page.getByText(/Photo verified for local export review/)).toContainText("500 × 600");
    await expect(page.getByRole("button", { name: "Upload to eBay — unavailable", exact: true })).toBeDisabled();
    expect((await storageReads()).privateReads - storageBefore.privateReads).toBe(1); expect(await stats()).toEqual(providerBefore);
    expect(bodies.join(" ")).not.toMatch(/fake-access|fake-refresh|ciphertext|authTag|images\/|object\/|pathname|Bearer/);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length, cookies: document.cookie }))).toEqual({ local: 0, session: 0, cookies: "" });
    expect((await pool.query("SELECT provider_retain_until > now() AS retained FROM listing_images WHERE listing_id=$1", [listing.id])).rows[0].retained).toBe(true);
    const readAfter = await storageReads();
    await page.goto(`/listings/${listing.id}/edit`); await page.getByLabel("Title", { exact: false }).first().fill("Private photo local save fixture");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();
    expect(await storageReads()).toEqual(readAfter); expect(await stats()).toEqual(providerBefore);
    await page.goto(`/listings/${listing.id}/ebay`); expect(await storageReads()).toEqual(readAfter);
    await expect(page.getByText(/Photo verified for local export review/)).toHaveCount(0);
    expect((await pool.query("SELECT count(*)::integer n FROM marketplace_listings WHERE listing_id=$1", [listing.id])).rows[0].n).toBe(0);
  } finally {
    await repository.delete(owner, listing.id);
    // Test-only teardown: no real Blob object or provider resource exists.
    if (pathname) await pool.query("DELETE FROM image_cleanup WHERE pathname=$1", [pathname]);
  }
});

test("keyboard and mobile local walkthrough with simulated providers", async ({ page, context, request }, testInfo) => {
  test.slow();
  // No browser request can reach a real marketplace. The normal app also uses
  // build-time fake adapters, a separate _test database and synthetic auth.
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["3100", "4311", "4312", "4313"].includes(url.port) ? route.continue() : route.abort();
  });
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**", async route => {
    const url = new URL(route.request().url()), readiness = url.searchParams.get("scope")?.includes("sell.account.readonly");
    await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=${readiness ? "seller-a-readiness" : "seller-a"}` }, body: "" });
  });
  const stats = async () => (await request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } })).json();
  const storageStats = async () => (await request.post("http://127.0.0.1:4311/control/stats", { headers: { Authorization: `Bearer ${process.env.TEST_STORAGE_SECRET}` }, data: {} })).json();
  const noOverflow = async () => {
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth,
      overflow: Array.from(document.querySelectorAll("main, section, fieldset, label, select, textarea, input")).filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(el => ({ tag: el.tagName, className: el.className })) }));
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
  };
  let listingId: string | undefined;
  const paths = new Set<string>();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/listings/new");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    const ebay = page.getByRole("button", { name: "eBay", exact: true });
    await ebay.focus(); await page.keyboard.press("Space"); await expect(ebay).toHaveAttribute("aria-pressed", "true");
    expect(await ebay.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await page.getByRole("button", { name: "Reverb", exact: true }).focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Continue", exact: true }).focus(); await page.keyboard.press("Enter");
    const title = page.getByLabel("Title", { exact: false }).first(); await expect(title).toBeFocused();
    await title.fill("Bad");
    await page.getByRole("button", { name: "Save Listing", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert", { name: "Complete These Fields" })).toBeFocused();
    await title.fill("Synthetic Walkthrough Pedal");
    await page.getByLabel("Description", { exact: false }).fill("Generated test item; no real listing. " + "longword".repeat(35));
    await page.getByLabel("Price", { exact: false }).first().fill("75");
    await page.getByLabel("Brand", { exact: false }).first().fill("Synthetic");
    await page.getByLabel("Model", { exact: false }).first().fill("Test Pedal");
    await page.getByLabel("Shipping Rate", { exact: false }).fill("0");
    const exit = page.getByRole("button", { name: "Exit To Home", exact: true });
    await exit.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Save Before Leaving?" });
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    expect(await dialog.evaluate(el => el.matches(":modal"))).toBe(true);
    await title.focus(); await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Exit Without Saving", exact: true })).toBeFocused();
    await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(exit).toBeFocused();
    await expect(title).toHaveValue("Synthetic Walkthrough Pedal");
    await noOverflow();
    const beforeSave = await stats();
    await page.getByRole("button", { name: "Save Listing", exact: true }).click();
    await expect(page).toHaveURL(/\/listings\/[^/]+\/edit$/); listingId = page.url().split("/").slice(-2)[0];
    expect(await stats()).toEqual(beforeSave);
    const sharp = (await import("sharp")).default;
    const frontName = "synthetic-front-" + "x".repeat(85) + ".png";
    const bytes = await sharp({ create: { width: 500, height: 600, channels: 3, background: "#446688" } }).png().toBuffer();
    await expect(page.getByLabel("Upload photos")).toBeEnabled();
    await page.getByLabel("Upload photos").setInputFiles([frontName, "synthetic-rear.png"].map(name => ({ name, mimeType: "image/png", buffer: bytes })));
    await expect(page.getByRole("status").filter({ hasText: "2 photos saved privately." })).toBeVisible();
    for (const row of (await pool.query("SELECT pathname FROM listing_images WHERE listing_id=$1", [listingId])).rows) paths.add(row.pathname);
    await page.getByRole("button", { name: "Move synthetic-rear.png earlier", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem", { name: "Photo 1: synthetic-rear.png", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Remove synthetic-rear.png", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem", { name: "Photo 1: " + frontName, exact: true })).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Photo removed from this local listing." })).toBeVisible();
    await page.getByLabel("Title", { exact: false }).first().fill("Synthetic Walkthrough Edited");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Next marketplace preview" }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("status", { name: "Marketplace preview position" })).toHaveText("2 / 2");
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: testInfo.outputPath("mobile-preview.png"), fullPage: true });
    await page.goto(`/listings/${listingId}/ebay`);
    await expect(page.getByRole("button", { name: "Load eBay categories" })).toBeDisabled();
    await page.goto("/settings/integrations/ebay");
    await page.getByRole("button", { name: "Connect eBay Sandbox", exact: true }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Authorize read-only seller checks", exact: true }).click();
    await expect(page.getByText("Permissions: Account identity, read-only account settings/business policies and read-only inventory locations.", { exact: true })).toBeVisible();
    const connectedStats = await stats(), beforeReads = await storageStats();
    await page.goto(`/listings/${listingId}/ebay`); await page.reload();
    await expect(page.getByRole("button", { name: "Validate photo 1", exact: true })).toBeEnabled();
    expect(await stats()).toEqual(connectedStats); expect(await storageStats()).toEqual(beforeReads);
    await page.getByRole("button", { name: "Load eBay categories" }).click();
    await page.getByRole("button", { name: "Browse Synthetic musical instruments" }).click();
    await page.getByRole("button", { name: "Select Synthetic effects pedals" }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByText("Synthetic effects pedals", { exact: true })).toBeFocused();
    await page.getByLabel("eBay condition").selectOption("3000");
    await page.getByRole("button", { name: "Prepare eBay review", exact: true }).click();
    await expect(page.getByRole("region", { name: "eBay preparation review" })).toBeFocused();
    await page.getByRole("button", { name: "Check eBay Seller Readiness", exact: true }).click();
    await expect(page.getByRole("region", { name: "Seller readiness result" })).toBeVisible();
    const preparedStats = await stats();
    await page.getByRole("button", { name: "Validate photo 1", exact: true }).click();
    await expect(page.getByText(/Photo verified for local export review/)).toContainText("500 × 600");
    await expect(page.getByRole("button", { name: "Upload to eBay — unavailable", exact: true })).toBeDisabled();
    expect(await stats()).toEqual(preparedStats); expect(preparedStats.mutations).toBe(0);
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(); }
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: testInfo.outputPath("desktop-preparation.png"), fullPage: true });
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length }))).toEqual({ local: 0, session: 0 });
    const passive = await stats();
    await page.goto(`/listings/${listingId}/edit`); await page.getByLabel("Title", { exact: false }).first().fill("Synthetic Walkthrough Final");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();
    await page.goto(`/listings/${listingId}/ebay`);
    await expect(page.getByText(/Photo verified for local export review/)).toHaveCount(0); expect(await stats()).toEqual(passive);
    expect((await pool.query("SELECT count(*)::integer n FROM marketplace_listings WHERE listing_id=$1", [listingId])).rows[0].n).toBe(0);
  } finally {
    if (listingId) {
      const { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository"), { drizzle } = await import("drizzle-orm/node-postgres"), schema = await import("../src/infrastructure/db/schema");
      await new DrizzleListingRepository(drizzle(pool, { schema })).delete(owner, listingId);
    }
    for (const pathname of paths) {
      await request.post("http://127.0.0.1:4311/control/delete", { headers: { Authorization: `Bearer ${process.env.TEST_STORAGE_SECRET}` }, data: { pathname } });
      await pool.query("DELETE FROM image_cleanup WHERE pathname=$1", [pathname]);
    }
  }
});
