import type { Account, Category, Merchant, Transaction } from "@accounting/shared";
import {
  accountDelta,
  categoryInfo,
  expenseOf,
  incomeOf,
  useAccounts,
  useCategories,
  useMerchants,
  useMonthTransactions,
} from "../lib/data";
import { dayLabel, formatMoney } from "../lib/format";
import { AuthBanner, MonthSwitcher, SyncPill } from "./ui";

export function Totals({ transactions, currency }: { transactions: Transaction[]; currency: string }) {
  let expense = 0;
  let income = 0;
  // 轉帳只是錢換地方放，不算收支；手續費算支出
  for (const t of transactions) {
    expense += expenseOf(t);
    income += incomeOf(t);
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
  const merchants = useMerchants(ledgerId);

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
          merchantById={merchants?.byId}
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
              const sub = [acc?.name, merchant, t.note].filter(Boolean).join(" · ");
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
  const sub = [t.note, fee > 0 ? `手續費 ${formatMoney(fee, currency)}` : ""].filter(Boolean).join(" · ");
  // 帳戶明細頁：顯示這個帳戶的增減；一般明細：顯示轉帳金額（不算收支）
  const delta = accountId ? accountDelta(t, accountId) : null;
  return (
    <button className="tx-row" onClick={() => onEdit(t)}>
      <span className="tx-icon" aria-hidden>
        🔁
      </span>
      <span className="tx-main">
        <div className="tx-title">
          {from} → {to}
        </div>
        <div className="tx-sub">{sub || "轉帳"}</div>
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
