// 真后端适配层：把 window.supabaseMemory / window.memoryEmbedding 换成调用本地 OmbreBrain
// 真后端(localhost:8000)，而不是 Supabase。index.html 里所有记忆读写代码一行不用改——
// 调的还是这两个同名全局对象，字段格式转换全在这个文件里做，不改后端任何代码。
//
// 迁移前 Supabase 里的记忆已导出备份到 home/backups/supabase_memories_backup_*.json。

const OMBRE_BASE = 'https://47-107-161-135.sslip.io';

// 云端服务端设了 OMBRE_ADMIN_TOKEN 全局鉴权，/api/* 都要带 X-Admin-Token header，否则 401。
// token 不能写进这个文件(会随 index.html 一起公开在 GitHub Pages 源码里)，改成首次访问弹窗问用户要，
// 存进 localStorage，之后同设备/浏览器不用再输。
const OMBRE_TOKEN_KEY = 'ombre_admin_token';
function getOmbreToken() {
  let token = localStorage.getItem(OMBRE_TOKEN_KEY);
  if (!token) {
    token = prompt('请输入 Ombre Brain 的 Admin Token（部署时生成，只需输入一次）：');
    if (token) localStorage.setItem(OMBRE_TOKEN_KEY, token.trim());
  }
  return token ? token.trim() : '';
}

// index.html 在调用 addMemory/updateMemory 之前，已经把内部分类键(you/us/study/nest/legacy)
// 转成了中文标签(侧写/共鸣/学业/造巢)，这里收到的 type 参数就是这四个中文标签之一。
// 真后端没有这个分类维度，借用它的自由分类字段 domain 存这个标签，读回时再从 domain[0] 还原。
const MEMORY_TYPES = ['侧写', '共鸣', '学业', '造巢'];

// home source(manual/ai/import) <-> 真后端 created_by(user/ai/import)，只有 manual/user 这一对不同名。
const SOURCE_TO_CREATED_BY = { manual: 'user', ai: 'ai', import: 'import' };
const CREATED_BY_TO_SOURCE = { user: 'manual', ai: 'ai', import: 'import' };

function clampImportance(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 5;
  return Math.min(10, Math.max(1, n));
}

async function ombreFetch(path, options) {
  try {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers, { 'X-Admin-Token': getOmbreToken() });
    const res = await fetch(OMBRE_BASE + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) localStorage.removeItem(OMBRE_TOKEN_KEY); // token 错了/过期，下次请求重新弹窗问
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) return { data: null, error: (data && data.error) || `HTTP ${res.status}` };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
}

// 真后端桶 metadata -> 伪 Supabase 行形状，供 index.html 现成的 supabaseRowToMemoryItem() 直接消费。
function bucketToRow(bucket) {
  const meta = bucket.metadata || {};
  const domain0 = Array.isArray(meta.domain) ? meta.domain[0] : null;
  return {
    id: bucket.id,
    content: bucket.content != null ? bucket.content : (meta.content_preview || ''),
    type: MEMORY_TYPES.includes(domain0) ? domain0 : null, // 非法/未分类值让 index.html 自己兜底成 legacy
    importance: meta.importance != null ? meta.importance : 5,
    protected: !!meta.protected,
    highlight: !!meta.highlight,
    feel: meta.type === 'feel',
    // noise 是真后端的计算字段，不是可直接读的列：resolved && importance===1 才算 noise。
    noise: !!(meta.resolved && meta.importance === 1),
    source: CREATED_BY_TO_SOURCE[meta.created_by] || 'import',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    created_at: meta.created || meta.last_active || null,
  };
}

// home 记忆字段 -> 真后端 update/create 请求 body。
function buildPatch({ content, type, importance, flags, source, tags }) {
  const f = flags || {};
  const patch = {};
  if (content != null) patch.content = content;
  if (type != null) patch.domain = [MEMORY_TYPES.includes(type) ? type : '侧写'];
  if (importance != null) patch.importance = clampImportance(importance);
  if (f.protected != null) patch.protected = !!f.protected;
  if (f.highlight != null) patch.highlight = !!f.highlight;
  if (f.feel != null) patch.type = f.feel ? 'feel' : 'dynamic';
  if (source != null) patch.created_by = SOURCE_TO_CREATED_BY[source] || 'user';
  if (tags != null) patch.tags = tags;
  // 标记 noise=true：真后端约定同时传 resolved:true + importance:1(后端会自动备份原 importance)。
  // 取消 noise：只传 resolved:false，不主动带 importance，让后端从备份里自动恢复原值——
  // 除非调用方在同一次 action 里显式给了新 importance(上面已经写进 patch，这里不会覆盖)。
  if (f.noise === true) { patch.resolved = true; patch.importance = 1; }
  else if (f.noise === false) { patch.resolved = false; }
  return patch;
}

async function addMemory(content, type, importance, flags, source, tags) {
  if (!MEMORY_TYPES.includes(type)) {
    throw new Error(`type 必须是 ${MEMORY_TYPES.join('/')} 之一，收到：${type}`);
  }
  const patch = buildPatch({ content, type, importance, flags, source, tags });
  // create 接口不支持 resolved(noise 标记)，跟真后端自己处理 internalized 的方式一样，先建后补一次 update。
  const wantsNoise = patch.resolved === true;
  delete patch.resolved;
  const body = { content, domain: patch.domain, importance: patch.importance, tags: patch.tags || [] };
  if (patch.protected != null) body.protected = patch.protected;
  if (patch.highlight != null) body.highlight = patch.highlight;
  if (patch.type != null) body.type = patch.type;
  if (patch.created_by != null) body.created_by = patch.created_by;
  const { data, error } = await ombreFetch('/api/bucket/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (error) return { data: null, error };
  if (wantsNoise) {
    await ombreFetch(`/api/bucket/${data.id}/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: true, importance: 1 }),
    });
  }
  const fresh = await ombreFetch(`/api/bucket/${data.id}`);
  const row = fresh.data ? bucketToRow(fresh.data) : bucketToRow({ id: data.id, metadata: data.metadata, content });
  return { data: [row], error: null };
}

async function getMemories(type, limit = 20) {
  const { data, error } = await ombreFetch('/api/buckets');
  if (error) return { data: null, error };
  let list = Array.isArray(data) ? data : [];
  if (type) list = list.filter(b => Array.isArray(b.domain) && b.domain.includes(type));
  list = list.slice(0, limit);
  // /api/buckets 只给 200 字预览，记忆注入需要完整正文，逐条拉详情(本机 localhost，并发拉不慢)。
  const rows = await Promise.all(list.map(async b => {
    const detail = await ombreFetch(`/api/bucket/${b.id}`);
    return detail.data ? bucketToRow(detail.data) : bucketToRow({ id: b.id, metadata: b, content: b.content_preview });
  }));
  return { data: rows, error: null };
}

async function updateMemory(id, fields) {
  if (fields.type != null && !MEMORY_TYPES.includes(fields.type)) {
    throw new Error(`type 必须是 ${MEMORY_TYPES.join('/')} 之一，收到：${fields.type}`);
  }
  const patch = buildPatch({
    content: fields.content, type: fields.type, importance: fields.importance,
    flags: { protected: fields.protected, highlight: fields.highlight, feel: fields.feel, noise: fields.noise },
    source: fields.source, tags: fields.tags,
  });
  const { data, error } = await ombreFetch(`/api/bucket/${id}/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (error) return { data: null, error };
  const fresh = await ombreFetch(`/api/bucket/${id}`);
  const row = fresh.data ? bucketToRow(fresh.data) : null;
  return { data: row ? [row] : [], error: null };
}

// 真后端只支持软删除(移进回收站，/v2/console/trash/ 里能找回)，没有硬删除的公开语义——
// 比原来 Supabase 的硬 delete 更安全，符合"别丢数据"的原则，未额外调用 /purge。
async function deleteMemory(id) {
  const { error } = await ombreFetch(`/api/bucket/${id}/delete`, { method: 'POST' });
  return { error };
}

// 主脚本是非 module 的经典 <script>，无法 import 本文件；挂到 window 上供其调用。
window.supabaseMemory = { addMemory, getMemories, updateMemory, deleteMemory };

// ---- 语义检索：真后端 /api/search 替代 Supabase Edge Function ----

// 真后端在 create/update 时已经自动生成并存储 embedding(embedding_engine.generate_and_store)，
// 不需要 home 这边再单独触发一次，保留这个函数只是为了不用改 index.html 里的调用点。
async function storeWithEmbedding() { /* no-op：真后端已在写入时自动生成 embedding */ }

async function searchByEmbedding(queryText, topK = 5) {
  if (!queryText || !queryText.trim()) return [];
  const { data, error } = await ombreFetch(
    `/api/search?q=${encodeURIComponent(queryText)}&limit=${topK}&include_vector=true&exclude_pinned=true`
  );
  if (error || !data) return [];
  const hits = [...(data.keyword_hits || []), ...(data.vector_hits || [])].slice(0, topK);
  return hits.map(h => ({
    content: h.content_preview || h.summary || '',
    similarity: h.similarity != null ? h.similarity : null,
  }));
}

async function getRelevantMemories(context, topK = 5) {
  const matches = await searchByEmbedding(context, topK);
  if (!matches.length) return '';
  return '\n\n【语义相关记忆】\n' + matches.map(m =>
    m.similarity != null ? `${m.content}（相关度${(m.similarity * 100).toFixed(0)}%）` : m.content
  ).join('\n');
}

window.memoryEmbedding = { storeWithEmbedding, searchByEmbedding, getRelevantMemories };
