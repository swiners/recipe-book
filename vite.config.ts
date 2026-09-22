import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Pages serves this from /sam-recipes/, not the domain root. Supplied by the workflow
  // so `npm run dev` stays at / locally. Baked in at build time.
  base: process.env.PAGES_BASE_PATH ?? "/",
});
