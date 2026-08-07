import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  base: "/cabinet/",
  build: {
    outDir: "dist/client",
    sourcemap: false,
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "react-router"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/internal/v1": {
        target: process.env.CRM_BACKEND_URL ?? "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "tests/sites-worker.test.mjs"],
  },
  plugins: [react()],
});
