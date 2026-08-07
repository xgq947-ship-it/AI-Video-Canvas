-- 0005_license_keys.sql
-- 授权码只存哈希：SHA-256(标准化授权码 + LICENSE_CODE_SALT)。
-- features 存 JSON 文本（SQLite 无 jsonb），例如 '["director_workflow"]'。
-- 激活并发安全靠条件更新：UPDATE ... WHERE code_hash=? AND status='unused'，判 changes===1。

create table if not exists license_keys (
  id text primary key,
  code_hash text not null unique,

  status text not null default 'unused'
    check (status in ('unused', 'used', 'revoked', 'disabled')),
  license_type text not null default 'perpetual',
  max_activations integer not null default 1,
  activation_count integer not null default 0,

  bound_device_hash text,
  bound_user_id text references users(id),
  activated_at text,

  features text not null default '[]',
  note text,

  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists license_keys_bound_device_idx
on license_keys (bound_device_hash);
