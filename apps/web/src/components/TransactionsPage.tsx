import type { Account, Category, Transaction } from "@accounting/shared";
import { categoryInfo, useAccounts, useCategories, useMonthTransactions } from "../lib/data";
import { dayLabel, formatMoney } from "../lib/format";
import { AuthBanner, MonthSwitcher, SyncPill } from "./ui";

export function Totals({ transactions, currency }: { transactions: Transaction[]; currency: string }) {
  let expense = 0;
  let income = 0;
  for (const t of transactions) {
    if (t.kind === "expense") expense += t.amount;
    else income += t.amount;
  }
  return (
    <div className="card kpi-row">
      <div className="kpi">
        <div className="kpi-label">支出</div>
        <div className="kpi-value" title={formatMoney(expense, currency)}>
          {formatMoney(expense, currency, true)}
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-label">收入</div>
        <div className="kpi-value income" title={formatMoney(income, currency)}>
          {formatMoney(income, currency, true)}
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-label">結餘</div>
        <div className="kpi-value" title={formatMoney(income - expense, currency)}>
          {formatMoney(income - expense, currency, true)}
        </div>
      </div>
    </div>
  );
}

export function TransactionsPage({
  ledgerId,
  currency,
  month,
  onMonthChange,
  onEdit,
}: {
  ledgerId: string;
  currency: string;
  month: string;
  onMonthChange: (m: string) => void;
  onEdit: (t: Transaction) => void;
}) {
  const transactions = useMonthTransactions(ledgerId, month);
  const categories = useCategories(ledgerId);
  const accounts = useAccounts(ledgerId);

  return (
    <div className="page">
      <header className="page-header">
        <MonthSwitcher month={month} onChange={onMonthChange} />
        <SyncPill />
      </header>
      <AuthBanner />

      {transactions && <Totals transactions={transactions} currency={currency} />}

      {transactions && transactions.length === 0 && (
        <div className="empty">
          <div className="big">🧾</div>
          這個月還沒有記帳。
          <br />
          點右下角的 ＋ 記第一筆。
        </div>
      )}

      {transactions && (
        <TransactionGroups
          transactions={transactions}
          categories={categories}
          accounts={accounts}
          currency={currency}
          onEdit={onEdit}
        />
      )}
    </div>
  );
}

/** 依日期分組的記帳清單（明細頁、帳戶明細頁共用） */
export function TransactionGroups({
  transactions,
  categories,
  accounts,
  currency,
  onEdit,
  hideAccount = false,
}: {
  transactions: Transaction[];
  categories: Category[] | undefined;
  accounts: Account[] | undefined;
  currency: string;
  onEdit: (t: Transaction) => void;
  /** 帳戶明細頁不用每筆都寫帳戶名稱 */
  hideAccount?: boolean;
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
        const net = list.reduce((s, t) => s + (t.kind === "income" ? t.amount : -t.amount), 0);
        return (
          <section key={date} className="card day-group">
            <div className="day-head">
              <span>{dayLabel(date)}</span>
              <span>{formatMoney(net, currency)}</span>
            </div>
            {list.map((t) => {
              const cat = categoryInfo(t.category_id, catById);
              const acc = !hideAccount && t.account_id ? accById.get(t.account_id) : undefined;
              const sub = [acc?.name, t.note].filter(Boolean).join(" · ");
              return (
                <button key={t.id} className="tx-row" onClick={() => onEdit(t)}>
                  <span className="tx-icon" aria-hidden>
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
