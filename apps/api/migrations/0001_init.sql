-- 同步用的全域版本號。每次寫入都 +1，手機用它來問「上次之後有什麼變更」。
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('rev', 0);

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

-- 帳本。第一版每人只有一本；之後和家人共用時，多個成員共用同一本。
CREATE TABLE ledgers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'TWD',
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev        INTEGER NOT NULL
);
CREATE INDEX ledgers_rev ON ledgers(rev);

CREATE TABLE ledger_members (
  ledger_id  TEXT NOT NULL REFERENCES ledgers(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (ledger_id, user_id)
);
CREATE INDEX ledger_members_user ON ledger_members(user_id);

CREATE TABLE accounts (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledgers(id),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'credit_card', 'e_wallet', 'other')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev        INTEGER NOT NULL
);
CREATE INDEX accounts_ledger_rev ON accounts(ledger_id, rev);

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledgers(id),
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  icon       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev        INTEGER NOT NULL
);
CREATE INDEX categories_ledger_rev ON categories(ledger_id, rev);

-- 金額 amount：整數，最小單位 ×100（NT$12.50 → 1250）
-- category_id / account_id 不設外鍵：手機可能分批同步，順序不保證。
CREATE TABLE transactions (
  id          TEXT PRIMARY KEY,
  ledger_id   TEXT NOT NULL REFERENCES ledgers(id),
  kind        TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  category_id TEXT,
  account_id  TEXT,
  date        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  rev         INTEGER NOT NULL
);
CREATE INDEX transactions_ledger_rev ON transactions(ledger_id, rev);
CREATE INDEX transactions_ledger_date ON transactions(ledger_id, date);
