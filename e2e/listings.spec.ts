import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { testDatabaseUrl } from "../src/test/testDatabase";
import { listingFixture } from "../src/test/fixtures";

const pool = new Pool({ connectionString: testDatabaseUrl() });
const ownedIds = new Set<string>();
test.afterEach(async () => {
  for (const id of ownedIds) await pool.query("DELETE FROM listings WHERE id = $1", [id]);
  ownedIds.clear();
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
