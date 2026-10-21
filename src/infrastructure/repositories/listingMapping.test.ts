import { listingFixture } from "../../test/fixtures";
import { listingFromRows, listingToRows } from "./listingMapping";
import type { listings } from "../db/schema";

it("rejects corrupt JSONB and numeric values read from the persistence boundary", () => {
  const { row } = listingToRows(listingFixture());
  const stored = row as typeof listings.$inferSelect;
  expect(() => listingFromRows({ ...stored, attributes: { brand: 42 } }, [], [])).toThrow();
  expect(() => listingFromRows({ ...stored, askingPriceAmount: "NaN" }, [], [])).toThrow();
});
