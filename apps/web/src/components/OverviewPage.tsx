import { useState } from "react";
import type { TransactionKind } from "@accounting/shared";
import { categoryInfo, useCategories, useRangeTransactions } from "../lib/data";
import { formatMoney, type Period, periodNoun, periodRange } from "../lib/format";
import { Totals } from "./TransactionsPage";
import { AuthBanner, PeriodSwitcher, PeriodUnitBar, Segmented, SyncPill } from "./ui";

interface Row {
  id: string;
  icon: string;
  name: string;
  amount: number;
  count: number;
  /** 子分類的細項（直接記在上層分類的算「其他」） */
  subs: Map<string, { name: string; amount: number; count: number }>;
}

/**
 * 總覽（日／月／年）：收支統計 + 分類排行。
 * 分類排行用「由大到小的橫條」而不是圓餅圖：分類多的時候，
 * 同一條基準線上的長條比扇形更容易比較大小。
 */
export function OverviewPage({
  ledgerId,
  currency,
  period,
  onPeriodChange,
}: {
  ledgerId: string;
  currency: string;
  period: Period;
  onPeriodChange: (p: Period) => void;
}) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [start, end] = periodRange(period);
  const transactions = useRangeTransactions(ledgerId, start, end);
  const categories = useCategories(ledgerId);

  const catById = new Map((categories ?? []).map((c) => [c.id, c]));
  const rows = new Map<string, Row>();
  let total = 0;
  for (const t of transactions ?? []) {
    // 轉帳本身不算收支，手續費算一筆「轉帳手續費」支出
    if (t.kind === "transfer") {
      const fee = t.fee ?? 0;
      if (kind !== "expense" || fee === 0) continue;
      total += fee;
      const row = rows.get("_fee") ?? { id: "_fee", icon: "🏦", name: "轉帳手續費", amount: 0, count: 0, subs: new Map() };
      row.amount += fee;
      row.count += 1;
      row.subs.set("_self", { name: "其他", amount: row.amount, count: row.count });
      rows.set("_fee", row);
      continue;
    }
    if (t.kind !== kind) continue;
    total += t.amount;
    // 子分類併到上層分類統計
    const { top, sub } = categoryInfo(t.category_id, catById);
    const key = top?.id ?? "_none";
    const row = rows.get(key) ?? {
      id: key,
      icon: top?.icon || "•",
      name: top?.name ?? "未分類",
      amount: 0,
      count: 0,
      subs: new Map(),
    };
    row.amount += t.amount;
    row.count += 1;
    const subKey = sub?.id ?? "_self";
    const subRow = row.subs.get(subKey) ?? { name: sub?.name ?? "其他", amount: 0, count: 0 };
    subRow.amount += t.amount;
    subRow.count += 1;
    row.subs.set(subKey, subRow);
    rows.set(key, row);
  }
  const ranked = [...rows.values()].sort((a, b) => b.amount - a.amount);
  const max = ranked[0]?.amount ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <PeriodSwitcher period={period} onChange={onPeriodChange} />
        <SyncPill />
      </header>
      <PeriodUnitBar period={period} onChange={onPeriodChange} />
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
        <div className="empty">{periodNoun(period.unit)}沒有{kind === "expense" ? "支出" : "收入"}。</div>
      ) : (
        <div className="card rank-list" role="table" aria-label={`${kind === "expense" ? "支出" : "收入"}分類排行`}>
          {ranked.map((r) => {
            const pct = total > 0 ? (r.amount / total) * 100 : 0;
            // 只有「全部記在上層分類」時不用展開
            const hasSubs = r.subs.size > 1 || !r.subs.has("_self");
            const open = expanded === r.id && hasSubs;
            return (
              <div
                key={r.id}
                className={`rank-row${hasSubs ? " expandable" : ""}`}
                role="row"
                title={`${r.name}：${formatMoney(r.amount, currency)}，${r.count} 筆，佔 ${pct.toFixed(1)}%`}
                aria-expanded={hasSubs ? open : undefined}
                onClick={hasSubs ? () => setExpanded(open ? null : r.id) : undefined}
              >
                <div className="rank-top">
                  <span className="rank-name" role="cell">
                    <span aria-hidden>{r.icon} </span>
                    {r.name}
                    <span className="count">
                      {r.count} 筆{hasSubs && (open ? " ▴" : " ▾")}
                    </span>
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
                {open && (
                  <div className="rank-subs">
                    {[...r.subs.entries()]
                      .sort((a, b) => b[1].amount - a[1].amount)
                      .map(([key, sr]) => (
                        <div key={key} className="rank-sub" role="row">
                          <span className="rank-name" role="cell">
                            {sr.name}
                            <span className="count">{sr.count} 筆</span>
                          </span>
                          <span className="rank-amount" role="cell">
                            {formatMoney(sr.amount, currency)}
                          </span>
                          <span className="rank-pct" role="cell">
                            {r.amount > 0 ? Math.round((sr.amount / r.amount) * 100) : 0}%
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
