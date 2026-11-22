# 記帳本

個人記帳 App：手機上用的 PWA（可加入主畫面），離線也能記帳，有網路時自動同步到 Cloudflare，每天自動備份。

## 架構

```
手機 (PWA, React)
  記一筆 → IndexedDB（先存手機，離線也能用）
             ↓ 有網路時自動同步
Cloudflare Worker（同一個網址提供網頁 + /api）
  ├─ D1 資料庫（主要資料，內建 30 天時間點還原）
  ├─ Cron：每天台灣時間 02:00 → 匯出到 R2
  └─ R2：daily/YYYY-MM-DD.json.gz（保留 30 天）、monthly/YYYY-MM.json.gz（永久）
Cloudflare Access：只有白名單 email 能登入
```

| 目錄 | 內容 |
|---|---|
| `apps/web` | PWA 前端（React + Vite + Dexie） |
| `apps/api` | Cloudflare Worker：API、同步、備份排程、D1 migration |
| `packages/shared` | 前後端共用的資料格式與驗證（zod） |

### 同步規則

- 每筆資料的 id 由手機產生（UUID），網路不穩重送也不會重複。
- 每次修改更新 `updated_at`，衝突時以較新的為準。
- 刪除只標記 `deleted_at`，其他裝置才知道要刪。
- 金額存整數、最小單位 ×100（NT$12.50 → `1250`）。
- 伺服器每次寫入都遞增一個全域版本號 `rev`，手機用 cursor 只拉新的變更。

## 本機開發

需要 Node.js 22 以上。

```powershell
npm install
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
npm run db:migrate:local
npm run dev
```

打開 http://localhost:5173 。本機沒有 Cloudflare Access，會用 `.dev.vars` 裡的 `DEV_USER_EMAIL` 當作已登入（只在 localhost 生效）。

> Windows 若開啟了「智慧型應用程式控制」，rollup 的原生模組會被擋，所以 `package.json` 用 `overrides` 改用 `@rollup/wasm-node`。

## 部署到 Cloudflare（第一次）

1. 登入：`npx wrangler login`
2. 建立資料庫，把輸出的 `database_id` 貼到 `apps/api/wrangler.jsonc`：
   `npx wrangler d1 create accounting`
3. 建立備份用的 R2 bucket（R2 需要先在 Cloudflare 綁定付款方式，免費額度內不收費）：
   `npx wrangler r2 bucket create accounting-backups`
4. 部署（會先建置網頁、套用 migration）：`npm run deploy`
5. 設定 Cloudflare Access（只有你能登入）：
   - **Workers & Pages → accounting → Settings → Domains & Routes**，在 `workers.dev` 那列選 **Enable Cloudflare Access**。記下跳出來的 **AUD Tag** 和 `xxx.cloudflareaccess.com` 網域。
   - 一鍵開啟只會保護「preview URLs」。到 **Zero Trust → Access → Applications** 編輯這個應用程式，在 Destinations 加上正式網址（Public hostname：`accounting` + `<你的子網域>.workers.dev`）。
   - 預設只能用 Cloudflare 帳號登入。到 **Zero Trust → Settings → Authentication** 新增 **One-time PIN**，並在應用程式的 Login methods 勾選它，手機才能用 email 驗證碼登入。
   - Policy 設成 Allow，Include → Emails → 你的 email。
6. 設定機密（不會進 git）：
   ```powershell
   cd apps/api
   npx wrangler secret put ACCESS_TEAM_DOMAIN   # 例如 myteam.cloudflareaccess.com
   npx wrangler secret put ACCESS_AUD           # 第 5 步的 AUD Tag
   npx wrangler secret put ALLOWED_EMAILS       # 你的 email，多個用逗號分隔
   ```
7. 手機打開網址 → 登入 → 「加入主畫面」。

之後更新只要 `npm run deploy`。

## 還原備份

- **30 天內誤刪**：D1 Time Travel，`npx wrangler d1 time-travel restore accounting --timestamp=<時間>`
- **從 R2 備份檔**：在 Cloudflare 後台下載 `daily/*.json.gz`，解壓後是每張資料表的 JSON。

## 之後的功能

- 和家人共用帳本（資料表已預留 `ledger_members`；加入新成員時要讓他從 cursor 0 重新同步）
- 預算、多幣別、收據拍照、匯入銀行對帳單
