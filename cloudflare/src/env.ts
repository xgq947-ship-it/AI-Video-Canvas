export interface Env {
  DB: D1Database;

  // vars（非机密）
  APP_ORIGIN: string;
  GOOGLE_REDIRECT_URI: string;
  ACCESS_TOKEN_TTL_SECONDS: string;
  REFRESH_TOKEN_TTL_DAYS: string;
  DESKTOP_LOGIN_CODE_TTL_SECONDS: string;
  ALLOWED_LOOPBACK_HOSTS: string;

  // secrets（.dev.vars / wrangler secret）
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SIGNING_SECRET: string;
  LICENSE_CODE_SALT: string;
  LICENSE_PRIVATE_KEY_PEM_B64?: string;
  LICENSE_PUBLIC_KEY_PEM_B64?: string;
  ADMIN_SECRET?: string;
}
