import assert from "node:assert/strict";
import { crc32 } from "node:zlib";

// Independent central-directory reader for tests, using Node's native CRC (not the writer's table).
export function readStoredZip(bytes: Buffer) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count);
  const centralOffset = bytes.readUInt32LE(end + 16);
  assert.equal(centralOffset + bytes.readUInt32LE(end + 12), end);
  const entries: { path: string; data: Buffer; utf8: boolean }[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const flags = bytes.readUInt16LE(cursor + 8);
    assert.equal(bytes.readUInt16LE(cursor + 10), 0); // STORE, no compression.
    const crc = bytes.readUInt32LE(cursor + 16);
    const size = bytes.readUInt32LE(cursor + 24);
    assert.equal(bytes.readUInt32LE(cursor + 20), size);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (rawName.some(byte => byte > 127)) assert.ok(flags & 0x0800, "UTF-8 path needs its flag");
    const path = rawName.toString("utf8");
    assert.ok(!path.startsWith("/") && !path.includes("\\") && !path.split("/").includes(".."));
    const local = bytes.readUInt32LE(cursor + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt16LE(local + 6), flags);
    assert.equal(bytes.readUInt16LE(local + 8), 0);
    assert.equal(bytes.readUInt32LE(local + 14), crc);
    assert.equal(bytes.readUInt32LE(local + 18), size);
    assert.equal(bytes.readUInt32LE(local + 22), size);
    assert.equal(bytes.readUInt16LE(local + 26), nameLength);
    assert.deepEqual(bytes.subarray(local + 30, local + 30 + nameLength), rawName);
    const start = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
    assert.ok(start + size <= centralOffset);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc);
    entries.push({ path, data, utf8: !!(flags & 0x0800) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, end);
  return entries;
}
