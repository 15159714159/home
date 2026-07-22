-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：anon key（客户端用的公开 key）只能对 memories/diaries 做 insert + select，
-- 不能 delete；update 只开放到指定列（memories 的衰减字段，diaries 的评论字段）。

alter table memories enable row level security;
alter table diaries  enable row level security;

grant select, insert on memories to anon;
grant select, insert on diaries  to anon;
grant update (decay_score, last_accessed) on memories to anon;
grant update (comments) on diaries to anon;

create policy "memories_select" on memories for select to anon using (true);
create policy "memories_insert" on memories for insert to anon with check (true);
create policy "memories_update_decay" on memories for update to anon using (true) with check (true);

create policy "diaries_select" on diaries for select to anon using (true);
create policy "diaries_insert" on diaries for insert to anon with check (true);
create policy "diaries_update_comments" on diaries for update to anon using (true) with check (true);
