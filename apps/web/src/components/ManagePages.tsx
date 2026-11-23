import { type FormEvent, useState } from "react";
import { ACCOUNT_TYPES, type Account, type AccountType, type Category, type TransactionKind } from "@accounting/shared";
import {
  deleteAccount,
  deleteCategory,
  saveAccount,
  saveCategory,
  swapOrder,
  useAccountBalances,
  useAccounts,
  useCategories,
} from "../lib/data";
import { useBackLayer } from "../lib/back";
import { amountToInput, formatMoney, parseBalance } from "../lib/format";
import { IconPicker } from "./IconPicker";
import { Segmented, Sheet, toast } from "./ui";

export function ManageHeader({
  title,
  onBack,
  backLabel = "設定",
  action,
}: {
  title: string;
  onBack: () => void;
  backLabel?: string;
  /** 右上角按鈕 */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <header className="page-header">
      <button className="back-btn" onClick={onBack}>
        ‹ {backLabel}
      </button>
      <h1 className="page-title page-title-sm">{title}</h1>
      {action ? (
        <button className="link-btn header-action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : (
        <span className="header-action" />
      )}
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

type CategoryEditing = { category?: Category; parent?: Category } | null;

export function CategoriesPage({ ledgerId, onBack }: { ledgerId: string; onBack: () => void }) {
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [editing, setEditing] = useState<CategoryEditing>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const all = (useCategories(ledgerId) ?? []).filter((c) => c.deleted_at === null);
  const childrenOf = (id: string) => all.filter((c) => c.parent_id === id);

  const open = openId ? all.find((c) => c.id === openId) : undefined;
  useBackLayer(open !== undefined, () => setOpenId(null));
  if (open) {
    return (
      <SubcategoriesPage
        ledgerId={ledgerId}
        parent={open}
        subs={childrenOf(open.id)}
        onBack={() => setOpenId(null)}
      />
    );
  }

  const list = all.filter((c) => c.kind === kind && !c.parent_id);

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
      <p className="muted hint">點分類可以管理它的子分類，例如「餐飲」底下的早餐、午餐。</p>
      <div className="card list">
        {list.map((c, i) => {
          const subs = childrenOf(c.id);
          return (
            <div key={c.id} className="list-row">
              <button className="grow list-row list-row-inner" onClick={() => setOpenId(c.id)}>
                <span className="row-icon">{c.icon || "•"}</span>
                <span className="grow">
                  <div>{c.name}</div>
                  <div className="sub ellipsis">{subs.length > 0 ? subs.map((s) => s.name).join("、") : "沒有子分類"}</div>
                </span>
                <span className="chev">›</span>
              </button>
              <OrderButtons
                onUp={i > 0 ? () => void swapOrder("categories", c.id, list[i - 1]!.id) : undefined}
                onDown={i < list.length - 1 ? () => void swapOrder("categories", c.id, list[i + 1]!.id) : undefined}
              />
            </div>
          );
        })}
        <button className="list-row" onClick={() => setEditing({})}>
          <span className="grow add-text">＋ 新增{kind === "expense" ? "支出" : "收入"}分類</span>
        </button>
      </div>

      {editing && (
        <CategorySheet ledgerId={ledgerId} kind={kind} {...editing} subCount={0} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function SubcategoriesPage({
  ledgerId,
  parent,
  subs,
  onBack,
}: {
  ledgerId: string;
  parent: Category;
  subs: Category[];
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<CategoryEditing>(null);

  return (
    <div className="page">
      <ManageHeader
        title={`${parent.icon} ${parent.name}`.trim()}
        onBack={onBack}
        backLabel="分類"
        action={{ label: "編輯", onClick: () => setEditing({ category: parent }) }}
      />
      <p className="muted hint">記帳時選了「{parent.name}」後，可以再選子分類，也可以不選。</p>
      <div className="section-title">子分類</div>
      <div className="card list">
        {subs.map((c, i) => (
          <div key={c.id} className="list-row">
            <button className="grow list-row list-row-inner" onClick={() => setEditing({ category: c, parent })}>
              <span className="row-icon">{c.icon || parent.icon || "•"}</span>
              <span className="grow">{c.name}</span>
            </button>
            <OrderButtons
              onUp={i > 0 ? () => void swapOrder("categories", c.id, subs[i - 1]!.id) : undefined}
              onDown={i < subs.length - 1 ? () => void swapOrder("categories", c.id, subs[i + 1]!.id) : undefined}
            />
          </div>
        ))}
        <button className="list-row" onClick={() => setEditing({ parent })}>
          <span className="grow add-text">＋ 新增子分類</span>
        </button>
      </div>

      {editing && (
        <CategorySheet
          ledgerId={ledgerId}
          kind={parent.kind}
          {...editing}
          subCount={editing.category?.id === parent.id ? subs.length : 0}
          onClose={() => setEditing(null)}
          onDeleted={editing.category?.id === parent.id ? onBack : undefined}
        />
      )}
    </div>
  );
}

function CategorySheet({
  ledgerId,
  kind,
  category,
  parent,
  subCount,
  onClose,
  onDeleted,
}: {
  ledgerId: string;
  kind: TransactionKind;
  category?: Category;
  /** 有值 = 子分類 */
  parent?: Category;
  /** 刪除上層分類時，提醒會一起刪掉幾個子分類 */
  subCount: number;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [error, setError] = useState<string | null>(null);
  const noun = parent ? "子分類" : "分類";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("請輸入名稱");
    await saveCategory(
      ledgerId,
      { kind: category?.kind ?? kind, name, icon, parent_id: parent?.id ?? null },
      category?.id,
    );
    onClose();
  }

  async function remove() {
    if (!category) return;
    const extra = subCount > 0 ? `\n底下的 ${subCount} 個子分類也會一起刪除。` : "";
    if (!confirm(`刪除${noun}「${category.name}」？${extra}\n已記的帳不會被刪除，仍會顯示這個${noun}名稱。`)) return;
    await deleteCategory(category.id);
    toast(`已刪除${noun}`);
    onClose();
    onDeleted?.();
  }

  return (
    <Sheet title={category ? `編輯${noun}` : parent ? `新增「${parent.name}」的子分類` : "新增分類"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span className="label">名稱</span>
          <input
            className="input"
            maxLength={50}
            placeholder={parent ? "例如：午餐" : undefined}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <IconPicker value={icon} onChange={setIcon} fallback={parent ? parent.icon : undefined} />
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

export function AccountsPage({
  ledgerId,
  currency,
  onBack,
}: {
  ledgerId: string;
  currency: string;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const list = (useAccounts(ledgerId) ?? []).filter((a) => a.deleted_at === null);
  const balances = useAccountBalances(ledgerId);

  return (
    <div className="page">
      <ManageHeader title="帳戶" onBack={onBack} />
      <p className="muted hint">
        記帳時選擇用哪個帳戶付款或收款，例如現金、信用卡、悠遊卡、LINE Pay。每個帳戶的明細在下方「帳戶」分頁。
      </p>
      <div className="card list">
        {list.map((a, i) => (
          <div key={a.id} className="list-row">
            <button className="grow list-row list-row-inner" onClick={() => setEditing(a)}>
              <span className="grow">
                <div>{a.name}</div>
                <div className="sub">
                  {ACCOUNT_TYPE_LABELS[a.type]} · 初始 {formatMoney(a.initial_balance ?? 0, currency)}
                </div>
              </span>
              {balances && <span className="value">{formatMoney(balances.get(a.id) ?? 0, currency)}</span>}
            </button>
            <OrderButtons
              onUp={i > 0 ? () => void swapOrder("accounts", a.id, list[i - 1]!.id) : undefined}
              onDown={i < list.length - 1 ? () => void swapOrder("accounts", a.id, list[i + 1]!.id) : undefined}
            />
          </div>
        ))}
        <button className="list-row" onClick={() => setEditing("new")}>
          <span className="grow add-text">＋ 新增帳戶</span>
        </button>
      </div>

      {editing && (
        <AccountSheet ledgerId={ledgerId} account={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

export function AccountSheet({
  ledgerId,
  account,
  onClose,
  onDeleted,
}: {
  ledgerId: string;
  account?: Account;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const initial = account?.initial_balance ?? 0;
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "cash");
  const [balance, setBalance] = useState(initial === 0 ? "" : amountToInput(Math.abs(initial)));
  const [negative, setNegative] = useState(initial < 0);
  const [error, setError] = useState<string | null>(null);

  function changeType(t: AccountType) {
    setType(t);
    // 信用卡通常是欠款；還沒輸入金額時順便切換正負
    if (!balance) setNegative(t === "credit_card");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("請輸入名稱");
    const minor = parseBalance(balance);
    if (minor === null) return setError("初始金額格式不對，例如 5000 或 120.5");
    await saveAccount(ledgerId, { name, type, initial_balance: negative ? -minor : minor }, account?.id);
    onClose();
  }

  async function remove() {
    if (!account || !confirm(`刪除帳戶「${account.name}」？\n已記的帳不會被刪除。`)) return;
    await deleteAccount(account.id);
    toast("已刪除帳戶");
    onClose();
    onDeleted?.();
  }

  return (
    <Sheet title={account ? "編輯帳戶" : "新增帳戶"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="label">名稱</span>
          <input
            className="input"
            maxLength={50}
            placeholder="例如：玉山信用卡"
            value={name}
            autoFocus={!account}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">類型</span>
          <select className="input" value={type} onChange={(e) => changeType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="label">初始金額</span>
          <Segmented
            full
            value={negative ? "debt" : "asset"}
            onChange={(v) => setNegative(v === "debt")}
            options={[
              { value: "asset", label: "餘額（正數）" },
              { value: "debt", label: "欠款（負數）" },
            ]}
          />
          <div className="signed-input">
            <span className="sign" aria-hidden>
              {negative ? "−" : "＋"}
            </span>
            <input
              className="input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label="初始金額"
              value={balance}
              onChange={(e) => {
                setBalance(e.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="muted field-hint">開始記帳前，這個帳戶裡已經有的錢。目前餘額 = 初始金額 + 收入 − 支出。</div>
        </div>
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
