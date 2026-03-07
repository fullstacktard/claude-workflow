import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5000,
    // Allow external connections in Docker
    host: "0.0.0.0",
    // Watch configuration for WSL2 compatibility
    watch: {
      // Enable polling for WSL2/Docker environments where inotify doesn't work
      usePolling: process.env.CHOKIDAR_USEPOLLING === "true",
      // Polling interval in ms (balance between responsiveness and CPU usage)
      interval: parseInt(process.env.CHOKIDAR_INTERVAL ?? "1000", 10),
    },
    proxy: {
      "/api": {
        // Use VITE_API_URL env var in Docker, fallback to localhost for local dev
        target: process.env.VITE_API_URL ?? "http://localhost:3850",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.VITE_API_URL ?? "http://localhost:3850",
        changeOrigin: true,
      },
      "/oauth": {
        target: process.env.VITE_API_URL ?? "http://localhost:3850",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_API_URL ?? "http://localhost:3850",
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Suppress large chunk warnings - Three.js is inherently large
    chunkSizeWarningLimit: 1500,
    // NO manualChunks - let Vite/Rollup handle code splitting naturally
    // React.lazy() will ensure Three.js only loads when visualization page is accessed
  },
  // Pre-bundle for dev server only - doesn't affect production build
  optimizeDeps: {
    include: ["three", "@react-three/fiber", "@react-three/drei"],
  },
});
