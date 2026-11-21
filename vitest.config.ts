import { defineConfig } from "vitest/config";
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom", globals: true, setupFiles: "./src/test/setup.ts",
    // Let actual-SDK tests intercept transitive credential discovery as well as
    // direct imports. Native external imports bypass vi.mock for dependencies.
    server: { deps: { inline: ["@vercel/blob"] } },
    include: ["src/**/*.test.{ts,tsx}"], exclude: ["src/**/*.integration.test.ts"],
  },
});
