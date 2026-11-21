import { type FormEvent, useEffect, useState } from "react";
import type { Transaction, TransactionKind } from "@accounting/shared";
import { deleteTransaction, saveTransaction, useAccounts, useCategories } from "../lib/data";
import { getMeta, setMeta } from "../lib/db";
import { amountToInput, parseAmount, todayStr } from "../lib/format";
import { Segmented, Sheet, toast } from "./ui";

export function TransactionSheet({
  ledgerId,
  editing,
  onClose,
}: {
  ledgerId: string;
  /** 有值 = 編輯；沒有 = 新增 */
  editing?: Transaction;
  onClose: () => void;
}) {
  const categories = useCategories(ledgerId);
  const accounts = useAccounts(ledgerId);

  const [kind, setKind] = useState<TransactionKind>(editing?.kind ?? "expense");
  const [amount, setAmount] = useState(editing ? amountToInput(editing.amount) : "");
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  const [accountId, setAccountId] = useState<string | null>(editing?.account_id ?? null);
  const [date, setDate] = useState(editing?.date ?? todayStr());
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const visibleCategories = (categories ?? []).filter(
    (c) => c.kind === kind && (c.deleted_at === null || c.id === categoryId),
  );
  const visibleAccounts = (accounts ?? []).filter((a) => a.deleted_at === null || a.id === accountId);

  // 新增時，帳戶預設用上次選的
  useEffect(() => {
    if (editing || accountId || !accounts) return;
    void getMeta("lastAccountId").then((last) => {
      const live = accounts.filter((a) => a.deleted_at === null);
      setAccountId(live.find((a) => a.id === last)?.id ?? live[0]?.id ?? null);
    });
  }, [accounts, editing, accountId]);

  function changeKind(k: TransactionKind) {
    setKind(k);
    if (categoryId && categories?.find((c) => c.id === categoryId)?.kind !== k) setCategoryId(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const minor = parseAmount(amount);
    if (minor === null) return setError("請輸入金額，例如 120 或 45.5");
    if (!categoryId) return setError("請選擇分類");
    setSaving(true);
    await saveTransaction(
      ledgerId,
      { kind, amount: minor, category_id: categoryId, account_id: accountId, date, note },
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
          ]}
        />

        <label className="field">
          <span className="label">金額</span>
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

        <div className="field">
          <span className="label">分類</span>
          <div className="chip-grid">
            {visibleCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={c.id === categoryId}
                onClick={() => {
                  setCategoryId(c.id);
                  setError(null);
                }}
              >
                <span className="chip-icon">{c.icon || "•"}</span>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {visibleAccounts.length > 0 && (
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

        <label className="field">
          <span className="label">日期</span>
          <input className="input" type="date" value={date} required onChange={(e) => setDate(e.target.value || todayStr())} />
        </label>

        <label className="field">
          <span className="label">備註</span>
          <input
            className="input"
            maxLength={500}
            placeholder="例如：午餐、捷運"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

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
