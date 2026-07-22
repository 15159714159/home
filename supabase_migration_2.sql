-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：记忆卡片改版 —— emotion(1-5) 换成 importance(1-10)，新增4个状态位（协→protected/highlight/feel/noise）
-- 以及 source（记忆来源：manual/ai/import），并把旧的4类中文枚举值改名为新的4类。

alter table memories add column if not exists importance smallint default 5;
alter table memories add column if not exists protected boolean default false;
alter table memories add column if not exists highlight boolean default false;
alter table memories add column if not exists feel boolean default false;
alter table memories add column if not exists noise boolean default false;
alter table memories add column if not exists source text default 'import';

-- 旧中文枚举值改名为新的4类，避免已有数据因枚举改名后匹配不上掉进 legacy 兜底
update memories set type = '侧写' where type = '生活';
update memories set type = '共鸣' where type = '关于我们';
update memories set type = '学业' where type = '学习';
update memories set type = '造巢' where type = '筑巢';

grant update (importance, protected, highlight, feel, noise, source) on memories to anon;
-- emotion / decay_score 列保留在表里不删（避免破坏性 schema 变更），代码只是不再读写这两列
