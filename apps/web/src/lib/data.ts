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

export async function saveCategory(
  ledgerId: string,
  input: { kind: TransactionKind; name: string; icon: string },
  id?: string,
): Promise<void> {
  const existing = id ? await db.categories.get(id) : undefined;
  const now = stamp(existing?.updated_at);
  let sortOrder = existing?.sort_order;
  if (sortOrder === undefined) {
    const siblings = await db.categories.where("ledger_id").equals(ledgerId).toArray();
    sortOrder = Math.max(-1, ...siblings.filter((c) => c.kind === input.kind).map((c) => c.sort_order)) + 1;
  }
  await db.categories.put({
    id: existing?.id ?? newId(),
    ledger_id: ledgerId,
    kind: input.kind,
    name: input.name.trim(),
    icon: input.icon.trim(),
    sort_order: sortOrder,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    dirty: 1,
  });
  requestSync();
}

export async function deleteCategory(id: string): Promise<void> {
  const existing = await db.categories.get(id);
  if (!existing) return;
  const now = stamp(existing.updated_at);
  await db.categories.update(id, { deleted_at: now, updated_at: now, dirty: 1 });
  requestSync();
}

// ── 帳戶 ─────────────────────────────────────────────────────────────

export async function saveAccount(
  ledgerId: string,
  input: { name: string; type: AccountType },
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
