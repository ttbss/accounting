import { categoryInfo, newestFirst } from "./data";
import { db } from "./db";
import { todayStr } from "./format";

/** 匯出整本帳本的記帳紀錄成 CSV（Excel 開得了中文：加 UTF-8 BOM） */
export async function exportCsv(ledgerId: string): Promise<{ count: number }> {
  const [transactions, categories, accounts, merchants] = await Promise.all([
    db.transactions.where("ledger_id").equals(ledgerId).toArray(),
    db.categories.where("ledger_id").equals(ledgerId).toArray(),
    db.accounts.where("ledger_id").equals(ledgerId).toArray(),
    db.merchants.where("ledger_id").equals(ledgerId).toArray(),
  ]);
  const merchantName = new Map(merchants.map((m) => [m.id, m.name]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));

  const rows = transactions
    .filter((t) => t.deleted_at === null)
    .sort((a, b) => newestFirst(b, a))
    .map((t) => {
      const transfer = t.kind === "transfer";
      const cat = categoryInfo(t.category_id, catById);
      return [
        t.date,
        t.time ?? "",
        transfer ? "轉帳" : t.kind === "expense" ? "支出" : "收入",
        (t.amount / 100).toFixed(2),
        transfer ? "" : (cat.top?.name ?? "未分類"),
        transfer ? "" : (cat.sub?.name ?? ""),
        (t.account_id && accName.get(t.account_id)) || "",
        (t.to_account_id && accName.get(t.to_account_id)) || "",
        t.fee ? (t.fee / 100).toFixed(2) : "",
        (t.merchant_id && merchantName.get(t.merchant_id)) || "",
        t.note,
      ];
    });

  // 轉帳：「帳戶」是轉出帳戶，手續費從轉出帳戶扣
  const header = ["日期", "時間", "類型", "金額", "分類", "子分類", "帳戶", "轉入帳戶", "手續費", "店家", "備註"];
  const csv = [header, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n");
  const file = new File(["﻿" + csv], `記帳-${todayStr()}.csv`, { type: "text/csv;charset=utf-8" });

  // 手機上優先用系統分享（可以直接存到檔案、傳給自己）；不支援就直接下載
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return { count: rows.length };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return { count: rows.length };
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { count: rows.length };
}

function escapeCell(value: string): string {
  // 開頭是 = + - @ 的字串，Excel 會當公式執行，前面加 ' 避免
  const safe = /^[=+\-@]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
