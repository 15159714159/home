-- 在 Supabase 后台 SQL Editor 里手动执行一次。
-- 目的：给 ai_config 表加两列，供设置页"私人时间"分区两个新设置项同步到
-- garden-agent 的 runWakeSpontaneous()（见 server.js）：
--   wake_tool_round_limit —— 私人时间每次工具调用轮数上限，整数，范围 2-24，
--     null/超范围/非数字一律回落到 wakeEngine.js 的 WAKE_TUNABLES.TOOL_ROUND_LIMIT（12）。
--   wake_prompt_template  —— 唤醒提示词模板，多行文本，null/空字符串表示沿用后端内置
--     默认模板；填了就整段覆盖，支持 {ago}（"ao上次说话是X前。"）、{tools_hint}
--     （工具引导句）两个占位符。
-- 沿用 ai_config 现有的零 DDL-on-backend 模式：garden-agent 侧不建表/加列，只读；
-- 加列这一步始终由人手动在 Supabase 控制台跑一次，跟 ctx_limit（migration_11）、
-- wake_interval_min（migration_16）完全同一套做法。

alter table ai_config add column if not exists wake_tool_round_limit integer;
alter table ai_config add column if not exists wake_prompt_template text;
