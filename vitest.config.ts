import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./tests/setup.ts"],
    env: { NODE_ENV: "test" },
    fileParallelism: false, // single shared test DB
  },
});
