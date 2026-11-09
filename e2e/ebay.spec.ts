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

test("missing seller policies and locations are guidance, never invented resources", async ({ page, request }) => {
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
    await page.goto(`/listings/${listing.id}/ebay`);
    await page.getByRole("button", { name: "Check eBay Seller Readiness" }).click();
    await expect(page.getByText(/Incomplete — finish seller registration/)).toBeVisible();
    await expect(page.getByText(/Not enrolled — manage business policies/)).toBeVisible();
    await expect(page.getByText(/No usable enabled warehouse/)).toBeVisible();
    await expect(page.getByLabel("Fulfillment policy", { exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: /create.*offer|stage.*inventory|publish|upload/i })).toHaveCount(0);
    const stats = await (await request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } })).json();
    expect(stats.mutations).toBe(0);
  } finally { await repository.delete(owner, listing.id); }
});
