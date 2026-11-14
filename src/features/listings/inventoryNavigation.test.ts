import { inventoryQuerySchema } from "../../application/inventory";
import { inventoryHref, isCanonicalInventoryLocation, readInventoryLocation } from "./inventoryNavigation";

it("trims literal Unicode, wildcard, quote and backslash searches without interpreting them", () => {
  const query = "Café 東京 🎸 50%_ O'Reilly\\case!";
  expect(readInventoryLocation({ q: `  ${query}  `, page: "2" })).toEqual({ query, page: 2, error: undefined });
  expect(readInventoryLocation({ q: " \t " })).toEqual({ query: "", page: 1, error: undefined });
  const href = inventoryHref(query, 2);
  expect(new URL(href, "https://example.test").searchParams.get("q")).toBe(query);
  expect(new URL(href, "https://example.test").searchParams.get("page")).toBe("2");
});

it.each([undefined, "", "0", "-1", "2.5", "1e3", "+2", " 2 ", "02", "NaN", "9007199254740992", "9".repeat(1000), ["2", "3"]])("normalizes invalid or repeated page %s to one", page => {
  expect(readInventoryLocation({ page }).page).toBe(1);
});

it("accepts positive safe integers for count-based clamping before OFFSET", () => {
  expect(readInventoryLocation({ page: "2" }).page).toBe(2);
  expect(readInventoryLocation({ page: String(Number.MAX_SAFE_INTEGER) }).page).toBe(Number.MAX_SAFE_INTEGER);
});

it("rejects excessive, repeated and control-character searches with bounded editable feedback", () => {
  expect(readInventoryLocation({ q: "x".repeat(100) }).error).toBeUndefined();
  const long = readInventoryLocation({ q: "x".repeat(10_000), page: "2" });
  expect(long.query).toHaveLength(100); expect(long.error).toMatch(/100/); expect(long.page).toBe(1);
  expect(readInventoryLocation({ q: ["first", "second"] })).toMatchObject({ query: "first", page: 1, error: expect.stringMatching(/single/) });
  const control = readInventoryLocation({ q: "first\u0000second" });
  expect(control.error).toMatch(/control/); expect(control.query).not.toContain("\u0000");
});

it("builds canonical search/page links and discards unsupported owner parameters", () => {
  expect(inventoryHref("", 1)).toBe("/listings");
  expect(inventoryHref("guitar", 1)).toBe("/listings?q=guitar");
  expect(isCanonicalInventoryLocation({}, "", 1)).toBe(true);
  expect(isCanonicalInventoryLocation({ q: "guitar", page: "2" }, "guitar", 2)).toBe(true);
  for (const params of [{ q: " guitar " }, { q: "" }, { page: "1" }, { page: ["2", "3"] }, { ownerId: "foreign" }]) {
    expect(isCanonicalInventoryLocation(params, params.q === "guitar" ? "guitar" : "", 1)).toBe(false);
  }
});

it("validates the application boundary independently of URL parsing", () => {
  expect(inventoryQuerySchema.parse({})).toEqual({ query: "", page: 1 });
  for (const input of [{ query: "x".repeat(101) }, { query: "bad\ninput" }, { page: 0 }, { page: 1.5 }, { page: Number.MAX_SAFE_INTEGER + 1 }, { ownerId: "foreign" }]) {
    expect(inventoryQuerySchema.safeParse(input).success).toBe(false);
  }
});
