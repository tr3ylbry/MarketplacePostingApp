import { test, expect } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { createTestAuth } from "../src/test/auth";
import { listingFixture } from "../src/test/fixtures";
import { listingToRows } from "../src/infrastructure/repositories/listingMapping";
import * as schema from "../src/infrastructure/db/schema";

const { db, pool, auth } = createTestAuth();
const owners: string[] = [];
test.afterEach(async () => {
  if (owners.length) await db.delete(schema.listings).where(inArray(schema.listings.ownerId, owners));
  const helpers = (await auth.$context).test;
  for (const id of owners) await helpers.deleteUser(id);
  owners.length = 0;
});
test.afterAll(() => pool.end());

test("inventory title search, URL pagination/history, owner isolation and final-page deletion without provider traffic", async ({ page, context, request }, testInfo) => {
  const helpers = (await auth.$context).test;
  const owner = (await helpers.saveUser(helpers.createUser())).id;
  const other = (await helpers.saveUser(helpers.createUser())).id;
  owners.push(owner, other);
  await context.addCookies(await helpers.getCookies({ userId: owner }));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && ["3100", "4311", "4312", "4313"].includes(url.port) ? route.continue() : route.abort();
  });
  const literal = "100%_\\ O'Reilly 東京 🎸";
  const titles = [
    ...Array.from({ length: 26 }, (_, index) => `Needle guitar ${String(index).padStart(2, "0")}`),
    ...Array.from({ length: 30 }, (_, index) => `Other amplifier ${String(index).padStart(2, "0")}`),
    `Literal ${literal}`, "Long inventory title " + "x".repeat(300), "<script>window.inventoryInjected=1</script>",
  ];
  const rows = titles.map((title, index) => ({ ...listingToRows({ ...listingFixture({ title }),
    id: `${owner}-${String(index).padStart(3, "0")}`, createdAt: "2026-01-01T00:00:00.000Z" }).row, ownerId: owner }));
  const foreign = Array.from({ length: 5 }, (_, index) => ({ ...listingToRows(listingFixture({ title: `Needle foreign ${index}` })).row, ownerId: other }));
  await db.insert(schema.listings).values([...rows, ...foreign]);
  const providerStats = async () => {
    const responses = await Promise.all([
      request.get("http://127.0.0.1:4313/stats", { headers: { "x-test-secret": process.env.TEST_EBAY_SECRET! } }),
      request.get("http://127.0.0.1:4312/stats", { headers: { "x-test-secret": process.env.TEST_REVERB_SECRET! } }),
      request.post("http://127.0.0.1:4311/control/stats", { headers: { authorization: `Bearer ${process.env.TEST_STORAGE_SECRET!}` }, data: {} }),
    ]);
    for (const response of responses) expect(response.ok()).toBe(true);
    return Promise.all(responses.map(response => response.json()));
  };
  const before = await providerStats();
  let imageReads = 0, inventoryRequests = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (/\/api\/listings\/[^/]+\/images\//.test(url.pathname) || url.port === "4311") imageReads++;
    if (url.pathname === "/listings") inventoryRequests++;
  });
  await page.goto("/listings");
  const dashboard = page.getByRole("region", { name: "Saved listings" });
  await expect(dashboard.locator(".listing-card")).toHaveCount(25);
  await expect(dashboard.getByText("59 total", { exact: true })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search inventory titles" });
  const requestsBeforeTyping = inventoryRequests;
  await search.fill("Needle");
  await page.waitForTimeout(150);
  expect(inventoryRequests).toBe(requestsBeforeTyping);
  await search.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Needle");
  await expect(dashboard.getByText("26 matching", { exact: true })).toBeVisible();
  await expect(dashboard.locator(".listing-card")).toHaveCount(25);
  await search.focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Search titles" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Clear search" })).toBeFocused();
  await page.getByRole("link", { name: "Next inventory page" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Needle&page=2");
  await expect(dashboard.locator(".listing-card")).toHaveCount(1);
  await expect(dashboard.getByRole("link", { name: "Needle guitar 25", exact: true })).toBeVisible();
  await expect(dashboard.getByText("Page 2 of 2")).toHaveAttribute("aria-current", "page");
  await page.reload(); await expect(search).toHaveValue("Needle");
  await page.goBack(); await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Needle");
  await expect(dashboard.locator(".listing-card")).toHaveCount(25);
  await page.goForward(); await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Needle&page=2");
  await search.fill("Other"); await page.getByRole("button", { name: "Search titles" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Other");
  await expect(dashboard.getByText("30 matching", { exact: true })).toBeVisible();
  await page.goBack(); await expect(search).toHaveValue("Needle");
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Needle&page=2");
  await page.goForward(); await expect(search).toHaveValue("Other");
  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings");
  await expect(dashboard.getByText("59 total", { exact: true })).toBeVisible();
  await search.fill(literal); await search.press("Enter");
  await expect(page).toHaveURL(`http://127.0.0.1:3100/listings?${new URLSearchParams({ q: literal })}`);
  await expect(dashboard.locator(".listing-card")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("q")).toBe(literal);
  await expect(dashboard.getByRole("link", { name: `Literal ${literal}`, exact: true })).toBeVisible();
  await search.fill("<script>"); await search.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=%3Cscript%3E");
  await expect(dashboard.locator(".listing-card")).toHaveCount(1);
  expect(await page.evaluate(() => "inventoryInjected" in window)).toBe(false);
  await search.fill("no matches"); await search.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=no+matches");
  await expect(dashboard.getByText(/No saved listings match/)).toBeVisible();
  await expect(dashboard.getByText("0 matching", { exact: true })).toBeVisible();
  await page.goto(`/listings?q=${"z".repeat(101)}`);
  await expect(dashboard.getByRole("alert")).toHaveText(/100/);
  await expect(dashboard.locator(".listing-card")).toHaveCount(0);
  await expect(search).toHaveValue("z".repeat(100));
  await page.goto("/listings?q=Needle&q=Other");
  await expect(dashboard.getByRole("alert")).toHaveText(/single/);
  for (const suffix of ["?page=-1", "?page=2&page=3", `?page=${"9".repeat(80)}`, `?ownerId=${other}`]) {
    await page.goto(`/listings${suffix}`);
    await expect(page).toHaveURL("http://127.0.0.1:3100/listings");
    await expect(dashboard.getByText("59 total", { exact: true })).toBeVisible();
  }
  await page.goto(`/listings?page=${Number.MAX_SAFE_INTEGER}`);
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?page=3");
  await expect(dashboard.locator(".listing-card")).toHaveCount(9);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Long titles wrap without compressing the short status into vertical text.
    expect(await dashboard.locator(".status-pill").evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height < 40))).toBe(true);
    if (width === 320) await page.screenshot({ path: testInfo.outputPath("inventory-mobile.png"), fullPage: true });
  }
  await page.goto("/listings?q=Needle&page=9999");
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Needle&page=2");
  page.once("dialog", dialog => dialog.accept());
  await dashboard.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/listings?q=Needle");
  await expect(dashboard.getByText("25 matching", { exact: true })).toBeVisible();
  await expect(dashboard.locator(".listing-card")).toHaveCount(25);
  const foreignContext = await context.browser()!.newContext();
  try {
    await foreignContext.addCookies(await helpers.getCookies({ userId: other }));
    const otherPage = await foreignContext.newPage(); await otherPage.goto("http://127.0.0.1:3100/listings?q=Needle");
    await expect(otherPage.getByText("5 matching", { exact: true })).toBeVisible();
    await expect(otherPage.locator(".listing-card")).toHaveCount(5);
    await expect(otherPage.getByRole("link", { name: "Needle guitar 00", exact: true })).toHaveCount(0);
  } finally { await foreignContext.close(); }
  expect(imageReads).toBe(0);
  expect(await providerStats()).toEqual(before);
});
