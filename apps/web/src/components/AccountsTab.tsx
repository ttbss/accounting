import { useState } from "react";
import type { Account, Transaction } from "@accounting/shared";
import {
  accountDelta,
  useAccountBalances,
  useAccountTransactions,
  useAccounts,
  useCategories,
  useMerchants,
} from "../lib/data";
import { formatMoney, monthLabel } from "../lib/format";
import { ACCOUNT_TYPE_LABELS, AccountSheet, ManageHeader } from "./ManagePages";
import { TransactionGroups } from "./TransactionsPage";
import { AuthBanner, SyncPill } from "./ui";

function Money({ value, currency, className = "" }: { value: number; currency: string; className?: string }) {
  return <span className={`money${value < 0 ? " negative" : ""} ${className}`}>{formatMoney(value, currency)}</span>;
}

/** 帳戶分頁：每個帳戶的目前餘額，點進去看明細 */
export function AccountsListPage({
  ledgerId,
  currency,
  onOpen,
}: {
  ledgerId: string;
  currency: string;
  onOpen: (accountId: string) => void;
}) {
  const accounts = (useAccounts(ledgerId) ?? []).filter((a) => a.deleted_at === null);
  const balances = useAccountBalances(ledgerId);
  const total = accounts.reduce((s, a) => s + (balances?.get(a.id) ?? 0), 0);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">帳戶</h1>
        <SyncPill />
      </header>
      <AuthBanner />

      {balances && (
        <div className="card acct-hero">
          <div className="acct-label">淨資產（所有帳戶合計）</div>
          <div className="acct-balance">
            <Money value={total} currency={currency} />
          </div>
        </div>
      )}

      <div className="card list">
        {accounts.map((a) => (
          <button key={a.id} className="list-row" onClick={() => onOpen(a.id)}>
            <span className="grow">
              <div>{a.name}</div>
              <div className="sub">{ACCOUNT_TYPE_LABELS[a.type]}</div>
            </span>
            {balances && <Money value={balances.get(a.id) ?? 0} currency={currency} />}
            <span className="chev">›</span>
          </button>
        ))}
        {accounts.length === 0 && <div className="list-row muted">還沒有帳戶，到「設定 → 帳戶」新增。</div>}
      </div>
    </div>
  );
}

/** 單一帳戶：餘額 + 所有明細（依月份分段） */
export function AccountDetailPage({
  ledgerId,
  currency,
  accountId,
  onBack,
  onEdit,
  onBankSync,
}: {
  ledgerId: string;
  currency: string;
  accountId: string;
  onBack: () => void;
  onEdit: (t: Transaction) => void;
  /** 打開「銀行對帳」頁 */
  onBankSync: () => void;
}) {
  const accounts = useAccounts(ledgerId);
  const categories = useCategories(ledgerId);
  const transactions = useAccountTransactions(ledgerId, accountId);
  const merchants = useMerchants(ledgerId);
  const [editingAccount, setEditingAccount] = useState(false);

  const account: Account | undefined = accounts?.find((a) => a.id === accountId);
  if (!accounts) return null;
  if (!account) {
    return (
      <div className="page">
        <ManageHeader title="帳戶" onBack={onBack} backLabel="帳戶" />
        <div className="empty">找不到這個帳戶。</div>
      </div>
    );
  }

  let income = 0;
  let expense = 0;
  let transferIn = 0;
  /** 轉出（含手續費） */
  let transferOut = 0;
  const months = new Map<string, Transaction[]>();
  for (const t of transactions ?? []) {
    const delta = accountDelta(t, accountId);
    if (t.kind === "income") income += delta;
    else if (t.kind === "expense") expense -= delta;
    else if (delta > 0) transferIn += delta;
    else transferOut -= delta;
    const m = t.date.slice(0, 7);
    const list = months.get(m) ?? [];
    list.push(t);
    months.set(m, list);
  }
  const initial = account.initial_balance ?? 0;
  const balance = initial + income - expense + transferIn - transferOut;

  return (
    <div className="page">
      <ManageHeader
        title={account.name}
        onBack={onBack}
        backLabel="帳戶"
        action={account.deleted_at === null ? { label: "編輯", onClick: () => setEditingAccount(true) } : undefined}
      />

      <div className="card acct-hero">
        <div className="acct-label">
          目前餘額 · {ACCOUNT_TYPE_LABELS[account.type]}
          {account.deleted_at !== null && "（已刪除）"}
        </div>
        <div className="acct-balance">
          <Money value={balance} currency={currency} />
        </div>
        <div className="acct-stats">
          <span>
            初始 <b>{formatMoney(initial, currency)}</b>
          </span>
          <span>
            收入 <b>{formatMoney(income, currency)}</b>
          </span>
          <span>
            支出 <b>{formatMoney(expense, currency)}</b>
          </span>
          {transferIn > 0 && (
            <span>
              轉入 <b>{formatMoney(transferIn, currency)}</b>
            </span>
          )}
          {transferOut > 0 && (
            <span>
              轉出 <b>{formatMoney(transferOut, currency)}</b>
            </span>
          )}
          <span>
            共 <b>{transactions?.length ?? 0}</b> 筆
          </span>
        </div>
        {account.deleted_at === null && account.type !== "cash" && (
          <button className="btn small acct-sync-btn" onClick={onBankSync}>
            🏦 匯入銀行對帳單
          </button>
        )}
      </div>

      {transactions && transactions.length === 0 && <div className="empty">這個帳戶還沒有記帳紀錄。</div>}

      {[...months.entries()].map(([month, list]) => {
        const net = list.reduce((s, t) => s + accountDelta(t, accountId), 0);
        return (
          <section key={month}>
            <div className="section-title month-title">
              <span>{monthLabel(month)}</span>
              <span>{formatMoney(net, currency)}</span>
            </div>
            <TransactionGroups
              transactions={list}
              categories={categories}
              accounts={accounts}
              merchantById={merchants?.byId}
              currency={currency}
              onEdit={onEdit}
              accountId={accountId}
            />
          </section>
        );
      })}

      {editingAccount && (
        <AccountSheet
          ledgerId={ledgerId}
          account={account}
          onClose={() => setEditingAccount(false)}
          onDeleted={onBack}
        />
      )}
    </div>
  );
}
