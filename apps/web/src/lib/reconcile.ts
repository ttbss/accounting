/**
 * 銀行對帳：把對帳單的每一筆跟 App 裡這個帳戶的記帳紀錄配對。
 *
 * 1. 金額完全一樣、日期差 3 天以內 → 同一筆。日期／時間不同就更正成銀行的。
 * 2. 剩下的：同方向（都是扣款或都是入帳）、日期差 1 天以內、金額差不到一倍 → 可能是金額記錯，提議更正金額。
 * 3. 還是配不到的銀行紀錄 → 新增；配不到的 App 紀錄 → 列出來（銀行沒有這筆）。
 *
 * 「金額」都用對這個帳戶餘額的影響（帶正負號）來比，所以收支、轉入、轉出都適用。
 */
import type { Account, Category, EntryKind, Transaction } from "@accounting/shared";
import type { BankRow, Statement } from "./bankStatement";
import { accountDelta, type TransactionInput } from "./data";

/** 配對時日期最多差幾天（週末、假日入帳日會延後） */
const EXACT_DAY_WINDOW = 3;
const FUZZY_DAY_WINDOW = 1;

export interface Changes {
  date?: string;
  time?: string;
  amount?: number;
  fee?: number;
}

export interface Match {
  bank: BankRow;
  tx: Transaction;
  changes: Changes;
  /** 金額不同、靠日期配到的 */
  amountFix: boolean;
}

export interface Plan {
  matches: Match[];
  /** 銀行有、App 沒有 */
  creations: BankRow[];
  /** App 有、銀行沒有（只算對帳單期間內的） */
  missing: Transaction[];
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** txs：這個帳戶的記帳紀錄（含轉入這個帳戶的轉帳），不含已刪除的 */
export function reconcile(stmt: Statement, txs: Transaction[], accountId: string): Plan {
  const lo = dayNumber(stmt.start) - EXACT_DAY_WINDOW;
  const hi = dayNumber(stmt.end) + EXACT_DAY_WINDOW;
  const candidates = txs.filter((t) => {
    const d = dayNumber(t.date);
    return t.deleted_at === null && d >= lo && d <= hi && accountDelta(t, accountId) !== 0;
  });

  const usedBank = new Set<BankRow>();
  const usedTx = new Set<string>();
  const matches: Match[] = [];

  const pair = (scoreOf: (b: BankRow, t: Transaction) => number | null) => {
    const pairs: { b: BankRow; t: Transaction; score: number }[] = [];
    for (const b of stmt.rows) {
      if (usedBank.has(b)) continue;
      for (const t of candidates) {
        if (usedTx.has(t.id)) continue;
        const score = scoreOf(b, t);
        if (score !== null) pairs.push({ b, t, score });
      }
    }
    // 分數低的先配（日期、時間最接近的）
    pairs.sort((x, y) => x.score - y.score);
    const out: { b: BankRow; t: Transaction }[] = [];
    for (const p of pairs) {
      if (usedBank.has(p.b) || usedTx.has(p.t.id)) continue;
      usedBank.add(p.b);
      usedTx.add(p.t.id);
      out.push(p);
    }
    return out;
  };

  const closeness = (b: BankRow, t: Transaction) => {
    const days = Math.abs(dayNumber(b.date) - dayNumber(t.date));
    const timeGap = b.time && t.time ? Math.min(Math.abs(minutes(b.time) - minutes(t.time)), 720) : 60;
    return days * 1440 + timeGap;
  };

  // 第一輪：金額一樣
  for (const { b, t } of pair((b, t) => {
    if (accountDelta(t, accountId) !== b.delta) return null;
    if (Math.abs(dayNumber(b.date) - dayNumber(t.date)) > EXACT_DAY_WINDOW) return null;
    return closeness(b, t);
  })) {
    matches.push({ bank: b, tx: t, changes: dateTimeChanges(b, t), amountFix: false });
  }

  // 第二輪：金額不同，但同方向、日期很近
  for (const { b, t } of pair((b, t) => {
    const appDelta = accountDelta(t, accountId);
    if (Math.sign(appDelta) !== Math.sign(b.delta)) return null;
    if (t.kind === "transfer" && t.account_id === accountId && t.to_account_id === accountId) return null;
    const days = Math.abs(dayNumber(b.date) - dayNumber(t.date));
    if (days > FUZZY_DAY_WINDOW) return null;
    // 金額差超過一倍就不像同一筆了：寧可當成「新增」+「銀行沒有」讓使用者自己看
    const ratio = Math.max(Math.abs(appDelta), Math.abs(b.delta)) / Math.max(1, Math.min(Math.abs(appDelta), Math.abs(b.delta)));
    // 例外：剛好差 10 倍（多打或少打一個 0）
    const tenfold = Math.abs(appDelta) * 10 === Math.abs(b.delta) || Math.abs(b.delta) * 10 === Math.abs(appDelta);
    if (ratio > 2 && !tenfold) return null;
    return days * 1440 + (tenfold ? 50 : Math.log(ratio) * 100);
  })) {
    matches.push({
      bank: b,
      tx: t,
      changes: { ...dateTimeChanges(b, t), ...amountChanges(b, t, accountId) },
      amountFix: true,
    });
  }

  const missing = candidates.filter((t) => !usedTx.has(t.id) && t.date >= stmt.start && t.date <= stmt.end);
  const creations = stmt.rows.filter((b) => !usedBank.has(b));
  matches.sort((x, y) => x.bank.date.localeCompare(y.bank.date) || x.bank.timeFull.localeCompare(y.bank.timeFull));
  return { matches, creations, missing };
}

function dateTimeChanges(b: BankRow, t: Transaction): Changes {
  const c: Changes = {};
  if (b.date !== t.date) c.date = b.date;
  if (b.time && b.time !== t.time) c.time = b.time;
  return c;
}

/**
 * 讓這筆對帳戶的影響變成銀行的金額。
 * 轉帳的兩邊常常差一筆手續費（轉出扣 50,015、轉入收到 50,000），這時候盡量把差額算在手續費，
 * 不去動另一邊帳戶的金額 —— 不然兩個帳戶輪流對帳時會一直改來改去。
 */
function amountChanges(b: BankRow, t: Transaction, accountId: string): Changes {
  if (t.kind !== "transfer") return { amount: Math.abs(b.delta) };
  if (t.to_account_id === accountId) {
    // 這個帳戶是轉入方：收到的比記的少一點 → 差額是手續費（轉出方扣的總數不變）
    const sent = t.amount + t.fee;
    const gap = sent - b.delta;
    return gap >= 0 && gap <= MAX_FEE ? { amount: b.delta, fee: gap } : { amount: b.delta };
  }
  // 這個帳戶是轉出方：轉入金額不變，多扣的一點點算手續費
  const total = -b.delta;
  const gap = total - t.amount;
  if (gap >= 0 && gap <= MAX_FEE) return { fee: gap };
  return total >= t.fee ? { amount: total - t.fee } : { amount: total, fee: 0 };
}

/** 差額在這以內才當成轉帳手續費（NT$100） */
const MAX_FEE = 10_000;

export function hasChanges(c: Changes): boolean {
  return Object.keys(c).length > 0;
}

// ── 新增紀錄的預設值 ─────────────────────────────────────────────────

export interface Draft {
  kind: EntryKind;
  category_id: string | null;
  /** 轉帳的另一個帳戶 */
  other_account_id: string | null;
}

/** 新增紀錄的備註：摘要 + 存摺備註 + 轉帳留言 */
export function bankNote(b: BankRow): string {
  return [b.summary, b.memo, b.message].filter(Boolean).join(" ").slice(0, 500);
}

/** 用來找「以前匯入過的同一種交易」：摘要 + 存摺備註 */
function learnKey(b: BankRow): string {
  return [b.summary, b.memo].filter(Boolean).join(" ");
}

/**
 * 猜這筆該記成什麼：
 * 1. 以前匯入過同樣摘要／對象的，照上次的（使用者改過分類的話，就照改過的）
 * 2. 摘要裡有自己其他帳戶的帳號 → 轉帳到那個帳戶
 * 3. 卡款 → 轉帳到信用卡；ATM 提款 → 轉帳到現金；薪資 → 收入「薪資」；
 *    銀行有給分類（永豐的「交易分類」）而且跟 App 的分類同名 → 用那個分類
 * 4. 其他：扣款記支出、入帳記收入，未分類
 *
 * knownNumbers：每個 App 帳戶上次匯入的銀行帳號（帳戶 id → 只有數字的帳號）
 */
export function suggestDraft(
  b: BankRow,
  history: Transaction[],
  accountId: string,
  accounts: Account[],
  categories: Category[],
  knownNumbers: Map<string, string> = new Map(),
): Draft {
  const outgoing = b.delta < 0;
  const liveAccounts = accounts.filter((a) => a.deleted_at === null && a.id !== accountId);
  const liveCats = categories.filter((c) => c.deleted_at === null);
  const key = learnKey(b);

  if (key) {
    const prev = history
      .filter((t) => t.deleted_at === null && t.note.startsWith(key) && Math.sign(accountDelta(t, accountId)) === Math.sign(b.delta))
      .sort((x, y) => y.date.localeCompare(x.date) || y.updated_at - x.updated_at)[0];
    if (prev) {
      if (prev.kind === "transfer") {
        const other = prev.account_id === accountId ? prev.to_account_id : prev.account_id;
        if (other && liveAccounts.some((a) => a.id === other)) return { kind: "transfer", category_id: null, other_account_id: other };
      } else if (!prev.category_id || liveCats.some((c) => c.id === prev.category_id)) {
        return { kind: prev.kind, category_id: prev.category_id, other_account_id: null };
      }
    }
  }

  const text = `${b.summary} ${b.memo} ${b.category}`.normalize("NFKC");

  // 摘要／對方帳號裡出現自己其他帳戶的帳號（例如「手機轉帳-12345678901234」、「807/0012345678901234」）
  const digits = `${b.summary} ${b.memo} ${b.counterparty}`.normalize("NFKC").replace(/\D/g, "");
  for (const a of liveAccounts) {
    const no = knownNumbers.get(a.id);
    if (no && no.length >= 8 && digits.includes(no)) return { kind: "transfer", category_id: null, other_account_id: a.id };
  }
  const byType = (type: Account["type"]) => liveAccounts.find((a) => a.type === type)?.id ?? null;
  const catNamed = (kind: "expense" | "income", re: RegExp) =>
    liveCats.find((c) => c.kind === kind && re.test(c.name))?.id ?? null;

  // 帳戶名稱的關鍵字（去掉「銀行」「帳戶」這類字）出現在摘要／備註裡，例如備註「永豐銀行」↔ 帳戶「永豐」
  const named = (list: Account[]) =>
    list.find((a) => {
      const word = a.name.normalize("NFKC").replace(/銀行|商銀|帳戶|存款|活存|綜存|信用卡|卡/g, "").trim();
      return word.length >= 2 && text.includes(word);
    })?.id ?? null;

  if (outgoing && /卡款|信用卡/.test(text)) {
    const cards = liveAccounts.filter((a) => a.type === "credit_card");
    const card = named(cards) ?? cards[0]?.id;
    if (card) return { kind: "transfer", category_id: null, other_account_id: card };
  }
  if (outgoing && /ATM|提款|提領/i.test(text) && !/轉/.test(text)) {
    const cash = byType("cash");
    if (cash) return { kind: "transfer", category_id: null, other_account_id: cash };
  }
  const sameOwner = named(liveAccounts.filter((a) => a.type !== "cash" && a.type !== "credit_card"));
  if (sameOwner) return { kind: "transfer", category_id: null, other_account_id: sameOwner };
  // 銀行的分類跟 App 的分類同名（「這筆是啥」之類的預設值不算）
  if (b.category && !/這筆是啥|未分類/.test(b.category)) {
    const kind = outgoing ? "expense" : "income";
    const same = liveCats.find((c) => c.kind === kind && c.name === b.category);
    if (same) return { kind, category_id: same.id, other_account_id: null };
  }
  if (!outgoing && /薪/.test(text)) return { kind: "income", category_id: catNamed("income", /薪/), other_account_id: null };
  if (!outgoing && /利息/.test(text)) {
    return { kind: "income", category_id: catNamed("income", /利息|投資/), other_account_id: null };
  }
  return { kind: outgoing ? "expense" : "income", category_id: null, other_account_id: null };
}

export function draftToInput(b: BankRow, draft: Draft, accountId: string): TransactionInput {
  const base = { date: b.date, time: b.time, merchant_id: null, note: bankNote(b) };
  const outgoing = b.delta < 0;
  if (draft.kind === "transfer" && draft.other_account_id) {
    return outgoing
      ? { ...base, kind: "transfer", amount: b.withdraw, fee: b.fee, category_id: null, account_id: accountId, to_account_id: draft.other_account_id }
      : { ...base, kind: "transfer", amount: b.delta, fee: 0, category_id: null, account_id: draft.other_account_id, to_account_id: accountId };
  }
  return {
    ...base,
    kind: outgoing ? "expense" : "income",
    amount: Math.abs(b.delta),
    fee: 0,
    category_id: draft.category_id,
    account_id: accountId,
    to_account_id: null,
  };
}
