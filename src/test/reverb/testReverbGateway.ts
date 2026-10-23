import { ReverbClient } from "../../infrastructure/reverb/reverbClient";
// Test artifact only: normal builds never reference this module.
export function reverbGateway() {
  const secret = process.env.TEST_REVERB_SECRET;
  if (process.env.MARKETPLACE_TEST_BUILD !== "1" || process.env.VERCEL || !secret) throw new Error("Test Reverb unavailable.");
  return new ReverbClient("sandbox", (input, init) => {
    const url = new URL(String(input));
    return fetch(`http://127.0.0.1:4312${url.pathname}${url.search}`, { ...init, headers: { ...init?.headers, "X-Test-Secret": secret } });
  });
}
