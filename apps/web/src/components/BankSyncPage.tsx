import { type ReactNode, useMemo, useState } from "react";
import type { Account, Category, Transaction } from "@accounting/shared";
import {
  type BankRow,
  parseStatement,
  pickAccount,
  type Statement,
  type StatementAccount,
  StatementFormatError,
} from "../lib/bankStatement";
import {
  accountDelta,
  applyBankSync,
  type BankSyncOps,
  categoryInfo,
  useAccountTransactions,
  useAccounts,
  useCategories,
} from "../lib/data";
import { formatMoney, toDateStr } from "../lib/format";
import { bankNote, type Draft, draftToInput, hasChanges, type Match, type Plan, reconcile, suggestDraft } from "../lib/reconcile";
import { readSheetFile, SheetFormatError } from "../lib/sheet";
import { ManageHeader } from "./ManagePages";
import { Segmented, toast } from "./ui";

interface Loaded {
  fileName: string;
  /** 整個檔案（可能有好幾個帳戶） */
  file: Statement;
  /** 選的那個帳戶（file.accounts 的 key） */
  accountKey: string;
  /** 只有選的那個帳戶的紀錄 */
  stmt: Statement;
  plan: Plan;
  /** 上次匯入這個帳戶時的銀行帳號（不一樣就提醒） */
  previousAccountNo: string | null;
}

const accountNoKey = (accountId: string) => `bankStatementAccount:${accountId}`;

function loadAccountNo(accountId: string): string | null {
  try {
    return localStorage.getItem(accountNoKey(accountId));
  } catch {
    return null;
  }
}

function saveAccountNo(accountId: string, no: string): void {
  try {
    localStorage.setItem(accountNoKey(accountId), no);
  } catch {
    /* 存不了就算了，只是少一個提醒 */
  }
}

/**
 * 檔案裡有好幾個帳戶時，先猜要對哪一個：
 * 上次匯入這個 App 帳戶的帳號 → 名稱有共同的關鍵字（例如帳戶叫「永豐 數位」，對到「…數位活期儲蓄存款」）→ 筆數最多的
 */
function guessAccount(accounts: StatementAccount[], account: Account, savedNo: string | null): string {
  const bySaved = savedNo ? accounts.find((a) => a.no === savedNo) : undefined;
  if (bySaved) return bySaved.key;
  const words = account.name
    .normalize("NFKC")
    .split(/[\s·・\-_/()（）]+/)
    .flatMap((w) => w.replace(/銀行|商銀|帳戶|存款|活存|活儲|台幣|臺幣/g, " ").split(" "))
    .filter((w) => w.length >= 2);
  const byName = accounts.find((a) => words.some((w) => a.label.normalize("NFKC").includes(w)));
  return (byName ?? accounts[0]!).key;
}

/** 銀行對帳：上傳網路銀行下載的交易明細，跟這個帳戶的紀錄核對 */
export function BankSyncPage({
  ledgerId,
  currency,
  accountId,
  onBack,
}: {
  ledgerId: string;
  currency: string;
  accountId: string;
  onBack: () => void;
}) {
  const accounts = useAccounts(ledgerId);
  const categories = useCategories(ledgerId);
  const transactions = useAccountTransactions(ledgerId, accountId);
  const account = accounts?.find((a) => a.id === accountId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function onFile(file: File) {
    if (!transactions || !accounts || !categories) return;
    setError(null);
    setReading(true);
    try {
      const whole = parseStatement(await readSheetFile(file));
      const saved = loadAccountNo(accountId);
      const key = whole.accounts.length > 1 && account ? guessAccount(whole.accounts, account, saved) : whole.accounts[0]!.key;
      setLoaded(load(file.name, whole, key, saved));
    } catch (err) {
      if (err instanceof SheetFormatError || err instanceof StatementFormatError) setError(err.message);
      else setError(`讀取失敗：${err instanceof Error ? err.message : err}`);
    } finally {
      setReading(false);
    }
  }

  function load(fileName: string, whole: Statement, key: string, saved: string | null): Loaded {
    const stmt = whole.accounts.length > 1 ? pickAccount(whole, key) : whole;
    return {
      fileName,
      file: whole,
      accountKey: key,
      stmt,
      plan: reconcile(stmt, transactions!, accountId),
      previousAccountNo: saved,
    };
  }

  if (!accounts || !categories || !transactions) return null;
  if (!account) {
    return (
      <div className="page">
        <ManageHeader title="銀行對帳" onBack={onBack} backLabel="帳戶" />
        <div className="empty">找不到這個帳戶。</div>
      </div>
    );
  }

  return (
    <div className="page">
      <ManageHeader title="銀行對帳" onBack={onBack} backLabel={account.name} />
      {loaded ? (
        <Review
          key={`${loaded.fileName} ${loaded.accountKey}`}
          onPickAccount={(key) => setLoaded(load(loaded.fileName, loaded.file, key, loaded.previousAccountNo))}
          ledgerId={ledgerId}
          currency={currency}
          account={account}
          accounts={accounts}
          categories={categories}
          transactions={transactions}
          loaded={loaded}
          onReset={() => setLoaded(null)}
          onDone={onBack}
        />
      ) : (
        <>
          <div className="card acct-hero">
            <div>
              從網路銀行下載「交易明細」（Excel 或 CSV），上傳後會跟「{account.name}」的紀錄核對：
            </div>
            <ul className="sync-intro">
              <li>銀行有、這裡沒有的 → 新增</li>
              <li>日期、時間或金額不同的 → 更正成銀行的</li>
              <li>這裡有、銀行沒有的 → 列出來讓你決定要不要刪</li>
            </ul>
            <div className="muted">
              套用前都可以逐筆確認。目前支援玉山銀行的「交易明細」和永豐銀行「智慧收支帳本」的匯出（要先在 Excel
              拿掉檔案密碼），其他銀行欄位名稱相近也讀得懂。
            </div>
          </div>
          <label className={`btn primary block file-btn${reading ? " disabled" : ""}`}>
            {reading ? "讀取中…" : "選擇對帳單檔案"}
            <input
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              disabled={reading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onFile(f);
              }}
            />
          </label>
          {error && (
            <div className="banner sync-error" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Review({
  ledgerId,
  currency,
  account,
  accounts,
  categories,
  transactions,
  loaded,
  onPickAccount,
  onReset,
  onDone,
}: {
  ledgerId: string;
  currency: string;
  account: Account;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  loaded: Loaded;
  onPickAccount: (key: string) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const { stmt, plan } = loaded;
  const accountId = account.id;
  const corrections = plan.matches.filter((m) => hasChanges(m.changes));
  const unchanged = plan.matches.length - corrections.length;

  const [drafts, setDrafts] = useState<Map<number, Draft>>(() => {
    const knownNumbers = new Map<string, string>();
    for (const a of accounts) {
      const no = loadAccountNo(a.id);
      if (no) knownNumbers.set(a.id, no);
    }
    return new Map(plan.creations.map((b) => [b.line, suggestDraft(b, transactions, accountId, accounts, categories, knownNumbers)]));
  });
  // 開始記這個帳戶（建立帳戶）之前的交易：當時的餘額已經算進初始金額，預設不匯入。
  // 不然轉帳的另一邊（例如 ATM 提款轉進「現金」）會憑空多出錢。
  const startDate = toDateStr(new Date(account.created_at));
  const recent = plan.creations.filter((b) => b.date >= startDate);
  const older = plan.creations.filter((b) => b.date < startDate);
  const [createSel, setCreateSel] = useState<Set<number>>(() => new Set(recent.map((b) => b.line)));
  const [fixSel, setFixSel] = useState<Set<string>>(() => new Set(corrections.map((m) => m.tx.id)));
  const [removeSel, setRemoveSel] = useState<Set<string>>(() => new Set());
  const [adjustInitial, setAdjustInitial] = useState(true);
  const [busy, setBusy] = useState(false);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  // ── 套用後的帳戶餘額（到對帳單最後一天），跟銀行的餘額比 ──
  const lastWithBalance = [...stmt.rows].reverse().find((r) => r.balance !== null);
  const bankBalance = lastWithBalance?.balance ?? null;
  let projected = account.initial_balance ?? 0;
  const fixById = new Map(corrections.filter((m) => fixSel.has(m.tx.id)).map((m) => [m.tx.id, m]));
  for (const t of transactions) {
    if (removeSel.has(t.id)) continue;
    const fix = fixById.get(t.id);
    const date = fix?.changes.date ?? t.date;
    if (date > stmt.end) continue;
    projected += fix?.amountFix ? fix.bank.delta : accountDelta(t, accountId);
  }
  for (const b of plan.creations) if (createSel.has(b.line)) projected += b.delta;
  const balanceDiff = bankBalance === null ? 0 : bankBalance - projected;

  const total = createSel.size + fixSel.size + removeSel.size + (balanceDiff !== 0 && adjustInitial ? 1 : 0);
  const accountNoChanged =
    loaded.previousAccountNo !== null && stmt.accountNo !== null && loaded.previousAccountNo !== stmt.accountNo;

  async function apply() {
    setBusy(true);
    try {
      const ops: BankSyncOps = {
        create: plan.creations
          .filter((b) => createSel.has(b.line))
          .map((b) => draftToInput(b, drafts.get(b.line)!, accountId)),
        update: corrections.filter((m) => fixSel.has(m.tx.id)).map((m) => ({ id: m.tx.id, changes: m.changes })),
        remove: [...removeSel],
        initialBalance:
          balanceDiff !== 0 && adjustInitial
            ? { accountId, value: (account.initial_balance ?? 0) + balanceDiff }
            : undefined,
      };
      await applyBankSync(ledgerId, ops);
      if (stmt.accountNo) saveAccountNo(accountId, stmt.accountNo);
      const parts = [
        ops.create.length && `新增 ${ops.create.length} 筆`,
        ops.update.length && `更正 ${ops.update.length} 筆`,
        ops.remove.length && `刪除 ${ops.remove.length} 筆`,
        ops.initialBalance && "調整初始金額",
      ].filter(Boolean);
      toast(parts.length ? `已${parts.join("、")}` : "沒有要變更的");
      onDone();
    } catch (err) {
      toast(`套用失敗：${err instanceof Error ? err.message : err}`);
      setBusy(false);
    }
  }

  const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  const setLines = (set: Set<number>, rows: BankRow[], on: boolean) => {
    const next = new Set(set);
    for (const b of rows) {
      if (on) next.add(b.line);
      else next.delete(b.line);
    }
    return next;
  };

  const creationRow = (b: BankRow) => (
    <CreationRow
      key={b.line}
      row={b}
      draft={drafts.get(b.line)!}
      onDraft={(d) => setDrafts(new Map(drafts).set(b.line, d))}
      selected={createSel.has(b.line)}
      onSelect={(on) => setCreateSel(toggle(createSel, b.line, on))}
      accountId={accountId}
      accounts={accounts}
      categories={categories}
      currency={currency}
    />
  );

  const txLabel = (t: Transaction) => {
    if (t.kind === "transfer") {
      const out = t.account_id === accountId;
      const other = out ? t.to_account_id : t.account_id;
      return `轉帳${out ? " → " : " ← "}${(other && accName.get(other)) || "其他帳戶"}`;
    }
    return categoryInfo(t.category_id, catById).label;
  };

  return (
    <>
      <div className="card acct-hero">
        <div className="acct-label">{loaded.fileName}</div>
        <div className="sync-summary">
          {loaded.file.accounts.length > 1 ? (
            <label className="field sync-account-pick">
              <span className="label">這個檔案有 {loaded.file.accounts.length} 個帳戶，要跟「{account.name}」對帳的是：</span>
              <select className="input" value={loaded.accountKey} onChange={(e) => onPickAccount(e.target.value)}>
                {loaded.file.accounts.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label || "（沒有名稱）"}（{a.count} 筆）
                  </option>
                ))}
              </select>
            </label>
          ) : (
            stmt.accountLabel && <div>帳號 {stmt.accountLabel}</div>
          )}
          <div>
            {shortDate(stmt.start)} ～ {shortDate(stmt.end)}，共 {stmt.rows.length} 筆
          </div>
        </div>
        <div className="acct-stats">
          <span>
            新增 <b>{recent.length}</b>
          </span>
          {older.length > 0 && (
            <span>
              記帳開始前 <b>{older.length}</b>
            </span>
          )}
          <span>
            更正 <b>{corrections.length}</b>
          </span>
          <span>
            銀行沒有 <b>{plan.missing.length}</b>
          </span>
          <span>
            已一致 <b>{unchanged}</b>
          </span>
        </div>
      </div>

      {accountNoChanged && (
        <div className="banner" role="alert">
          這份對帳單的帳號（{stmt.accountNo}）跟上次匯入「{account.name}」的不同（{loaded.previousAccountNo}），確定是同一個帳戶嗎？
        </div>
      )}
      {stmt.balanceMismatches > 0 && (
        <div className="banner" role="alert">
          對帳單裡有 {stmt.balanceMismatches} 筆的餘額前後對不起來，檔案可能不完整，請仔細確認。
        </div>
      )}

      {recent.length > 0 && (
        <>
          <SectionTitle
            title={`新增（銀行有、這裡沒有）${recent.length} 筆`}
            allOn={recent.every((b) => createSel.has(b.line))}
            onAll={(on) => setCreateSel(setLines(createSel, recent, on))}
          />
          <div className="card list">{recent.map(creationRow)}</div>
        </>
      )}

      {corrections.length > 0 && (
        <>
          <SectionTitle
            title={`更正成銀行的 ${corrections.length} 筆`}
            allOn={fixSel.size === corrections.length}
            onAll={(on) => setFixSel(new Set(on ? corrections.map((m) => m.tx.id) : []))}
          />
          <div className="card list">
            {corrections.map((m) => (
              <CheckRow
                key={m.tx.id}
                checked={fixSel.has(m.tx.id)}
                onChange={(on) => setFixSel(toggle(fixSel, m.tx.id, on))}
                title={txLabel(m.tx) + (m.tx.note ? ` · ${m.tx.note}` : "")}
                sub={
                  <>
                    <ChangeList match={m} accountId={accountId} currency={currency} />
                    <div>銀行：{bankTitle(m.bank)}</div>
                  </>
                }
                amount={m.bank.delta}
                currency={currency}
              />
            ))}
          </div>
        </>
      )}

      {plan.missing.length > 0 && (
        <>
          <SectionTitle
            title={`銀行沒有這筆 ${plan.missing.length} 筆`}
            allOn={removeSel.size === plan.missing.length}
            onAll={(on) => setRemoveSel(new Set(on ? plan.missing.map((t) => t.id) : []))}
            allLabel="全部刪除"
          />
          <p className="muted hint">可能是記錯帳戶、重複記，或銀行還沒入帳。勾選的會刪除。</p>
          <div className="card list">
            {plan.missing.map((t) => (
              <CheckRow
                key={t.id}
                checked={removeSel.has(t.id)}
                onChange={(on) => setRemoveSel(toggle(removeSel, t.id, on))}
                title={txLabel(t) + (t.note ? ` · ${t.note}` : "")}
                sub={`${shortDate(t.date)}${t.time ? ` ${t.time}` : ""}`}
                amount={accountDelta(t, accountId)}
                currency={currency}
                danger
              />
            ))}
          </div>
        </>
      )}

      {older.length > 0 && (
        <>
          <SectionTitle
            title={`記帳開始前（${shortDate(startDate)} 以前）${older.length} 筆`}
            allOn={older.every((b) => createSel.has(b.line))}
            onAll={(on) => setCreateSel(setLines(createSel, older, on))}
          />
          <p className="muted hint">
            你從 {shortDate(startDate)} 開始記「{account.name}」，這些交易在那之前，當時的餘額已經算進初始金額，所以預設不匯入。
            想補歷史紀錄才勾選；注意轉帳會連另一個帳戶（例如現金）的餘額一起改。
          </p>
          <div className="card list">{older.map(creationRow)}</div>
        </>
      )}

      {plan.creations.length === 0 && corrections.length === 0 && plan.missing.length === 0 && (
        <div className="empty">
          <div className="big">✅</div>
          全部 {plan.matches.length} 筆都跟銀行一致
        </div>
      )}

      {bankBalance !== null && (
        <>
          <div className="section-title">餘額核對（{shortDate(stmt.end)}）</div>
          <div className="card list">
            <div className="list-row">
              <span className="grow">銀行餘額</span>
              <span className="money">{formatMoney(bankBalance, currency)}</span>
            </div>
            <div className="list-row">
              <span className="grow">
                套用後這裡的餘額
                {balanceDiff === 0 && <div className="sub ok-text">一致 ✓</div>}
              </span>
              <span className={`money${projected < 0 ? " negative" : ""}`}>{formatMoney(projected, currency)}</span>
            </div>
            {balanceDiff !== 0 && (
              <label className="list-row check-row">
                <input type="checkbox" checked={adjustInitial} onChange={(e) => setAdjustInitial(e.target.checked)} />
                <span className="grow">
                  <div>調整初始金額，讓餘額一致</div>
                  <div className="sub">
                    差 {formatMoney(balanceDiff, currency)}：初始金額 {formatMoney(account.initial_balance ?? 0, currency)} →{" "}
                    {formatMoney((account.initial_balance ?? 0) + balanceDiff, currency)}
                    。通常是對帳單期間之前的紀錄不完整。
                  </div>
                </span>
              </label>
            )}
          </div>
        </>
      )}

      <div className="sync-actions">
        <button className="btn" disabled={busy} onClick={onReset}>
          換一個檔案
        </button>
        <button className="btn primary grow" disabled={busy || total === 0} onClick={() => void apply()}>
          {busy ? "套用中…" : total === 0 ? "沒有要變更的" : `套用 ${total} 項變更`}
        </button>
      </div>
    </>
  );
}

function SectionTitle({
  title,
  allOn,
  onAll,
  allLabel = "全選",
}: {
  title: string;
  allOn: boolean;
  onAll: (on: boolean) => void;
  allLabel?: string;
}) {
  return (
    <div className="section-title month-title">
      <span>{title}</span>
      <button className="link-btn" onClick={() => onAll(!allOn)}>
        {allOn ? "全不選" : allLabel}
      </button>
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  title,
  sub,
  amount,
  currency,
  danger,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  sub: ReactNode;
  amount: number;
  currency: string;
  danger?: boolean;
}) {
  return (
    <label className={`list-row check-row${danger ? " danger-check" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="grow">
        <div className="ellipsis">{title}</div>
        <div className="sub">{sub}</div>
      </span>
      <SignedMoney value={amount} currency={currency} />
    </label>
  );
}

function SignedMoney({ value, currency }: { value: number; currency: string }) {
  return (
    <span className={`money sync-amount${value < 0 ? " negative" : " positive"}`}>
      {value > 0 ? "+" : ""}
      {formatMoney(value, currency)}
    </span>
  );
}

function ChangeList({ match, accountId, currency }: { match: Match; accountId: string; currency: string }) {
  const { tx, changes, bank } = match;
  const parts: string[] = [];
  if (changes.date) parts.push(`日期 ${shortDate(tx.date)} → ${shortDate(changes.date)}`);
  if (changes.time) parts.push(tx.time ? `時間 ${tx.time} → ${changes.time}` : `補上時間 ${changes.time}`);
  if (match.amountFix) {
    parts.push(`金額 ${formatMoney(Math.abs(accountDelta(tx, accountId)), currency)} → ${formatMoney(Math.abs(bank.delta), currency)}`);
  }
  return <div className="sync-change">{parts.join(" · ")}</div>;
}

function CreationRow({
  row,
  draft,
  onDraft,
  selected,
  onSelect,
  accountId,
  accounts,
  categories,
  currency,
}: {
  row: BankRow;
  draft: Draft;
  onDraft: (d: Draft) => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
  accountId: string;
  accounts: Account[];
  categories: Category[];
  currency: string;
}) {
  const outgoing = row.delta < 0;
  const others = accounts.filter((a) => a.deleted_at === null && a.id !== accountId);
  const plainKind = outgoing ? "expense" : "income";
  const cats = categories.filter((c) => c.deleted_at === null && c.kind === plainKind);
  const tops = cats.filter((c) => c.parent_id === null);

  return (
    <div className={`list-row sync-create${selected ? "" : " off"}`}>
      <label className="check-row sync-create-head">
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} />
        <span className="grow">
          <div className="ellipsis">{bankNote(row) || "（沒有摘要）"}</div>
          <div className="sub">
            {shortDate(row.date)}
            {row.time && ` ${row.time}`}
            {row.counterparty && ` · ${row.counterparty}`}
            {row.fee > 0 && ` · 手續費 ${formatMoney(row.fee, currency)}`}
          </div>
        </span>
        <SignedMoney value={row.delta} currency={currency} />
      </label>
      {selected && (
        <div className="sync-create-edit">
          {others.length > 0 && (
            <Segmented
              value={draft.kind === "transfer" ? "transfer" : plainKind}
              onChange={(k) =>
                onDraft(
                  k === "transfer"
                    ? { kind: "transfer", category_id: null, other_account_id: draft.other_account_id ?? others[0]!.id }
                    : { kind: k, category_id: draft.category_id, other_account_id: null },
                )
              }
              options={[
                { value: plainKind, label: outgoing ? "支出" : "收入" },
                { value: "transfer", label: outgoing ? "轉出" : "轉入" },
              ]}
            />
          )}
          {draft.kind === "transfer" ? (
            <select
              className="input sync-select"
              aria-label={outgoing ? "轉入帳戶" : "從哪個帳戶轉入"}
              value={draft.other_account_id ?? ""}
              onChange={(e) => onDraft({ ...draft, other_account_id: e.target.value })}
            >
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {outgoing ? "轉到 " : "來自 "}
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="input sync-select"
              aria-label="分類"
              value={draft.category_id ?? ""}
              onChange={(e) => onDraft({ ...draft, category_id: e.target.value || null })}
            >
              <option value="">未分類</option>
              {tops.map((top) => [
                <option key={top.id} value={top.id}>
                  {top.icon} {top.name}
                </option>,
                ...cats
                  .filter((c) => c.parent_id === top.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {"　　"}
                      {c.name}
                    </option>
                  )),
              ])}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function bankTitle(b: BankRow): string {
  return `${shortDate(b.date)}${b.time ? ` ${b.time}` : ""} ${bankNote(b)}`.trim();
}

function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return y === new Date().getFullYear() ? `${m}/${d}` : `${y}/${m}/${d}`;
}
