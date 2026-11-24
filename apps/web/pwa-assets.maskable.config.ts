import { defineConfig, type Preset } from "@vite-pwa/assets-generator/config";

// public/icon-maskable.svg 已經是滿版背景、圖形在中央 80% 安全區內，所以不再加邊距。
// Android 會把 maskable 圖示裁成圓形、方圓或水滴；iOS 會自己幫 apple-touch-icon 加圓角。
const preset: Preset = {
  transparent: { sizes: [] },
  maskable: { sizes: [512], padding: 0 },
  apple: { sizes: [180], padding: 0 },
};

export default defineConfig({
  preset,
  images: ["public/icon-maskable.svg"],
});
