-- 子分類：parent_id 指向上層分類（只有一層）。NULL = 上層分類。
-- 不設外鍵，理由同 transactions：手機分批同步時順序不保證。
ALTER TABLE categories ADD COLUMN parent_id TEXT;

-- 帳戶初始金額（最小單位 ×100，可以是負數，例如信用卡欠款）
ALTER TABLE accounts ADD COLUMN initial_balance INTEGER NOT NULL DEFAULT 0;

-- 幫既有帳本的「餐飲」加上預設子分類（沒有子分類的才加）。
-- id 由上層分類 id 推算，重跑也不會重複。
UPDATE counters SET value = value + 1 WHERE name = 'rev';

INSERT OR IGNORE INTO categories
  (id, ledger_id, name, kind, icon, sort_order, created_by, created_at, updated_at, deleted_at, rev, parent_id)
SELECT c.id || '-sub-' || s.n, c.ledger_id, s.name, 'expense', '', s.ord,
       l.owner_id, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER), NULL,
       (SELECT value FROM counters WHERE name = 'rev'), c.id
FROM categories c
JOIN ledgers l ON l.id = c.ledger_id
CROSS JOIN (
  SELECT '01' AS n, '早餐' AS name, 0 AS ord
  UNION ALL SELECT '02', '午餐', 1
  UNION ALL SELECT '03', '晚餐', 2
  UNION ALL SELECT '04', '點心零嘴', 3
) s
WHERE c.name = '餐飲' AND c.kind = 'expense' AND c.deleted_at IS NULL AND c.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.parent_id = c.id);
