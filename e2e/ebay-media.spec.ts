import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { createTestAuth } from "../src/test/auth";
import { listingFixture } from "../src/test/fixtures";
import { DrizzleListingRepository } from "../src/infrastructure/repositories/drizzleListingRepository";
import * as schema from "../src/infrastructure/db/schema";

const { pool, db, auth } = createTestAuth();
test.afterAll(() => pool.end());
test("explicit generated-fixture media simulation persists one fence across reload, save and local deletion; no real transport or getImage", async ({ page, context, request }) => {
  const helpers = (await auth.$context).test, owner = (await helpers.saveUser(helpers.createUser())).id;
  const listings = new DrizzleListingRepository(db), listing = await listings.create(owner, listingFixture({ title: "Synthetic media attempt fixture" }));
  let pathname: string | undefined;
  await context.addCookies(await helpers.getCookies({ userId: owner }));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["3100", "4311", "4312", "4313"].includes(url.port) ? route.continue() : route.abort();
  });
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=seller-a` }, body: "" });
  });
  const stats = async () => (await request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } })).json();
  const reads = async () => (await request.post("http://127.0.0.1:4311/control/stats", { headers: { authorization: `Bearer ${process.env.TEST_STORAGE_SECRET}` }, data: {} })).json();
  try {
    await page.goto("/settings/integrations/ebay"); await page.getByRole("button", { name: "Connect eBay Sandbox", exact: true }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const source = await sharp({ create: { width: 500, height: 600, channels: 3, background: "#883322" } }).png().toBuffer();
    await page.goto(`/listings/${listing.id}/edit`);
    await expect(page.getByLabel("Upload photos")).toBeEnabled();
    await page.getByLabel("Upload photos").setInputFiles({ name: "synthetic-original.png", mimeType: "image/png", buffer: source });
    await expect(page.getByRole("img", { name: "synthetic-original.png", exact: true })).toBeVisible();
    await expect(page.getByText("Uploading", { exact: false })).toHaveCount(0);
    pathname = (await db.select().from(schema.listingImages).where(eq(schema.listingImages.listingId, listing.id)))[0].pathname!;
    const before = await stats(), beforeReads = await reads(), responses: string[] = [];
    page.on("response", response => { if (new URL(response.url()).pathname === `/listings/${listing.id}/ebay`) void response.text().then(body => responses.push(body)).catch(() => undefined); });
    await page.goto(`/listings/${listing.id}/ebay`); await page.reload();
    const simulate = page.getByRole("button", { name: "Simulate media attempt for photo 1", exact: true });
    await expect(simulate).toBeEnabled(); expect(await stats()).toEqual(before); expect(await reads()).toEqual(beforeReads);
    await simulate.focus(); await expect(simulate).toBeFocused(); await page.keyboard.press("Enter");
    await expect(page.getByText(/Simulated response recorded/)).toBeVisible();
    const after = await stats(); expect(after.mediaPosts - before.mediaPosts).toBe(1); expect(after.mediaAccepted - before.mediaAccepted).toBe(1); expect(after.mediaGets).toBe(0);
    const [attempt] = await db.select().from(schema.ebayMediaAttempts).where(eq(schema.ebayMediaAttempts.ownerId, owner));
    expect(attempt.state).toBe("confirmed"); expect(attempt.simulation).toBe(true); expect(attempt.sourceDigest).not.toBe(attempt.exportDigest);
    expect(attempt.returnedImageId).not.toBeNull(); expect(attempt.expiresAt).not.toBeNull();
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length, readable: document.cookie }))).toEqual({ local: 0, session: 0, readable: "" });
    expect(responses.join(" ")).not.toMatch(/fake-access|fake-refresh|ciphertext|authTag|fake_[a-f0-9]{32}|\/eps\/|images\/|pathname|sourceDigest|exportDigest/);
    const readAfter = await reads(); await page.reload(); await expect(simulate).toBeEnabled();
    expect(await stats()).toEqual(after); expect(await reads()).toEqual(readAfter);
    await simulate.click(); await expect(page.getByText(/Simulated response recorded/)).toBeVisible(); expect(await stats()).toEqual(after); expect(await reads()).toEqual(readAfter);
    await expect(page.getByRole("button", { name: "Upload to eBay — unavailable" })).toBeDisabled();
    await page.goto(`/listings/${listing.id}/edit`); await page.getByLabel("Title", { exact: false }).first().fill("Local edit after simulation");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Saved!" })).toBeVisible();
    expect(await stats()).toEqual(after);
    await page.goto(`/listings/${listing.id}/ebay`); await simulate.click();
    await expect(page.getByText(/Simulation requires operator review/)).toBeVisible(); expect(await stats()).toEqual(after);
    await page.goto(`/listings/${listing.id}`); page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Delete", exact: true }).click(); await expect(page).toHaveURL("http://127.0.0.1:3100/listings");
    expect(await listings.getById(owner, listing.id)).toBeNull();
    const retained = (await db.select().from(schema.ebayMediaAttempts).where(eq(schema.ebayMediaAttempts.ownerId, owner)))[0];
    expect(retained.state).toBe("residual"); expect(retained.returnedImageId).toBe(attempt.returnedImageId);
    const cleanup = (await db.select().from(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, pathname)))[0];
    expect(Date.parse(cleanup.notBefore)).toBeGreaterThan(Date.now()); expect(await stats()).toEqual(after);
  } finally {
    // Explicit CI-only teardown of this generated fixture and simulated journal.
    await db.delete(schema.ebayMediaAttempts).where(eq(schema.ebayMediaAttempts.ownerId, owner));
    if (await listings.getById(owner, listing.id)) await listings.delete(owner, listing.id);
    if (pathname) {
      await request.post("http://127.0.0.1:4311/control/delete", { headers: { authorization: `Bearer ${process.env.TEST_STORAGE_SECRET}` }, data: { pathname } });
      await db.delete(schema.imageCleanup).where(eq(schema.imageCleanup.pathname, pathname));
    }
    await helpers.deleteUser(owner);
  }
});
