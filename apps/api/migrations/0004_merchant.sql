-- 店家（選填，收支才有）。直接存名稱；「店家清單」就是用過的名稱，依最近使用排序。
ALTER TABLE transactions ADD COLUMN merchant TEXT NOT NULL DEFAULT '';
