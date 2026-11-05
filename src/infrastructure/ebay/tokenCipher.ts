import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { EbayError, type TokenEnvelope } from "../../application/ebayConnection";
const envelope = z.object({ ciphertext: z.string().regex(/^(?:[a-f0-9]{2})+$/).max(65536), iv: z.string().regex(/^[a-f0-9]{24}$/), tag: z.string().regex(/^[a-f0-9]{32}$/), keyVersion: z.literal(1) });
export class EbayTokenCipher {
  private readonly key: Buffer;
  constructor(key: string | undefined) {
    if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new EbayError("config");
    this.key = Buffer.from(key, "hex");
  }
  encrypt(value: string, aad: string): TokenEnvelope {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    return { ciphertext: Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), keyVersion: 1 };
  }
  decrypt(value: TokenEnvelope, aad: string): string {
    try {
      const valid = envelope.parse(value), decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(valid.iv, "hex"));
      decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(valid.tag, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(valid.ciphertext, "hex")), decipher.final()]).toString("utf8");
    } catch { throw new EbayError("auth"); }
  }
}
