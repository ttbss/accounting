import { useCallback, useEffect, useState } from "react";
import { api, AuthExpiredError, OfflineError, relogin } from "../lib/api";
import { exportCsv } from "../lib/csv";
import { usePendingCount } from "../lib/data";
import type { Session } from "../lib/db";
import { relativeTime } from "../lib/format";
import { syncNow } from "../lib/sync";
import { toast, useLastSyncAt, useSyncState, useTick } from "./ui";

export function SettingsPage({ session, onOpen }: { session: Session; onOpen: (p: "categories" | "accounts" | "merchants") => void }) {
  const state = useSyncState();
  const pending = usePendingCount() ?? 0;
  const lastSyncAt = useLastSyncAt();
  useTick();

  const [backup, setBackup] = useState<{ uploaded: string; bytes: number } | null | "unknown">("unknown");
  const [backingUp, setBackingUp] = useState(false);

  const loadBackup = useCallback(async () => {
    try {
      const { latest } = await api.latestBackup();
      setBackup(latest);
    } catch {
      setBackup("unknown");
    }
  }, []);

  useEffect(() => {
    void loadBackup();
  }, [loadBackup]);

  async function backupNow() {
    setBackingUp(true);
    try {
      await syncNow(); // 先把手機上的資料送上去，備份才完整
      await api.backupNow();
      toast("備份完成");
      await loadBackup();
    } catch (err) {
      if (err instanceof OfflineError) toast("沒有網路，無法備份");
      else if (err instanceof AuthExpiredError) relogin();
      else toast(`備份失敗：${err instanceof Error ? err.message : err}`);
    } finally {
      setBackingUp(false);
    }
  }

  async function onExport() {
    const { count } = await exportCsv(session.ledgerId);
    toast(`已匯出 ${count} 筆`);
  }

  let syncText = lastSyncAt ? `上次同步：${relativeTime(lastSyncAt)}` : "尚未同步";
  if (state.kind === "syncing") syncText = "同步中…";
  if (state.kind === "offline") syncText = "目前離線，有網路時會自動同步";
  if (state.kind === "auth") syncText = "登入已過期";
  if (state.kind === "error") syncText = `同步失敗：${state.message}`;

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">設定</h1>
      </header>

      <div className="section-title">同步</div>
      <div className="card list">
        <div className="list-row">
          <div className="grow">
            <div>{syncText}</div>
            <div className="sub">{pending > 0 ? `${pending} 筆還沒同步到雲端` : "所有資料都已在雲端"}</div>
          </div>
          {state.kind === "auth" ? (
            <button className="btn small primary" onClick={relogin}>
              重新登入
            </button>
          ) : (
            <button className="btn small" disabled={state.kind === "syncing"} onClick={() => void syncNow()}>
              立即同步
            </button>
          )}
        </div>
      </div>

      <div className="section-title">雲端備份</div>
      <div className="card list">
        <div className="list-row">
          <div className="grow">
            <div>
              {backup === "unknown"
                ? "連上網路後可查看"
                : backup
                  ? `最近備份：${relativeTime(Date.parse(backup.uploaded))}`
                  : "還沒有備份"}
            </div>
            <div className="sub">每天凌晨 2 點自動備份，保留 30 天，每月另存一份</div>
          </div>
          <button className="btn small" disabled={backingUp} onClick={backupNow}>
            {backingUp ? "備份中…" : "立即備份"}
          </button>
        </div>
        <button className="list-row" onClick={onExport}>
          <div className="grow">
            <div>匯出 CSV</div>
            <div className="sub">所有記帳紀錄，可用 Excel 開啟</div>
          </div>
          <span className="chev">›</span>
        </button>
      </div>

      <div className="section-title">管理</div>
      <div className="card list">
        <button className="list-row" onClick={() => onOpen("categories")}>
          <span className="grow">分類</span>
          <span className="chev">›</span>
        </button>
        <button className="list-row" onClick={() => onOpen("accounts")}>
          <span className="grow">帳戶</span>
          <span className="chev">›</span>
        </button>
        <button className="list-row" onClick={() => onOpen("merchants")}>
          <span className="grow">店家</span>
          <span className="chev">›</span>
        </button>
      </div>

      <div className="section-title">帳號</div>
      <div className="card list">
        <div className="list-row">
          <span className="grow">登入身分</span>
          <span className="value">{session.email}</span>
        </div>
      </div>
    </div>
  );
}
