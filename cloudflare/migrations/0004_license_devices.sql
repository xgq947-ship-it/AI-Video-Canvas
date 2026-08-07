-- 0004_license_devices.sql
-- 设备试用与授权状态。device_hash 全局唯一：同一设备切换账号不能重开试用。
-- trial_started_at / trial_expires_at 由服务端（Worker）生成，客户端不得提交。

create table if not exists license_devices (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  device_hash text not null unique,
  installation_id_hash text,
  platform text,
  app_version text,

  license_status text not null default 'trial'
    check (license_status in ('trial', 'expired', 'licensed', 'blocked')),
  trial_started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  trial_expires_at text not null,

  activated_at text,
  license_key_id text,
  last_seen_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists license_devices_user_id_idx
on license_devices (user_id);
