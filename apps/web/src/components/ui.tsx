import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { relogin } from "../lib/api";
import { useBackLayer } from "../lib/back";
import { getMeta } from "../lib/db";
import {
  changePeriodUnit,
  isCurrentPeriod,
  isLatestPeriod,
  type Period,
  type PeriodUnit,
  periodLabel,
  relativeTime,
  shiftPeriod,
  todayStr,
} from "../lib/format";
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

const UNIT_NAMES: Record<PeriodUnit, string> = { day: "天", month: "個月", year: "年" };

/** 有些桌面瀏覽器不支援 <input type="month">，就改用選日期 */
const MONTH_INPUT_OK = (() => {
  try {
    const i = document.createElement("input");
    i.type = "month";
    return i.type === "month";
  } catch {
    return false;
  }
})();

/** 頁首的「‹ 期間 ›」；點中間的文字可以直接選日期或月份 */
export function PeriodSwitcher({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const unitName = UNIT_NAMES[period.unit];
  const monthPicker = period.unit === "month" && MONTH_INPUT_OK;
  return (
    <div className="month-switcher">
      <button className="icon-btn" aria-label={`上一${unitName}`} onClick={() => onChange(shiftPeriod(period, -1))}>
        ‹
      </button>
      <label className="label period-label">
        {periodLabel(period)}
        {period.unit !== "year" && (
          <input
            className="period-picker"
            type={monthPicker ? "month" : "date"}
            aria-label={period.unit === "day" ? "選擇日期" : "選擇月份"}
            value={monthPicker ? period.anchor.slice(0, 7) : period.anchor}
            onClick={(e) => {
              // 桌面版 Chrome 點透明的輸入框不會自己打開選擇器
              try {
                e.currentTarget.showPicker?.();
              } catch {
                /* 不支援就算了，手機點了本來就會開 */
              }
            }}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              onChange({ unit: period.unit, anchor: monthPicker ? `${v}-01` : v });
            }}
          />
        )}
      </label>
      <button
        className="icon-btn"
        aria-label={`下一${unitName}`}
        disabled={isLatestPeriod(period)}
        onClick={() => onChange(shiftPeriod(period, 1))}
      >
        ›
      </button>
    </div>
  );
}

const UNIT_LABELS: Record<PeriodUnit, string> = { day: "日", month: "月", year: "年" };

/** 頁首下面那排：日／月／年（units 可以只列其中幾個），不在本期時可以一鍵回到今天 */
export function PeriodUnitBar({
  period,
  onChange,
  units = ["day", "month", "year"],
}: {
  period: Period;
  onChange: (p: Period) => void;
  units?: PeriodUnit[];
}) {
  const back = period.unit === "day" ? "今天" : period.unit === "month" ? "本月" : "今年";
  return (
    <div className="period-bar">
      <Segmented
        value={period.unit}
        onChange={(u) => onChange(changePeriodUnit(period, u))}
        options={units.map((u) => ({ value: u, label: UNIT_LABELS[u] }))}
      />
      {!isCurrentPeriod(period) && (
        <button className="link-btn" onClick={() => onChange({ unit: period.unit, anchor: todayStr() })}>
          回到{back}
        </button>
      )}
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
  // 手機按返回 = 取消
  useBackLayer(true, onClose);
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
        <div className="sheet-grabber" aria-hidden />
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
