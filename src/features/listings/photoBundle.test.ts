// @vitest-environment node
import { readStoredZip } from "../../test/readStoredZip";
import { photoTargets } from "../../platforms/photoTargets";
import type { Listing } from "../../domain/listing";
import { BUNDLE_CHUNK_BYTES, MAX_BUNDLE_SOURCE_BYTES, MAX_BUNDLE_ZIP_BYTES, buildListingPhotoBundle, calculateZipLayout, planListingPhotoBundle } from "./photoBundle";

const all = photoTargets.map(target => target.key) as Listing["selectedPlatforms"];
const listing = (selectedPlatforms: Listing["selectedPlatforms"] = ["ebay"], title = "Test Guitar") => ({ title, selectedPlatforms });
const photos = (count: number, size = 16) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `photo-${index}.jpg`, size }));
const signal = () => new AbortController().signal;
beforeEach(() => vi.stubGlobal("scheduler", { yield: vi.fn(async () => {}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("preserves folder order, per-folder limits and unique identity even for identical filenames", async () => {
  const input = photos(40).map(photo => ({ ...photo, name: "front.jpg" }));
  const plan = planListingPhotoBundle(listing(all), input);
  expect(plan.photos.map(photo => photo.id)).toEqual(input.slice(0, 25).map(photo => photo.id));
  expect(plan.entries).toHaveLength(95);
  const read = vi.fn(async (photo: { id: string; size: number }) => new Uint8Array(photo.size).fill(Number(photo.id.slice(1)) + 1).buffer);
  const zip = await buildListingPhotoBundle(plan, read, { signal: signal() });
  expect(read).toHaveBeenCalledTimes(25);
  const entries = readStoredZip(Buffer.from(await zip.arrayBuffer()));
  let index = 0;
  for (const target of photoTargets) for (let photo = 0; photo < target.limit; photo++) {
    expect(entries[index].path).toBe(`Test_Guitar_${target.folderLabel}Photos/${String(photo + 1).padStart(2, "0")}_front.jpg`);
    expect(entries[index++].data).toEqual(Buffer.alloc(16, photo + 1));
  }
  expect(zip.size).toBe(plan.layout.zipBytes);
  expect(plan.downloadName).toBe("Test Guitar_PhotoBundle.zip");
});

it("uses one source buffer/view and one chunked CRC pass per needed photo across folders", async () => {
  const plan = planListingPhotoBundle(listing(all), photos(2, BUNDLE_CHUNK_BYTES * 2));
  const buffers = new Set(plan.photos.map(photo => new ArrayBuffer(photo.size)));
  const views: ArrayBuffer[] = [];
  const NativeBytes = Uint8Array;
  vi.stubGlobal("Uint8Array", new Proxy(NativeBytes, { construct(target, args) {
    if (buffers.has(args[0])) views.push(args[0]);
    return Reflect.construct(target, args);
  } }));
  let nextBuffer = 0;
  const read = vi.fn(async () => [...buffers][nextBuffer++]);
  const NativeBlob = Blob;
  const payloads: BlobPart[] = [];
  vi.stubGlobal("Blob", class extends NativeBlob {
    constructor(parts: BlobPart[], options: BlobPropertyBag) { payloads.push(...parts); super(parts, options); }
  });
  await buildListingPhotoBundle(plan, read, { signal: signal() });
  expect(read).toHaveBeenCalledTimes(2);
  expect(views).toEqual([...buffers]);
  expect(payloads.filter(part => buffers.has(part as ArrayBuffer))).toHaveLength(10);
  // 2 CRC chunks/photo, and a task yield after every 4 of the 10 directory entries.
  expect((globalThis as unknown as { scheduler: { yield: ReturnType<typeof vi.fn> } }).scheduler.yield).toHaveBeenCalledTimes(6);
});

it("accepts the exact source budget and rejects one byte over before any loader is invoked", () => {
  const input = photos(4, 8 * 1024 * 1024);
  expect(planListingPhotoBundle(listing(), input).sourceBytes).toBe(MAX_BUNDLE_SOURCE_BYTES);
  input[3].size++;
  expect(() => planListingPhotoBundle(listing(), input)).toThrow(/32 MiB/);
});

it("accounts for repeated payloads and encoded names at the exact archive budget and one byte over", () => {
  const input = photos(25, 800_000);
  const selected = listing(["ebay", "craigslist", "reverb"]);
  const first = planListingPhotoBundle(selected, input);
  const overhead = first.layout.zipBytes - first.entries.reduce((sum, entry) => sum + entry.size, 0);
  // Only Reverb includes the 25th photo, so changing it changes the archive by exactly one byte.
  input[24].size = MAX_BUNDLE_ZIP_BYTES - overhead - 24 * 800_000 * 3;
  const exact = planListingPhotoBundle(selected, input);
  expect(exact.layout.zipBytes).toBe(MAX_BUNDLE_ZIP_BYTES);
  expect(exact.sourceBytes).toBeLessThan(MAX_BUNDLE_SOURCE_BYTES);
  input[24].size++;
  expect(() => planListingPhotoBundle(selected, input)).toThrow(/64 MiB/);
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 10 * 1024 * 1024 + 1])("rejects invalid source size %s", size => {
  expect(() => planListingPhotoBundle(listing(), photos(1, size))).toThrow();
});

it("rejects duplicate identities, too many images and empty selections before reading", () => {
  expect(() => planListingPhotoBundle(listing(), [photos(1)[0], photos(1)[0]])).toThrow(/identities/);
  expect(() => planListingPhotoBundle(listing(), photos(41))).toThrow();
  expect(() => planListingPhotoBundle(listing([]), photos(4))).toThrow(/Choose a marketplace/);
  expect(() => planListingPhotoBundle(listing(), [])).toThrow(/saved photo/);
});

it.each(["../front.jpg", "C:\\front.jpg", "front.jpg/extra", "front\u0000.jpg", "front.jpg:bad", "front." + "雪".repeat(22)])("rejects unsupported name %s", name => {
  expect(() => planListingPhotoBundle(listing(), [{ id: "p", size: 1, name }])).toThrow(/name|extension/);
});

it("bounds huge title/stems deterministically and emits correct Unicode paths in both headers", async () => {
  const input = [{ id: "p", size: 9, name: "f".repeat(240) + ".雪" }];
  const plan = planListingPhotoBundle(listing(["ebay"], "A".repeat(65_536)), input);
  const zip = await buildListingPhotoBundle(plan, async () => new TextEncoder().encode("123456789").buffer, { signal: signal() });
  const [entry] = readStoredZip(Buffer.from(await zip.arrayBuffer()));
  expect(entry.path).toBe(`${"A".repeat(120)}_eBayPhotos/01_${"f".repeat(120)}.雪`);
  expect(entry.utf8).toBe(true);
  expect(plan.downloadName.length).toBeLessThan(150);
  expect(plan.layout.zipBytes).toBe(zip.size);
  expect(plan.entries[0].path.length).toBe(Buffer.byteLength(entry.path));
});

it("checks ZIP32 entry-count, encoded path, size, offset and arithmetic boundaries without giant payloads", () => {
  expect(calculateZipLayout([]).zipBytes).toBe(22);
  expect(calculateZipLayout([{ size: 0, pathLength: 65535 }]).zipBytes).toBe(131168);
  expect(() => calculateZipLayout([{ size: 0, pathLength: 65536 }])).toThrow();
  expect(() => calculateZipLayout([{ size: 0, pathLength: 0 }])).toThrow();
  expect(calculateZipLayout(Array.from({ length: 0xfffe }, () => ({ size: 0, pathLength: 1 }))).offsets).toHaveLength(0xfffe);
  expect(() => calculateZipLayout(Array.from({ length: 0xffff }, () => ({ size: 0, pathLength: 1 })))).toThrow();
  expect(calculateZipLayout([{ size: 0xfffffffe - 100, pathLength: 1 }]).zipBytes).toBe(0xfffffffe);
  expect(() => calculateZipLayout([{ size: 0xfffffffe - 99, pathLength: 1 }])).toThrow();
  expect(() => calculateZipLayout([{ size: 0xffffffff, pathLength: 1 }])).toThrow();
  expect(() => calculateZipLayout([{ size: 0xfffffffe - 31, pathLength: 1 }, { size: 1, pathLength: 1 }])).toThrow();
  expect(() => calculateZipLayout([{ size: Number.MAX_SAFE_INTEGER + 1, pathLength: 1 }])).toThrow();
});

it("rejects changed actual lengths and does not read the next source", async () => {
  const read = vi.fn(async () => new ArrayBuffer(15));
  await expect(buildListingPhotoBundle(planListingPhotoBundle(listing(), photos(2)), read, { signal: signal() })).rejects.toThrow(/size changed/);
  expect(read).toHaveBeenCalledTimes(1);
});

it("cancels during CRC before another read or Blob construction", async () => {
  const controller = new AbortController();
  vi.stubGlobal("scheduler", { yield: vi.fn(async () => controller.abort()) });
  const construct = vi.fn();
  vi.stubGlobal("Blob", class { constructor() { construct(); } });
  const read = vi.fn(async () => new ArrayBuffer(BUNDLE_CHUNK_BYTES * 2));
  await expect(buildListingPhotoBundle(planListingPhotoBundle(listing(), photos(2, BUNDLE_CHUNK_BYTES * 2)), read, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(read).toHaveBeenCalledTimes(1); expect(construct).not.toHaveBeenCalled();
});

it("cancels during directory assembly before creating the ZIP", async () => {
  const controller = new AbortController();
  await expect(buildListingPhotoBundle(planListingPhotoBundle(listing(all), photos(2)), async () => new ArrayBuffer(16), {
    signal: controller.signal, onProgress: phase => { if (phase === "Building") controller.abort(); },
  })).rejects.toMatchObject({ name: "AbortError" });
});

it("provides repeated real event-loop opportunities with the portable scheduler fallback", async () => {
  vi.stubGlobal("scheduler", undefined);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try {
    await buildListingPhotoBundle(planListingPhotoBundle(listing(), photos(1, 4 * 1024 * 1024)), async photo => new ArrayBuffer(photo.size), { signal: signal() });
    expect(ticks).toBeGreaterThan(8);
  } finally { clearInterval(timer); }
});
