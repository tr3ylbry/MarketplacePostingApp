import type { Listing } from "../../domain/listing";
import { MAX_IMAGE_BYTES, MAX_IMAGE_COUNT } from "../../domain/listingImage";
import { photoTargets } from "../../platforms/photoTargets";
import type { BundlePhoto } from "./types";

export const MAX_BUNDLE_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_BUNDLE_ZIP_BYTES = 64 * 1024 * 1024;
export const BUNDLE_CHUNK_BYTES = 256 * 1024;
const MAX_STEM_LENGTH = 120;
const MAX_EXTENSION_BYTES = 64;
// All-ones count/size/offset fields signal ZIP64, which this writer does not emit.
const MAX_ZIP_ENTRIES = 0xfffe;
const MAX_ZIP32 = 0xfffffffe;
const encoder = new TextEncoder();

interface ZipEntry {
  photoId: string;
  path: Uint8Array<ArrayBuffer>;
  size: number;
}
export interface PhotoBundlePlan {
  readonly photos: readonly BundlePhoto[];
  readonly entries: readonly ZipEntry[];
  readonly sourceBytes: number;
  readonly layout: ReturnType<typeof calculateZipLayout>;
  readonly downloadName: string;
}

function integer(value: number, maximum: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("Photo bundle size or ZIP field is unsupported. Choose fewer or smaller photos.");
  }
  return value;
}

// Shared by planning and writing. No payload allocation is necessary to check ZIP32 bounds.
export function calculateZipLayout(entries: readonly { size: number; pathLength: number }[]) {
  integer(entries.length, MAX_ZIP_ENTRIES);
  const offsets: number[] = [];
  let centralOffset = 0;
  let centralSize = 0;
  for (const entry of entries) {
    integer(entry.size, MAX_ZIP32);
    integer(entry.pathLength, 0xffff, 1);
    offsets.push(centralOffset);
    centralOffset = integer(centralOffset + 30 + entry.pathLength + entry.size, MAX_ZIP32);
    centralSize = integer(centralSize + 46 + entry.pathLength, MAX_ZIP32);
  }
  const zipBytes = integer(centralOffset + centralSize + 22, MAX_ZIP32);
  return { offsets, centralOffset, centralSize, zipBytes };
}

function stem(value: string) {
  // Bound work as well as output; preserve the existing naming for ordinary short names.
  return value.slice(0, 512).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")
    .slice(0, MAX_STEM_LENGTH).replace(/_+$/g, "") || "Listing";
}

function unsafeName(value: string) {
  return /[\\/]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function photoName(name: string) {
  if (!name || name.length > 255 || unsafeName(name)) {
    throw new Error("A photo name is unsupported. Rename the photo before creating a bundle.");
  }
  const extension = name.match(/(\.[^.]+)$/)?.[1] ?? "";
  if (encoder.encode(extension).length > MAX_EXTENSION_BYTES || /[:*?"<>|]/.test(extension)) {
    throw new Error("A photo extension is unsupported. Rename the photo before creating a bundle.");
  }
  return stem(name.replace(/\.[^.]+$/, "")) + extension;
}

export function planListingPhotoBundle(
  listing: Pick<Listing, "title" | "selectedPlatforms">,
  photos: readonly BundlePhoto[],
): PhotoBundlePlan {
  integer(photos.length, MAX_IMAGE_COUNT);
  const identities = new Set<string>();
  for (const photo of photos) {
    integer(photo.size, MAX_IMAGE_BYTES, 1);
    if (!photo.id || identities.has(photo.id)) throw new Error("Photo identities changed. Reload the listing and try again.");
    identities.add(photo.id);
  }
  const title = stem(listing.title);
  const needed = new Map<string, BundlePhoto>();
  const entries: ZipEntry[] = [];
  for (const target of photoTargets) {
    if (!listing.selectedPlatforms.some(platform => platform === target.key)) continue;
    for (const [index, photo] of photos.slice(0, target.limit).entries()) {
      const path = `${title}_${target.folderLabel}Photos/${String(index + 1).padStart(2, "0")}_${photoName(photo.name)}`;
      entries.push({ photoId: photo.id, path: encoder.encode(path), size: photo.size });
      needed.set(photo.id, { ...photo });
    }
  }
  if (!entries.length) throw new Error("Choose a marketplace and add a saved photo before downloading a bundle.");
  const sourceBytes = [...needed.values()].reduce((sum, photo) => integer(sum + photo.size, Number.MAX_SAFE_INTEGER), 0);
  const layout = calculateZipLayout(entries.map(entry => ({ size: entry.size, pathLength: entry.path.length })));
  if (sourceBytes > MAX_BUNDLE_SOURCE_BYTES || layout.zipBytes > MAX_BUNDLE_ZIP_BYTES) {
    throw new Error("Photo bundle exceeds 32 MiB of source photos or 64 MiB of ZIP data. Use fewer or smaller photos, or select fewer marketplaces. No bundle photos were downloaded.");
  }
  const downloadTitle = listing.title && listing.title.length <= MAX_STEM_LENGTH
    && encoder.encode(listing.title).length <= MAX_STEM_LENGTH && !unsafeName(listing.title) && !/[:*?"<>|]/.test(listing.title)
    ? listing.title : title;
  return { photos: [...needed.values()], entries, sourceBytes, layout, downloadName: `${downloadTitle}_PhotoBundle.zip` };
}

export async function yieldBundleWork(signal: AbortSignal) {
  signal.throwIfAborted();
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) await scheduler.yield();
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

async function crc32(bytes: Uint8Array, signal: AbortSignal) {
  let crc = 0xffffffff;
  for (let start = 0; start < bytes.length; start += BUNDLE_CHUNK_BYTES) {
    signal.throwIfAborted();
    const end = Math.min(start + BUNDLE_CHUNK_BYTES, bytes.length);
    for (let index = start; index < end; index++) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    await yieldBundleWork(signal);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function buildListingPhotoBundle(
  plan: PhotoBundlePlan,
  readPhoto: (photo: BundlePhoto, signal: AbortSignal) => Promise<ArrayBuffer>,
  { signal, onProgress }: { signal: AbortSignal; onProgress?: (phase: "Reading" | "Preparing" | "Building", completed: number, total: number) => void },
) {
  const sources = new Map<string, { buffer: ArrayBuffer; crc: number }>();
  const parts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  try {
    for (const [index, photo] of plan.photos.entries()) {
      signal.throwIfAborted();
      onProgress?.("Reading", index + 1, plan.photos.length);
      const buffer = await readPhoto(photo, signal);
      signal.throwIfAborted();
      if (buffer.byteLength !== photo.size) throw new Error("A photo's size changed. Reload the listing and try again.");
      onProgress?.("Preparing", index + 1, plan.photos.length);
      sources.set(photo.id, { buffer, crc: await crc32(new Uint8Array(buffer), signal) });
    }
    for (const [index, entry] of plan.entries.entries()) {
      signal.throwIfAborted();
      const source = sources.get(entry.photoId)!;
      const header = new ArrayBuffer(30);
      const local = new DataView(header);
      const flags = entry.path.some(byte => byte > 127) ? 0x0800 : 0;
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, flags, true);
      local.setUint32(14, source.crc, true);
      local.setUint32(18, entry.size, true);
      local.setUint32(22, entry.size, true);
      local.setUint16(26, entry.path.length, true);
      parts.push(header, entry.path, source.buffer);
      const directory = new ArrayBuffer(46);
      const central = new DataView(directory);
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, flags, true);
      central.setUint32(16, source.crc, true);
      central.setUint32(20, entry.size, true);
      central.setUint32(24, entry.size, true);
      central.setUint16(28, entry.path.length, true);
      central.setUint32(42, plan.layout.offsets[index], true);
      centralParts.push(directory, entry.path);
      if ((index + 1) % 4 === 0) {
        onProgress?.("Building", index + 1, plan.entries.length);
        await yieldBundleWork(signal);
      }
    }
    const endRecord = new ArrayBuffer(22);
    const end = new DataView(endRecord);
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, plan.entries.length, true);
    end.setUint16(10, plan.entries.length, true);
    end.setUint32(12, plan.layout.centralSize, true);
    end.setUint32(16, plan.layout.centralOffset, true);
    signal.throwIfAborted();
    // Repeated entries share source buffers. Blob still owns Z bytes of archive storage.
    const zip = new Blob([...parts, ...centralParts, endRecord], { type: "application/zip" });
    signal.throwIfAborted();
    if (zip.size !== plan.layout.zipBytes) throw new Error("Photo bundle could not be built safely. Try again.");
    return zip;
  } finally {
    sources.clear(); parts.length = 0; centralParts.length = 0;
  }
}
