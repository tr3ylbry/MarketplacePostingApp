import { act, renderHook } from "@testing-library/react";
import { useListings } from "./useListings";
import { toFormInput } from "../listingFormMapping";
import { listingFixture } from "../../../test/fixtures";
import { STORAGE_KEY } from "../../../storage/listingsStorage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("creates, reloads, edits and deletes a persisted listing", () => {
  const first = renderHook(useListings);
  act(() => first.result.current.createListing(toFormInput(listingFixture()), []));
  const id = first.result.current.selectedListing!.id;
  first.unmount();
  const second = renderHook(useListings);
  expect(second.result.current.selectedListing?.id).toBe(id);
  act(() => second.result.current.updateListing(id, { ...toFormInput(second.result.current.selectedListing!), title: "Updated Guitar" }, []));
  expect(second.result.current.selectedListing?.title).toBe("Updated Guitar");
  act(() => second.result.current.deleteListing(id));
  expect(second.result.current.listings).toEqual([]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).listings).toEqual([]);
});

it("does not rewrite storage on mount and exposes failed saves", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const { result } = renderHook(useListings);
  expect(setItem).not.toHaveBeenCalled();
  act(() => result.current.createListing(toFormInput(listingFixture()), []));
  expect(result.current.storageError).toContain("memory only");
  expect(result.current.listings).toHaveLength(1);
});
