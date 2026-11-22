-- 記帳時間（當地時間 HH:MM，選填）。舊紀錄沒有時間，保持 NULL。
ALTER TABLE transactions ADD COLUMN time TEXT;
