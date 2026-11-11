import { BUNDLE_URL_LIFETIME_MS, initiateBundleDownload } from "./photoBundleDownload";

let create: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  create = vi.fn(() => "blob:synthetic-bundle"); revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it("removes the temporary anchor and preserves the handoff delay, including abort/unmount after success", () => {
  const controller = new AbortController(); const cleaned = vi.fn();
  const cleanup = initiateBundleDownload(new Blob(["test"]), "Test Photos.zip", controller.signal, cleaned);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  expect(document.querySelector("a")).toBeNull(); expect(revoke).not.toHaveBeenCalled();
  cleanup(); controller.abort();
  vi.advanceTimersByTime(BUNDLE_URL_LIFETIME_MS - 1); expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-bundle");
  expect(cleaned).toHaveBeenCalledExactlyOnceWith(cleanup);
  cleanup(); expect(cleaned).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it("revokes immediately if click fails, without leaving a timer, listener or anchor", () => {
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => { throw new Error("Synthetic click failure"); });
  const controller = new AbortController(); const cleaned = vi.fn();
  expect(() => initiateBundleDownload(new Blob(["test"]), "Test.zip", controller.signal, cleaned)).toThrow(/Synthetic click failure/);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-bundle");
  expect(document.querySelector("a")).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  controller.abort(); expect(cleaned).toHaveBeenCalledTimes(1);
});

it("does not create a URL for an already cancelled operation", () => {
  const controller = new AbortController(); controller.abort();
  expect(() => initiateBundleDownload(new Blob(), "Test.zip", controller.signal, vi.fn())).toThrow();
  expect(create).not.toHaveBeenCalled(); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it("cleans up cancellation immediately after URL creation and never clicks", () => {
  const controller = new AbortController();
  create.mockImplementation(() => { controller.abort(); return "blob:synthetic-bundle"; });
  expect(() => initiateBundleDownload(new Blob(), "Test.zip", controller.signal, vi.fn())).toThrow();
  expect(revoke).toHaveBeenCalledTimes(1); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it("checks cancellation again after anchor insertion, before the download", () => {
  const controller = new AbortController(); const append = document.body.append.bind(document.body);
  vi.spyOn(document.body, "append").mockImplementation((...nodes) => { append(...nodes); controller.abort(); });
  expect(() => initiateBundleDownload(new Blob(), "Test.zip", controller.signal, vi.fn())).toThrow();
  expect(revoke).toHaveBeenCalledTimes(1); expect(document.querySelector("a")).toBeNull();
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
