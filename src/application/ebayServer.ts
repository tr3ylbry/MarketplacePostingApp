import "server-only";
import { getDatabase } from "../infrastructure/db/client";
import { DrizzleEbayConnectionRepository } from "../infrastructure/repositories/drizzleEbayConnectionRepository";
import { EbayTokenCipher } from "../infrastructure/ebay/tokenCipher";
import { ebayRuntime } from "@ebay-runtime";
import { createEbayConnectionService } from "./ebayConnectionService";
import { EbayError } from "./ebayConnection";
export function ebayService() {
  const { config, gateway } = ebayRuntime();
  const key = process.env.EBAY_CREDENTIAL_ENCRYPTION_KEY;
  if (key === process.env.BETTER_AUTH_SECRET || key === process.env.REVERB_CREDENTIAL_ENCRYPTION_KEY) throw new EbayError("config");
  return createEbayConnectionService(new DrizzleEbayConnectionRepository(getDatabase()), gateway, new EbayTokenCipher(key), config);
}
