import { defineConfig } from "vitest/config";

// Node-side tests for tools/ (the crawler and builder). The Worker tests use vitest.config.js.
export default defineConfig({
  test: { include: ["tools/**/*.test.mjs"], environment: "node" },
});
