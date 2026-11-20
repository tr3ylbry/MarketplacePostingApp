import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { realMediaDigest } from "../../application/ebayRealMedia";

// Non-personal, static RGB. Unique visible marker, never a personal-photo substitute.
export async function generateCaptureFixture() {
  const marker=randomBytes(12).toString("hex");
  const bytes=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="#fff"/><rect x="20" y="20" width="460" height="300" fill="#315a8a"/><path d="M20 20L480 320M480 20L20 320" stroke="#ffcc00" stroke-width="20"/><text x="20" y="370" font-size="24">SANDBOX DISCOVERY ONLY</text><text x="20" y="420" font-size="24">${marker.slice(0,12)}</text><text x="20" y="460" font-size="24">${marker.slice(12)}</text></svg>`)).toColourspace("srgb").removeAlpha().png().toBuffer();
  return {bytes,sourceDigest:realMediaDigest(bytes)};
}
