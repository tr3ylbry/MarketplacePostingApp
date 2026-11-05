import { ebayConfig } from "./config";
import { EbayClient } from "./ebayClient";
export function ebayRuntime() {
  const config = ebayConfig(process.env);
  return { config, gateway: new EbayClient(config) };
}
