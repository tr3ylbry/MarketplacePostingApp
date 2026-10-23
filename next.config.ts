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
  ...(testBuild ? { distDir: ".next-test", turbopack: { resolveAlias: { "@image-storage": "./src/test/storage/testImageStorage.ts" } } } : {}),
};
export default nextConfig;
