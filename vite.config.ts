import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        id: "/",
        name: "Sandbench",
        short_name: "Sandbench",
        description: "Local demo of chat, media, and device capabilities.",
        theme_color: "#101820",
        background_color: "#e4eaef",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "en",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api-proxy": {
        target: "https://api.x.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ""),
      },
      // Runner mode in dev (VITE_RUNNER_URL=/api): a runner started with `npm run runner`.
      // The runner checks the Firebase ID token itself, so no token is added here.
      "/api/": {
        target: "http://127.0.0.1:8080",
      },
      "/harness": {
        target: "http://127.0.0.1:8799",
        rewrite: (path) => path.replace(/^\/harness/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req, res) => {
            const origin = req.headers.origin;
            const allowed = !origin || origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173";
            if (!allowed || req.headers["x-sandbench-client"] !== "1") {
              res.writeHead(403, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "Harness calls must come from the Sandbench page." }));
              proxyReq.destroy();
              return;
            }
            try {
              proxyReq.setHeader("x-sandbench-token", readFileSync(".harness-token", "utf8").trim());
            } catch {
              // No token file means the harness is not running; it will answer 401 or the proxy will fail.
            }
          });
        },
      },
    },
  },
});
