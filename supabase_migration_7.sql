-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：新增 checklist 表，支撑定时清单功能（固定日常项/一次性项/定时提醒项），
-- 字段照抄 timed-checklist-main/SPEC.md §2。闹钟触发、零点清除全部由前端惰性执行，
-- 这张表本身没有任何服务器端逻辑。

create table if not exists checklist (
  id          bigint generated always as identity primary key,
  body        text    not null,
  is_fixed    integer not null default 1,
  done        integer not null default 0,
  done_at     bigint,
  position    integer not null default 0,
  created_by  text    not null default 'user',
  trigger_at  bigint,
  notified    integer not null default 0,
  created_at  bigint  not null,
  updated_at  bigint  not null
);

alter table checklist enable row level security;

grant select, insert, delete on checklist to anon;
grant update (body, is_fixed, done, done_at, position, trigger_at, notified, updated_at) on checklist to anon;

create policy "checklist_select" on checklist for select to anon using (true);
create policy "checklist_insert" on checklist for insert to anon with check (true);
create policy "checklist_update" on checklist for update to anon using (true) with check (true);
create policy "checklist_delete" on checklist for delete to anon using (true);
