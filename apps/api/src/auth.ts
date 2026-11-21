import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./env";

/**
 * 從 Cloudflare Access 的 JWT 取出登入者 email。
 *
 * 網站前面已經有 Access 擋著，但 Worker 仍自己驗證 JWT：
 * 這樣就算有人繞過 Access（例如直接打 workers.dev 網址），也拿不到資料。
 * 任何設定缺漏都會回傳 null（拒絕），不會放行。
 */
const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function getVerifiedEmail(req: Request, env: AppEnv): Promise<string | null> {
  const url = new URL(req.url);

  // 本機開發：沒有 Access，用 .dev.vars 的假 email。只在 localhost 生效。
  if (env.DEV_USER_EMAIL && LOCAL_HOSTS.has(url.hostname)) {
    return env.DEV_USER_EMAIL.trim().toLowerCase();
  }

  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!team || !aud) return null;

  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  const issuer = `https://${team}`;
  let jwks = jwksByTeam.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByTeam.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
    if (!email || !isAllowed(email, env)) return null;
    return email;
  } catch {
    return null;
  }
}

function isAllowed(email: string, env: AppEnv): boolean {
  const allowed = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // 白名單沒設定 = 不讓任何人進來（寧可擋錯，不可放錯）
  return allowed.includes(email);
}
