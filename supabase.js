import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://itfqxewtpuudmewmczxz.supabase.co';
// 这是 anon key，设计上就是给客户端用的；权限范围由 supabase_policies.sql 里的 RLS 策略限制，
// 绝不能把 service_role/secret key 放在这个文件里。
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0ZnF4ZXd0cHV1ZG1ld21jenh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzE5NTYsImV4cCI6MjEwMDIwNzk1Nn0.JwhDFJmke7E2wMuvK_kBzYqnXE2D5v9CTh-8M0I0xu8';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// 主脚本是非 module 的经典 <script>，无法 import 本文件；挂到 window 上供其调用
window.supabaseMemory = { addMemory, getMemories, searchMemories, updateMemory, deleteMemory, updateDecay };
window.supabaseDiary = { addDiary, getDiaries, addComment };
