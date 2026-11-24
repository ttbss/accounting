import { defineConfig, type Preset } from "@vite-pwa/assets-generator/config";

// 執行 `npm run icons -w apps/web` 產生各尺寸 App 圖示。
// 這裡處理圓角版 public/icon.svg：pwa-*.png（purpose any）與 favicon.ico。
// maskable 與 apple-touch-icon 需要滿版背景，改用 public/icon-maskable.svg（見 pwa-assets.maskable.config.ts）。
// 兩個 SVG 的圖案要一起改。
const preset: Preset = {
  transparent: { sizes: [64, 192, 512], favicons: [[48, "favicon.ico"]], padding: 0 },
  maskable: { sizes: [] },
  apple: { sizes: [] },
};

export default defineConfig({
  preset,
  images: ["public/icon.svg"],
});
