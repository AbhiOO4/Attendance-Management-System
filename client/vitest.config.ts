import { defineConfig } from "vitest/config"
import path from "path"

// Unit tests for the client's pure lib/ mirrors of the server's payroll math. Kept apart from
// vite.config.ts so the PWA/Tailwind plugins never load under test.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
