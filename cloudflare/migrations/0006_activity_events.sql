-- 0006_activity_events.sql
-- 活跃上报：每设备每自然日最多一条（unique 约束保证幂等）。
-- 用户内容一律不入库，只记设备哈希 / 版本 / 平台 / 日期。

create table if not exists activity_events (
  id integer primary key autoincrement,
  user_id text references users(id) on delete cascade,
  device_hash text not null,
  event_date text not null,
  app_version text,
  platform text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  unique (device_hash, event_date)
);

create index if not exists activity_events_event_date_idx
on activity_events (event_date);
