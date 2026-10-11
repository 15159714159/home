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
// 记忆通过 garden-agent 代理到 Ombre Brain。
const MEMORY_TYPES = ['侧写', '共鸣', '学业', '造巢'];

export async function addMemory(content, type, importance, flags, source, tags) {
  return api('/memories', { action: 'add', content, type, importance, flags, source, tags });
}
export async function getMemories(type, limit = 500) {
  const { data, error } = await api('/memories', { action: 'list', limit });
  if (error) return { data: null, error };
  const rows = Array.isArray(data) ? data : [];
  const filtered = type ? rows.filter(r => r.type === type) : rows;
  const withDecay = filtered.map(m => ({ ...m, decayScore: updateDecay(m.created_at || new Date().toISOString()) }));
  return { data: withDecay, error: null };
}
export async function searchMemories(keyword) {
  const { data, error } = await api('/memories', { action: 'search', keyword });
  if (error) return { data: null, error };
  return { data: Array.isArray(data) ? data : [], error: null };
}
export function updateDecay(lastAccessed) {
  const days = (Date.now() - new Date(lastAccessed).getTime()) / 86400000;
  return 1 / (1 + 0.05 * Math.max(days, 0));
}
export async function updateMemory(id, fields) {
  return api('/memories', { action: 'update', id, fields });
}
export async function deleteMemory(id) {
  return api('/memories', { action: 'delete', id });
}

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

// 阶段 3（2026-10-11）：条件请求。opts.since 显式可选，**默认不带**——
// 只有定时轮询与回前台刷新两路会传，其余调用点（首屏、409 冲突分支、任何用来刷新
// expectedUpdatedAt 的拉取）连调都不用改，请求体与改动前逐字节一致。
// 服务端命中时只回 { unchanged:true, updated_at }（几十字节），**不带 data.data**；
// 所以调用方必须能容忍 data 不是消息数组——凡是需要真消息体的地方一律不许传 since。
export async function getChat(kind, opts) {
  const body = { kind };
  const since = opts && typeof opts.since === 'string' ? opts.since.trim() : '';
  if (since) body.since = since;
  return api('/chat-sync', body);
}
export async function upsertChat(kind, data, expectedUpdatedAt) {
  const res = await api('/chat-sync', { kind, data, expectedUpdatedAt });
  if (res.error && res.error.code === 'CHAT_SYNC_CONFLICT') return res;
  return res;
}

let mainChatPollTimer = null;
let mainChatPollCallback = null;
let lastMainChatUpdatedAt = null;
let mainPollInFlight = false;
// 期 1 ⑨（2026-10-11）：回合进行中「本 tick 不发请求」的判定函数，由订阅方（index.html）注入。
// 保持 null 就是改动前的行为——不跳过。模块内不预设任何默认判定，免得在没有"回合"概念的场景里误跳。
let mainChatShouldSkipPoll = null;

export function subscribeMainChat(onUpdate, shouldSkipPoll) {
  mainChatPollCallback = onUpdate;
  // 第二个参数显式可选：老调用点（只传一个回调）行为不变；老 supabase.js 碰到多传的实参也只是
  // 忽略它，不会抛 TypeError，所以这个参数不需要 Safely 包装（要包装的是页面侧那个判定函数）。
  mainChatShouldSkipPoll = (typeof shouldSkipPoll === 'function') ? shouldSkipPoll : null;
  startMainChatPoll();
  return { unsubscribe: () => unsubscribeMainChatPoll() };
}
// 阶段 3（2026-10-11）：把定时器收进一对显式启停，给 index.html 的 visibilitychange/pageshow 用。
// 定时器句柄已经有现成的（mainChatPollTimer），不新造变量、不改别的结构。
// 关键约束：**已有定时器时直接 return，不得重复创建**——重复创建会让每次切前台多堆一根 5s 定时器，
// 请求数翻倍。回前台只重启定时器，**不在这里补拉一次**：refreshChatsOnResume 已经会拉一次主聊天，
// 补拉会叠成两次全量。
export function startMainChatPoll(opts) {
  if (mainChatPollTimer) return;
  if (!mainChatPollCallback) return;
  // 立刻拉一次只在「订阅首启」那条路上做（subscribeMainChat 调它时不传参）——那时没有任何
  // 别的通道在拉，不拉就要等满一个 5s tick，画面白等 5 秒。
  // 「回前台 / bfcache 唤醒」那条路显式传 { immediate:false }：同一时刻 refreshChatsOnResume
  // 已经会拉一次主聊天，这里再补一次就是两根并发请求——内容刚变时两根都会走全量（各 10MB），
  // 比不修还糟，正是 ao 明确要避免的"叠成两次全量"。
  if (!opts || opts.immediate !== false) pollMainChat();
  mainChatPollTimer = setInterval(pollMainChat, 5000);
}
// 只停定时器与在途守卫的重复建，**不清回调**：回调是订阅方（index.html）注册的，停表不等于退订，
// 回前台 startMainChatPoll 还要靠它继续投递。在飞的请求不用管，pollMainChat 的 finally 会释放。
export function stopMainChatPoll() {
  if (mainChatPollTimer) { clearInterval(mainChatPollTimer); mainChatPollTimer = null; }
}
// 退订专用（subscribeMainChat 返回的 unsubscribe 用）。与 stopMainChatPoll 分开是因为两者语义不同：
// 一个是"暂停取数"，一个是"没人要了"。
function unsubscribeMainChatPoll() {
  stopMainChatPoll();
  mainChatPollCallback = null;
  mainChatShouldSkipPoll = null;
}
// 阶段 3：首屏播种去重键。initChatSync 那一次 getChat('main') 不带 since（老行为，字节数与改动前一致），
// 拿到的 updated_at 就是"本机已经消费掉的那一份版本"。不播的话，开页面后第一根轮询还得多下一整份 10 MB。
// 只接受非空字符串：拿不到就保持 null，轮询照旧走全量（= 现状，没有新风险）。
export function seedMainChatVersion(v) {
  if (typeof v === 'string' && v) lastMainChatUpdatedAt = v;
}
// 只读出口，给 index.html 的 refreshChatsOnResume 取当前去重键用（它自己要发那一根条件请求）。
// 归一成"非空字符串或空串"：调用方拿到空串就等于不带 since，走全量，与改动前一致。
// 不提供 setter——要写只能走 seedMainChatVersion（首屏播种）或轮询内部推进，
// 免得别处随手塞一个本地生成的时间戳进来把别的设备的更新误判成"没变"。
export function getMainChatVersion() {
  return typeof lastMainChatUpdatedAt === 'string' ? lastMainChatUpdatedAt : '';
}
// 去重键（lastMainChatUpdatedAt）**只在这一次投递真的被消费掉之后**才推进。
// 以前是先推进后投递：回调侧只要在某条早退分支上 return（生成中 / 陈旧快照 / 锚点对不上），
// 这一份快照就被永久作废了——要等到 updated_at 再次变化才会重新投递，最长能空 5s+。
// 现在回调返回 false 表示"这次没吃掉"，键原地不动，下一个 5s tick 自动重投；
// 页面侧还有一条 1.5s 的定点重放（index.html 的 parkCloudRow/drainPendingCloudRow），
// 快慢两条腿互为兜底。
// in-flight 守卫：请求 RTT 超过 5s 时上一根还没回来下一根就发了，两根可能乱序返回，
// 把旧的快照盖在新的上面。同一时刻只允许一根在飞。
async function pollMainChat() {
  if (!mainChatPollCallback || mainPollInFlight) return;
  // 期 1 ⑨（2026-10-11）：回合进行中直接跳过本 tick，**一个字节都不发**。
  // 道理：回合期间服务端每写一次主聊天，updated_at 就往前走一步，而本机的去重键因为快照被
  // park（applyCloudMainUpdate 返回 false）原地不动 → 每一根 5s tick 都带旧 since → 服务端
  // 每次都回整份 10 MB → 又 park → 键还是不动。整个回合每 5 秒白下 10 MB，还跟流式抢带宽。
  // 回合结束后这些内容由 done 分支重画 + park 槽重放补齐，中间这几份是纯浪费。
  // 跳过时**不推进去重键**（键语义不变：只表示"这一版被消费掉了"），所以回合一结束，
  // 第一根 tick 必然带旧 since → 服务端必然回全量 → 被正常消费并推进键，不丢更新。
  // 判定失败/没注入/抛异常一律按"不跳过"处理：这是省流量优化，绝不能因为判定函数出问题
  // 把同步整个停掉（那就是把一条只读通道静默关死）。
  if (mainChatShouldSkipPoll) {
    let skip = false;
    try { skip = !!mainChatShouldSkipPoll(); } catch (e) { skip = false; }
    if (skip) return;
  }
  mainPollInFlight = true;
  try {
    // 阶段 3（2026-10-11）：带上本机已消费的版本号走条件请求。getChat 内部只在
    // lastMainChatUpdatedAt 是非空字符串时才会真的把 since 放进请求体，所以首轮（null）
    // 与任何异常情形依旧是不带 since 的全量，向后兼容。
    const { data, error } = await getChat('main', { since: lastMainChatUpdatedAt });
    if (error || !data) return;
    // 服务端说"没变，就是你手上那一版"→ 什么都不做：不推进去重键、不重画、不碰本地消息。
    // 严格 === true：老服务端 / 不带 since 的响应里没有这个字段，undefined 会落到下面原有逻辑，
    // 与改动前逐字节一致。
    if (data.unchanged === true) return;
    if (data.updated_at && data.updated_at !== lastMainChatUpdatedAt) {
      const consumed = mainChatPollCallback(data);
      if (consumed !== false) lastMainChatUpdatedAt = data.updated_at;
    }
  } catch {}
  finally { mainPollInFlight = false; }
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
window.supabaseChats = { getChat, upsertChat, subscribeMainChat, startMainChatPoll, stopMainChatPoll, seedMainChatVersion, getMainChatVersion };
window.supabaseChecklist = { getChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem, claimDueChecklistAlarms };
window.supabaseAiConfig = { upsertAiConfig };
window.supabaseMood = { getMood, upsertMood };
window.supabaseWakeEngine = { getWakeEngineEnabled, setWakeEngineEnabled };
