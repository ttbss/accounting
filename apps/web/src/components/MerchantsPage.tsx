import { type FormEvent, useState } from "react";
import type { Merchant, Transaction } from "@accounting/shared";
import {
  DuplicateMerchantError,
  deleteMerchant,
  expenseOf,
  incomeOf,
  saveMerchant,
  useAccounts,
  useCategories,
  useMerchantTransactions,
  useMerchants,
} from "../lib/data";
import { formatMoney, monthLabel } from "../lib/format";
import { ManageHeader } from "./ManagePages";
import { TransactionGroups } from "./TransactionsPage";
import { Sheet, toast } from "./ui";

/** 設定 → 店家：清單（最近用過的在前面），點進去看在這家的所有紀錄 */
export function MerchantsPage({
  ledgerId,
  currency,
  onBack,
  onEdit,
}: {
  ledgerId: string;
  currency: string;
  onBack: () => void;
  onEdit: (t: Transaction) => void;
}) {
  const merchants = useMerchants(ledgerId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Merchant | "new" | null>(null);
  const [q, setQ] = useState("");

  const open = openId ? merchants?.byId.get(openId) : undefined;
  if (open) {
    return (
      <MerchantDetailPage
        ledgerId={ledgerId}
        currency={currency}
        merchant={open}
        onBack={() => setOpenId(null)}
        onEdit={onEdit}
      />
    );
  }

  const all = merchants?.list ?? [];
  const list = q.trim() ? all.filter((m) => m.name.includes(q.trim())) : all;

  return (
    <div className="page">
      <ManageHeader title="店家" onBack={onBack} />
      <p className="muted hint">記帳時輸入的店家會自動加進來。最近用過的排在最上面，點進去可以看在這家的所有紀錄。</p>

      {all.length > 5 && (
        <input
          className="input search-input"
          placeholder={`搜尋 ${all.length} 個店家`}
          value={q}
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
        />
      )}

      <div className="card list">
        {list.map((m) => {
          const s = merchants?.stats.get(m.id);
          return (
            <button
              key={m.id}
              className="list-row"
              onClick={() => {
                setOpenId(m.id);
                window.scrollTo(0, 0);
              }}
            >
              <span className="grow">
                <div className="ellipsis">{m.name}</div>
                <div className="sub">{s ? `${s.count} 筆 · 最近 ${s.lastDate}` : "還沒有紀錄"}</div>
              </span>
              {s && s.expense > 0 && <span className="value">{formatMoney(s.expense, currency)}</span>}
              <span className="chev">›</span>
            </button>
          );
        })}
        {q.trim() && list.length === 0 && <div className="list-row muted">找不到「{q.trim()}」</div>}
        <button className="list-row" onClick={() => setEditing("new")}>
          <span className="grow add-text">＋ 新增店家</span>
        </button>
      </div>

      {editing && (
        <MerchantSheet
          ledgerId={ledgerId}
          merchant={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MerchantDetailPage({
  ledgerId,
  currency,
  merchant,
  onBack,
  onEdit,
}: {
  ledgerId: string;
  currency: string;
  merchant: Merchant;
  onBack: () => void;
  onEdit: (t: Transaction) => void;
}) {
  const transactions = useMerchantTransactions(ledgerId, merchant.id);
  const categories = useCategories(ledgerId);
  const accounts = useAccounts(ledgerId);
  const [editing, setEditing] = useState(false);

  let expense = 0;
  let income = 0;
  const months = new Map<string, Transaction[]>();
  for (const t of transactions ?? []) {
    expense += expenseOf(t);
    income += incomeOf(t);
    const m = t.date.slice(0, 7);
    const list = months.get(m) ?? [];
    list.push(t);
    months.set(m, list);
  }

  return (
    <div className="page">
      <ManageHeader
        title={merchant.name}
        onBack={onBack}
        backLabel="店家"
        action={merchant.deleted_at === null ? { label: "編輯", onClick: () => setEditing(true) } : undefined}
      />

      <div className="card acct-hero">
        <div className="acct-label">在這家的支出{merchant.deleted_at !== null && "（店家已刪除）"}</div>
        <div className="acct-balance">
          <span className="money">{formatMoney(expense, currency)}</span>
        </div>
        <div className="acct-stats">
          {income > 0 && (
            <span>
              收入 <b>{formatMoney(income, currency)}</b>
            </span>
          )}
          <span>
            共 <b>{transactions?.length ?? 0}</b> 筆
          </span>
          {transactions && transactions[0] && (
            <span>
              最近 <b>{transactions[0].date}</b>
            </span>
          )}
        </div>
      </div>

      {transactions && transactions.length === 0 && <div className="empty">還沒有在這家的紀錄。</div>}

      {[...months.entries()].map(([month, list]) => {
        const net = list.reduce((s, t) => s + incomeOf(t) - expenseOf(t), 0);
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
              currency={currency}
              onEdit={onEdit}
              hideMerchant
            />
          </section>
        );
      })}

      {editing && <MerchantSheet ledgerId={ledgerId} merchant={merchant} onClose={() => setEditing(false)} onDeleted={onBack} />}
    </div>
  );
}

function MerchantSheet({
  ledgerId,
  merchant,
  onClose,
  onDeleted,
}: {
  ledgerId: string;
  merchant?: Merchant;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState(merchant?.name ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("請輸入名稱");
    try {
      await saveMerchant(ledgerId, name, merchant?.id);
    } catch (err) {
      if (err instanceof DuplicateMerchantError) return setError(err.message);
      throw err;
    }
    toast(merchant ? "已更新店家" : "已新增店家");
    onClose();
  }

  async function remove() {
    if (!merchant || !confirm(`刪除店家「${merchant.name}」？\n已記的帳不會被刪除，仍會顯示這個店家名稱。`)) return;
    await deleteMerchant(merchant.id);
    toast("已刪除店家");
    onClose();
    onDeleted?.();
  }

  return (
    <Sheet title={merchant ? "編輯店家" : "新增店家"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="label">名稱</span>
          <input
            className="input"
            maxLength={100}
            placeholder="例如：全家、八方雲集"
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          {merchant && <div className="muted field-hint">改名後，所有在這家的紀錄都會顯示新名稱。</div>}
        </label>
        {error && <div className="field-error">{error}</div>}
        <div className="form-actions">
          {merchant && (
            <button type="button" className="btn danger" onClick={remove}>
              刪除
            </button>
          )}
          <button type="submit" className="btn primary">
            儲存
          </button>
        </div>
      </form>
    </Sheet>
  );
}
