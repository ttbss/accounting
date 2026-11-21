/** wrangler.jsonc 產生的 Env，加上用 `wrangler secret put` / .dev.vars 設定的值。 */
export type AppEnv = Env & {
  /** 例如 myteam.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access 應用程式的 Application Audience (AUD) Tag */
  ACCESS_AUD?: string;
  /** 允許使用的 email，逗號分隔。正式環境必填。 */
  ALLOWED_EMAILS?: string;
  /** 只在 localhost 生效的假登入 email */
  DEV_USER_EMAIL?: string;
};

export interface AuthUser {
  id: string;
  email: string;
}

export type HonoEnv = {
  Bindings: AppEnv;
  Variables: { user: AuthUser };
};
