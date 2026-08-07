-- 0003_refresh_tokens.sql
-- 只保存 Refresh Token 的哈希（SHA-256），绝不存明文。
-- 一次登录对应一条会话记录；刷新时轮换（rotate）——旧记录置为 revoked，插入新记录。

create table if not exists refresh_tokens (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  device_hash text,
  status text not null default 'active',
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at text,
  revoked_at text
);

-- status 允许值：active / revoked / expired
create index if not exists refresh_tokens_user_id_idx
on refresh_tokens (user_id);
