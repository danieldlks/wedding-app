import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // when running `vite` directly (not `wrangler pages dev`), proxy API calls
      // to a locally running `wrangler pages dev` instance on port 8788.
      "/api": "http://127.0.0.1:8788"
    }
  }
});
