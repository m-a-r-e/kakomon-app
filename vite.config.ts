import { defineConfig } from "vite";

import { resolve } from "node:path";

export default defineConfig({
  base: "/kakomon-app/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        kakomon: resolve(__dirname, "kakomon.html"),
      },
    },
  },
  server: {
    port: 6174,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  worker: {
    format: "es",
  },
});
