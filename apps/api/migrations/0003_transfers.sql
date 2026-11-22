-- 轉帳：kind = 'transfer'，account_id = 轉出帳戶，to_account_id = 轉入帳戶。
-- amount 是轉入帳戶收到的金額；fee 是手續費，從轉出帳戶扣
-- （轉出帳戶共減少 amount + fee）。轉帳沒有分類。
--
-- SQLite 不能修改 CHECK 條件，所以重建 transactions 表。
-- 沒有其他表參照 transactions，可以直接換掉。
CREATE TABLE transactions_new (
  id            TEXT PRIMARY KEY,
  ledger_id     TEXT NOT NULL REFERENCES ledgers(id),
  kind          TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  category_id   TEXT,
  account_id    TEXT,
  to_account_id TEXT,
  fee           INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  date          TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  rev           INTEGER NOT NULL
);

INSERT INTO transactions_new
  (id, ledger_id, kind, amount, category_id, account_id, to_account_id, fee, date, note,
   created_by, created_at, updated_at, deleted_at, rev)
SELECT id, ledger_id, kind, amount, category_id, account_id, NULL, 0, date, note,
       created_by, created_at, updated_at, deleted_at, rev
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX transactions_ledger_rev ON transactions(ledger_id, rev);
CREATE INDEX transactions_ledger_date ON transactions(ledger_id, date);
