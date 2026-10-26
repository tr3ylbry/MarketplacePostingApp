import { randomBytes } from "node:crypto";
import { CredentialCipher } from "./credentialCipher";
import { safeReverbError } from "../../application/reverbService";
const key = () => randomBytes(32).toString("hex");
it("uses fresh authenticated encryption and stores no plaintext", () => {
  const cipher = new CredentialCipher(key()), token = "fake-reverb-token-never-real";
  const a = cipher.encrypt(token, "owner-a:sandbox"), b = cipher.encrypt(token, "owner-a:sandbox");
  expect(JSON.stringify(a)).not.toContain(token); expect(a).not.toEqual(b);
  expect(cipher.decrypt(a, "owner-a:sandbox")).toBe(token);
  expect(() => cipher.decrypt(a, "owner-b:sandbox")).toThrow();
  expect(() => new CredentialCipher(key()).decrypt(a, "owner-a:sandbox")).toThrow();
  for (const field of ["encryptedToken", "authTag", "iv"] as const) {
    const bytes = Buffer.from(a[field], "base64"); bytes[0] ^= 1;
    expect(() => cipher.decrypt({ ...a, [field]: bytes.toString("base64") }, "owner-a:sandbox")).toThrow();
  }
});
it("requires a dedicated 256-bit key and redacts unexpected errors", () => {
  for (const value of [undefined, "short", "x".repeat(64)]) expect(() => new CredentialCipher(value)).toThrow();
  expect(safeReverbError(new Error("fake-secret https://private?signature=secret"))).not.toContain("secret");
});
