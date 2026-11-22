/** 金額：整數、最小單位 ×100 */

/** wholeUnits：只顯示到整數（用在空間小的統計數字） */
export function formatMoney(minor: number, currency = "TWD", wholeUnits = false): string {
  if (wholeUnits) minor = Math.round(minor / 100) * 100;
  const digits = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 100);
}

/** 使用者輸入的金額字串 → 最小單位整數；格式不對或 ≤ 0 回傳 null */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [int = "0", frac = ""] = s.split(".");
  const value = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 帳戶初始金額：可以是 0；空白當 0；格式不對回傳 null。正負號另外選。 */
export function parseBalance(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [int = "0", frac = ""] = s.split(".");
  const value = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(value) && value <= 1e13 ? value : null;
}

export function amountToInput(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** 日期：一律用當地日期字串 YYYY-MM-DD / 月份 YYYY-MM */

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const todayStr = () => toDateStr(new Date());
export const currentMonth = () => todayStr().slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return toDateStr(d).slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${y} 年 ${m} 月`;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  const today = todayStr();
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));
  const base = `${m} 月 ${d} 日 週${WEEKDAYS[dt.getDay()]}`;
  if (date === today) return `今天 · ${base}`;
  if (date === yesterday) return `昨天 · ${base}`;
  return base;
}

export function relativeTime(ms: number): string {
  const diff = Math.round((ms - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("zh-TW", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 45) return "剛剛";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // 非 HTTPS（例如用區網 IP 測試）時沒有 randomUUID
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 現在的當地時間 HH:MM */
export function nowTimeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 檢視期間：日／月／年 ─────────────────────────────────────────────

export type PeriodUnit = "day" | "month" | "year";

/** anchor 是期間內的某一天（YYYY-MM-DD） */
export interface Period {
  unit: PeriodUnit;
  anchor: string;
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** 期間的第一天和最後一天（含） */
export function periodRange({ unit, anchor }: Period): [string, string] {
  if (unit === "day") return [anchor, anchor];
  if (unit === "month") return [`${anchor.slice(0, 7)}-01`, `${anchor.slice(0, 7)}-31`];
  return [`${anchor.slice(0, 4)}-01-01`, `${anchor.slice(0, 4)}-12-31`];
}

export function shiftPeriod(p: Period, delta: number): Period {
  const d = parseDate(p.anchor);
  if (p.unit === "day") return { unit: "day", anchor: toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta)) };
  if (p.unit === "month") return { unit: "month", anchor: toDateStr(new Date(d.getFullYear(), d.getMonth() + delta, 1)) };
  return { unit: "year", anchor: toDateStr(new Date(d.getFullYear() + delta, 0, 1)) };
}

/** 換成日／月／年：包含今天的話停在今天，不然停在原本期間的第一天 */
export function changePeriodUnit(p: Period, unit: PeriodUnit): Period {
  return { unit, anchor: isCurrentPeriod(p) ? todayStr() : periodRange(p)[0] };
}

export function isCurrentPeriod(p: Period): boolean {
  const [start, end] = periodRange(p);
  const today = todayStr();
  return start <= today && today <= end;
}

/** 已經是今天／本月／今年（或之後）就不能再往後 */
export function isLatestPeriod(p: Period): boolean {
  return periodRange(p)[1] >= todayStr();
}

export function periodLabel({ unit, anchor }: Period): string {
  const d = parseDate(anchor);
  if (unit === "year") return `${d.getFullYear()} 年`;
  if (unit === "month") return monthLabel(anchor.slice(0, 7));
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  if (anchor.slice(0, 4) !== todayStr().slice(0, 4)) return `${d.getFullYear()} 年 ${md}`;
  return `${md} 週${WEEKDAYS[d.getDay()]}`;
}

/** 空白畫面用：「這一天」「這個月」「這一年」 */
export function periodNoun(unit: PeriodUnit): string {
  return unit === "day" ? "這一天" : unit === "month" ? "這個月" : "這一年";
}
