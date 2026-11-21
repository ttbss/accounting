import { MAX_PUSH_ROWS, type PullResponse } from "@accounting/shared";
import { api, AuthExpiredError, OfflineError } from "./api";
import { clearLocalData, db, getMeta, type Local, setMeta, SYNCED_TABLES } from "./db";

/**
 * 同步引擎：先推送本機改過的資料，再拉伺服器上的新資料。
 *
 * 什麼時候同步：開啟 App、恢復網路、切回前景、每分鐘一次、以及每次記帳後 1 秒。
 * 同一時間只會跑一個同步；跑的時候又有人要求同步，跑完會再補跑一次。
 */

export type SyncState =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "offline" }
  | { kind: "auth" }
  | { kind: "error"; message: string };

let state: SyncState = { kind: "idle" };
const listeners = new Set<() => void>();

function setState(next: SyncState) {
  state = next;
  listeners.forEach((l) => l());
}

export const syncStore = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

let debounce: ReturnType<typeof setTimeout> | undefined;
/** 記帳後呼叫：稍等一下再同步，連續修改只會同步一次 */
export function requestSync(): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), 1000);
}

async function runOnce(): Promise<void> {
  setState({ kind: "syncing" });
  try {
    await ensureSession();
    await pushAll();
    await pullAll();
    await setMeta("lastSyncAt", Date.now());
    setState({ kind: "idle" });
  } catch (err) {
    if (err instanceof OfflineError) setState({ kind: "offline" });
    else if (err instanceof AuthExpiredError) setState({ kind: "auth" });
    else setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

/** 第一次開啟（或換了帳號）時，向伺服器取得使用者與帳本 */
async function ensureSession(): Promise<void> {
  const existing = await getMeta("session");
  if (existing && !navigator.onLine) return;
  const me = await api.me();
  if (existing && existing.userId === me.user.id) return;
  if (existing) await clearLocalData(); // 換了帳號
  const ledger = me.ledgers.find((l) => l.id === me.defaultLedgerId);
  await setMeta("session", {
    userId: me.user.id,
    email: me.user.email,
    ledgerId: me.defaultLedgerId,
    currency: ledger?.currency ?? "TWD",
  });
}

type AnyRow = Local<{ id: string; updated_at: number }>;

async function pushAll(): Promise<void> {
  for (;;) {
    // 一次最多 MAX_PUSH_ROWS 筆；帳戶、分類先送，記帳紀錄後送
    const batch: Record<(typeof SYNCED_TABLES)[number], AnyRow[]> = { accounts: [], categories: [], transactions: [] };
    let room = MAX_PUSH_ROWS;
    for (const t of SYNCED_TABLES) {
      if (room === 0) break;
      const rows = (await db[t].where("dirty").equals(1).limit(room).toArray()) as AnyRow[];
      batch[t] = rows;
      room -= rows.length;
    }
    if (room === MAX_PUSH_ROWS) return; // 沒有待推送的資料

    const strip = (rows: AnyRow[]) => rows.map(({ dirty: _dirty, ...rest }) => rest);
    await api.push({
      accounts: strip(batch.accounts) as never,
      categories: strip(batch.categories) as never,
      transactions: strip(batch.transactions) as never,
    });

    // 標記為已同步。若推送期間使用者又改了這筆（updated_at 變了），保持 dirty 下次再送。
    await db.transaction("rw", [db.accounts, db.categories, db.transactions], async () => {
      for (const t of SYNCED_TABLES) {
        const sent = batch[t];
        if (sent.length === 0) continue;
        const current = (await db[t].bulkGet(sent.map((r) => r.id))) as (AnyRow | undefined)[];
        const done = current.filter(
          (row, i): row is AnyRow => !!row && row.updated_at === sent[i]!.updated_at,
        );
        await Promise.all(done.map((row) => db[t].update(row.id, { dirty: 0 })));
      }
    });
  }
}

async function pullAll(): Promise<void> {
  let cursor = (await getMeta("cursor")) ?? 0;
  let res: PullResponse;
  do {
    res = await api.pull(cursor);
    const { changes } = res;
    const next = res.cursor;
    await db.transaction("rw", [db.ledgers, db.accounts, db.categories, db.transactions, db.meta], async () => {
      await merge(db.ledgers, changes.ledgers);
      await merge(db.accounts, changes.accounts);
      await merge(db.categories, changes.categories);
      await merge(db.transactions, changes.transactions);
      await setMeta("cursor", next);
    });
    cursor = next;
  } while (res.hasMore);
}

/** 伺服器的資料蓋過本機，除非本機有「還沒推送、而且比較新」的修改 */
async function merge<T extends { id: string; updated_at: number }>(
  table: { bulkGet(keys: string[]): Promise<(Local<T> | undefined)[]>; bulkPut(rows: Local<T>[]): Promise<unknown> },
  incoming: T[],
): Promise<void> {
  if (incoming.length === 0) return;
  const local = await table.bulkGet(incoming.map((r) => r.id));
  const toPut: Local<T>[] = [];
  incoming.forEach((row, i) => {
    const mine = local[i];
    if (mine && mine.dirty === 1 && mine.updated_at > row.updated_at) return;
    toPut.push({ ...row, dirty: 0 });
  });
  await table.bulkPut(toPut);
}

/** 啟動自動同步。回傳停止函式。 */
export function startAutoSync(): () => void {
  void syncNow();
  const onOnline = () => void syncNow();
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncNow();
  };
  const timer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) void syncNow();
  }, 60_000);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
