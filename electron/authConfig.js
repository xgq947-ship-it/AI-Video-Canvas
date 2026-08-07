/**
 * 主进程鉴权配置。客户端只保存公开配置（Worker 基址、公钥等），绝无任何 secret。
 *
 * 打包后的 App 不会加载任意 .env（安全策略，见 server/index.js 对 EVAN_DESKTOP 的
 * 同款处理）——所以本文件只在「未打包」时读取 dotenv，且必须在读取 process.env 之前
 * 完成：ESM 的 import 早于本文件其余代码执行，若把 dotenv.config() 放进 main.js 就
 * 太晚了（authConfig.js 作为它的依赖会先跑完）。放在这个叶子模块自己的顶部才对。
 */
import dotenv from 'dotenv';
import { app } from 'electron';

if (!app.isPackaged) dotenv.config();

/**
 * Worker 基址。跟 GOOGLE_LOGIN_ENABLED 同样的道理：打包后读不到 .env，不能靠
 * 环境变量决定生产用哪个地址。
 */
const PACKAGED_DEFAULT_AUTH_BASE_URL = 'https://ai-canvas-auth.xgq-clash.workers.dev';
export const AUTH_BASE_URL = app.isPackaged
  ? PACKAGED_DEFAULT_AUTH_BASE_URL
  : process.env.AUTH_BASE_URL || 'http://localhost:8788';

/**
 * 客户端内置的 Ed25519 公钥（SPKI base64url），仅用于 P5 验签，不参与登录。
 *
 * 开发/生产两把完全不同的密钥对：本地 wrangler dev 用的私钥（在 cloudflare/.dev.vars
 * 里）配这里的 DEV 默认值——这套密钥对已经在开发过程中的会话记录里出现过明文，
 * 只能继续留在本地测试用，绝不能带去生产。生产私钥单独生成、只经
 * `wrangler secret put` 写入 Cloudflare，从未出现在任何日志/对话里；这里的
 * PACKAGED 默认值是它配对的公钥（公钥本来就要给客户端内置，不是秘密）。
 */
const PACKAGED_DEFAULT_LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAo6HZFIcNsynX6KCmeJkBsZhbmyiMRJ1zOjOrP7-ZAYI';
const DEV_DEFAULT_LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEABOb--03BYPrxTLpaRVSxNSasAnnAd6zrQs0mkUqfJek';
export const LICENSE_PUBLIC_KEY_SPKI_B64URL = app.isPackaged
  ? PACKAGED_DEFAULT_LICENSE_PUBLIC_KEY
  : process.env.LICENSE_PUBLIC_KEY || DEV_DEFAULT_LICENSE_PUBLIC_KEY;

/**
 * 登录总开关。
 *
 * 打包后的 App 读不到 .env，process.env.GOOGLE_LOGIN_ENABLED 在 Finder 双击启动时
 * 几乎总是空——所以“发布一个真正启用登录的版本”不能靠环境变量，只能靠改这行常量
 * 再重新打包。要发布启用登录的版本：把 PACKAGED_DEFAULT 改成 true，npm run desktop:dist。
 * 开发调试时仍可用环境变量临时打开，不需要碰这个常量、不需要重新打包。
 */
const PACKAGED_DEFAULT_LOGIN_ENABLED = false;
export const GOOGLE_LOGIN_ENABLED = app.isPackaged
  ? PACKAGED_DEFAULT_LOGIN_ENABLED
  : String(process.env.GOOGLE_LOGIN_ENABLED || '').toLowerCase() === 'true';

/** 一次性登录码/loopback 等待超时（毫秒）。 */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** SecureStore 键名（与文档 §15.3 对齐）。 */
export const SECURE_KEYS = Object.freeze({
  REFRESH_TOKEN: 'auth.refresh_token',
  USER_ID: 'auth.user_id',
  LICENSE_PAYLOAD: 'license.payload',
  LICENSE_SIGNATURE: 'license.signature',
});
