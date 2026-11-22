import type { Account, AccountType, Category, Transaction, TransactionKind } from "@accounting/shared";
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
  kind: TransactionKind;
  amount: number;
  category_id: string | null;
  account_id: string | null;
  date: string;
  note: string;
}

export async function saveTransaction(ledgerId: string, input: TransactionInput, id?: string): Promise<void> {
  const existing = id ? await db.transactions.get(id) : undefined;
  const now = stamp(existing?.updated_at);
  await db.transactions.put({
    id: existing?.id ?? newId(),
    ledger_id: ledgerId,
    ...input,
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

/** 某個帳戶的所有記帳紀錄（新到舊） */
export function useAccountTransactions(ledgerId: string, accountId: string): Transaction[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.transactions.where("[ledger_id+account_id]").equals([ledgerId, accountId]).toArray())
        .filter((t) => t.deleted_at === null)
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at),
    [ledgerId, accountId],
  );
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
      if (t.deleted_at !== null || !t.account_id || !balances.has(t.account_id)) continue;
      balances.set(t.account_id, balances.get(t.account_id)! + (t.kind === "income" ? t.amount : -t.amount));
    }
    return balances;
  }, [ledgerId]);
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
