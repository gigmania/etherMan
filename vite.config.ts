import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "dist" },
  test: {
    include: ["web/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    restoreMocks: true,
  },
  server: { host: "127.0.0.1" },
});
