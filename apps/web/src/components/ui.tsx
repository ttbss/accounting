import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { relogin } from "../lib/api";
import { getMeta } from "../lib/db";
import { currentMonth, monthLabel, relativeTime, shiftMonth } from "../lib/format";
import { usePendingCount } from "../lib/data";
import { type SyncState, syncNow, syncStore } from "../lib/sync";

export function useSyncState(): SyncState {
  return useSyncExternalStore(syncStore.subscribe, syncStore.get);
}

export function useLastSyncAt(): number | undefined {
  return useLiveQuery(() => getMeta("lastSyncAt"));
}

/** 每 30 秒重新渲染一次，讓「3 分鐘前」這類文字保持正確 */
export function useTick(ms = 30_000): void {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const isCurrent = month >= currentMonth();
  return (
    <div className="month-switcher">
      <button className="icon-btn" aria-label="上個月" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </button>
      <span className="label">{monthLabel(month)}</span>
      <button
        className="icon-btn"
        aria-label="下個月"
        disabled={isCurrent}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        ›
      </button>
    </div>
  );
}

/** 頁首右上角的同步狀態小標籤，點了會立刻同步 */
export function SyncPill() {
  const state = useSyncState();
  const pending = usePendingCount() ?? 0;
  useTick();

  let dot = "ok";
  let text = "已同步";
  if (state.kind === "syncing") {
    dot = "busy";
    text = "同步中";
  } else if (state.kind === "offline") {
    dot = "warn";
    text = pending > 0 ? `離線 · ${pending} 筆待同步` : "離線";
  } else if (state.kind === "auth") {
    dot = "bad";
    text = "需要重新登入";
  } else if (state.kind === "error") {
    dot = "bad";
    text = "同步失敗";
  } else if (pending > 0) {
    dot = "warn";
    text = `${pending} 筆待同步`;
  }

  return (
    <button
      className="sync-pill"
      onClick={() => (state.kind === "auth" ? relogin() : void syncNow())}
      title={state.kind === "error" ? state.message : undefined}
    >
      <span className={`sync-dot ${dot}`} />
      {text}
    </button>
  );
}

/** 登入過期時顯示在頁面頂端 */
export function AuthBanner() {
  const state = useSyncState();
  if (state.kind !== "auth") return null;
  return (
    <div className="banner" role="alert">
      <span>登入已過期，新記的帳會先存在手機上。</span>
      <button className="btn small" onClick={relogin}>
        重新登入
      </button>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <button className="link-btn" onClick={onClose}>
            取消
          </button>
          <h2>{title}</h2>
          <span style={{ width: 32 }} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`segmented${full ? " full" : ""}`} role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<(msg: string | null) => void>();

export function toast(message: string): void {
  toastListeners.forEach((l) => l(message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastListeners.forEach((l) => l(null)), 2500);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastListeners.add(setMsg);
    return () => void toastListeners.delete(setMsg);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export { relativeTime };
