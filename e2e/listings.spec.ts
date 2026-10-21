import { test, expect } from "@playwright/test";
import { createTestAuth } from "../src/test/auth";
import { listingFixture } from "../src/test/fixtures";

const { pool, auth } = createTestAuth();
let userId: string;
test.beforeEach(async ({ context }) => {
  const helpers = (await auth.$context).test;
  const user = await helpers.saveUser(helpers.createUser());
  userId = user.id;
  await context.addCookies(await helpers.getCookies({ userId }));
});
const ownedIds = new Set<string>();
test.afterEach(async () => {
  for (const id of ownedIds) await pool.query("DELETE FROM listings WHERE id = $1", [id]);
  ownedIds.clear();
  await (await auth.$context).test.deleteUser(userId);
});
test.afterAll(() => pool.end());

test("create, reload, edit, preview warnings and delete a database-backed listing", async ({ page }) => {
  await page.goto("/listings/new");
  await page.getByRole("button", { name: /eBay/ }).click();
  await page.getByRole("button", { name: /Reverb/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Title", { exact: false }).first().fill("E2E Guitar");
  await page.getByLabel("Description", { exact: false }).fill("Clean guitar with a hard case and working electronics.");
  await page.getByLabel("Price", { exact: false }).first().fill("250");
  await page.getByLabel("Brand", { exact: false }).first().fill("Fender");
  await page.getByLabel("Model", { exact: false }).first().fill("Strat");
  await page.getByLabel("Shipping Rate", { exact: false }).fill("0");
  await page.locator('input[type="file"]').setInputFiles({ name: "front.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6jWQAAAAASUVORK5CYII=", "base64") });
  await page.getByRole("button", { name: "Save Listing", exact: true }).click();
  await expect(page).toHaveURL(/\/listings\/[^/]+\/edit$/);
  const segments = page.url().split("/");
  ownedIds.add(segments[segments.length - 2]);
  const result = await pool.query<{ owner_id: string }>("SELECT owner_id FROM listings WHERE id = $1", [segments[segments.length - 2]]);
  expect(result.rows[0].owner_id).toBe(userId);
  await expect(page.getByRole("button", { name: "Download Photo Bundle" })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Title", { exact: false }).first()).toHaveValue("E2E Guitar");
  await expect(page.getByText(/Only filenames are saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download Photo Bundle" })).toHaveCount(0);
  await page.getByLabel("Title", { exact: false }).first().fill("Edited E2E Guitar");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.getByText("1. front.png")).toBeVisible();
  await page.getByRole("button", { name: "→", exact: true }).click();
  await expect(page.getByText(/Category is required for Reverb/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Edited E2E Guitar", exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/listings$/);
  await expect(page.getByRole("link", { name: "Edited E2E Guitar", exact: true })).toHaveCount(0);
});

test("sign out revokes access and an unauthenticated user reaches only sign-in", async ({ page, context }) => {
  await page.goto("/listings");
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  const session = await context.request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
  for (const route of ["/listings", "/listings/new", "/listings/known-id", "/listings/known-id/edit"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test("another authenticated user cannot read or edit a known foreign listing ID", async ({ page }) => {
  const helpers = (await auth.$context).test;
  const other = await helpers.saveUser(helpers.createUser());
  const listing = listingFixture({ title: "Private other-user guitar" });
  const { DrizzleListingRepository } = await import("../src/infrastructure/repositories/drizzleListingRepository");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../src/infrastructure/db/schema");
  const repository = new DrizzleListingRepository(drizzle(pool, { schema }));
  try {
    await repository.create(other.id, listing);
    await page.goto("/listings");
    await expect(page.getByText(listing.title)).toHaveCount(0);
    for (const suffix of ["", "/edit"]) {
      await page.goto(`/listings/${listing.id}${suffix}`);
      await expect(page.getByRole("heading", { name: "Listing not found" })).toBeVisible();
      await expect(page.getByText(listing.title)).toHaveCount(0);
    }
    expect(await repository.getById(other.id, listing.id)).toEqual(listing);
  } finally { await repository.delete(other.id, listing.id); await helpers.deleteUser(other.id); }
});

test("explicit local import persists and repeated import skips existing records", async ({ page }) => {
  const listing = listingFixture({ title: "Imported E2E Guitar" });
  ownedIds.add(listing.id);
  await page.goto("/listings");
  await page.evaluate(value => localStorage.setItem("marketplace-posting-assistant:listings:v2", JSON.stringify({ version: 2, listings: [value] })), listing);
  await page.reload();
  await expect(page.getByRole("link", { name: listing.title, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Import local listings" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 1; skipped 0");
  await page.reload();
  await expect(page.getByRole("link", { name: listing.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import local listings" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 0; skipped 1");
  expect(await page.evaluate(() => localStorage.getItem("marketplace-posting-assistant:listings:v2"))).toContain(listing.id);
});
