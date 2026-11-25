import { useLayoutEffect } from "react";
import type { Account, Category, Merchant, Transaction } from "@accounting/shared";
import {
  accountDelta,
  categoryInfo,
  expenseOf,
  incomeOf,
  useAccounts,
  useCategories,
  useMerchants,
  useRangeTransactions,
} from "../lib/data";
import { dayLabel, formatMoney, monthLabel, type Period, periodNoun, periodRange, isLatestPeriod, shiftPeriod } from "../lib/format";
import { useSwipeNav } from "../lib/swipe";
import { AuthBanner, PeriodSwitcher, PeriodUnitBar, SyncPill, tintOf } from "./ui";

export function Totals({ transactions, currency }: { transactions: Transaction[]; currency: string }) {
  let expense = 0;
  let income = 0;
  // 轉帳只是錢換地方放，不算收支；手續費算支出
  for (const t of transactions) {
    expense += expenseOf(t);
    income += incomeOf(t);
  }
  const net = income - expense;
  return (
    <div className="summary">
      <div className="summary-label">總支出</div>
      <div className="summary-value" title={formatMoney(expense, currency)}>
        {formatMoney(expense, currency, true)}
      </div>
      <div className="summary-stats">
        <div className="summary-stat">
          <span>收入</span>
          <b className="income" title={formatMoney(income, currency)}>
            {formatMoney(income, currency, true)}
          </b>
        </div>
        <div className="summary-stat">
          <span>結餘</span>
          <b className={net < 0 ? "negative" : undefined} title={formatMoney(net, currency)}>
            {formatMoney(net, currency, true)}
          </b>
        </div>
      </div>
    </div>
  );
}

export function TransactionsPage({
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
  const [start, end] = periodRange(period);
  const transactions = useRangeTransactions(ledgerId, start, end);
  // 左右滑動換到上一個／下一個期間
  const { contentRef, swipeHandlers, contentReady } = useSwipeNav(
    () => onPeriodChange(shiftPeriod(period, -1)),
    isLatestPeriod(period) ? null : () => onPeriodChange(shiftPeriod(period, 1)),
  );
  // 新期間的資料畫好了才讓內容滑進來（不然會先看到舊資料一下）
  useLayoutEffect(() => contentReady(), [transactions]);
  const categories = useCategories(ledgerId);
  const accounts = useAccounts(ledgerId);
  const merchants = useMerchants(ledgerId);

  return (
    <div className="page swipe-page" {...swipeHandlers}>
      <header className="page-header">
        <PeriodSwitcher period={period} onChange={onPeriodChange} />
        <SyncPill />
      </header>
      <PeriodUnitBar period={period} onChange={onPeriodChange} />
      <AuthBanner />
      <div ref={contentRef}>
        {transactions && <Totals transactions={transactions} currency={currency} />}

        {transactions && transactions.length === 0 && (
          <div className="empty">
            <div className="empty-icon" aria-hidden>
              🧾
            </div>
            <div className="empty-title">{periodNoun(period.unit)}還沒有記帳</div>
            點右下角的 ＋ 記第一筆。
          </div>
        )}

        {transactions &&
          // 看整年的時候先分月份，比較好找
          (period.unit === "year" ? byMonth(transactions) : [["", transactions] as const]).map(([month, list]) => (
            <section key={month}>
              {month && (
                <div className="section-title month-title">
                  <span>{monthLabel(month)}</span>
                  <span>{formatMoney(list.reduce((s, t) => s + incomeOf(t) - expenseOf(t), 0), currency)}</span>
                </div>
              )}
              <TransactionGroups
                transactions={list}
                categories={categories}
                accounts={accounts}
                merchantById={merchants?.byId}
                currency={currency}
                onEdit={onEdit}
              />
            </section>
          ))}
      </div>
    </div>
  );
}

/** 依月份分段（保持原本的順序） */
export function byMonth(transactions: Transaction[]): [string, Transaction[]][] {
  const months = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const m = t.date.slice(0, 7);
    const list = months.get(m) ?? [];
    list.push(t);
    months.set(m, list);
  }
  return [...months.entries()];
}

/** 依日期分組的記帳清單（明細頁、帳戶明細頁共用） */
export function TransactionGroups({
  transactions,
  categories,
  accounts,
  currency,
  onEdit,
  accountId,
  merchantById,
  hideMerchant = false,
}: {
  transactions: Transaction[];
  categories: Category[] | undefined;
  accounts: Account[] | undefined;
  /** 用來顯示店家名稱（含已刪除的店家） */
  merchantById?: Map<string, Merchant>;
  /** 店家明細頁不用每筆都寫店家名稱 */
  hideMerchant?: boolean;
  currency: string;
  onEdit: (t: Transaction) => void;
  /** 帳戶明細頁：金額改成「對這個帳戶的增減」，也不用每筆都寫帳戶名稱 */
  accountId?: string;
}) {
  const catById = new Map<string, Category>((categories ?? []).map((c) => [c.id, c]));
  const accById = new Map<string, Account>((accounts ?? []).map((a) => [a.id, a]));

  const days = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const list = days.get(t.date) ?? [];
    list.push(t);
    days.set(t.date, list);
  }

  return (
    <>
      {[...days.entries()].map(([date, list]) => {
        const net = list.reduce(
          (s, t) => s + (accountId ? accountDelta(t, accountId) : incomeOf(t) - expenseOf(t)),
          0,
        );
        return (
          <section key={date} className="card day-group">
            <div className="day-head">
              <span>{dayLabel(date)}</span>
              <span>{formatMoney(net, currency)}</span>
            </div>
            {list.map((t) => {
              if (t.kind === "transfer") {
                return (
                  <TransferRow
                    key={t.id}
                    t={t}
                    accById={accById}
                    currency={currency}
                    accountId={accountId}
                    onEdit={onEdit}
                  />
                );
              }
              const cat = categoryInfo(t.category_id, catById);
              const acc = !accountId && t.account_id ? accById.get(t.account_id) : undefined;
              const merchant = !hideMerchant && t.merchant_id ? merchantById?.get(t.merchant_id)?.name : undefined;
              const sub = [t.time, acc?.name, merchant, t.note].filter(Boolean).join(" · ");
              return (
                <button key={t.id} className="tx-row" onClick={() => onEdit(t)}>
                  <span className="tx-icon" data-tint={tintOf(cat.top?.id)} aria-hidden>
                    {cat.icon}
                  </span>
                  <span className="tx-main">
                    <div className="tx-title">{cat.label}</div>
                    {sub && <div className="tx-sub">{sub}</div>}
                  </span>
                  <span className={`tx-amount${t.kind === "income" ? " income" : ""}`}>
                    {t.kind === "income" ? "+" : "−"}
                    {formatMoney(t.amount, currency)}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

function TransferRow({
  t,
  accById,
  currency,
  accountId,
  onEdit,
}: {
  t: Transaction;
  accById: Map<string, Account>;
  currency: string;
  accountId?: string;
  onEdit: (t: Transaction) => void;
}) {
  const from = (t.account_id && accById.get(t.account_id)?.name) || "?";
  const to = (t.to_account_id && accById.get(t.to_account_id)?.name) || "?";
  const fee = t.fee ?? 0;
  const sub = [t.time, t.note || (fee > 0 ? "" : "轉帳"), fee > 0 ? `手續費 ${formatMoney(fee, currency)}` : ""]
    .filter(Boolean)
    .join(" · ");
  // 帳戶明細頁：顯示這個帳戶的增減；一般明細：顯示轉帳金額（不算收支）
  const delta = accountId ? accountDelta(t, accountId) : null;
  return (
    <button className="tx-row" onClick={() => onEdit(t)}>
      <span className="tx-icon" data-tint="1" aria-hidden>
        🔁
      </span>
      <span className="tx-main">
        <div className="tx-title">
          {from} → {to}
        </div>
        <div className="tx-sub">{sub}</div>
      </span>
      {delta === null ? (
        <span className="tx-amount transfer">{formatMoney(t.amount, currency)}</span>
      ) : (
        <span className={`tx-amount${delta > 0 ? " income" : ""}`}>
          {delta > 0 ? "+" : "−"}
          {formatMoney(Math.abs(delta), currency)}
        </span>
      )}
    </button>
  );
}
