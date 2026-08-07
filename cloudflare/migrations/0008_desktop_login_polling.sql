-- 0008_desktop_login_polling.sql
-- 浏览器回调成功后，桌面应用用高熵 verifier 主动轮询领取会话。
-- 数据库只保存 SHA-256 challenge，不保存 verifier，也不再依赖 localhost 回跳。

alter table desktop_login_codes add column poll_challenge text;

create unique index if not exists desktop_login_codes_poll_challenge_idx
on desktop_login_codes (poll_challenge)
where poll_challenge is not null;
