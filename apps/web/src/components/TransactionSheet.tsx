import { type FormEvent, useEffect, useState } from "react";
import type { EntryKind, Transaction } from "@accounting/shared";
import {
  deleteTransaction,
  saveCategory,
  saveMerchant,
  saveTransaction,
  useAccounts,
  useCategories,
  useMerchants,
  useNoteSuggestions,
} from "../lib/data";
import { getMeta, setMeta } from "../lib/db";
import { amountToInput, formatMoney, parseAmount, parseBalance, nowTimeStr, todayStr } from "../lib/format";
import { Segmented, Sheet, toast } from "./ui";

export function TransactionSheet({
  ledgerId,
  editing,
  defaultAccountId,
  currency,
  onClose,
}: {
  ledgerId: string;
  currency: string;
  /** 有值 = 編輯；沒有 = 新增 */
  editing?: Transaction;
  /** 新增時預設的帳戶（從帳戶明細頁開啟時） */
  defaultAccountId?: string;
  onClose: () => void;
}) {
  const categories = useCategories(ledgerId);
  const accounts = useAccounts(ledgerId);

  const [kind, setKind] = useState<EntryKind>(editing?.kind ?? "expense");
  const isTransfer = kind === "transfer";
  const [amount, setAmount] = useState(editing ? amountToInput(editing.amount) : "");
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  const [accountId, setAccountId] = useState<string | null>(editing?.account_id ?? defaultAccountId ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(editing?.to_account_id ?? null);
  const [fee, setFee] = useState(editing?.fee ? amountToInput(editing.fee) : "");
  /** 店家欄位的文字；存檔時對應到店家清單（沒有就新增） */
  const [merchant, setMerchant] = useState("");
  /** true = 店家是自動帶入的（新增時），換子分類會跟著換；使用者自己改過就不再自動帶 */
  const [merchantAuto, setMerchantAuto] = useState(!editing);
  const [browsing, setBrowsing] = useState(false);
  const [date, setDate] = useState(editing?.date ?? todayStr());
  // 新的一筆預設現在時間；舊紀錄沒有時間就留空
  const [time, setTime] = useState(editing ? (editing.time ?? "") : nowTimeStr());
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 分類：上層一排，選了之後下面出現它的子分類。
  // 已刪除的分類只在「正在編輯的這筆用到它」時顯示。
  const catById = new Map((categories ?? []).map((c) => [c.id, c]));
  const selected = categoryId ? catById.get(categoryId) : undefined;
  const selectedTop = selected?.parent_id ? catById.get(selected.parent_id) : selected;
  const visible = (c: { id: string; deleted_at: number | null }) =>
    c.deleted_at === null || c.id === categoryId || c.id === selectedTop?.id;
  const topCategories = (categories ?? []).filter((c) => c.kind === kind && !c.parent_id && visible(c));
  const subCategories = selectedTop ? (categories ?? []).filter((c) => c.parent_id === selectedTop.id && visible(c)) : [];

  const visibleAccounts = (accounts ?? []).filter(
    (a) => a.deleted_at === null || a.id === accountId || (isTransfer && a.id === toAccountId),
  );
  const merchants = useMerchants(ledgerId);
  const merchantNames = (merchants?.list ?? []).map((m) => m.name);
  const typedMerchant = merchant.trim();
  const merchantSuggestions =
    !merchantAuto && typedMerchant && !browsing
      ? merchantNames.filter((m) => m !== typedMerchant && m.includes(typedMerchant)).slice(0, 12)
      : [];

  // 編輯時：店家清單載入後填入這筆的店家名稱
  const [merchantLoaded, setMerchantLoaded] = useState(false);
  useEffect(() => {
    if (merchantLoaded || !merchants) return;
    setMerchantLoaded(true);
    if (editing?.merchant_id) setMerchant(merchants.byId.get(editing.merchant_id)?.name ?? "");
  }, [merchants, merchantLoaded, editing]);

  const accountName = (id: string | null) => accounts?.find((a) => a.id === id)?.name ?? "";

  // 這個分類以前記過的備註，最近用過的在前面；輸入時只留包含輸入文字的
  const allSuggestions = useNoteSuggestions(ledgerId, categoryId) ?? [];
  const typed = note.trim();
  const suggestions = allSuggestions.filter((s) => s !== typed && (!typed || s.includes(typed))).slice(0, 20);

  // 新增時，帳戶預設用上次選的
  useEffect(() => {
    if (editing || accountId || !accounts) return;
    void getMeta("lastAccountId").then((last) => {
      const live = accounts.filter((a) => a.deleted_at === null);
      setAccountId(live.find((a) => a.id === last)?.id ?? live[0]?.id ?? null);
    });
  }, [accounts, editing, accountId]);

  function changeKind(k: EntryKind) {
    setKind(k);
    setError(null);
    if (categoryId && categories?.find((c) => c.id === categoryId)?.kind !== k) setCategoryId(null);
  }

  function pickFrom(id: string) {
    setAccountId(id);
    if (id === toAccountId) setToAccountId(null);
    setError(null);
  }

  function pickCategory(id: string) {
    setCategoryId(id);
    setError(null);
    // 新增時：帶入上次在這個（子）分類用的店家
    if (merchantAuto) {
      const last = merchants?.lastByCategory.get(id);
      setMerchant((last && merchants?.byId.get(last)?.name) || "");
    }
  }

  /** 再點一次已選的子分類 = 取消子分類，只留上層 */
  function pickSub(id: string) {
    const next = id === categoryId ? (selectedTop?.id ?? null) : id;
    if (next) pickCategory(next);
  }

  function chooseMerchant(m: string) {
    setMerchant(m);
    setMerchantAuto(false);
    setBrowsing(false);
  }

  async function addSub() {
    if (!selectedTop) return;
    const name = prompt(`在「${selectedTop.name}」底下新增子分類`)?.trim().slice(0, 50);
    if (!name) return;
    const same = subCategories.find((c) => c.name === name && c.deleted_at === null);
    if (same) return pickCategory(same.id);
    const id = await saveCategory(ledgerId, { kind: selectedTop.kind, name, icon: "", parent_id: selectedTop.id });
    pickCategory(id);
    toast(`已新增子分類「${name}」`);
  }

  /** 「現金 −$1,015 → 永豐銀行 +$1,000」，讓人確認手續費從哪裡扣 */
  function transferSummary(): string | null {
    const amt = parseAmount(amount);
    const f = parseBalance(fee);
    if (amt === null || f === null || !accountId || !toAccountId || accountId === toAccountId) return null;
    return `${accountName(accountId)} −${formatMoney(amt + f, currency)} → ${accountName(toAccountId)} +${formatMoney(amt, currency)}`;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const minor = parseAmount(amount);
    if (minor === null) return setError("請輸入金額，例如 120 或 45.5");
    let feeMinor = 0;
    if (isTransfer) {
      if (!accountId) return setError("請選擇轉出帳戶");
      if (!toAccountId) return setError("請選擇轉入帳戶");
      if (accountId === toAccountId) return setError("轉出和轉入不能是同一個帳戶");
      const parsedFee = parseBalance(fee);
      if (parsedFee === null) return setError("手續費格式不對，例如 15");
      feeMinor = parsedFee;
    } else if (!categoryId) {
      return setError("請選擇分類");
    }
    setSaving(true);
    // 店家名稱 → 店家 id：沿用這筆原本的店家（就算它已被刪除）、同名的店家，或新增一個
    let merchantId: string | null = null;
    const merchantName = isTransfer ? "" : merchant.trim();
    if (merchantName) {
      const original = editing?.merchant_id ? merchants?.byId.get(editing.merchant_id) : undefined;
      merchantId = original?.name === merchantName ? original.id : await saveMerchant(ledgerId, merchantName);
    }
    await saveTransaction(
      ledgerId,
      {
        kind,
        amount: minor,
        category_id: categoryId,
        account_id: accountId,
        to_account_id: toAccountId,
        fee: feeMinor,
        date,
        time: /^\d{2}:\d{2}$/.test(time) ? time : null,
        merchant_id: merchantId,
        note,
      },
      editing?.id,
    );
    if (accountId) await setMeta("lastAccountId", accountId);
    toast(editing ? "已更新" : "已記下");
    onClose();
  }

  async function remove() {
    if (!editing || !confirm("確定要刪除這筆嗎？")) return;
    await deleteTransaction(editing.id);
    toast("已刪除");
    onClose();
  }

  return (
    <Sheet title={editing ? "編輯" : "記一筆"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Segmented
          full
          value={kind}
          onChange={changeKind}
          options={[
            { value: "expense", label: "支出" },
            { value: "income", label: "收入" },
            { value: "transfer", label: "轉帳" },
          ]}
        />

        <label className="field">
          <span className="label">{isTransfer ? "轉帳金額" : "金額"}</span>
          <input
            className={`input amount-input${kind === "income" ? " income" : ""}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            autoFocus={!editing}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
          />
        </label>

        {isTransfer && (
          <TransferFields
            accounts={visibleAccounts}
            fromId={accountId}
            toId={toAccountId}
            fee={fee}
            onFrom={pickFrom}
            onTo={(id) => {
              setToAccountId(id);
              setError(null);
            }}
            onFee={(v) => {
              setFee(v);
              setError(null);
            }}
            summary={transferSummary()}
          />
        )}

        {!isTransfer && (
          <div className="field">
            <span className="label">分類</span>
            <div className="chip-grid">
              {topCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  aria-pressed={c.id === selectedTop?.id}
                  onClick={() => pickCategory(c.id)}
                >
                  <span className="chip-icon">{c.icon || "•"}</span>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isTransfer && selectedTop && (
          <div className="field">
            <span className="label">{selectedTop.name}的子分類</span>
            <div className="chip-row">
              {subCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  aria-pressed={c.id === categoryId}
                  onClick={() => pickSub(c.id)}
                >
                  {c.icon && <span aria-hidden>{c.icon}</span>}
                  {c.name}
                </button>
              ))}
              <button type="button" className="chip chip-add" onClick={addSub}>
                ＋ 新增
              </button>
            </div>
          </div>
        )}

        {!isTransfer && (
          <div className="field">
            <span className="label">店家（選填）</span>
            <div className="merchant-input">
              <input
                className="input"
                maxLength={100}
                autoComplete="off"
                placeholder="例如：全家、八方雲集"
                value={merchant}
                onChange={(e) => {
                  setMerchant(e.target.value);
                  setMerchantAuto(false);
                }}
              />
              {merchant && (
                <button type="button" className="icon-btn" aria-label="清除店家" onClick={() => chooseMerchant("")}>
                  ×
                </button>
              )}
              <button
                type="button"
                className="btn small"
                aria-expanded={browsing}
                onClick={() => setBrowsing((b) => !b)}
              >
                {browsing ? "收起" : "瀏覽"}
              </button>
            </div>
            {merchantAuto && merchant && selected && (
              <div className="muted field-hint">上次在「{selected.name}」用的店家</div>
            )}
            {merchantSuggestions.length > 0 && (
              <div className="suggest-row" style={{ margin: "8px 0 0" }} aria-label="用過的店家">
                {merchantSuggestions.map((m) => (
                  <button key={m} type="button" className="suggest" onClick={() => chooseMerchant(m)}>
                    {m}
                  </button>
                ))}
              </div>
            )}
            {browsing && <MerchantBrowser all={merchantNames} current={merchant} onPick={chooseMerchant} />}
          </div>
        )}

        <label className="field">
          <span className="label">備註</span>
          <input
            className="input"
            maxLength={500}
            placeholder={isTransfer ? "例如：繳卡費、儲值悠遊卡" : "例如：便當、捷運"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {suggestions.length > 0 && (
          <div className="suggest-row" aria-label="以前記過的備註">
            {suggestions.map((s) => (
              <button key={s} type="button" className="suggest" onClick={() => setNote(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {!isTransfer && visibleAccounts.length > 0 && (
          <div className="field">
            <span className="label">帳戶</span>
            <div className="chip-row">
              {visibleAccounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="chip"
                  aria-pressed={a.id === accountId}
                  onClick={() => setAccountId(a.id)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field-row">
          <label className="field">
            <span className="label">日期</span>
            <input className="input" type="date" value={date} required onChange={(e) => setDate(e.target.value || todayStr())} />
          </label>
          <label className="field">
            <span className="label">時間</span>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        {error && <div className="field-error">{error}</div>}

        <div className="form-actions">
          {editing && (
            <button type="button" className="btn danger" onClick={remove}>
              刪除
            </button>
          )}
          <button type="submit" className="btn primary" disabled={saving}>
            儲存
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function TransferFields({
  accounts,
  fromId,
  toId,
  fee,
  onFrom,
  onTo,
  onFee,
  summary,
}: {
  accounts: { id: string; name: string }[];
  fromId: string | null;
  toId: string | null;
  fee: string;
  onFrom: (id: string) => void;
  onTo: (id: string) => void;
  onFee: (v: string) => void;
  summary: string | null;
}) {
  if (accounts.length < 2) {
    return <div className="field muted">轉帳需要至少兩個帳戶，請先到「設定 → 帳戶」新增。</div>;
  }
  return (
    <>
      <div className="field">
        <span className="label">轉出帳戶</span>
        <div className="chip-row">
          {accounts.map((a) => (
            <button key={a.id} type="button" className="chip" aria-pressed={a.id === fromId} onClick={() => onFrom(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">轉入帳戶</span>
        <div className="chip-row">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              className="chip"
              aria-pressed={a.id === toId}
              disabled={a.id === fromId}
              onClick={() => onTo(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="label">手續費（從轉出帳戶扣，沒有就留空）</span>
        <input
          className="input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={fee}
          onChange={(e) => onFee(e.target.value)}
        />
      </label>
      {summary && <div className="transfer-summary">{summary}</div>}
    </>
  );
}

/** 所有用過的店家，最近用過的在最上面；可以搜尋 */
function MerchantBrowser({
  all,
  current,
  onPick,
}: {
  all: string[];
  current: string;
  onPick: (m: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = q.trim() ? all.filter((m) => m.includes(q.trim())) : all;
  return (
    <div className="merchant-browser">
      {all.length === 0 ? (
        <div className="muted merchant-empty">還沒有店家。在上面輸入店家名稱，存檔後就會加進店家清單；也可以到「設定 → 店家」管理。</div>
      ) : (
        <>
          <input
            className="input"
            placeholder={`搜尋 ${all.length} 個店家`}
            value={q}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="merchant-list" role="listbox" aria-label="用過的店家">
            {list.map((m) => (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={m === current.trim()}
                className="merchant-option"
                onClick={() => onPick(m)}
              >
                {m}
              </button>
            ))}
            {list.length === 0 && <div className="muted merchant-empty">找不到「{q.trim()}」</div>}
          </div>
        </>
      )}
    </div>
  );
}
