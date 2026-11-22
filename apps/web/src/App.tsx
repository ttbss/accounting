import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Transaction } from "@accounting/shared";
import { relogin } from "./lib/api";
import { getMeta, type Session } from "./lib/db";
import { currentMonth } from "./lib/format";
import { startAutoSync, syncNow } from "./lib/sync";
import { AccountDetailPage, AccountsListPage } from "./components/AccountsTab";
import { AccountsPage, CategoriesPage } from "./components/ManagePages";
import { OverviewPage } from "./components/OverviewPage";
import { SettingsPage } from "./components/SettingsPage";
import { TransactionSheet } from "./components/TransactionSheet";
import { TransactionsPage } from "./components/TransactionsPage";
import { ToastHost, useSyncState } from "./components/ui";

type Tab = "list" | "overview" | "accounts" | "settings";
type SubPage = "categories" | "accounts" | null;

export function App() {
  useEffect(() => startAutoSync(), []);
  const loaded = useLiveQuery(async () => ({ session: (await getMeta("session")) ?? null }));

  if (!loaded) return null;
  if (!loaded.session) return <FirstRun />;
  return <Main session={loaded.session} />;
}

/** 第一次開啟：要連上網路，向伺服器拿帳本和預設分類 */
function FirstRun() {
  const state = useSyncState();
  return (
    <div className="center-screen">
      <img src="/icon.svg" alt="" />
      {state.kind === "offline" ? (
        <>
          <div>第一次使用需要連上網路</div>
          <button className="btn primary" onClick={() => void syncNow()}>
            重試
          </button>
        </>
      ) : state.kind === "auth" ? (
        <>
          <div>請先登入</div>
          <button className="btn primary" onClick={relogin}>
            登入
          </button>
        </>
      ) : state.kind === "error" ? (
        <>
          <div>發生錯誤</div>
          <div className="muted">{state.message}</div>
          <button className="btn primary" onClick={() => void syncNow()}>
            重試
          </button>
        </>
      ) : (
        <div className="muted">正在準備你的帳本…</div>
      )}
    </div>
  );
}

function Main({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("list");
  const [sub, setSub] = useState<SubPage>(null);
  const [month, setMonth] = useState(currentMonth);
  const [sheet, setSheet] = useState<{ editing?: Transaction } | null>(null);
  /** 帳戶分頁裡正在看的帳戶 */
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const { ledgerId, currency } = session;

  function go(t: Tab) {
    setTab(t);
    setSub(null);
    setOpenAccount(null);
    window.scrollTo(0, 0);
  }

  return (
    <div className="app">
      {tab === "list" && (
        <TransactionsPage
          ledgerId={ledgerId}
          currency={currency}
          month={month}
          onMonthChange={setMonth}
          onEdit={(t) => setSheet({ editing: t })}
        />
      )}
      {tab === "overview" && (
        <OverviewPage ledgerId={ledgerId} currency={currency} month={month} onMonthChange={setMonth} />
      )}
      {tab === "accounts" && openAccount === null && (
        <AccountsListPage
          ledgerId={ledgerId}
          currency={currency}
          onOpen={(id) => {
            setOpenAccount(id);
            window.scrollTo(0, 0);
          }}
        />
      )}
      {tab === "accounts" && openAccount !== null && (
        <AccountDetailPage
          ledgerId={ledgerId}
          currency={currency}
          accountId={openAccount}
          onBack={() => setOpenAccount(null)}
          onEdit={(t) => setSheet({ editing: t })}
        />
      )}
      {tab === "settings" && sub === null && <SettingsPage session={session} onOpen={setSub} />}
      {tab === "settings" && sub === "categories" && <CategoriesPage ledgerId={ledgerId} onBack={() => setSub(null)} />}
      {tab === "settings" && sub === "accounts" && <AccountsPage ledgerId={ledgerId} currency={currency} onBack={() => setSub(null)} />}

      {tab !== "settings" && (
        <button className="fab" aria-label="記一筆" onClick={() => setSheet({})}>
          ＋
        </button>
      )}

      <nav className="tabbar">
        <div className="tabbar-inner">
          <TabButton icon="🧾" label="明細" active={tab === "list"} onClick={() => go("list")} />
          <TabButton icon="📊" label="總覽" active={tab === "overview"} onClick={() => go("overview")} />
          <TabButton icon="💳" label="帳戶" active={tab === "accounts"} onClick={() => go("accounts")} />
          <TabButton icon="⚙️" label="設定" active={tab === "settings"} onClick={() => go("settings")} />
        </div>
      </nav>

      {sheet && (
        <TransactionSheet
          ledgerId={ledgerId}
          editing={sheet.editing}
          currency={currency}
          defaultAccountId={tab === "accounts" ? (openAccount ?? undefined) : undefined}
          onClose={closeSheet}
        />
      )}
      <ToastHost />
    </div>
  );
}

function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="tab" aria-current={active ? "page" : undefined} onClick={onClick}>
      <span className="tab-icon" aria-hidden>
        {icon}
      </span>
      {label}
    </button>
  );
}
