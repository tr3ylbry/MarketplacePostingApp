import type { NextConfig } from "next";

const testBuild = process.env.MARKETPLACE_TEST_BUILD === "1";
if (testBuild) {
  const database = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (process.env.VERCEL || !["localhost", "127.0.0.1"].includes(database.hostname) || !database.pathname.endsWith("_test")) {
    throw new Error("Test storage requires a local disposable _test database and cannot run on Vercel.");
  }
}
const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Keep the original IP origin for strict OAuth callback validation. Next's
  // default NextURL normalization rewrites 127.0.0.1 to localhost.
  skipProxyUrlNormalize: true,
  logging: { incomingRequests: { ignore: [/^\/api\/integrations\/ebay\//, /^\/api\/auth\/callback\//] }, fetches: { fullUrl: false } },
  ...(testBuild ? { distDir: ".next-test", turbopack: { resolveAlias: { "@image-storage": "./src/test/storage/testImageStorage.ts", "@reverb-gateway": "./src/test/reverb/testReverbGateway.ts", "@ebay-runtime": "./src/test/ebay/testRuntime.ts", "@ebay-metadata": "./src/test/ebay/testMetadataGateway.ts", "@ebay-readiness": "./src/test/ebay/testReadinessGateway.ts" } } } : {}),
};
export default nextConfig;
