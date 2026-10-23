import "server-only";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";
import { DrizzleReverbRepository } from "../infrastructure/repositories/drizzleReverbRepository";
import { CredentialCipher } from "../infrastructure/reverb/credentialCipher";
import { reverbEnvironment } from "../infrastructure/reverb/reverbClient";
import { reverbGateway } from "@reverb-gateway";
import { imageStorage } from "@image-storage";
import { createReverbService } from "./reverbService";
import type { EncryptedCredential } from "./reverbRepository";
function cipher() {
  const key = process.env.REVERB_CREDENTIAL_ENCRYPTION_KEY;
  if (key && key === process.env.BETTER_AUTH_SECRET) throw new Error("Reverb encryption requires a dedicated key.");
  return new CredentialCipher(key);
}
export function reverbService() {
  const db = getDatabase();
  return createReverbService(new DrizzleReverbRepository(db), new DrizzleListingRepository(db), reverbGateway(),
    { encrypt: (token: string, context: string) => cipher().encrypt(token, context),
      decrypt: (value: EncryptedCredential, context: string) => cipher().decrypt(value, context) }, imageStorage, reverbEnvironment());
}
