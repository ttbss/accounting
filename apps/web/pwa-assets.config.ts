import { defineConfig, minimal2023Preset as preset } from "@vite-pwa/assets-generator/config";

// 執行 `npm run icons -w apps/web`，從 public/icon.svg 產生各尺寸 App 圖示
export default defineConfig({
  preset,
  images: ["public/icon.svg"],
});
