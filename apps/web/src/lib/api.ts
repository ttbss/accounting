import type { MeResponse, PullResponse, PushRequest, PushResponse } from "@accounting/shared";

/** 沒網路或伺服器連不到 */
export class OfflineError extends Error {
  constructor() {
    super("無法連線");
  }
}

/** Cloudflare Access 的登入過期了（fetch 被轉址到登入頁，或回 401） */
export class AuthExpiredError extends Error {
  constructor() {
    super("登入已過期");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      redirect: "manual",
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new OfflineError();
  }
  if (res.type === "opaqueredirect" || res.status === 401) throw new AuthExpiredError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `伺服器錯誤 (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  pull: (cursor: number) => request<PullResponse>(`/api/sync/pull?cursor=${cursor}`),
  push: (body: PushRequest) => request<PushResponse>("/api/sync/push", { method: "POST", body: JSON.stringify(body) }),
  latestBackup: () =>
    request<{ latest: { key: string; uploaded: string; bytes: number } | null }>("/api/backup/latest"),
  backupNow: () => request<{ ok: true; key: string; bytes: number; rows: number }>("/api/backup", { method: "POST" }),
};

/** 重新走一次 Cloudflare Access 登入（整頁跳轉，不經過 Service Worker 快取） */
export function relogin(): void {
  window.location.href = "/api/login";
}
