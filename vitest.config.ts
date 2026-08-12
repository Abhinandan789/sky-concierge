import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // PGlite instantiates its WASM lazily on first use (~10s); sharing one
    // instance per file keeps the rest of the suite fast.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
