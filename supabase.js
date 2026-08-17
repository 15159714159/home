import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://itfqxewtpuudmewmczxz.supabase.co';
// 这是 anon key，设计上就是给客户端用的；权限范围由 supabase_policies.sql 里的 RLS 策略限制，
// 绝不能把 service_role/secret key 放在这个文件里。
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0ZnF4ZXd0cHV1ZG1ld21jenh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzE5NTYsImV4cCI6MjEwMDIwNzk1Nn0.JwhDFJmke7E2wMuvK_kBzYqnXE2D5v9CTh-8M0I0xu8';

// keepalive: true 让请求能在页面刷新/关闭的卸载过程中继续发完，
// 配合 index.html 里 pagehide 时的 flushChatSync 用，否则刷新会把没发完的同步请求直接掐断
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: (url, options) => fetch(url, { ...options, keepalive: true }) }
});

const MEMORY_TYPES = ['侧写', '共鸣', '学业', '造巢'];
const DIARY_AUTHORS = ['然竣', 'ao'];

function clampImportance(importance) {
  const n = parseInt(importance, 10);
  if (isNaN(n)) return 5;
  return Math.min(10, Math.max(1, n));
}

export async function addMemory(content, type, importance, flags, source, tags) {
  if (!MEMORY_TYPES.includes(type)) {
    throw new Error(`type 必须是 ${MEMORY_TYPES.join('/')} 之一，收到：${type}`);
  }
  const now = new Date().toISOString();
  const f = flags || {};
  return supabase.from('memories').insert({
    content,
    type,
    importance: clampImportance(importance),
    protected: !!f.protected,
    highlight: !!f.highlight,
    feel: !!f.feel,
    noise: !!f.noise,
    source: source || 'manual',
    tags: tags || [],
    last_accessed: now
  }).select();
}

export async function getMemories(type, limit = 20) {
  let query = supabase.from('memories').select('*');
  if (type) query = query.eq('type', type);
  query = query.order('created_at', { ascending: false }).limit(limit);
  const { data, error } = await query;
  if (error) return { data, error };
  const withDecay = (data || []).map(m => ({ ...m, decayScore: updateDecay(m.last_accessed) }));
  return { data: withDecay, error: null };
}

export async function searchMemories(keyword) {
  return supabase.from('memories').select('*').ilike('content', `%${keyword}%`).order('created_at', { ascending: false });
}

// 纯计算，不发网络请求；参考 Ombre-Brain 的时间衰减公式：越久没被访问，分数越低，衰减速率 λ=0.05
export function updateDecay(lastAccessed) {
  const days = (Date.now() - new Date(lastAccessed).getTime()) / 86400000;
  return 1 / (1 + 0.05 * Math.max(days, 0));
}

export async function addDiary(author, mood, content) {
  if (!DIARY_AUTHORS.includes(author)) {
    throw new Error(`author 必须是 ${DIARY_AUTHORS.join('/')} 之一，收到：${author}`);
  }
  return supabase.from('diaries').insert({ author, mood, content, comments: [] }).select();
}

export async function getDiaries(author, limit = 20) {
  let query = supabase.from('diaries').select('*');
  if (author) query = query.eq('author', author);
  query = query.order('created_at', { ascending: false }).limit(limit);
  return query;
}

// 读后写：先取当前 comments 数组再整体覆盖更新，双人使用场景下的并发覆盖风险可接受
export async function addComment(diaryId, comment) {
  const { data: row, error: readErr } = await supabase.from('diaries').select('comments').eq('id', diaryId).single();
  if (readErr) return { data: null, error: readErr };
  const comments = Array.isArray(row.comments) ? row.comments : [];
  comments.push({ ...comment, createdAt: Date.now() });
  return supabase.from('diaries').update({ comments }).eq('id', diaryId).select();
}

export async function updateMemory(id, fields) {
  const payload = {};
  if (fields.content != null) payload.content = fields.content;
  if (fields.type != null) {
    if (!MEMORY_TYPES.includes(fields.type)) {
      throw new Error(`type 必须是 ${MEMORY_TYPES.join('/')} 之一，收到：${fields.type}`);
    }
    payload.type = fields.type;
  }
  if (fields.importance != null) payload.importance = clampImportance(fields.importance);
  if (fields.protected != null) payload.protected = !!fields.protected;
  if (fields.highlight != null) payload.highlight = !!fields.highlight;
  if (fields.feel != null) payload.feel = !!fields.feel;
  if (fields.noise != null) payload.noise = !!fields.noise;
  if (fields.source != null) payload.source = fields.source;
  if (fields.tags != null) payload.tags = fields.tags;
  return supabase.from('memories').update(payload).eq('id', id).select();
}

export async function deleteMemory(id) {
  return supabase.from('memories').delete().eq('id', id);
}

// 定时清单：字段照抄 timed-checklist-main/SPEC.md §2，三种形态靠 is_fixed/trigger_at 区分。
export async function getChecklist() {
  return supabase.from('checklist').select('*').order('position', { ascending: true });
}

export async function addChecklistItem(fields) {
  const now = Date.now();
  return supabase.from('checklist').insert({
    body: fields.body,
    is_fixed: fields.trigger_at != null ? 0 : (fields.is_fixed ? 1 : 0),
    done: 0,
    position: fields.position || 0,
    created_by: fields.created_by || 'user',
    trigger_at: fields.trigger_at ?? null,
    notified: 0,
    created_at: now,
    updated_at: now
  }).select();
}

export async function updateChecklistItem(id, fields) {
  const payload = { updated_at: Date.now() };
  if (fields.body != null) payload.body = fields.body;
  if (fields.is_fixed != null) payload.is_fixed = fields.is_fixed ? 1 : 0;
  if (fields.done != null) { payload.done = fields.done ? 1 : 0; payload.done_at = fields.done ? Date.now() : null; }
  if (fields.position != null) payload.position = fields.position;
  if (fields.trigger_at !== undefined) { payload.trigger_at = fields.trigger_at; payload.notified = 0; }
  return supabase.from('checklist').update(payload).eq('id', id).select();
}

export async function deleteChecklistItem(id) {
  return supabase.from('checklist').delete().eq('id', id);
}

// 闹钟原子占位：只更新 notified=0 的行，返回的行数就是本次真正抢到的提醒——
// 多个标签页/多次 tick 并发时，后到的 update 会匹配 0 行，天然防止同一提醒重复触发。
export async function claimDueChecklistAlarms(nowMs) {
  return supabase.from('checklist')
    .update({ notified: 1, updated_at: nowMs })
    .not('trigger_at', 'is', null)
    .lte('trigger_at', nowMs)
    .eq('notified', 0)
    .eq('done', 0)
    .select();
}

// 跨设备聊天记录同步：kind 是 'main'（主聊天）或 'subchats'（副聊天），
// 每行整份数组存成一个 jsonb 列，upsert 整体覆盖，不做逐条 merge。
//
// 每个页面实例一个写入方标识，故意不存 localStorage——就是要区分同设备的不同标签页/窗口，
// 下次再发生数据回退，能直接从 written_by 看出是哪个实例写的，不用猜。
const CLIENT_ID = (navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop') + '-' +
  Math.random().toString(36).slice(2, 8) + '-' + new Date().toISOString().slice(5, 16);

// written_by 列要跑过 supabase_migration_6.sql 才存在；没跑之前 select 这一列会直接报错，
// 导致整个聊天同步瘫痪，所以先带 written_by 查，报错（列不存在）就退回不带它的旧查询。
export async function getChat(kind) {
  const withWriter = await supabase.from('chats').select('data,updated_at,written_by').eq('kind', kind).maybeSingle();
  if (withWriter.error) {
    return supabase.from('chats').select('data,updated_at').eq('kind', kind).maybeSingle();
  }
  return withWriter;
}
// 乐观锁写入：只有当云端 updated_at 跟调用方上次读到的时间戳一致时才真正写入。
// 事故复盘：一个开了很久没刷新的旧标签页，切走时会把内存里过时的聊天记录当最新数据同步上云端，
// 无条件覆盖掉其他设备/标签页刚同步好的新内容。expectedUpdatedAt 就是用来拦住这种"用旧数据覆盖新数据"的写入——
// 云端已经变了就直接拒绝，交给调用方重新拉取最新数据，而不是盲目覆盖。
// expectedUpdatedAt 为空时（比如云端还没有这一行）退回普通 upsert。
//
// written_by 同 getChat：migration 6 没跑之前这一列不存在，带着它写会直接报错——
// 先带 written_by 写，报错就退回不带它的写法重试一次，避免同步在 migration 落地前整体瘫痪。
export async function upsertChat(kind, data, expectedUpdatedAt) {
  const nowIso = new Date().toISOString();
  if (!expectedUpdatedAt) {
    const withWriter = await supabase.from('chats').upsert({ kind, data, updated_at: nowIso, written_by: CLIENT_ID }).select();
    if (withWriter.error) return supabase.from('chats').upsert({ kind, data, updated_at: nowIso }).select();
    return withWriter;
  }
  let { data: rows, error } = await supabase.from('chats')
    .update({ data, updated_at: nowIso, written_by: CLIENT_ID })
    .eq('kind', kind).eq('updated_at', expectedUpdatedAt)
    .select();
  if (error) {
    ({ data: rows, error } = await supabase.from('chats')
      .update({ data, updated_at: nowIso })
      .eq('kind', kind).eq('updated_at', expectedUpdatedAt)
      .select());
  }
  if (error) return { data: rows, error };
  if (!rows || rows.length === 0) {
    return { data: null, error: { code: 'CHAT_SYNC_CONFLICT', message: '云端数据已被其他设备/页面更新，拒绝用本地旧数据覆盖' } };
  }
  return { data: rows, error: null };
}

// 同步 API key/model/persona 到云端，供 OmbreBrain 后端读取做缓存暖 ping（见 supabase_migration_8.sql）。
// 只存一行（id='main'），跟 upsertChat 一样整行覆盖。
export async function upsertAiConfig(payload) {
  return supabase.from('ai_config').upsert({ id: 'main', ...payload, updated_at: new Date().toISOString() });
}

// "心事"：AI 自己悄悄揣着、对用户不可见的当下情绪/心事状态（见 supabase_migration_9.sql）。
// 只存一行（id='main'），新的直接覆盖旧的，不做历史版本、不做乐观锁。
export async function getMood() {
  return supabase.from('ai_mood').select('content,updated_at').eq('id', 'main').maybeSingle();
}
export async function upsertMood(content) {
  return supabase.from('ai_mood').upsert({ id: 'main', content, updated_at: new Date().toISOString() });
}

// 主脚本是非 module 的经典 <script>，无法 import 本文件；挂到 window 上供其调用
window.supabaseMemory = { addMemory, getMemories, searchMemories, updateMemory, deleteMemory, updateDecay };
window.supabaseDiary = { addDiary, getDiaries, addComment };
window.supabaseChats = { getChat, upsertChat };
window.supabaseChecklist = { getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, claimDueChecklistAlarms };
window.supabaseAiConfig = { upsertAiConfig };
window.supabaseMood = { getMood, upsertMood };
