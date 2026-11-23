/**
 * 讀銀行下載的對帳單檔案（.xlsx 或 .csv），變成一列一列的字串。
 *
 * 不用第三方套件：.xlsx 其實是 zip 包著幾個 XML，用瀏覽器內建的
 * DecompressionStream 解壓，再從 XML 取出第一個工作表的儲存格。
 */

export class SheetFormatError extends Error {}

export async function readSheetFile(file: File): Promise<string[][]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // zip 檔開頭是 "PK"
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
  // 舊版 .xls（二進位格式）開頭是 D0 CF 11 E0
  if (buf[0] === 0xd0 && buf[1] === 0xcf) {
    throw new SheetFormatError("不支援舊版 .xls，請從網路銀行下載 Excel（.xlsx）或 CSV 格式");
  }
  return parseCsv(decodeText(buf));
}

// ── CSV ──────────────────────────────────────────────────────────────

/** 台灣的銀行常給 Big5 編碼的 CSV；不是合法的 UTF-8 就當 Big5 */
function decodeText(buf: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("big5").decode(buf);
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // 有些銀行在儲存格前面加 = 或 ' 避免 Excel 把帳號當數字：="0012345"
  return rows.map((r) => r.map((c) => c.replace(/^="(.*)"$/, "$1").replace(/^'/, "")));
}

// ── XLSX ─────────────────────────────────────────────────────────────

async function readXlsx(buf: Uint8Array<ArrayBuffer>): Promise<string[][]> {
  const zip = readZipEntries(buf);
  const text = async (name: string) => {
    const entry = zip.get(name);
    return entry ? new TextDecoder().decode(await entry()) : null;
  };

  const sheetPath = await firstSheetPath(text);
  const sheetXml = sheetPath ? await text(sheetPath) : null;
  if (!sheetXml) throw new SheetFormatError("這個 Excel 檔裡找不到工作表");
  const shared = parseSharedStrings((await text("xl/sharedStrings.xml")) ?? "");
  return parseSheetXml(sheetXml, shared);
}

/** 依 workbook.xml 的順序找第一個工作表的檔案路徑 */
async function firstSheetPath(text: (name: string) => Promise<string | null>): Promise<string | null> {
  const workbook = (await text("xl/workbook.xml")) ?? "";
  const rels = (await text("xl/_rels/workbook.xml.rels")) ?? "";
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  if (rid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], "Id") !== rid) continue;
      const target = attr(m[0], "Target") ?? "";
      return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    }
  }
  return "xl/worksheets/sheet1.xml";
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) out.push(textRuns(m[1] ?? ""));
  return out;
}

/** 把 <t> 裡的文字接起來（跳過日文注音 <rPh>） */
function textRuns(xml: string): string {
  let s = "";
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += decodeXml(m[1]!);
  return s;
}

function parseSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(attr(rm[1]!, "r")) || rows.length + 1;
    while (rows.length < rowNo - 1) rows.push([]);
    const row: string[] = [];
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const body = cm[2] ?? "";
      const ref = attr(attrs, "r");
      const col = ref ? columnIndex(ref) : row.length;
      const type = attr(attrs, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textRuns(body);
      else if (v !== undefined) value = decodeXml(v);
      while (row.length < col) row.push("");
      row[col] = value;
    }
    rows.push(row);
  }
  return rows;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()]!;
  });
}

// ── ZIP ──────────────────────────────────────────────────────────────

/** 檔名 → 取得解壓後內容的函式（用到才解壓） */
function readZipEntries(buf: Uint8Array<ArrayBuffer>): Map<string, () => Promise<Uint8Array>> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 從檔尾往前找 End of Central Directory（PK\5\6）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SheetFormatError("檔案壞掉了，無法讀取");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    entries.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method !== 8) throw new SheetFormatError("不支援這種壓縮格式");
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
  }
  return entries;
}
