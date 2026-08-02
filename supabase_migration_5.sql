-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：anon key 之前只有 memories 表的 select/insert/update 权限，没有 delete。
-- 前端的记忆删除功能（applyMemoryUpdate 的 delete 分支）本地删了、云端删不掉，
-- 下次从云端刷新记忆时又把"已删除"的记忆合并回本地，看起来像是自动复活。
-- 补上 delete 权限，让云端跟本地保持一致。

grant delete on memories to anon;

create policy "memories_delete" on memories for delete to anon using (true);
