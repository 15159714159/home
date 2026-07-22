-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：记忆卡片改版 —— emotion(1-5) 换成 importance(1-10)，新增4个状态位（protected/highlight/feel/noise）
-- 以及 source（记忆来源：manual/ai/import），并把旧的4类中文枚举值改名为新的4类。
--
-- 实测发现 Supabase SQL Editor 里一次粘贴执行的多条语句会被当成一个事务：
-- 只要最后一步（收紧 type 约束）失败，前面已经跑过的 update 改名也会被整体回滚。
-- 因此这份脚本按依赖顺序拆成独立的几步，务必分开、按顺序单独执行，每步确认成功后再跑下一步。

-- 第1步：删除旧的 type 约束（只允许旧4类中文值），改名前必须先放开，否则 update 会被约束拒绝。
alter table memories drop constraint if exists memories_type_check;

-- 第2步：改名。旧中文枚举值 -> 新的4类，避免已有数据因枚举改名后匹配不上掉进 legacy 兜底。
update memories set type = '侧写' where type = '生活';
update memories set type = '共鸣' where type = '关于我们';
update memories set type = '学业' where type = '学习';
update memories set type = '造巢' where type = '筑巢';

-- 第3步：新增字段。
-- 注意：如果 importance 列之前被手动建过且类型不是 smallint（比如误建成了 text），
-- 需要先 `alter table memories drop column importance;` 删掉重建，否则 `add column if not exists` 会跳过、类型不对。
alter table memories add column if not exists importance smallint default 5;
alter table memories add column if not exists protected boolean default false;
alter table memories add column if not exists highlight boolean default false;
alter table memories add column if not exists feel boolean default false;
alter table memories add column if not exists noise boolean default false;
alter table memories add column if not exists source text default 'import';

-- 第4步：改名完成后，重新收紧约束，只保留新的4类。
alter table memories add constraint memories_type_check check (type in ('侧写','共鸣','学业','造巢'));

-- 第5步：授权 anon key 更新这几个新列。
grant update (importance, protected, highlight, feel, noise, source) on memories to anon;
-- emotion / decay_score 列保留在表里不删（避免破坏性 schema 变更），代码只是不再读写这两列
