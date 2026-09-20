// supabase.js — 前端数据桥。
// 2026-09-20: Supabase 项目 402 限流，全部改走 garden-agent 后端 API。
// 接口形状（window.supabase*）保持不变，index.html 不用改。

const CHAT_MAIN_BASE = 'https://47-107-161-135.sslip.io/chat-main';

function getServiceKey() {
  try {
    const cfg = JSON.parse(localStorage.getItem('nest_config') || '{}');
    return cfg.chatServiceKey || '';
  } catch { return ''; }
}

async function api(path, body = {}) {
  const res = await fetch(CHAT_MAIN_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getServiceKey() },
    body: JSON.stringify(body),
    keepalive: true,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed;
    try { parsed = JSON.parse(text); } catch {}
    const msg = (parsed && parsed.error) || `HTTP ${res.status}`;
    const code = (parsed && parsed.code) || undefined;
    return { data: null, error: { message: msg, code } };
  }
  const json = await res.json();
  return { data: json.data ?? json, error: null };
}

// === Memory ===
// 记忆由 Ombre Brain 管理，Supabase memories 表已不可用。
// 前端 UI 操作全部降级为空/静默失败——不影响 AI 侧记忆功能。
const MEMORY_TYPES = ['侧写', '共鸣', '学业', '造巢'];

export async function addMemory() { return { data: null, error: { message: '记忆存储暂不可用' } }; }
export async function getMemories() { return { data: [], error: null }; }
export async function searchMemories() { return { data: [], error: null }; }
export function updateDecay(lastAccessed) {
  const days = (Date.now() - new Date(lastAccessed).getTime()) / 86400000;
  return 1 / (1 + 0.05 * Math.max(days, 0));
}
export async function updateMemory() { return { data: null, error: { message: '记忆存储暂不可用' } }; }
export async function deleteMemory() { return { data: null, error: null }; }

// === Diary ===
export async function addDiary(author, mood, content) {
  return api('/diaries', { action: 'add', author, mood, content });
}
export async function getDiaries(author, limit = 20) {
  const { data, error } = await api('/diaries', { limit });
  if (error) return { data: null, error };
  const rows = Array.isArray(data) ? data : [];
  const filtered = author ? rows.filter(d => d.author === author) : rows;
  return { data: filtered, error: null };
}
export async function addComment(diaryId, comment) {
  return { data: null, error: { message: '评论功能暂不可用' } };
}

// === Chat Sync ===
const CLIENT_ID = (navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop') + '-' +
  Math.random().toString(36).slice(2, 8) + '-' + new Date().toISOString().slice(5, 16);

export async function getChat(kind) {
  return api('/chat-sync', { kind });
}
export async function upsertChat(kind, data, expectedUpdatedAt) {
  const res = await api('/chat-sync', { kind, data, expectedUpdatedAt });
  if (res.error && res.error.code === 'CHAT_SYNC_CONFLICT') return res;
  return res;
}

let mainChatPollTimer = null;
let mainChatPollCallback = null;
let lastMainChatUpdatedAt = null;

export function subscribeMainChat(onUpdate) {
  mainChatPollCallback = onUpdate;
  if (mainChatPollTimer) return { unsubscribe: () => stopMainChatPoll() };
  pollMainChat();
  mainChatPollTimer = setInterval(pollMainChat, 5000);
  return { unsubscribe: () => stopMainChatPoll() };
}
function stopMainChatPoll() {
  if (mainChatPollTimer) { clearInterval(mainChatPollTimer); mainChatPollTimer = null; }
  mainChatPollCallback = null;
}
async function pollMainChat() {
  if (!mainChatPollCallback) return;
  try {
    const { data, error } = await api('/chat-sync', { kind: 'main' });
    if (error || !data) return;
    if (data.updated_at && data.updated_at !== lastMainChatUpdatedAt) {
      lastMainChatUpdatedAt = data.updated_at;
      mainChatPollCallback(data);
    }
  } catch {}
}

// === AI Config ===
export async function upsertAiConfig(payload) {
  return api('/ai-config', payload);
}

// === Mood ===
export async function getMood() {
  return api('/mood', {});
}
export async function upsertMood(content) {
  return api('/mood', { content });
}

// === Wake Engine ===
export async function getWakeEngineEnabled() {
  const { data, error } = await api('/wake-engine', {});
  if (error) return { data: null, error };
  return { data: !!(data && data.enabled !== false), error: null };
}
export async function setWakeEngineEnabled(enabled) {
  return api('/wake-engine', { enabled });
}

// === Checklist ===
export async function getChecklist() {
  const { data, error } = await api('/checklist', { action: 'list' });
  if (error) return { data: null, error };
  return { data: Array.isArray(data) ? data : [], error: null };
}
export async function addChecklistItem(fields) {
  return api('/checklist', { action: 'add', ...fields });
}
export async function updateChecklistItem(id, fields) {
  return api('/checklist', { action: 'update', id, ...fields });
}
export async function deleteChecklistItem(id) {
  return api('/checklist', { action: 'delete', id });
}
export async function claimDueChecklistAlarms(nowMs) {
  return api('/checklist', { action: 'claim-alarms', nowMs });
}

// 主脚本是非 module 的经典 <script>，无法 import 本文件；挂到 window 上供其调用
window.supabaseMemory = { addMemory, getMemories, searchMemories, updateMemory, deleteMemory, updateDecay };
window.supabaseDiary = { addDiary, getDiaries, addComment };
window.supabaseChats = { getChat, upsertChat, subscribeMainChat };
window.supabaseChecklist = { getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, claimDueChecklistAlarms };
window.supabaseAiConfig = { upsertAiConfig };
window.supabaseMood = { getMood, upsertMood };
window.supabaseWakeEngine = { getWakeEngineEnabled, setWakeEngineEnabled };
