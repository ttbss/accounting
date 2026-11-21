import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "icon.svg"],
      manifest: {
        name: "記帳本",
        short_name: "記帳",
        description: "個人記帳，離線也能記，自動同步與備份",
        lang: "zh-TW",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f9f9f7",
        theme_color: "#2a78d6",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "/index.html",
        // /api 一律走網路；/api/login 要讓 Cloudflare Access 有機會重新登入
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    // 本機開發：/api 轉給 wrangler dev。changeOrigin 讓 Worker 看到 localhost，假登入才會生效。
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
