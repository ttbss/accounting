/**
 * 銀行對帳單（交易明細）→ 統一格式。
 *
 * 用表頭的欄位名稱找欄位，所以不同銀行只要表頭名稱在下面的清單裡就讀得懂。
 * 目前照這兩種格式寫：
 * - 玉山銀行「交易明細查詢下載」：
 *   交易日期｜交易時間｜摘要｜提｜手續費｜存｜帳戶餘額｜存摺備註｜銀行代號/帳號｜轉帳留言｜財金序號
 * - 永豐銀行「智慧收支帳本」匯出（一個檔案可能有好幾個帳戶，用「帳務資訊」分開；金額有正負號、已含手續費）：
 *   交易日｜帳務類型｜入帳日｜交易說明｜交易分類｜帳務資訊｜收入/支出｜金額｜原始交易金額｜帳戶餘額
 * 金額一律轉成最小單位 ×100 的整數。
 */

export interface BankRow {
  /** 在檔案裡的第幾列（從 1 開始，給人看的） */
  line: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM，沒有就是 null */
  time: string | null;
  /** HH:MM:SS，排序用 */
  timeFull: string;
  summary: string;
  memo: string;
  counterparty: string;
  message: string;
  serial: string;
  withdraw: number;
  deposit: number;
  fee: number;
  /** 這筆之後的帳戶餘額；沒有這欄就是 null */
  balance: number | null;
  /** 對帳戶餘額的影響：存 − 提 − 手續費 */
  delta: number;
  /** 銀行自己的分類（永豐的「交易分類」），沒有就是空字串 */
  category: string;
  /** 這筆屬於檔案裡的哪個帳戶（StatementAccount.key）；檔案沒有帳戶欄時是空字串 */
  account: string;
}

/** 檔案裡出現的帳戶（永豐的匯出一次會有好幾個） */
export interface StatementAccount {
  key: string;
  /** 例如「某某分行活期儲蓄存款(新台幣) 123-456-7890123-4」 */
  label: string;
  /** 帳號（只留數字） */
  no: string | null;
  count: number;
}

export interface Statement {
  /** 例如「0012345678901 臺幣綜存」 */
  accountLabel: string | null;
  /** 帳號（只留數字），用來提醒是不是傳錯帳戶的檔案 */
  accountNo: string | null;
  /** 查詢期間；檔案沒寫就用第一筆和最後一筆的日期 */
  start: string;
  end: string;
  /** 舊到新 */
  rows: BankRow[];
  /** 依餘額欄驗算，前後對不起來的筆數（0 = 都對得起來） */
  balanceMismatches: number;
  /** 檔案裡的所有帳戶；超過一個時要用 pickAccount 選一個再對帳 */
  accounts: StatementAccount[];
}

export class StatementFormatError extends Error {}

const HEADERS = {
  date: ["交易日期", "日期", "帳務日期", "交易日", "記帳日"],
  time: ["交易時間", "時間"],
  summary: ["摘要", "交易摘要", "說明", "交易說明", "交易類別", "交易項目"],
  withdraw: ["提", "支出", "提款", "提出", "支出金額", "提款金額", "轉出"],
  deposit: ["存", "存入", "收入", "存款", "存入金額", "存款金額", "轉入"],
  amount: ["金額", "交易金額"],
  fee: ["手續費"],
  balance: ["帳戶餘額", "餘額", "結餘", "結存"],
  memo: ["存摺備註", "備註", "附註"],
  counterparty: ["銀行代號/帳號", "對方帳號", "轉出入帳號", "轉入帳號", "對方銀行帳號"],
  message: ["轉帳留言", "留言", "附言"],
  serial: ["財金序號", "序號", "交易序號"],
  category: ["交易分類"],
  account: ["帳務資訊", "帳戶資訊", "帳戶名稱"],
} as const;

type Field = keyof typeof HEADERS;

const norm = (s: string) => (s ?? "").normalize("NFKC").replace(/\s+/g, "").trim();

export function parseStatement(rows: string[][]): Statement {
  // 找表頭：同時有日期欄、和提／存（或金額）欄的那一列
  let headerAt = -1;
  let cols: Partial<Record<Field, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 40) && headerAt < 0; r++) {
    const found: Partial<Record<Field, number>> = {};
    rows[r]!.forEach((cell, c) => {
      const h = norm(cell);
      for (const f of Object.keys(HEADERS) as Field[]) {
        if (found[f] === undefined && (HEADERS[f] as readonly string[]).includes(h)) found[f] = c;
      }
    });
    if (found.date !== undefined && (found.withdraw !== undefined || found.deposit !== undefined || found.amount !== undefined)) {
      headerAt = r;
      cols = found;
    }
  }
  if (headerAt < 0) throw new StatementFormatError("看不懂這個檔案：找不到「交易日期」和「提／存」欄位");

  // 表頭上面的資訊：帳號、查詢期間
  let accountLabel: string | null = null;
  let period: [string, string] | null = null;
  for (const row of rows.slice(0, headerAt)) {
    const cells = row.map((c) => (c ?? "").trim());
    const at = cells.findIndex((c) => c !== "");
    if (at < 0) continue;
    // 標籤在第一個有字的格子（永豐的檔案從 B 欄開始）
    const label = norm(cells[at]!).replace(/[:：]$/, "");
    const value = cells.slice(at + 1).find((c) => c !== "") ?? "";
    if (label === "帳號" || label === "帳戶") accountLabel = clean(value) || null;
    if (label.includes("期間") || label === "日期區間") {
      const [a, b] = value.split(/\s*[~～至]\s*|\s+-\s+/).map((s) => parseDate(s));
      if (a && b) period = [a, b];
    }
  }

  const get = (row: string[], f: Field) => (cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim());
  const parsed: BankRow[] = [];
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const date = parseDate(get(row, "date"));
    if (!date) continue; // 空白列、檔尾的說明文字
    let withdraw = parseMoney(get(row, "withdraw"));
    let deposit = parseMoney(get(row, "deposit"));
    if (cols.withdraw === undefined && cols.deposit === undefined) {
      const signed = parseMoney(get(row, "amount"), true);
      withdraw = signed < 0 ? -signed : 0;
      deposit = signed > 0 ? signed : 0;
    }
    const fee = parseMoney(get(row, "fee"));
    if (withdraw === 0 && deposit === 0 && fee === 0) continue;
    const t = parseTime(get(row, "time"));
    const balanceCell = get(row, "balance");
    parsed.push({
      line: r + 1,
      date,
      time: t ? t.slice(0, 5) : null,
      timeFull: t ?? "",
      summary: clean(get(row, "summary")),
      memo: clean(get(row, "memo")),
      counterparty: clean(get(row, "counterparty")),
      message: clean(get(row, "message")),
      serial: clean(get(row, "serial")),
      withdraw,
      deposit,
      fee,
      balance: cols.balance !== undefined && balanceCell !== "" ? parseMoney(balanceCell, true) : null,
      delta: deposit - withdraw - fee,
      category: clean(get(row, "category")),
      account: accountKey(get(row, "account")),
    });
  }
  if (parsed.length === 0) throw new StatementFormatError("這個檔案裡沒有交易紀錄");

  // 檔案裡的帳戶（依筆數多到少）
  const byKey = new Map<string, StatementAccount>();
  for (const r of parsed) {
    const a = byKey.get(r.account);
    if (a) a.count++;
    else {
      const label = clean(get(rows[r.line - 1]!, "account"));
      byKey.set(r.account, { key: r.account, label, no: accountNumber(label), count: 1 });
    }
  }
  const accounts = [...byKey.values()].sort((a, b) => b.count - a.count);

  // 銀行通常新的在上面；統一成舊到新。同一秒的多筆，維持檔案裡的相對順序。
  const fileNewestFirst = parsed[0]!.date + parsed[0]!.timeFull > parsed.at(-1)!.date + parsed.at(-1)!.timeFull;
  const ordered = fileNewestFirst ? [...parsed].reverse() : parsed;
  ordered.sort((a, b) => a.date.localeCompare(b.date) || a.timeFull.localeCompare(b.timeFull));

  const checked = checkBalances(ordered);
  const single = accounts.length === 1 ? accounts[0]! : null;
  const label = accountLabel ?? (single?.label || null);
  return {
    accountLabel: label,
    accountNo: single?.no ?? accountNumber(label ?? ""),
    start: period?.[0] ?? ordered[0]!.date,
    end: period?.[1] ?? ordered.at(-1)!.date,
    rows: checked.rows,
    balanceMismatches: checked.mismatches,
    accounts,
  };
}

/** 只留檔案裡某一個帳戶的紀錄（餘額要分開驗算） */
export function pickAccount(stmt: Statement, key: string): Statement {
  const acc = stmt.accounts.find((a) => a.key === key);
  if (!acc) return stmt;
  const checked = checkBalances(stmt.rows.filter((r) => r.account === key));
  return {
    ...stmt,
    accountLabel: acc.label || stmt.accountLabel,
    accountNo: acc.no,
    rows: checked.rows,
    balanceMismatches: checked.mismatches,
    accounts: [acc],
  };
}

/**
 * 用餘額欄驗算：上一筆餘額 + 這筆 = 這筆餘額。
 * 有的銀行「提」已經含手續費，這時候不另外扣手續費會比較對得起來。
 * 檔案裡有好幾個帳戶時，每個帳戶分開算。
 */
function checkBalances(rows: BankRow[]): { rows: BankRow[]; mismatches: number } {
  const mismatches = (list: BankRow[]) => {
    let bad = 0;
    const last = new Map<string, number | null>();
    for (const cur of list) {
      const prev = last.get(cur.account);
      if (prev !== undefined && prev !== null && cur.balance !== null && prev + cur.delta !== cur.balance) bad++;
      last.set(cur.account, cur.balance);
    }
    return bad;
  };
  const bad = mismatches(rows);
  if (bad > 0 && rows.some((r) => r.fee > 0)) {
    const feeIncluded = rows.map((r) => ({ ...r, delta: r.deposit - r.withdraw, fee: 0 }));
    const alt = mismatches(feeIncluded);
    if (alt < bad) return { rows: feeIncluded, mismatches: alt };
  }
  return { rows, mismatches: bad };
}

/** 「某某分行活期儲蓄存款(新台幣)\n123-456-7890123-4」→ 12345678901234 */
function accountNumber(label: string): string | null {
  const m = label.normalize("NFKC").match(/\d[\d-]{5,}\d/g);
  return m ? m.at(-1)!.replace(/-/g, "") : null;
}

/** 帳戶欄的值 → 分組用的 key：有帳號用帳號，沒有就用名稱 */
function accountKey(cell: string): string {
  return accountNumber(cell) ?? clean(cell);
}

function clean(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** 2026/11/17、*2026/10/31（非營業日）、2026-11-17、20261117、115/11/17（民國）、Excel 日期序號 */
export function parseDate(input: string): string | null {
  const s = norm(input).replace(/^[^\d]+/, "");
  if (!s) return null;
  let m = /^(\d{2,4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(s);
  if (!m && /^\d{8}$/.test(s)) m = [s, s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)] as unknown as RegExpExecArray;
  if (m) {
    let y = Number(m[1]);
    if (y < 1000) y += 1911; // 民國年
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // Excel 日期序號（1900 系統）：1 = 1900-01-01，含 Excel 把 1900 當閏年的錯誤
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

/** 回傳 HH:MM:SS */
function parseTime(input: string): string | null {
  const s = norm(input);
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    const h = Number(m[1]);
    if (h > 23 || Number(m[2]) > 59) return null;
    return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
  }
  // Excel 時間：一天的幾分之幾
  if (/^0?\.\d+$/.test(s)) {
    const sec = Math.round(Number(s) * 86_400);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(Math.floor(sec / 3600) % 24)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  }
  return null;
}

/** " 2,300" → 230000。signed = false 時取絕對值（提／存欄有的銀行會寫負號）。 */
function parseMoney(input: string, signed = false): number {
  let s = norm(input).replace(/[,$]|NT|TWD|元/gi, "");
  if (s === "" || s === "-") return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return 0;
  const value = Math.round(Number(s) * 100);
  return signed && negative ? -value : value;
}
