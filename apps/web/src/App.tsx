import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Transaction } from "@accounting/shared";
import { relogin } from "./lib/api";
import { useBackLayer } from "./lib/back";
import { getMeta, type Session } from "./lib/db";
import { type Period, type PeriodUnit, todayStr } from "./lib/format";
import { startAutoSync, syncNow } from "./lib/sync";
import { AccountDetailPage, AccountsListPage } from "./components/AccountsTab";
import { BankSyncPage } from "./components/BankSyncPage";
import { AccountsPage, CategoriesPage } from "./components/ManagePages";
import { MerchantsPage } from "./components/MerchantsPage";
import { OverviewPage } from "./components/OverviewPage";
import { SettingsPage } from "./components/SettingsPage";
import { TransactionSheet } from "./components/TransactionSheet";
import { TransactionsPage } from "./components/TransactionsPage";
import { ToastHost, useSyncState } from "./components/ui";

type Tab = "list" | "overview" | "accounts" | "settings";
type SubPage = "categories" | "accounts" | "merchants" | null;

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
  // 每次打開都從今天開始，但記住上次看的是日／月／年
  const [period, setPeriodState] = useState<Period>(() => ({ unit: loadPeriodUnit(), anchor: todayStr() }));
  const setPeriod = useCallback((p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem("periodUnit", p.unit);
    } catch {
      /* 無痕模式等情況存不了，沒關係 */
    }
  }, []);
  const [sheet, setSheet] = useState<{ editing?: Transaction } | null>(null);
  /** 帳戶分頁裡正在看的帳戶 */
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  /** 正在對帳（帳戶明細上面再開一層） */
  const [bankSync, setBankSync] = useState(false);
  const closeSheet = useCallback(() => setSheet(null), []);

  const { ledgerId, currency } = session;

  function go(t: Tab) {
    setTab(t);
    setSub(null);
    setOpenAccount(null);
    setBankSync(false);
    window.scrollTo(0, 0);
  }

  // 手機按返回：先關子頁面，再回到「明細」分頁，最後才離開 App
  useBackLayer(tab !== "list", () => go("list"));
  useBackLayer(sub !== null, () => setSub(null));
  useBackLayer(openAccount !== null, () => {
    setOpenAccount(null);
    setBankSync(false);
  });
  useBackLayer(bankSync, () => setBankSync(false));

  return (
    <div className="app">
      {tab === "list" && (
        <TransactionsPage
          ledgerId={ledgerId}
          currency={currency}
          period={period}
          onPeriodChange={setPeriod}
          onEdit={(t) => setSheet({ editing: t })}
        />
      )}
      {tab === "overview" && (
        <OverviewPage
          ledgerId={ledgerId}
          currency={currency}
          period={period}
          onPeriodChange={setPeriod}
          onEdit={(t) => setSheet({ editing: t })}
        />
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
      {tab === "accounts" && openAccount !== null && bankSync && (
        <BankSyncPage
          ledgerId={ledgerId}
          currency={currency}
          accountId={openAccount}
          onBack={() => {
            setBankSync(false);
            window.scrollTo(0, 0);
          }}
        />
      )}
      {tab === "accounts" && openAccount !== null && !bankSync && (
        <AccountDetailPage
          ledgerId={ledgerId}
          currency={currency}
          accountId={openAccount}
          onBack={() => setOpenAccount(null)}
          onEdit={(t) => setSheet({ editing: t })}
          onBankSync={() => {
            setBankSync(true);
            window.scrollTo(0, 0);
          }}
        />
      )}
      {tab === "settings" && sub === null && <SettingsPage session={session} onOpen={setSub} />}
      {tab === "settings" && sub === "categories" && <CategoriesPage ledgerId={ledgerId} onBack={() => setSub(null)} />}
      {tab === "settings" && sub === "merchants" && (
        <MerchantsPage
          ledgerId={ledgerId}
          currency={currency}
          onBack={() => setSub(null)}
          onEdit={(t) => setSheet({ editing: t })}
        />
      )}
      {tab === "settings" && sub === "accounts" && <AccountsPage ledgerId={ledgerId} currency={currency} onBack={() => setSub(null)} />}

      {tab !== "settings" && !bankSync && (
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

function loadPeriodUnit(): PeriodUnit {
  try {
    const v = localStorage.getItem("periodUnit");
    if (v === "day" || v === "month" || v === "year") return v;
  } catch {
    /* 讀不到就用預設 */
  }
  return "month";
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
