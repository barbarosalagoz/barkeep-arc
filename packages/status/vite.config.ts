import { defineConfig } from "vite";

// A static page. Relative asset paths, so the same build works at any URL.
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
});
