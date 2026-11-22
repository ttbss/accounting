-- 店家改成獨立清單：可以改名、刪除、單獨新增；記帳紀錄改存 merchant_id。
-- 0004 的 transactions.merchant（直接存名稱）轉成店家清單後刪掉。
CREATE TABLE merchants (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledgers(id),
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev        INTEGER NOT NULL
);
CREATE INDEX merchants_ledger_rev ON merchants(ledger_id, rev);

-- 不設外鍵，理由同 category_id：手機分批同步時順序不保證。
ALTER TABLE transactions ADD COLUMN merchant_id TEXT;

-- 把用過的店家名稱轉成店家清單（每本帳本每個名稱一筆），讓手機重新拉到這些變更
UPDATE counters SET value = value + 1 WHERE name = 'rev';

INSERT INTO merchants (id, ledger_id, name, created_by, created_at, updated_at, deleted_at, rev)
SELECT lower(hex(randomblob(16))), t.ledger_id, t.merchant, l.owner_id,
       CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER), NULL,
       (SELECT value FROM counters WHERE name = 'rev')
FROM (SELECT DISTINCT ledger_id, merchant FROM transactions WHERE merchant <> '') t
JOIN ledgers l ON l.id = t.ledger_id;

UPDATE transactions
SET merchant_id = (SELECT m.id FROM merchants m WHERE m.ledger_id = transactions.ledger_id AND m.name = transactions.merchant),
    updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
    rev = (SELECT value FROM counters WHERE name = 'rev')
WHERE merchant <> '';

ALTER TABLE transactions DROP COLUMN merchant;
