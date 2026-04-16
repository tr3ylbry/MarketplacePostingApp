import type { Listing } from "../../domain/listing";
import type { ListingPhotoUpload } from "./types";
import { photoTargets } from "../../platforms/photoTargets";

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function sanitizeSegment(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "Listing";
}

function encodePath(path: string) {
  return new TextEncoder().encode(path);
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function setUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function setUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function buildZip(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const pathBytes = encodePath(entry.path);
    const header = new Uint8Array(30);
    const headerView = new DataView(header.buffer);
    const entryCrc = crc32(entry.data);

    setUint32(headerView, 0, 0x04034b50);
    setUint16(headerView, 4, 20);
    setUint16(headerView, 6, 0);
    setUint16(headerView, 8, 0);
    setUint16(headerView, 10, 0);
    setUint16(headerView, 12, 0);
    setUint32(headerView, 14, entryCrc);
    setUint32(headerView, 18, entry.data.length);
    setUint32(headerView, 22, entry.data.length);
    setUint16(headerView, 26, pathBytes.length);
    setUint16(headerView, 28, 0);

    localParts.push(header, pathBytes, entry.data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);

    setUint32(centralView, 0, 0x02014b50);
    setUint16(centralView, 4, 20);
    setUint16(centralView, 6, 20);
    setUint16(centralView, 8, 0);
    setUint16(centralView, 10, 0);
    setUint16(centralView, 12, 0);
    setUint16(centralView, 14, 0);
    setUint32(centralView, 16, entryCrc);
    setUint32(centralView, 20, entry.data.length);
    setUint32(centralView, 24, entry.data.length);
    setUint16(centralView, 28, pathBytes.length);
    setUint16(centralView, 30, 0);
    setUint16(centralView, 32, 0);
    setUint16(centralView, 34, 0);
    setUint16(centralView, 36, 0);
    setUint32(centralView, 38, 0);
    setUint32(centralView, 42, offset);

    centralParts.push(central, pathBytes);
    offset += header.length + pathBytes.length + entry.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  setUint32(endView, 0, 0x06054b50);
  setUint16(endView, 4, 0);
  setUint16(endView, 6, 0);
  setUint16(endView, 8, entries.length);
  setUint16(endView, 10, entries.length);
  setUint32(endView, 12, centralSize);
  setUint32(endView, 16, offset);
  setUint16(endView, 20, 0);

  const blobParts = [...localParts, ...centralParts, endRecord].map((part) => {
    const buffer = new ArrayBuffer(part.byteLength);
    new Uint8Array(buffer).set(part);
    return buffer;
  });

  return new Blob(blobParts, {
    type: "application/zip",
  });
}

export async function buildListingPhotoBundle(
  listing: Listing,
  photos: ListingPhotoUpload[],
) {
  const safeTitle = sanitizeSegment(listing.title);
  const entries: ZipEntry[] = [];
  const activeTargets = photoTargets.filter(
    (target) => listing.isMusicalItem || target.key !== "reverb",
  );

  for (const target of activeTargets) {
    const folderName = `${safeTitle}_${target.folderLabel}Photos`;
    const selectedPhotos = photos.slice(0, target.limit);

    for (const [index, photo] of selectedPhotos.entries()) {
      const fileBytes = new Uint8Array(await photo.file.arrayBuffer());
      const safeName = sanitizeSegment(photo.name.replace(/\.[^.]+$/, ""));
      const extensionMatch = photo.name.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : "";

      entries.push({
        path: `${folderName}/${String(index + 1).padStart(2, "0")}_${safeName}${extension}`,
        data: fileBytes,
      });
    }
  }

  return buildZip(entries);
}
