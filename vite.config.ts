import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: "build/chrome-mv3-prod",
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome120",
    rollupOptions: { input: { popup: "popup.html", options: "options.html" } },
  },
})
