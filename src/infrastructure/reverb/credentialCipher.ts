import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedCredential } from "../../application/reverbRepository";
export class CredentialCipher {
  private readonly key: Buffer;
  constructor(key: string | undefined) {
    if (!key || !/^[a-f\d]{64}$/i.test(key)) throw new Error("Configure REVERB_CREDENTIAL_ENCRYPTION_KEY with 32 random bytes encoded as hex.");
    this.key = Buffer.from(key, "hex");
  }
  encrypt(token: string, context: string): EncryptedCredential {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    return { encryptedToken: Buffer.concat([cipher.update(token, "utf8"), cipher.final()]).toString("base64"),
      iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }
  decrypt(value: EncryptedCredential, context: string): string {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(value.iv, "base64"));
      decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(value.encryptedToken, "base64")), decipher.final()]).toString("utf8");
    } catch { throw new Error("Reverb credential could not be decrypted. Reconnect using the configured key."); }
  }
}
