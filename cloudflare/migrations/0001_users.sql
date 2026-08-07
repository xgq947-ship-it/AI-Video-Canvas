-- 0001_users.sql
-- Cloudflare D1 (SQLite)。id 由 Worker 用 crypto.randomUUID() 生成后写入 text 主键。
-- 时间统一存 ISO-8601 文本（strftime 产出的 UTC）。

create table if not exists users (
  id text primary key,
  email text,
  display_name text,
  avatar_url text,
  status text not null default 'active',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at text,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- status 允许值：active / blocked / deleted
create unique index if not exists users_email_unique
on users (lower(email))
where email is not null;
