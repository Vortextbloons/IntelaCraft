import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Keep Vite on the same IPv4 loopback address as the controller. On
    // Windows, the default `localhost` binding can be IPv6-only (`::1`),
    // while the browser resolves localhost to 127.0.0.1.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
