import { useState } from "react";
import type { TransactionKind } from "@accounting/shared";
import { useCategories, useMonthTransactions } from "../lib/data";
import { formatMoney } from "../lib/format";
import { Totals } from "./TransactionsPage";
import { AuthBanner, MonthSwitcher, Segmented, SyncPill } from "./ui";

interface Row {
  id: string;
  icon: string;
  name: string;
  amount: number;
  count: number;
}

/**
 * 每月總覽：收支統計 + 分類排行。
 * 分類排行用「由大到小的橫條」而不是圓餅圖：分類多的時候，
 * 同一條基準線上的長條比扇形更容易比較大小。
 */
export function OverviewPage({
  ledgerId,
  currency,
  month,
  onMonthChange,
}: {
  ledgerId: string;
  currency: string;
  month: string;
  onMonthChange: (m: string) => void;
}) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const transactions = useMonthTransactions(ledgerId, month);
  const categories = useCategories(ledgerId);

  const catById = new Map((categories ?? []).map((c) => [c.id, c]));
  const rows = new Map<string, Row>();
  let total = 0;
  for (const t of transactions ?? []) {
    if (t.kind !== kind) continue;
    total += t.amount;
    const cat = t.category_id ? catById.get(t.category_id) : undefined;
    const key = cat?.id ?? "_none";
    const row = rows.get(key) ?? { id: key, icon: cat?.icon || "•", name: cat?.name ?? "未分類", amount: 0, count: 0 };
    row.amount += t.amount;
    row.count += 1;
    rows.set(key, row);
  }
  const ranked = [...rows.values()].sort((a, b) => b.amount - a.amount);
  const max = ranked[0]?.amount ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <MonthSwitcher month={month} onChange={onMonthChange} />
        <SyncPill />
      </header>
      <AuthBanner />

      {transactions && <Totals transactions={transactions} currency={currency} />}

      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "expense", label: "支出分類" },
          { value: "income", label: "收入分類" },
        ]}
      />

      {ranked.length === 0 ? (
        <div className="empty">這個月沒有{kind === "expense" ? "支出" : "收入"}。</div>
      ) : (
        <div className="card rank-list" role="table" aria-label={`${kind === "expense" ? "支出" : "收入"}分類排行`}>
          {ranked.map((r) => {
            const pct = total > 0 ? (r.amount / total) * 100 : 0;
            return (
              <div
                key={r.id}
                className="rank-row"
                role="row"
                title={`${r.name}：${formatMoney(r.amount, currency)}，${r.count} 筆，佔 ${pct.toFixed(1)}%`}
              >
                <div className="rank-top">
                  <span className="rank-name" role="cell">
                    <span aria-hidden>{r.icon} </span>
                    {r.name}
                    <span className="count">{r.count} 筆</span>
                  </span>
                  <span className="rank-amount" role="cell">
                    {formatMoney(r.amount, currency)}
                  </span>
                  <span className="rank-pct" role="cell">
                    {pct < 1 ? "<1" : Math.round(pct)}%
                  </span>
                </div>
                <div className="rank-bar" aria-hidden>
                  <div style={{ width: `${max > 0 ? (r.amount / max) * 100 : 0}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
