import { type TouchEvent, useRef } from "react";

/**
 * 左右滑動換期間：往右滑 = 上一個，往左滑 = 下一個。
 * 滑動時內容跟著手指移動（contentRef 那一塊），放開後換頁並從另一邊滑進來。
 * 上下捲動優先：一開始比較偏上下的手勢就完全不管。
 */
export function useSwipeNav(onPrev: () => void, onNext: (() => void) | null) {
  const contentRef = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onPrev, onNext });
  handlers.current = { onPrev, onNext };
  const gesture = useRef<{ x: number; y: number; t: number; mode: "pending" | "h" | "v" } | null>(null);

  function setOffset(px: number, animate: boolean) {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.2s ease, opacity 0.2s ease" : "none";
    el.style.transform = px ? `translateX(${px}px)` : "";
    el.style.opacity = px ? String(Math.max(0.4, 1 - Math.abs(px) / 400)) : "";
  }

  /** 換頁後新內容從滑動的反方向滑進來 */
  function slideIn(from: 1 | -1) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setOffset(0, false);
    setOffset(from * 60, false);
    requestAnimationFrame(() => requestAnimationFrame(() => setOffset(0, true)));
  }

  function onTouchStart(e: TouchEvent) {
    const p = e.touches[0];
    // 在輸入框上滑是要移動游標，不是換頁
    if (e.touches.length !== 1 || !p || (e.target as HTMLElement).closest("input, textarea, select")) {
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
    const blocked = dx < 0 && !handlers.current.onNext;
    setOffset(blocked ? dx / 6 : dx * 0.6, false);
  }

  function onTouchEnd(e: TouchEvent) {
    const g = gesture.current;
    gesture.current = null;
    const p = e.changedTouches[0];
    if (!g || g.mode !== "h" || !p) return;
    const dx = p.clientX - g.x;
    const flick = Math.abs(dx) > 40 && Date.now() - g.t < 300;
    const { onPrev, onNext } = handlers.current;
    if ((Math.abs(dx) > 80 || flick) && dx > 0) {
      onPrev();
      slideIn(-1);
    } else if ((Math.abs(dx) > 80 || flick) && dx < 0 && onNext) {
      onNext();
      slideIn(1);
    } else {
      setOffset(0, true);
    }
  }

  function onTouchCancel() {
    if (gesture.current?.mode === "h") setOffset(0, true);
    gesture.current = null;
  }

  return { contentRef, swipeHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } };
}
