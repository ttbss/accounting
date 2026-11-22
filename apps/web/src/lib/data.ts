import type { Account, AccountType, Category, EntryKind, Merchant, Transaction, TransactionKind } from "@accounting/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Local } from "./db";
import { newId } from "./format";
import { requestSync } from "./sync";

/**
 * 所有寫入都經過這裡：更新 updated_at、標記 dirty，然後排程同步。
 * updated_at 至少比舊值大 1，就算手機時鐘往回調也能蓋過舊資料。
 */
function stamp(previous?: number): number {
  return Math.max(Date.now(), (previous ?? 0) + 1);
}

// ── 記帳紀錄 ──────────────────────────────────────────────────────────

export interface TransactionInput {
  kind: EntryKind;
  amount: number;
  category_id: string | null;
  /** 轉帳時是轉出帳戶 */
  account_id: string | null;
  /** 只有轉帳才有 */
  to_account_id: string | null;
  /** 只有轉帳才有，從轉出帳戶扣 */
  fee: number;
  date: string;
  /** 店家（選填，只有收支才有） */
  merchant_id: string | null;
  note: string;
}

export async function saveTransaction(ledgerId: string, input: TransactionInput, id?: string): Promise<void> {
  const existing = id ? await db.transactions.get(id) : undefined;
  const now = stamp(existing?.updated_at);
  await db.transactions.put({
    id: existing?.id ?? newId(),
    ledger_id: ledgerId,
    ...input,
    // 轉帳沒有分類；收支沒有轉入帳戶和手續費
    category_id: input.kind === "transfer" ? null : input.category_id,
    to_account_id: input.kind === "transfer" ? input.to_account_id : null,
    fee: input.kind === "transfer" ? input.fee : 0,
    merchant_id: input.kind === "transfer" ? null : input.merchant_id,
    note: input.note.trim(),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    dirty: 1,
  });
  requestSync();
}

export async function deleteTransaction(id: string): Promise<void> {
  const existing = await db.transactions.get(id);
  if (!existing) return;
  const now = stamp(existing.updated_at);
  await db.transactions.update(id, { deleted_at: now, updated_at: now, dirty: 1 });
  requestSync();
}

// ── 分類 ─────────────────────────────────────────────────────────────

/** parent_id 有值 = 子分類（只有一層）。回傳這筆分類的 id。 */
export async function saveCategory(
  ledgerId: string,
  input: { kind: TransactionKind; name: string; icon: string; parent_id?: string | null },
  id?: string,
): Promise<string> {
  const existing = id ? await db.categories.get(id) : undefined;
  const now = stamp(existing?.updated_at);
  const parentId = input.parent_id ?? existing?.parent_id ?? null;
  let sortOrder = existing?.sort_order;
  if (sortOrder === undefined) {
    const siblings = await db.categories.where("ledger_id").equals(ledgerId).toArray();
    sortOrder =
      Math.max(
        -1,
        ...siblings
          .filter((c) => c.kind === input.kind && (c.parent_id ?? null) === parentId && c.deleted_at === null)
          .map((c) => c.sort_order),
      ) + 1;
  }
  const newCategoryId = existing?.id ?? newId();
  await db.categories.put({
    id: newCategoryId,
    ledger_id: ledgerId,
    kind: input.kind,
    parent_id: parentId,
    name: input.name.trim(),
    icon: input.icon.trim(),
    sort_order: sortOrder,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    dirty: 1,
  });
  requestSync();
  return newCategoryId;
}

/** 刪除分類；刪上層分類時，底下的子分類一起刪 */
export async function deleteCategory(id: string): Promise<void> {
  await db.transaction("rw", db.categories, async () => {
    const existing = await db.categories.get(id);
    if (!existing) return;
    const children = (await db.categories.where("ledger_id").equals(existing.ledger_id).toArray()).filter(
      (c) => c.parent_id === id && c.deleted_at === null,
    );
    for (const c of [existing, ...children]) {
      const now = stamp(c.updated_at);
      await db.categories.update(c.id, { deleted_at: now, updated_at: now, dirty: 1 });
    }
  });
  requestSync();
}

// ── 店家 ─────────────────────────────────────────────────────────────

export class DuplicateMerchantError extends Error {}

/**
 * 新增或改名店家。新增時若已有同名（未刪除）的店家，直接回傳它的 id；
 * 改名成已存在的名稱則丟 DuplicateMerchantError。
 */
export async function saveMerchant(ledgerId: string, name: string, id?: string): Promise<string> {
  const clean = name.trim().slice(0, 100);
  const all = await db.merchants.where("ledger_id").equals(ledgerId).toArray();
  const same = all.find((m) => m.deleted_at === null && m.name === clean && m.id !== id);
  if (same) {
    if (id) throw new DuplicateMerchantError(`已經有叫「${clean}」的店家`);
    return same.id;
  }
  const existing = id ? all.find((m) => m.id === id) : undefined;
  const now = stamp(existing?.updated_at);
  const merchantId = existing?.id ?? newId();
  await db.merchants.put({
    id: merchantId,
    ledger_id: ledgerId,
    name: clean,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    dirty: 1,
  });
  requestSync();
  return merchantId;
}

/** 刪除店家：已記的帳不受影響，仍會顯示這個店家名稱 */
export async function deleteMerchant(id: string): Promise<void> {
  const existing = await db.merchants.get(id);
  if (!existing) return;
  const now = stamp(existing.updated_at);
  await db.merchants.update(id, { deleted_at: now, updated_at: now, dirty: 1 });
  requestSync();
}

// ── 帳戶 ─────────────────────────────────────────────────────────────

export async function saveAccount(
  ledgerId: string,
  input: { name: string; type: AccountType; initial_balance: number },
  id?: string,
): Promise<void> {
  const existing = id ? await db.accounts.get(id) : undefined;
  const now = stamp(existing?.updated_at);
  let sortOrder = existing?.sort_order;
  if (sortOrder === undefined) {
    const all = await db.accounts.where("ledger_id").equals(ledgerId).toArray();
    sortOrder = Math.max(-1, ...all.map((a) => a.sort_order)) + 1;
  }
  await db.accounts.put({
    id: existing?.id ?? newId(),
    ledger_id: ledgerId,
    name: input.name.trim(),
    type: input.type,
    initial_balance: input.initial_balance,
    sort_order: sortOrder,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    dirty: 1,
  });
  requestSync();
}

export async function deleteAccount(id: string): Promise<void> {
  const existing = await db.accounts.get(id);
  if (!existing) return;
  const now = stamp(existing.updated_at);
  await db.accounts.update(id, { deleted_at: now, updated_at: now, dirty: 1 });
  requestSync();
}

/** 交換兩筆的排序（分類、帳戶的上移/下移） */
export async function swapOrder(table: "categories" | "accounts", a: string, b: string): Promise<void> {
  const t = db[table] as unknown as import("dexie").Table<Local<{ id: string; sort_order: number; updated_at: number }>, string>;
  await db.transaction("rw", t, async () => {
    const [ra, rb] = await t.bulkGet([a, b]);
    if (!ra || !rb) return;
    const now = stamp(Math.max(ra.updated_at, rb.updated_at));
    await t.update(a, { sort_order: rb.sort_order, updated_at: now, dirty: 1 });
    await t.update(b, { sort_order: ra.sort_order, updated_at: now, dirty: 1 });
  });
  requestSync();
}

// ── 讀取用的 hooks（資料變動時畫面自動更新） ─────────────────────────

const byOrder = <T extends { sort_order: number; name: string }>(a: T, b: T) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-TW");

/** 全部分類（含已刪除，用來顯示舊紀錄的分類名稱） */
export function useCategories(ledgerId: string): Category[] | undefined {
  return useLiveQuery(
    async () => (await db.categories.where("ledger_id").equals(ledgerId).toArray()).sort(byOrder),
    [ledgerId],
  );
}

export function useAccounts(ledgerId: string): Account[] | undefined {
  return useLiveQuery(
    async () => (await db.accounts.where("ledger_id").equals(ledgerId).toArray()).sort(byOrder),
    [ledgerId],
  );
}

export function useMonthTransactions(ledgerId: string, month: string): Transaction[] | undefined {
  return useLiveQuery(
    async () =>
      (
        await db.transactions
          .where("[ledger_id+date]")
          .between([ledgerId, `${month}-01`], [ledgerId, `${month}-31`], true, true)
          .toArray()
      )
        .filter((t) => t.deleted_at === null)
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at),
    [ledgerId, month],
  );
}

export function usePendingCount(): number | undefined {
  return useLiveQuery(async () => {
    const counts = await Promise.all([
      db.accounts.where("dirty").equals(1).count(),
      db.categories.where("dirty").equals(1).count(),
      db.merchants.where("dirty").equals(1).count(),
      db.transactions.where("dirty").equals(1).count(),
    ]);
    return counts.reduce((a, b) => a + b, 0);
  });
}

/** 某個分類用過的備註，最近用過的排最前面（同樣的備註只出現一次） */
export function useNoteSuggestions(ledgerId: string, categoryId: string | null): string[] | undefined {
  return useLiveQuery(async () => {
    if (!categoryId) return [];
    const rows = await db.transactions.where("[ledger_id+category_id]").equals([ledgerId, categoryId]).toArray();
    const lastUsed = new Map<string, number>();
    for (const t of rows) {
      const note = t.note.trim();
      if (t.deleted_at !== null || !note) continue;
      lastUsed.set(note, Math.max(lastUsed.get(note) ?? 0, t.updated_at));
    }
    return [...lastUsed.entries()].sort((a, b) => b[1] - a[1]).map(([note]) => note);
  }, [ledgerId, categoryId]);
}

export interface MerchantStats {
  count: number;
  /** 支出合計 */
  expense: number;
  /** 收入合計 */
  income: number;
  lastUsed: number;
  lastDate: string;
}

export interface MerchantInfo {
  /** 店家清單（未刪除），最近用過的在前面，沒用過的排最後（新建的在前） */
  list: Merchant[];
  /** 全部店家（含已刪除，用來顯示舊紀錄的店家名稱） */
  byId: Map<string, Merchant>;
  /** 每個分類（含子分類）上次用的店家 id（只算未刪除的店家） */
  lastByCategory: Map<string, string>;
  stats: Map<string, MerchantStats>;
}

export function useMerchants(ledgerId: string): MerchantInfo | undefined {
  return useLiveQuery(async () => {
    const [merchants, rows] = await Promise.all([
      db.merchants.where("ledger_id").equals(ledgerId).toArray(),
      db.transactions.where("ledger_id").equals(ledgerId).toArray(),
    ]);
    const byId = new Map(merchants.map((m) => [m.id, m as Merchant]));
    const stats = new Map<string, MerchantStats>();
    const lastByCategory = new Map<string, { id: string; at: number }>();
    for (const t of rows) {
      if (t.deleted_at !== null || !t.merchant_id) continue;
      const s = stats.get(t.merchant_id) ?? { count: 0, expense: 0, income: 0, lastUsed: 0, lastDate: "" };
      s.count += 1;
      s.expense += expenseOf(t);
      s.income += incomeOf(t);
      s.lastUsed = Math.max(s.lastUsed, t.updated_at);
      if (t.date > s.lastDate) s.lastDate = t.date;
      stats.set(t.merchant_id, s);
      const m = byId.get(t.merchant_id);
      if (t.category_id && m && m.deleted_at === null) {
        const prev = lastByCategory.get(t.category_id);
        if (!prev || t.updated_at > prev.at) lastByCategory.set(t.category_id, { id: t.merchant_id, at: t.updated_at });
      }
    }
    const list = merchants
      .filter((m) => m.deleted_at === null)
      .sort(
        (a, b) =>
          (stats.get(b.id)?.lastUsed ?? 0) - (stats.get(a.id)?.lastUsed ?? 0) || b.created_at - a.created_at,
      );
    return {
      list,
      byId,
      lastByCategory: new Map([...lastByCategory].map(([cat, v]) => [cat, v.id])),
      stats,
    };
  }, [ledgerId]);
}

/** 在某個店家的所有記帳紀錄（新到舊） */
export function useMerchantTransactions(ledgerId: string, merchantId: string): Transaction[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.transactions.where("[ledger_id+merchant_id]").equals([ledgerId, merchantId]).toArray())
        .filter((t) => t.deleted_at === null)
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at),
    [ledgerId, merchantId],
  );
}

/** 某個帳戶的所有記帳紀錄（新到舊），包含轉入這個帳戶的轉帳 */
export function useAccountTransactions(ledgerId: string, accountId: string): Transaction[] | undefined {
  return useLiveQuery(async () => {
    const [from, to] = await Promise.all([
      db.transactions.where("[ledger_id+account_id]").equals([ledgerId, accountId]).toArray(),
      db.transactions.where("[ledger_id+to_account_id]").equals([ledgerId, accountId]).toArray(),
    ]);
    const byId = new Map([...from, ...to].map((t) => [t.id, t]));
    return [...byId.values()]
      .filter((t) => t.deleted_at === null)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at);
  }, [ledgerId, accountId]);
}

/** 每個帳戶的目前餘額 = 初始金額 + 收入 − 支出 */
export function useAccountBalances(ledgerId: string): Map<string, number> | undefined {
  return useLiveQuery(async () => {
    const [accounts, transactions] = await Promise.all([
      db.accounts.where("ledger_id").equals(ledgerId).toArray(),
      db.transactions.where("ledger_id").equals(ledgerId).toArray(),
    ]);
    const balances = new Map(accounts.map((a) => [a.id, a.initial_balance ?? 0]));
    for (const t of transactions) {
      if (t.deleted_at !== null) continue;
      for (const id of [t.account_id, t.to_account_id]) {
        if (id && balances.has(id)) balances.set(id, balances.get(id)! + accountDelta(t, id));
      }
    }
    return balances;
  }, [ledgerId]);
}

// ── 金額計算 ─────────────────────────────────────────────────────────

/** 這筆對某個帳戶餘額的影響。轉帳：轉出帳戶 −(金額 + 手續費)，轉入帳戶 +金額。 */
export function accountDelta(t: Transaction, accountId: string): number {
  if (t.kind === "transfer") {
    let delta = 0;
    if (t.account_id === accountId) delta -= t.amount + (t.fee ?? 0);
    if (t.to_account_id === accountId) delta += t.amount;
    return delta;
  }
  if (t.account_id !== accountId) return 0;
  return t.kind === "income" ? t.amount : -t.amount;
}

/** 整本帳本的收支：轉帳本身不算收入也不算支出，但手續費算支出 */
export function expenseOf(t: Transaction): number {
  if (t.kind === "expense") return t.amount;
  if (t.kind === "transfer") return t.fee ?? 0;
  return 0;
}

export function incomeOf(t: Transaction): number {
  return t.kind === "income" ? t.amount : 0;
}

// ── 分類顯示 ─────────────────────────────────────────────────────────

export interface CategoryInfo {
  /** 子分類沒設圖示時用上層的 */
  icon: string;
  /** 「餐飲 · 午餐」或「餐飲」 */
  label: string;
  /** 上層分類（統計用）；本身是上層分類時就是自己 */
  top?: Category;
  sub?: Category;
}

export function categoryInfo(categoryId: string | null, byId: Map<string, Category>): CategoryInfo {
  const cat = categoryId ? byId.get(categoryId) : undefined;
  if (!cat) return { icon: "•", label: "未分類" };
  const parent = cat.parent_id ? byId.get(cat.parent_id) : undefined;
  if (!parent) return { icon: cat.icon || "•", label: cat.name, top: cat };
  return { icon: cat.icon || parent.icon || "•", label: `${parent.name} · ${cat.name}`, top: parent, sub: cat };
}
