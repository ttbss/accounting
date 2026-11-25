/**
 * 外觀：跟隨系統／淺色／深色。只存在這台裝置（localStorage），不會同步。
 * index.html 裡有一小段同樣的程式在畫面出來前先套用，避免閃一下另一個顏色。
 */
export type ThemePref = "system" | "light" | "dark";

const KEY = "theme";
/** 跟 styles.css 的 --bg 一樣，讓狀態列和頁面同色 */
const BAR_COLOR = { light: "#f3f6fb", dark: "#0b1120" } as const;

export function loadTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* 讀不到就跟隨系統 */
  }
  return "system";
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;

  // index.html 有淺色、深色兩個 theme-color；指定外觀時兩個都改成同一個顏色
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = BAR_COLOR[pref === "system" ? scheme : pref];
  }
}

export function saveTheme(pref: ThemePref): void {
  applyTheme(pref);
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* 無痕模式等情況存不了，這次開著的期間仍然有效 */
  }
}
