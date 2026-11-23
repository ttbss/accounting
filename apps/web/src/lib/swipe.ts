import { type TouchEvent, useRef } from "react";

/**
 * 左右滑動換期間：往右滑 = 上一個，往左滑 = 下一個。
 *
 * 動畫分三段，避免畫面閃一下：
 * 1. 滑動時內容（contentRef 那一塊）跟著手指移動。
 * 2. 放開後舊內容往滑動方向滑出並淡出，完全看不見了才換期間。
 * 3. 新期間的資料畫好之後（頁面在 useLayoutEffect 裡呼叫 contentReady），
 *    新內容才從另一邊滑進來。舊內容不會跳位置，也不會在動畫途中被換掉。
 *
 * 上下捲動優先：一開始比較偏上下的手勢就完全不管。
 */
const OUT_MS = 140;
const IN_MS = 200;
/** 新資料一直沒來（例如查詢很慢）也不要讓畫面一直空白 */
const READY_TIMEOUT_MS = 500;

export function useSwipeNav(onPrev: () => void, onNext: (() => void) | null) {
  const contentRef = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onPrev, onNext });
  handlers.current = { onPrev, onNext };
  const gesture = useRef<{ x: number; y: number; t: number; mode: "pending" | "h" | "v" } | null>(null);
  /** 換期間後等新資料：新內容要從哪一邊進來（-1 左、1 右） */
  const pending = useRef<{ from: 1 | -1; timer: ReturnType<typeof setTimeout> } | null>(null);

  function style(px: number, opacity: number, ms: number) {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ease-out, opacity ${ms}ms ease-out` : "none";
    el.style.transform = px ? `translateX(${px}px)` : "";
    el.style.opacity = opacity === 1 ? "" : String(opacity);
  }

  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function slideIn() {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    // 先放到另一邊（看不見），強制排版一次，再滑回中間
    style(p.from * 60, 0, 0);
    void contentRef.current?.offsetWidth;
    style(0, 1, IN_MS);
  }

  function go(direction: 1 | -1) {
    const change = direction === -1 ? handlers.current.onPrev : handlers.current.onNext;
    if (!change) return;
    if (reducedMotion()) {
      style(0, 1, 0);
      change();
      return;
    }
    // 往右滑（上一個）：舊內容往右出去，新內容從左邊進來
    const out = direction === -1 ? 1 : -1;
    style(out * (window.innerWidth / 3), 0, OUT_MS);
    setTimeout(() => {
      change();
      pending.current = { from: (-out as 1 | -1), timer: setTimeout(slideIn, READY_TIMEOUT_MS) };
    }, OUT_MS);
  }

  function onTouchStart(e: TouchEvent) {
    const p = e.touches[0];
    // 在輸入框上滑是要移動游標，不是換頁；上一次的動畫還沒結束也先不理
    if (e.touches.length !== 1 || !p || pending.current || (e.target as HTMLElement).closest("input, textarea, select")) {
      gesture.current = null;
      return;
    }
    gesture.current = { x: p.clientX, y: p.clientY, t: Date.now(), mode: "pending" };
  }

  function onTouchMove(e: TouchEvent) {
    const g = gesture.current;
    const p = e.touches[0];
    if (!g || !p) return;
    const dx = p.clientX - g.x;
    const dy = p.clientY - g.y;
    if (g.mode === "pending") {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? "h" : "v";
    }
    if (g.mode !== "h") return;
    // 已經是最新的期間，往左滑只給一點點阻力回饋
    const px = dx < 0 && !handlers.current.onNext ? dx / 6 : dx * 0.6;
    style(px, Math.max(0.4, 1 - Math.abs(px) / 400), 0);
  }

  function onTouchEnd(e: TouchEvent) {
    const g = gesture.current;
    gesture.current = null;
    const p = e.changedTouches[0];
    if (!g || g.mode !== "h" || !p) return;
    const dx = p.clientX - g.x;
    const far = Math.abs(dx) > 80 || (Math.abs(dx) > 40 && Date.now() - g.t < 300);
    if (far && dx > 0) go(-1);
    else if (far && dx < 0 && handlers.current.onNext) go(1);
    else style(0, 1, IN_MS);
  }

  function onTouchCancel() {
    if (gesture.current?.mode === "h") style(0, 1, IN_MS);
    gesture.current = null;
  }

  return {
    contentRef,
    swipeHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
    /** 新期間的內容畫好了（在 useLayoutEffect 裡呼叫，畫面更新前就把新內容放好位置） */
    contentReady: slideIn,
  };
}
