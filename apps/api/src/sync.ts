import type {
  Account,
  Category,
  Ledger,
  PullResponse,
  PushRequest,
  Transaction,
} from "@accounting/shared";
import { pushRequestSchema } from "@accounting/shared";
import type { AppEnv, AuthUser } from "./env";

/**
 * 同步協定
 *
 * - 每次寫入（一個 push 或一次預設資料建立）都把 counters.rev +1，
 *   這批寫入的每一列都標上同一個 rev。
 * - pull 時手機帶上一次拿到的 cursor，伺服器回傳 rev > cursor 的所有列。
 * - D1 的 batch 是單一交易、依序執行，所以 rev 的遞增和寫入不會交錯，
 *   pull 不會漏掉「rev 比較小但比較晚寫入」的資料。
 *
 * 注意（之後做家人共用時）：新成員加入帳本後，他的 cursor 可能已經大於
 * 那本帳本舊資料的 rev，要讓他從 cursor = 0 重新 pull 一次。
 */

const NEXT_REV = "(SELECT value FROM counters WHERE name = 'rev')";
const BUMP_REV = "UPDATE counters SET value = value + 1 WHERE name = 'rev'";
const MEMBER_LEDGERS = "SELECT ledger_id FROM ledger_members WHERE user_id = ?1";
const PULL_LIMIT = 1000;

export class HttpError extends Error {
  constructor(
    public status: 400 | 403,
    message: string,
  ) {
    super(message);
  }
}

// ── pull ────────────────────────────────────────────────────────────────

type WithRev<T> = T & { rev: number };

export async function pull(env: AppEnv, user: AuthUser, cursor: number): Promise<PullResponse> {
  const db = env.DB;
  const limit = PULL_LIMIT + 1; // 多拿一筆，用來判斷是否被截斷

  const [ledgers, accounts, categories, transactions] = await db.batch([
    db
      .prepare(
        `SELECT id, name, currency, created_at, updated_at, deleted_at, rev FROM ledgers
         WHERE id IN (${MEMBER_LEDGERS}) AND rev > ?2 ORDER BY rev LIMIT ?3`,
      )
      .bind(user.id, cursor, limit),
    db
      .prepare(
        `SELECT id, ledger_id, name, type, initial_balance, sort_order, created_at, updated_at, deleted_at, rev FROM accounts
         WHERE ledger_id IN (${MEMBER_LEDGERS}) AND rev > ?2 ORDER BY rev LIMIT ?3`,
      )
      .bind(user.id, cursor, limit),
    db
      .prepare(
        `SELECT id, ledger_id, name, kind, parent_id, icon, sort_order, created_at, updated_at, deleted_at, rev FROM categories
         WHERE ledger_id IN (${MEMBER_LEDGERS}) AND rev > ?2 ORDER BY rev LIMIT ?3`,
      )
      .bind(user.id, cursor, limit),
    db
      .prepare(
        `SELECT id, ledger_id, kind, amount, category_id, account_id, to_account_id, fee, date, merchant, note,
                created_at, updated_at, deleted_at, rev FROM transactions
         WHERE ledger_id IN (${MEMBER_LEDGERS}) AND rev > ?2 ORDER BY rev LIMIT ?3`,
      )
      .bind(user.id, cursor, limit),
  ]);

  const tables = {
    ledgers: (ledgers?.results ?? []) as WithRev<Ledger>[],
    accounts: (accounts?.results ?? []) as WithRev<Account>[],
    categories: (categories?.results ?? []) as WithRev<Category>[],
    transactions: (transactions?.results ?? []) as WithRev<Transaction>[],
  };

  // 某張表超過上限時，以「第一個被截斷的 rev」為界，這次只回傳比它小的。
  // 同一個 rev 最多 MAX_PUSH_ROWS(200) 筆 < PULL_LIMIT，所以一定有進度。
  let boundary = Infinity;
  for (const rows of Object.values(tables)) {
    if (rows.length > PULL_LIMIT) boundary = Math.min(boundary, rows[PULL_LIMIT]!.rev);
  }
  const hasMore = boundary !== Infinity;

  let maxRev = cursor;
  const keep = <T extends { rev: number }>(rows: T[]): Omit<T, "rev">[] =>
    rows
      .filter((r) => r.rev < boundary)
      .map(({ rev, ...rest }) => {
        if (rev > maxRev) maxRev = rev;
        return rest;
      });

  const changes = {
    ledgers: keep(tables.ledgers),
    accounts: keep(tables.accounts),
    categories: keep(tables.categories),
    transactions: keep(tables.transactions),
  };

  return {
    cursor: hasMore ? boundary - 1 : maxRev,
    hasMore,
    changes,
  };
}

// ── push ────────────────────────────────────────────────────────────────

export async function push(env: AppEnv, user: AuthUser, body: unknown): Promise<number> {
  const parsed = pushRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const { accounts, categories, transactions } = parsed.data;
  const total = accounts.length + categories.length + transactions.length;
  if (total === 0) return 0;

  // 只能寫入自己是 owner / editor 的帳本
  const writable = await env.DB.prepare(
    "SELECT ledger_id FROM ledger_members WHERE user_id = ? AND role IN ('owner', 'editor')",
  )
    .bind(user.id)
    .all<{ ledger_id: string }>();
  const allowed = new Set(writable.results.map((r) => r.ledger_id));
  for (const row of [...accounts, ...categories, ...transactions]) {
    if (!allowed.has(row.ledger_id)) throw new HttpError(403, `沒有寫入帳本 ${row.ledger_id} 的權限`);
  }

  // 手機時鐘若跑到未來，那筆資料之後就改不動了，所以夾在伺服器時間以內
  const now = Date.now();
  const clamp = (t: number) => Math.min(t, now);

  const db = env.DB;
  const statements: D1PreparedStatement[] = [db.prepare(BUMP_REV)];

  // 共同規則：同一個 id 只在「傳來的比較新」且「帳本相同」時才覆蓋。
  // 帳本相同的檢查，避免有人用別人資料的 id 把資料搬到自己的帳本。
  for (const a of accounts) {
    statements.push(
      db
        .prepare(
          `INSERT INTO accounts
             (id, ledger_id, name, type, sort_order, created_by, created_at, updated_at, deleted_at, initial_balance, rev)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, COALESCE(?10, 0), ${NEXT_REV})
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, type = excluded.type, sort_order = excluded.sort_order,
             initial_balance = COALESCE(?10, accounts.initial_balance),
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, rev = excluded.rev
           WHERE excluded.updated_at >= accounts.updated_at AND accounts.ledger_id = excluded.ledger_id`,
        )
        .bind(
          a.id,
          a.ledger_id,
          a.name,
          a.type,
          a.sort_order,
          user.id,
          a.created_at,
          clamp(a.updated_at),
          a.deleted_at,
          a.initial_balance ?? null,
        ),
    );
  }

  for (const c of categories) {
    statements.push(
      db
        .prepare(
          `INSERT INTO categories
             (id, ledger_id, name, kind, icon, sort_order, created_by, created_at, updated_at, deleted_at, parent_id, rev)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ${NEXT_REV})
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, kind = excluded.kind, icon = excluded.icon, sort_order = excluded.sort_order,
             parent_id = CASE WHEN ?12 THEN excluded.parent_id ELSE categories.parent_id END,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, rev = excluded.rev
           WHERE excluded.updated_at >= categories.updated_at AND categories.ledger_id = excluded.ledger_id`,
        )
        .bind(
          c.id,
          c.ledger_id,
          c.name,
          c.kind,
          c.icon,
          c.sort_order,
          user.id,
          c.created_at,
          clamp(c.updated_at),
          c.deleted_at,
          c.parent_id ?? null,
          // 舊版手機沒帶 parent_id（undefined）時保留原值；帶 null 表示「改成上層分類」
          c.parent_id === undefined ? 0 : 1,
        ),
    );
  }

  for (const t of transactions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO transactions
             (id, ledger_id, kind, amount, category_id, account_id, date, note, created_by, created_at, updated_at, deleted_at,
              to_account_id, fee, merchant, rev)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, COALESCE(?14, 0), COALESCE(?16, ''), ${NEXT_REV})
           ON CONFLICT(id) DO UPDATE SET
             kind = excluded.kind, amount = excluded.amount, category_id = excluded.category_id,
             account_id = excluded.account_id, date = excluded.date, note = excluded.note,
             to_account_id = CASE WHEN ?15 THEN excluded.to_account_id ELSE transactions.to_account_id END,
             fee = COALESCE(?14, transactions.fee),
             merchant = COALESCE(?16, transactions.merchant),
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, rev = excluded.rev
           WHERE excluded.updated_at >= transactions.updated_at AND transactions.ledger_id = excluded.ledger_id`,
        )
        .bind(
          t.id,
          t.ledger_id,
          t.kind,
          t.amount,
          t.category_id,
          t.account_id,
          t.date,
          t.note,
          user.id,
          t.created_at,
          clamp(t.updated_at),
          t.deleted_at,
          t.to_account_id ?? null,
          t.fee ?? null,
          // 舊版手機沒帶 to_account_id / fee / merchant 時保留原值
          t.to_account_id === undefined ? 0 : 1,
          t.merchant ?? null,
        ),
    );
  }

  await db.batch(statements);
  return total;
}

export type { PushRequest };
