import type { EbayConfig } from "./config";
import { EbayMetadataClient } from "./ebayMetadataClient";

let current: { config: EbayConfig; client: EbayMetadataClient } | undefined;
export function ebayMetadataGateway(config: EbayConfig) {
  if (!current || current.config.fingerprint !== config.fingerprint || current.config.clientSecret !== config.clientSecret) {
    current = { config, client: new EbayMetadataClient(config) };
  }
  return current.client;
}
