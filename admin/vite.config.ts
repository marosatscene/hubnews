import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: "../public/admin",
    emptyOutDir: true
  }
});
