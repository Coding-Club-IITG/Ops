import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@contract": path.resolve(import.meta.dirname, "contract"),
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
