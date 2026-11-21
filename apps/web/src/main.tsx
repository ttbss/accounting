import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

// 有新版時自動更新（下次開啟 App 就是新版）
registerSW({ immediate: true });

// 請瀏覽器盡量不要清掉本機資料庫（還沒同步的帳都在裡面）
void navigator.storage?.persist?.();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
