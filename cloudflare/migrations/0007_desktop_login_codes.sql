-- 0007_desktop_login_codes.sql
-- 一次性桌面登录码（文档 §4.2）：浏览器回调只带这个短期 code，客户端拿它换会话。
-- 只存哈希；用后即焚（used=1）；有效期 60-120 秒。

create table if not exists desktop_login_codes (
  code_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  device_hash text,
  used integer not null default 0,
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists desktop_login_codes_expires_idx
on desktop_login_codes (expires_at);
