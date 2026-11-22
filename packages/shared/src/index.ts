/**
 * 前端（PWA）與後端（Worker）共用的資料格式與同步協定。
 *
 * 同步規則：
 * - 每筆資料的 id 由建立它的裝置產生，重送時不會重複。
 * - 每次修改都更新 updated_at（毫秒），兩邊衝突時以 updated_at 較新者為準。
 * - 刪除只設定 deleted_at，不真的刪掉，其他裝置才知道要刪。
 * - 金額一律用「整數、最小單位 ×100」存，例如 NT$12.50 → 1250。
 */
import { z } from "zod";

/** 手機一次最多推送幾筆（伺服器在一個交易裡寫入） */
export const MAX_PUSH_ROWS = 200;

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "id 只能包含英數字、- 和 _");
const timestamp = z.number().int().nonnegative();
const deletedAt = timestamp.nullable();

export const ACCOUNT_TYPES = ["cash", "bank", "credit_card", "e_wallet", "other"] as const;
/** 分類的種類（也是一般收支紀錄的種類） */
export const TRANSACTION_KINDS = ["expense", "income"] as const;
/** 記帳紀錄的種類：收支之外還有轉帳（轉帳沒有分類） */
export const ENTRY_KINDS = [...TRANSACTION_KINDS, "transfer"] as const;

export const accountSchema = z.object({
  id,
  ledger_id: id,
  name: z.string().trim().min(1).max(50),
  type: z.enum(ACCOUNT_TYPES),
  /** 初始金額，最小單位 ×100，可以是負數（例如信用卡欠款） */
  initial_balance: z.number().int().min(-1e13).max(1e13),
  sort_order: z.number().int(),
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: deletedAt,
});

export const categorySchema = z.object({
  id,
  ledger_id: id,
  name: z.string().trim().min(1).max(50),
  kind: z.enum(TRANSACTION_KINDS),
  /** 上層分類 id；null = 本身就是上層分類。只有一層，子分類的 kind 跟上層相同。 */
  parent_id: id.nullable(),
  icon: z.string().max(16),
  sort_order: z.number().int(),
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: deletedAt,
});

export const transactionSchema = z.object({
  id,
  ledger_id: id,
  kind: z.enum(ENTRY_KINDS),
  /** 最小單位 ×100 的正整數。轉帳時是轉入帳戶收到的金額。 */
  amount: z.number().int().nonnegative().max(1e13),
  /** 轉帳時是 null */
  category_id: id.nullable(),
  /** 轉帳時是轉出帳戶 */
  account_id: id.nullable(),
  /** 只有轉帳才有：轉入帳戶 */
  to_account_id: id.nullable(),
  /** 只有轉帳才有：手續費，從轉出帳戶扣（轉出帳戶共減少 amount + fee） */
  fee: z.number().int().nonnegative().max(1e13),
  /** 當地日期 YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 店家（選填，收支才有）；空字串 = 沒填 */
  merchant: z.string().max(100),
  note: z.string().max(500),
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: deletedAt,
});

export const ledgerSchema = z.object({
  id,
  name: z.string().min(1).max(50),
  currency: z.string().length(3),
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: deletedAt,
});

export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Ledger = z.infer<typeof ledgerSchema>;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** 手機推送到伺服器的變更。帳本本身在第一版不從手機修改。 */
export const pushRequestSchema = z
  .object({
    // 舊版手機不會帶新欄位；沒帶的話伺服器保留原本的值，不要蓋成預設值
    accounts: z.array(accountSchema.extend({ initial_balance: accountSchema.shape.initial_balance.optional() })).default([]),
    categories: z.array(categorySchema.extend({ parent_id: categorySchema.shape.parent_id.optional() })).default([]),
    transactions: z
      .array(
        transactionSchema
          .extend({
            to_account_id: transactionSchema.shape.to_account_id.optional(),
            fee: transactionSchema.shape.fee.optional(),
            merchant: transactionSchema.shape.merchant.optional(),
          })
          .refine((t) => t.kind !== "transfer" || t.to_account_id !== null, "轉帳要有轉入帳戶"),
      )
      .default([]),
  })
  .refine(
    (p) => p.accounts.length + p.categories.length + p.transactions.length <= MAX_PUSH_ROWS,
    `一次最多推送 ${MAX_PUSH_ROWS} 筆`,
  );

export type PushRequest = z.input<typeof pushRequestSchema>;

export interface PushResponse {
  ok: true;
  accepted: number;
}

export interface PullResponse {
  /** 下次 pull 時帶回來的游標 */
  cursor: number;
  /** true 表示還有資料，要立刻再 pull 一次 */
  hasMore: boolean;
  changes: {
    ledgers: Ledger[];
    accounts: Account[];
    categories: Category[];
    transactions: Transaction[];
  };
}

export interface MeResponse {
  user: { id: string; email: string };
  ledgers: Ledger[];
  defaultLedgerId: string;
}
