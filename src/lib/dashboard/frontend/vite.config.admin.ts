/**
 * Vite configuration for admin panel build.
 * Builds from admin-main.tsx (superset of public main.tsx + admin routes)
 * to admin-dist/ directory which is NEVER included in npm package.
 *
 * Key differences from vite.config.ts (public build):
 * - Entry point: admin.html (references admin-main.tsx)
 * - Output dir: admin-dist/ (separate from public dist/)
 * - Dev port: 5001 (avoids conflict with public dev server on 5000)
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5001, // Different port from public dev server (5000)
    host: "0.0.0.0",
    watch: {
      usePolling: process.env.CHOKIDAR_USEPOLLING === "true",
      interval: parseInt(process.env.CHOKIDAR_INTERVAL ?? "1000", 10),
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:3850",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.VITE_API_URL ?? "http://localhost:3850",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_API_URL ?? "http://localhost:3850",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "admin-dist", // Separate output directory -- NEVER in dist/
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: "admin.html", // Admin HTML entry point
    },
  },
  optimizeDeps: {
    include: ["three", "@react-three/fiber", "@react-three/drei"],
  },
});
