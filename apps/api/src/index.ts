import { Hono } from "hono";
import type { Ledger, MeResponse } from "@accounting/shared";
import { getVerifiedEmail } from "./auth";
import { latestBackup, runBackup } from "./backup";
import type { AppEnv, HonoEnv } from "./env";
import { ensureDefaultLedger, ensureUser } from "./seed";
import { HttpError, pull, push } from "./sync";

const app = new Hono<HonoEnv>().basePath("/api");

// 所有 /api 都要登入
app.use("*", async (c, next) => {
  const email = await getVerifiedEmail(c.req.raw, c.env);
  if (!email) return c.json({ error: "unauthorized" }, 401);
  c.set("user", await ensureUser(c.env, email));
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

// 登入過期時 App 會整頁跳到這裡：Cloudflare Access 先要求登入，登入後回到首頁
app.get("/login", (c) => c.redirect("/"));

app.get("/me", async (c) => {
  const user = c.get("user");
  const defaultLedgerId = await ensureDefaultLedger(c.env, user);
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.name, l.currency, l.created_at, l.updated_at, l.deleted_at
     FROM ledgers l JOIN ledger_members m ON m.ledger_id = l.id
     WHERE m.user_id = ? AND l.deleted_at IS NULL ORDER BY m.created_at`,
  )
    .bind(user.id)
    .all<Ledger>();
  return c.json<MeResponse>({ user, ledgers: results, defaultLedgerId });
});

app.get("/sync/pull", async (c) => {
  const cursor = Number(c.req.query("cursor") ?? "0");
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, "cursor 格式錯誤");
  return c.json(await pull(c.env, c.get("user"), cursor));
});

app.post("/sync/push", async (c) => {
  const body = await c.req.json().catch(() => {
    throw new HttpError(400, "body 不是 JSON");
  });
  const accepted = await push(c.env, c.get("user"), body);
  return c.json({ ok: true, accepted });
});

app.get("/backup/latest", async (c) => c.json({ latest: await latestBackup(c.env) }));

app.post("/backup", async (c) => {
  const result = await runBackup(c.env);
  return c.json({ ok: true, key: result.key, bytes: result.bytes, rows: result.rows });
});

app.all("*", (c) => c.json({ error: "not found" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runBackup(env).then((r) =>
        console.log(`備份完成 ${r.key}：${r.rows} 筆、${r.bytes} bytes，刪除舊備份 ${r.deleted.length} 份`),
      ),
    );
  },
} satisfies ExportedHandler<AppEnv>;
