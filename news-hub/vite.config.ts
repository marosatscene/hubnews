import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

const legacyNewsHubCssFiles = ["index-Cw3HW6In.css"];
const newsHubOutDir = "../public/news-hub";

function legacyNewsHubAssetAliases() {
  return {
    name: "legacy-news-hub-asset-aliases",
    closeBundle() {
      const assetsDir = join(__dirname, newsHubOutDir, "assets");
      const currentCss = join(assetsDir, "index.css");
      if (!existsSync(currentCss)) return;

      for (const fileName of legacyNewsHubCssFiles) {
        copyFileSync(currentCss, join(assetsDir, fileName));
      }
    }
  };
}

export default defineConfig({
  base: "/news-hub/",
  plugins: [tailwindcss(), react(), legacyNewsHubAssetAliases()],
  root: __dirname,
  server: {
    proxy: {
      "/admin/api": "http://127.0.0.1:4000"
    }
  },
  build: {
    outDir: newsHubOutDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "assets/index.css";
          return "assets/[name][extname]";
        },
        chunkFileNames: "assets/[name].js",
        entryFileNames: "assets/index.js"
      }
    }
  }
});
