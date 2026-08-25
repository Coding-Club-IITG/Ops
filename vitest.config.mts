import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@contracts": path.resolve(import.meta.dirname, "contracts"),
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
