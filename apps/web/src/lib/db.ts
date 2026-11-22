import Dexie, { type Table } from "dexie";
import type { Account, Category, Ledger, Transaction } from "@accounting/shared";

/** dirty = 1：這筆在手機上改過，還沒推送到伺服器。（IndexedDB 不能用 boolean 建索引） */
export type Local<T> = T & { dirty: 0 | 1 };

export interface Session {
  userId: string;
  email: string;
  ledgerId: string;
  currency: string;
}

export interface MetaMap {
  session: Session;
  /** 上次 pull 拿到的伺服器版本號 */
  cursor: number;
  lastSyncAt: number;
  lastAccountId: string;
}

interface MetaRow {
  key: string;
  value: unknown;
}

class AppDB extends Dexie {
  ledgers!: Table<Local<Ledger>, string>;
  accounts!: Table<Local<Account>, string>;
  categories!: Table<Local<Category>, string>;
  transactions!: Table<Local<Transaction>, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("accounting");
    this.version(1).stores({
      ledgers: "id",
      accounts: "id, ledger_id, dirty",
      categories: "id, ledger_id, dirty",
      transactions: "id, ledger_id, dirty, [ledger_id+date]",
      meta: "key",
    });
    // v2：子分類（categories.parent_id）、帳戶初始金額（accounts.initial_balance），
    // 加上依分類 / 帳戶查記帳紀錄的索引
    this.version(2)
      .stores({
        transactions: "id, ledger_id, dirty, [ledger_id+date], [ledger_id+category_id], [ledger_id+account_id]",
      })
      .upgrade(async (tx) => {
        await tx
          .table("categories")
          .toCollection()
          .modify((c: Partial<Category>) => {
            if (c.parent_id === undefined) c.parent_id = null;
          });
        await tx
          .table("accounts")
          .toCollection()
          .modify((a: Partial<Account>) => {
            if (a.initial_balance === undefined) a.initial_balance = 0;
          });
      });
  }
}

export const db = new AppDB();

export const SYNCED_TABLES = ["accounts", "categories", "transactions"] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export async function getMeta<K extends keyof MetaMap>(key: K): Promise<MetaMap[K] | undefined> {
  const row = await db.meta.get(key);
  return row?.value as MetaMap[K] | undefined;
}

export async function setMeta<K extends keyof MetaMap>(key: K, value: MetaMap[K]): Promise<void> {
  await db.meta.put({ key, value });
}

/** 換了登入帳號時，清掉這台裝置上的所有資料 */
export async function clearLocalData(): Promise<void> {
  await db.transaction("rw", [db.ledgers, db.accounts, db.categories, db.transactions, db.meta], async () => {
    await Promise.all([
      db.ledgers.clear(),
      db.accounts.clear(),
      db.categories.clear(),
      db.transactions.clear(),
      db.meta.clear(),
    ]);
  });
}
