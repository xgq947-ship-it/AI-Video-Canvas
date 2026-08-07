-- 0002_oauth_accounts.sql
-- Google 的 sub（provider_subject）才是稳定外部身份标识，不能只用邮箱匹配。

create table if not exists oauth_accounts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  email text,
  email_verified integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  unique (provider, provider_subject)
);

create index if not exists oauth_accounts_user_id_idx
on oauth_accounts (user_id);
