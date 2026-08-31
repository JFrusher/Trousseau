import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The same `@/*` alias tsconfig and Next use.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // The store's persistence path is a no-op without `window`, and that is
    // exactly the path worth testing.
    environment: "jsdom",
  },
});
