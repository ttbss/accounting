import { type FormEvent, useState } from "react";
import { ACCOUNT_TYPES, type Account, type AccountType, type Category, type TransactionKind } from "@accounting/shared";
import {
  deleteAccount,
  deleteCategory,
  saveAccount,
  saveCategory,
  swapOrder,
  useAccounts,
  useCategories,
} from "../lib/data";
import { Segmented, Sheet, toast } from "./ui";

function ManageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="page-header">
      <button className="back-btn" onClick={onBack}>
        ‹ 設定
      </button>
      <h1 className="page-title" style={{ fontSize: 18 }}>
        {title}
      </h1>
      <span style={{ width: 56 }} />
    </header>
  );
}

function OrderButtons({ onUp, onDown }: { onUp?: () => void; onDown?: () => void }) {
  return (
    <span className="order-btns">
      <button className="icon-btn" aria-label="上移" disabled={!onUp} onClick={onUp}>
        ↑
      </button>
      <button className="icon-btn" aria-label="下移" disabled={!onDown} onClick={onDown}>
        ↓
      </button>
    </span>
  );
}

// ── 分類 ─────────────────────────────────────────────────────────────

const EMOJI_SUGGESTIONS = ["🍱", "☕", "🍜", "🚌", "🚕", "⛽", "🛍️", "👕", "🏠", "💡", "📱", "🎮", "🎬", "✈️", "🏥", "💊", "📚", "🎁", "🐶", "👶", "💄", "🏋️", "💼", "🎉", "📈", "💰", "📦"];

export function CategoriesPage({ ledgerId, onBack }: { ledgerId: string; onBack: () => void }) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const list = (useCategories(ledgerId) ?? []).filter((c) => c.kind === kind && c.deleted_at === null);

  return (
    <div className="page">
      <ManageHeader title="分類" onBack={onBack} />
      <Segmented
        full
        value={kind}
        onChange={setKind}
        options={[
          { value: "expense", label: "支出" },
          { value: "income", label: "收入" },
        ]}
      />
      <div className="card list">
        {list.map((c, i) => (
          <div key={c.id} className="list-row">
            <button className="grow list-row" style={{ padding: 0, minHeight: 0 }} onClick={() => setEditing(c)}>
              <span style={{ fontSize: 20 }}>{c.icon || "•"}</span>
              <span className="grow">{c.name}</span>
            </button>
            <OrderButtons
              onUp={i > 0 ? () => void swapOrder("categories", c.id, list[i - 1]!.id) : undefined}
              onDown={i < list.length - 1 ? () => void swapOrder("categories", c.id, list[i + 1]!.id) : undefined}
            />
          </div>
        ))}
        <button className="list-row" onClick={() => setEditing("new")}>
          <span className="grow" style={{ color: "var(--accent)", fontWeight: 600 }}>
            ＋ 新增{kind === "expense" ? "支出" : "收入"}分類
          </span>
        </button>
      </div>

      {editing && (
        <CategorySheet
          ledgerId={ledgerId}
          kind={kind}
          category={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategorySheet({
  ledgerId,
  kind,
  category,
  onClose,
}: {
  ledgerId: string;
  kind: TransactionKind;
  category?: Category;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("請輸入名稱");
    await saveCategory(ledgerId, { kind: category?.kind ?? kind, name, icon }, category?.id);
    onClose();
  }

  async function remove() {
    if (!category || !confirm(`刪除分類「${category.name}」？\n已記的帳不會被刪除，仍會顯示這個分類名稱。`)) return;
    await deleteCategory(category.id);
    toast("已刪除分類");
    onClose();
  }

  return (
    <Sheet title={category ? "編輯分類" : "新增分類"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span className="label">名稱</span>
          <input className="input" maxLength={50} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <label>
            <span className="label">圖示</span>
            <input
              className="input"
              style={{ fontSize: 24, width: 80, textAlign: "center" }}
              value={icon}
              onChange={(e) => setIcon(Array.from(e.target.value).slice(-2).join(""))}
            />
          </label>
          <div className="emoji-row">
            {EMOJI_SUGGESTIONS.map((em) => (
              <button key={em} type="button" onClick={() => setIcon(em)} aria-label={`使用 ${em}`}>
                {em}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="field-error">{error}</div>}
        <div className="form-actions">
          {category && (
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

// ── 帳戶 ─────────────────────────────────────────────────────────────

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "現金",
  bank: "銀行",
  credit_card: "信用卡",
  e_wallet: "電子支付",
  other: "其他",
};

export function AccountsPage({ ledgerId, onBack }: { ledgerId: string; onBack: () => void }) {
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const list = (useAccounts(ledgerId) ?? []).filter((a) => a.deleted_at === null);

  return (
    <div className="page">
      <ManageHeader title="帳戶" onBack={onBack} />
      <p className="muted" style={{ margin: "0 4px 12px" }}>
        記帳時選擇用哪個帳戶付款或收款，例如現金、信用卡、悠遊卡、LINE Pay。
      </p>
      <div className="card list">
        {list.map((a, i) => (
          <div key={a.id} className="list-row">
            <button className="grow list-row" style={{ padding: 0, minHeight: 0 }} onClick={() => setEditing(a)}>
              <span className="grow">
                <div>{a.name}</div>
                <div className="sub">{ACCOUNT_TYPE_LABELS[a.type]}</div>
              </span>
            </button>
            <OrderButtons
              onUp={i > 0 ? () => void swapOrder("accounts", a.id, list[i - 1]!.id) : undefined}
              onDown={i < list.length - 1 ? () => void swapOrder("accounts", a.id, list[i + 1]!.id) : undefined}
            />
          </div>
        ))}
        <button className="list-row" onClick={() => setEditing("new")}>
          <span className="grow" style={{ color: "var(--accent)", fontWeight: 600 }}>
            ＋ 新增帳戶
          </span>
        </button>
      </div>

      {editing && (
        <AccountSheet ledgerId={ledgerId} account={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function AccountSheet({ ledgerId, account, onClose }: { ledgerId: string; account?: Account; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "cash");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("請輸入名稱");
    await saveAccount(ledgerId, { name, type }, account?.id);
    onClose();
  }

  async function remove() {
    if (!account || !confirm(`刪除帳戶「${account.name}」？\n已記的帳不會被刪除。`)) return;
    await deleteAccount(account.id);
    toast("已刪除帳戶");
    onClose();
  }

  return (
    <Sheet title={account ? "編輯帳戶" : "新增帳戶"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span className="label">名稱</span>
          <input
            className="input"
            maxLength={50}
            placeholder="例如：玉山信用卡"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">類型</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="field-error">{error}</div>}
        <div className="form-actions">
          {account && (
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
