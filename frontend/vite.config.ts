import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          firebase: ["firebase/app", "firebase/auth"],
          motion: ["framer-motion"],
          forms: ["react-hook-form", "@hookform/resolvers", "zod"],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
