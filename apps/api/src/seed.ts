import type { AppEnv, AuthUser } from "./env";

const NEXT_REV = "(SELECT value FROM counters WHERE name = 'rev')";
const BUMP_REV = "UPDATE counters SET value = value + 1 WHERE name = 'rev'";

const DEFAULT_EXPENSE_CATEGORIES: [string, string][] = [
  ["🍱", "餐飲"],
  ["🚌", "交通"],
  ["🛍️", "購物"],
  ["🏠", "居住"],
  ["💡", "水電網路"],
  ["🎮", "娛樂"],
  ["🏥", "醫療"],
  ["📚", "學習"],
  ["🎁", "人情"],
  ["📦", "其他"],
];

const DEFAULT_INCOME_CATEGORIES: [string, string][] = [
  ["💼", "薪資"],
  ["🎉", "獎金"],
  ["📈", "投資"],
  ["💰", "其他收入"],
];

const DEFAULT_SUBCATEGORIES: Record<string, string[]> = {
  餐飲: ["早餐", "午餐", "晚餐", "點心零嘴"],
};

const DEFAULT_ACCOUNTS: [string, string][] = [
  ["現金", "cash"],
  ["銀行帳戶", "bank"],
  ["信用卡", "credit_card"],
];

/** 依 email 找到使用者，第一次登入時建立。 */
export async function ensureUser(env: AppEnv, email: string): Promise<AuthUser> {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), email, Date.now())
    .run();
  const row = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first<AuthUser>();
  if (!row) throw new Error("無法建立使用者");
  return row;
}

/**
 * 確保使用者至少有一本帳本（含預設分類與帳戶）。
 * 所有 id 都是由使用者 id 推算出來的固定值，加上 INSERT OR IGNORE，
 * 所以同時被呼叫好幾次也只會建立一份。
 */
export async function ensureDefaultLedger(env: AppEnv, user: AuthUser): Promise<string> {
  const existing = await env.DB.prepare(
    "SELECT ledger_id FROM ledger_members WHERE user_id = ? ORDER BY created_at LIMIT 1",
  )
    .bind(user.id)
    .first<{ ledger_id: string }>();
  if (existing) return existing.ledger_id;

  const ledgerId = `${user.id}-default`;
  const now = Date.now();
  const db = env.DB;
  const statements: D1PreparedStatement[] = [
    db.prepare(BUMP_REV),
    db
      .prepare(
        `INSERT OR IGNORE INTO ledgers (id, name, currency, owner_id, created_at, updated_at, deleted_at, rev)
         VALUES (?, ?, 'TWD', ?, ?, ?, NULL, ${NEXT_REV})`,
      )
      .bind(ledgerId, "我的帳本", user.id, now, now),
    db
      .prepare(
        "INSERT OR IGNORE INTO ledger_members (ledger_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      )
      .bind(ledgerId, user.id, now),
  ];

  const categories = [
    ...DEFAULT_EXPENSE_CATEGORIES.map(([icon, name]) => ({ icon, name, kind: "expense" })),
    ...DEFAULT_INCOME_CATEGORIES.map(([icon, name]) => ({ icon, name, kind: "income" })),
  ];
  categories.forEach((c, i) => {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO categories
             (id, ledger_id, name, kind, icon, sort_order, created_by, created_at, updated_at, deleted_at, rev)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ${NEXT_REV})`,
        )
        .bind(`${ledgerId}-cat-${String(i + 1).padStart(2, "0")}`, ledgerId, c.name, c.kind, c.icon, i, user.id, now, now),
    );
  });

  // 預設子分類：id 由上層分類 id 推算（和 migration 0002 的規則相同）
  categories.forEach((c, i) => {
    const parentId = `${ledgerId}-cat-${String(i + 1).padStart(2, "0")}`;
    (DEFAULT_SUBCATEGORIES[c.name] ?? []).forEach((name, j) => {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO categories
               (id, ledger_id, name, kind, icon, sort_order, created_by, created_at, updated_at, deleted_at, parent_id, rev)
             VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, NULL, ?, ${NEXT_REV})`,
          )
          .bind(`${parentId}-sub-${String(j + 1).padStart(2, "0")}`, ledgerId, name, c.kind, j, user.id, now, now, parentId),
      );
    });
  });

  DEFAULT_ACCOUNTS.forEach(([name, type], i) => {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO accounts
             (id, ledger_id, name, type, sort_order, created_by, created_at, updated_at, deleted_at, rev)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ${NEXT_REV})`,
        )
        .bind(`${ledgerId}-acc-${String(i + 1).padStart(2, "0")}`, ledgerId, name, type, i, user.id, now, now),
    );
  });

  await db.batch(statements);
  return ledgerId;
}
