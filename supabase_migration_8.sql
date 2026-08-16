-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：新增 ai_config 表，把浏览器 localStorage 里的 API key/model/persona 同步一份到云端，
-- 供 OmbreBrain 后端读取，用于定时"暖 ping" Claude 的 prompt cache（防止长时间不聊天时缓存过期）。
--
-- 只存一行（id 固定为 'main'），跟 chats 表一样整行覆盖，不做历史版本、不做逐条 diff。
--
-- 安全提示：这里存的 api_key 是真实的 Claude API 密钥，跟 chats/memories 表一样只用 anon key
-- 做权限控制（本项目所有表目前都没有做用户级别的权限区分），任何拿到本项目 anon key 的人
-- （包括看过 index.html 源码的人）理论上都能读到这个 key。
--
-- tools_enabled：跟前端"工具"开关同步。工具模式下 index.html 会额外带 tools 数组 + 一条
-- system 块，请求前缀跟暖 ping 发的简化请求完全不同；后端读到 true 时会直接跳过本次暖 ping，
-- 避免白发一个谁也读不到的缓存写入。

create table if not exists ai_config (
  id            text primary key default 'main',
  api_key       text,
  endpoint      text,
  model         text,
  persona       text,
  tools_enabled boolean not null default false,
  updated_at    timestamptz not null default now()
);

alter table ai_config enable row level security;

grant select, insert, update on ai_config to anon;

create policy "ai_config_select" on ai_config for select to anon using (true);
create policy "ai_config_insert" on ai_config for insert to anon with check (true);
create policy "ai_config_update" on ai_config for update to anon using (true) with check (true);
