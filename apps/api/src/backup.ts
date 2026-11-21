import type { AppEnv } from "./env";

/**
 * 把整個資料庫匯出成 gzip 壓縮的 JSON，存到 R2：
 * - daily/YYYY-MM-DD.json.gz：每天一份，保留 BACKUP_RETENTION_DAYS 天
 * - monthly/YYYY-MM.json.gz：每天覆蓋，月底那份就成了該月的最終快照，永久保留
 *
 * 另外 D1 本身也有 Time Travel，可以還原到 30 天內任一時間點。
 */

const TABLES = ["users", "ledgers", "ledger_members", "accounts", "categories", "transactions"] as const;

export interface BackupResult {
  key: string;
  bytes: number;
  rows: number;
  deleted: string[];
}

export async function runBackup(env: AppEnv, now = new Date()): Promise<BackupResult> {
  const results = await env.DB.batch(TABLES.map((t) => env.DB.prepare(`SELECT * FROM ${t}`)));
  const tables = Object.fromEntries(TABLES.map((t, i) => [t, results[i]?.results ?? []]));
  const rows = Object.values(tables).reduce((n, r) => n + r.length, 0);

  const json = JSON.stringify({ format: "accounting-backup", version: 1, created_at: now.toISOString(), tables });
  const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();

  const tz = env.BACKUP_TIMEZONE || "Asia/Taipei";
  const day = localDate(now, tz);
  const options: R2PutOptions = {
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: { rows: String(rows), created_at: now.toISOString() },
  };
  const key = `daily/${day}.json.gz`;
  await env.BACKUPS.put(key, gz, options);
  await env.BACKUPS.put(`monthly/${day.slice(0, 7)}.json.gz`, gz, options);

  const retentionDays = Number(env.BACKUP_RETENTION_DAYS) || 30;
  const cutoff = localDate(new Date(now.getTime() - retentionDays * 86_400_000), tz);
  const deleted = await deleteDailyBefore(env.BACKUPS, cutoff);

  return { key, bytes: gz.byteLength, rows, deleted };
}

export async function latestBackup(env: AppEnv): Promise<{ key: string; uploaded: string; bytes: number } | null> {
  let latest: R2Object | null = null;
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: "daily/", cursor });
    for (const obj of page.objects) {
      if (!latest || obj.key > latest.key) latest = obj;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return latest ? { key: latest.key, uploaded: latest.uploaded.toISOString(), bytes: latest.size } : null;
}

async function deleteDailyBefore(bucket: R2Bucket, cutoffDay: string): Promise<string[]> {
  const old: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "daily/", cursor });
    for (const obj of page.objects) {
      const day = obj.key.slice("daily/".length, "daily/".length + 10);
      if (day < cutoffDay) old.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (old.length > 0) await bucket.delete(old);
  return old;
}

/** 指定時區的日期 YYYY-MM-DD */
function localDate(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
