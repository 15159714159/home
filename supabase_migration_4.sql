-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：新增 chats 表，用于跨设备同步主聊天(messages)和副聊天(subChats)。
--
-- 设计：整份聊天记录数组存成一行 jsonb，而不是拆成逐条消息一行——
-- 聊天记录会被"删除某条消息""清空""开启新话题"等操作整体重写，
-- 逐行 CRUD 反而更复杂，直接对应本地 IndexedDB 现在"整个数组一把存"的写法。
-- 只有两行：kind='main' 存 messages，kind='subchats' 存 subChats。

create table if not exists chats (
  kind text primary key check (kind in ('main','subchats')),
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table chats enable row level security;

-- anon key 需要能读、能首次插入两行、也能后续整行更新（更新用 upsert 实现，所以 insert/update 都要开）
grant select, insert, update on chats to anon;

create policy "chats_select" on chats for select to anon using (true);
create policy "chats_insert" on chats for insert to anon with check (true);
create policy "chats_update" on chats for update to anon using (true) with check (true);
