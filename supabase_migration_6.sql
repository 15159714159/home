-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：聊天同步发生过多次数据回退事故（详见 index.html 事故复盘1~4），
-- 加一列记录"这一行最后是哪个页面实例写的"，下次再出问题能直接定位到设备/标签页，不用猜。
-- update/upsert 权限 anon key 已经有，不需要额外授权。

alter table chats add column if not exists written_by text;
