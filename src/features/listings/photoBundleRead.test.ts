// @vitest-environment node
import { readBundlePhoto } from "./photoBundleDownload";
import { BUNDLE_CHUNK_BYTES } from "./photoBundle";

const signal = () => new AbortController().signal;
beforeEach(() => vi.stubGlobal("scheduler", { yield: vi.fn(async () => {}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function respond(stream: ReadableStream<Uint8Array>, status = 200) {
  const fetch = vi.fn(async () => new Response(stream, { status }));
  vi.stubGlobal("fetch", fetch); return fetch;
}

it("reads exactly the trusted length into one owned buffer and yields between large copies", async () => {
  const bytes = new Uint8Array(BUNDLE_CHUNK_BYTES * 2).fill(42);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const fetch = respond(stream); const abortSignal = signal();
  const result = await readBundlePhoto("/owner-scoped-image", bytes.length, abortSignal);
  expect(new Uint8Array(result)).toEqual(bytes);
  expect(fetch).toHaveBeenCalledWith("/owner-scoped-image", { signal: abortSignal, cache: "no-store", referrerPolicy: "no-referrer" });
  expect((globalThis as unknown as { scheduler: { yield: ReturnType<typeof vi.fn> } }).scheduler.yield).toHaveBeenCalledTimes(2);
  expect(stream.locked).toBe(false);
});

it("rejects short bodies and releases the reader", async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2)); controller.close(); } });
  respond(stream);
  await expect(readBundlePhoto("/image", 3, signal())).rejects.toThrow(/size changed/);
  expect(stream.locked).toBe(false);
});

it("keeps the byte-work interval bounded across uneven network chunks", async () => {
  const first = new Uint8Array(BUNDLE_CHUNK_BYTES - 7).fill(11);
  const second = new Uint8Array(BUNDLE_CHUNK_BYTES + 14).fill(22);
  respond(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(first); controller.enqueue(second); controller.close(); } }));
  const bytes = new Uint8Array(await readBundlePhoto("/image", first.length + second.length, signal()));
  expect(bytes.subarray(0, first.length)).toEqual(first);
  expect(bytes.subarray(first.length)).toEqual(second);
  expect((globalThis as unknown as { scheduler: { yield: ReturnType<typeof vi.fn> } }).scheduler.yield).toHaveBeenCalledTimes(2);
});

it("stops an excessive stream without copying beyond the declared size", async () => {
  const cancel = vi.fn(); let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(2)); }, cancel });
  respond(stream);
  await expect(readBundlePhoto("/image", 3, signal())).rejects.toThrow(/exceeds/);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(pulls).toBeLessThanOrEqual(3);
  expect(stream.locked).toBe(false);
});

it("cancels and releases an HTTP failure body", async () => {
  const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ cancel });
  respond(stream, 503);
  await expect(readBundlePhoto("/image", 3, signal())).rejects.toThrow(/could not be downloaded/);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("rejects a missing response body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null)));
  await expect(readBundlePhoto("/image", 3, signal())).rejects.toThrow(/could not be downloaded/);
});

it("releases the reader after a mid-stream network failure", async () => {
  let count = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (count++) controller.error(new Error("Synthetic interruption")); else controller.enqueue(new Uint8Array(1));
  } });
  respond(stream);
  await expect(readBundlePhoto("/image", 3, signal())).rejects.toThrow(/Synthetic interruption/);
  expect(stream.locked).toBe(false);
});

it("aborts a pending read even when the underlying stream has not completed", async () => {
  const cancel = vi.fn(); const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ start(source) { source.enqueue(new Uint8Array(1)); }, cancel });
  respond(stream);
  const result = readBundlePhoto("/image", 3, controller.signal);
  const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(stream.locked).toBe(true));
  controller.abort(); await assertion;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
});

it("checks cancellation during a large response chunk", async () => {
  const controller = new AbortController();
  vi.stubGlobal("scheduler", { yield: vi.fn(async () => controller.abort()) });
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(source) { source.enqueue(new Uint8Array(BUNDLE_CHUNK_BYTES * 2)); }, cancel });
  respond(stream);
  await expect(readBundlePhoto("/image", BUNDLE_CHUNK_BYTES * 2, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
});

it.each([0, -1, NaN, 1.5, 10 * 1024 * 1024 + 1])("rejects invalid expected size %s before fetching", async size => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(readBundlePhoto("/image", size, signal())).rejects.toThrow(/Invalid photo size/);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not fetch with an already cancelled operation", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const controller = new AbortController(); controller.abort();
  await expect(readBundlePhoto("/image", 1, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
