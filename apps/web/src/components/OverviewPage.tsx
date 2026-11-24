import { useState, useLayoutEffect, useEffect } from "react";
import type { Account, Transaction, TransactionKind } from "@accounting/shared";
import { categoryInfo, useAccounts, useCategories, useMerchants, useRangeTransactions } from "../lib/data";
import { useBackLayer } from "../lib/back";
import {
  formatMoney,
  type Period,
  periodNoun,
  periodRange,
  isCurrentPeriod,
  isLatestPeriod,
  shiftPeriod,
  todayStr,
} from "../lib/format";
import { Totals } from "./TransactionsPage";
import { useSwipeNav } from "../lib/swipe";
import { AuthBanner, PeriodSwitcher, PeriodUnitBar, Segmented, SyncPill } from "./ui";

interface Group {
  name: string;
  amount: number;
  /** 新到舊 */
  items: Transaction[];
}

interface Row {
  id: string;
  icon: string;
  name: string;
  amount: number;
  count: number;
  /** 依子分類分組（直接記在上層分類的算「其他」，key 是 _self） */
  subs: Map<string, Group>;
}

/** 轉帳手續費那一列，每筆算的是手續費而不是轉帳金額 */
const FEE_ROW = "_fee";

/**
 * 總覽（月／年）：收支統計 + 分類排行，點分類可以看這段期間的每一筆。
 * 分類排行用「由大到小的橫條」而不是圓餅圖：分類多的時候，
 * 同一條基準線上的長條比扇形更容易比較大小。
 */
export function OverviewPage({
  ledgerId,
  currency,
  period,
  onPeriodChange,
  onEdit,
}: {
  ledgerId: string;
  currency: string;
  period: Period;
  onPeriodChange: (p: Period) => void;
  onEdit: (t: Transaction) => void;
}) {
  // 總覽沒有「日」：明細在看某一天時，這裡看那一天所在的月份。
  // 在這裡換月份時，明細那邊仍維持「日」，停在新月份的第一天（本月就是今天）。
  const view: Period = period.unit === "day" ? { unit: "month", anchor: period.anchor } : period;
  const changeView = (p: Period) => {
    if (period.unit !== "day" || p.unit !== "month") return onPeriodChange(p);
    if (periodRange(p)[0] === periodRange(view)[0] && p.anchor !== todayStr()) return; // 同一個月：不動明細停的那天
    onPeriodChange({ unit: "day", anchor: isCurrentPeriod(p) ? todayStr() : p.anchor });
  };

  const [kind, setKindState] = useState<TransactionKind>("expense");
  const [expanded, setExpanded] = useState<string | null>(null);
  const setKind = (k: TransactionKind) => {
    setKindState(k);
    setExpanded(null);
  };
  // 手機按返回：先收起展開的分類明細
  useBackLayer(expanded !== null, () => setExpanded(null));

  const [start, end] = periodRange(view);
  const transactions = useRangeTransactions(ledgerId, start, end);
  // 左右滑動換到上一個／下一個期間
  const { contentRef, swipeHandlers, contentReady } = useSwipeNav(
    () => changeView(shiftPeriod(view, -1)),
    isLatestPeriod(view) ? null : () => changeView(shiftPeriod(view, 1)),
  );
  // 新期間的資料畫好了才讓內容滑進來（不然會先看到舊資料一下）
  useLayoutEffect(() => contentReady(), [transactions]);
  const categories = useCategories(ledgerId);
  const accounts = useAccounts(ledgerId);
  const merchants = useMerchants(ledgerId);

  const catById = new Map((categories ?? []).map((c) => [c.id, c]));
  const rows = new Map<string, Row>();
  let total = 0;
  const add = (key: string, init: () => Omit<Row, "amount" | "count" | "subs">, subKey: string, subName: string, t: Transaction, amount: number) => {
    const row = rows.get(key) ?? { ...init(), amount: 0, count: 0, subs: new Map<string, Group>() };
    row.amount += amount;
    row.count += 1;
    const group = row.subs.get(subKey) ?? { name: subName, amount: 0, items: [] };
    group.amount += amount;
    group.items.push(t);
    row.subs.set(subKey, group);
    rows.set(key, row);
    total += amount;
  };
  for (const t of transactions ?? []) {
    // 轉帳本身不算收支，手續費算一筆「轉帳手續費」支出
    if (t.kind === "transfer") {
      const fee = t.fee ?? 0;
      if (kind !== "expense" || fee === 0) continue;
      add(FEE_ROW, () => ({ id: FEE_ROW, icon: "🏦", name: "轉帳手續費" }), "_self", "其他", t, fee);
      continue;
    }
    if (t.kind !== kind) continue;
    // 子分類併到上層分類統計
    const { top, sub } = categoryInfo(t.category_id, catById);
    const key = top?.id ?? "_none";
    add(
      key,
      () => ({ id: key, icon: top?.icon || "•", name: top?.name ?? "未分類" }),
      sub?.id ?? "_self",
      sub?.name ?? "其他",
      t,
      t.amount,
    );
  }
  const ranked = [...rows.values()].sort((a, b) => b.amount - a.amount);
  const max = ranked[0]?.amount ?? 0;

  // 換期間後這個分類沒有紀錄了，就收起來（返回鍵那一格也一起退掉）
  const openMissing = transactions !== undefined && expanded !== null && !rows.has(expanded);
  useEffect(() => {
    if (openMissing) setExpanded(null);
  }, [openMissing]);

  const accById = new Map<string, Account>((accounts ?? []).map((a) => [a.id, a]));
  const kindName = kind === "expense" ? "支出" : "收入";

  return (
    <div className="page swipe-page" {...swipeHandlers}>
      <header className="page-header">
        <PeriodSwitcher period={view} onChange={changeView} />
        <SyncPill />
      </header>
      <PeriodUnitBar period={view} onChange={changeView} units={["month", "year"]} />
      <AuthBanner />
      <div ref={contentRef}>
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
          <div className="empty">
            {periodNoun(view.unit)}沒有{kindName}。
          </div>
        ) : (
          <div className="card rank-list" role="list" aria-label={`${kindName}分類排行`}>
            {ranked.map((r) => {
              const pct = total > 0 ? (r.amount / total) * 100 : 0;
              const open = expanded === r.id;
              const groups = [...r.subs.entries()].sort((a, b) => b[1].amount - a[1].amount);
              // 全部都記在上層分類時，不用再分組
              const flat = groups.length === 1 && groups[0]![0] === "_self";
              return (
                <div key={r.id} className="rank-row" role="listitem">
                  <button
                    type="button"
                    className="rank-toggle"
                    aria-expanded={open}
                    title={`${r.name}：${formatMoney(r.amount, currency)}，${r.count} 筆，佔 ${pct.toFixed(1)}%`}
                    onClick={() => setExpanded(open ? null : r.id)}
                  >
                    <div className="rank-top">
                      <span className="rank-name">
                        <span aria-hidden>{r.icon} </span>
                        {r.name}
                        <span className="count">
                          {r.count} 筆{open ? " ▴" : " ▾"}
                        </span>
                      </span>
                      <span className="rank-amount">{formatMoney(r.amount, currency)}</span>
                      <span className="rank-pct">{pct < 1 ? "<1" : Math.round(pct)}%</span>
                    </div>
                    <div className="rank-bar" aria-hidden>
                      <div style={{ width: `${max > 0 ? (r.amount / max) * 100 : 0}%` }} />
                    </div>
                  </button>
                  {open && (
                    <div className="rank-detail">
                      {groups.map(([key, g]) => (
                        <section key={key} className="rank-group" aria-label={flat ? undefined : g.name}>
                          {!flat && (
                            <div className="rank-group-head">
                              <span className="rank-name">
                                {g.name}
                                <span className="count">{g.items.length} 筆</span>
                              </span>
                              <span className="rank-amount">{formatMoney(g.amount, currency)}</span>
                              <span className="rank-pct">
                                {r.amount > 0 ? Math.round((g.amount / r.amount) * 100) : 0}%
                              </span>
                            </div>
                          )}
                          {g.items.map((t) => (
                            <RecordRow
                              key={t.id}
                              t={t}
                              amount={r.id === FEE_ROW ? (t.fee ?? 0) : t.amount}
                              accById={accById}
                              merchantName={t.merchant_id ? merchants?.byId.get(t.merchant_id)?.name : undefined}
                              currency={currency}
                              onEdit={onEdit}
                            />
                          ))}
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 分類明細裡的一筆：日期｜店家・備註／時間・帳戶｜金額 */
function RecordRow({
  t,
  amount,
  accById,
  merchantName,
  currency,
  onEdit,
}: {
  t: Transaction;
  amount: number;
  accById: Map<string, Account>;
  merchantName?: string;
  currency: string;
  onEdit: (t: Transaction) => void;
}) {
  const [y, m, d] = t.date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const accName = (id: string | null | undefined) => (id && accById.get(id)?.name) || "?";
  const title =
    t.kind === "transfer"
      ? `${accName(t.account_id)} → ${accName(t.to_account_id)}`
      : [merchantName, t.note].filter(Boolean).join(" · ");
  const sub = [t.time, t.kind === "transfer" ? t.note : t.account_id ? accName(t.account_id) : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" className="rank-tx" onClick={() => onEdit(t)}>
      <span className="rank-tx-date">
        {m}/{d}
        <small>週{weekday}</small>
      </span>
      <span className="rank-tx-main">
        <span className={`rank-tx-title${title ? "" : " none"}`}>{title || "沒有備註"}</span>
        {sub && <span className="rank-tx-sub">{sub}</span>}
      </span>
      <span className={`rank-tx-amount${t.kind === "income" ? " income" : ""}`}>{formatMoney(amount, currency)}</span>
    </button>
  );
}
