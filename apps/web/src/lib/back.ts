import { useEffect, useRef } from "react";

/**
 * 手機的「返回」：App 裡打開的每一層（分頁、子頁面、底部面板）都在瀏覽紀錄裡
 * 佔一格，按返回時關掉最上面那一層，而不是直接離開 App。
 *
 * 只靠「格數」對齊：目前位置比進入 App 時多出的格數 = 還開著的層數。
 * - 按返回（popstate）：關掉最上面一層，那一格已經被瀏覽器退掉了。
 * - 從畫面上關掉（按「取消」、「‹ 返回」、換分頁）：自己退掉一格。
 *   同一次操作關掉好幾層時合併成一次 history.go(-n)，只會觸發一次 popstate。
 */

interface Layer {
  close: () => void;
}

const stack: Layer[] = [];
/** 等一下要自己退掉的格數 */
let pendingBack = 0;
/** 自己呼叫 history.go 造成的 popstate，不要當成使用者按返回 */
let ignorePops = 0;

function flushBack() {
  if (pendingBack === 0) return;
  const n = pendingBack;
  pendingBack = 0;
  ignorePops++;
  history.go(-n);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    stack.pop()?.close();
  });
}

/** active 時佔一格瀏覽紀錄；按返回時呼叫 onBack（onBack 要讓這一層關掉） */
export function useBackLayer(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack);
  ref.current = onBack;

  useEffect(() => {
    if (!active) return;
    const layer: Layer = { close: () => ref.current() };
    stack.push(layer);
    history.pushState({ layer: stack.length }, "");
    return () => {
      const i = stack.indexOf(layer);
      if (i === -1) return; // 已經被返回鍵關掉了
      stack.splice(i, 1);
      pendingBack++;
      queueMicrotask(flushBack);
    };
  }, [active]);
}
