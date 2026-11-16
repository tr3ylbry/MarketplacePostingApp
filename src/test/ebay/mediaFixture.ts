import sharp from "sharp";
import type { MediaFixtureFactory } from "../../application/ebayMediaAttempt";

// Generated pixels only. Never derives output bytes/metadata from a private original.
export const mediaFixture: MediaFixtureFactory = {
  async create(signal) {
    signal.throwIfAborted();
    const pixels = Buffer.alloc(500 * 600 * 3);
    for (let y = 0; y < 600; y++) for (let x = 0; x < 500; x++) {
      const color = x < 100 && y < 150 ? [250, 220, 20] : x > 350 && y > 450 ? [20, 220, 100] : [40, 60, 180];
      const offset = (y * 500 + x) * 3; pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2];
    }
    const bytes = await sharp(pixels, { raw: { width: 500, height: 600, channels: 3 } }).png().toBuffer();
    signal.throwIfAborted(); return bytes;
  },
};
