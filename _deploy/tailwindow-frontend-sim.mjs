// ③ 前端尾窗契约测试（2026-10-12）
// 测的是线上要跑的那一份源码（从 index.html / supabase.js 里抠出来），不是抄的副本。
// 用法：node _deploy/tailwindow-frontend-sim.mjs
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const HOME = path.join(here, '..');
const idxSrc = fs.readFileSync(path.join(HOME, 'index.html'), 'utf8');
const sbSrc = fs.readFileSync(path.join(HOME, 'supabase.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }
function grab(src, re, what) {
  const m = src.match(re);
  if (!m) { console.error('✗ 没在源文件里找到 ' + what); process.exit(1); }
  return m[0];
}

// ---------- 抠源码 ----------
const getChatSrc = grab(sbSrc, /^export async function getChat\(kind, opts\) \{[\s\S]*?\n\}/m, 'supabase.js getChat').replace(/^export /, '');
const pollSrc = grab(sbSrc, /^async function pollMainChat\(\) \{[\s\S]*?\n\}/m, 'supabase.js pollMainChat');
const subSrc = grab(sbSrc, /^export function subscribeMainChat\(onUpdate, shouldSkipPoll, opts\) \{[\s\S]*?\n\}/m, 'supabase.js subscribeMainChat').replace(/^export /, '');
const mergeSrc = grab(idxSrc, /^function mergeCloudTailIntoLocal\(localMessages, cloudMessages\) \{[\s\S]*?\n\}/m, 'mergeCloudTailIntoLocal');
const filterSrc = grab(idxSrc, /^function filterDeletedLocally\(list\) \{[\s\S]*?\n\}/m, 'filterDeletedLocally');
const sameSrc = grab(idxSrc, /^function sameMsgSeq\(a, b\) \{[\s\S]*?\n\}/m, 'sameMsgSeq');
const staleSrc = grab(idxSrc, /^function cloudSnapshotIsStale\(nextSeq, localSeq\) \{[\s\S]*?\n\}/m, 'cloudSnapshotIsStale');
const applySrc = grab(idxSrc, /^function applyCloudMainUpdate\(row\) \{[\s\S]*?\n\}/m, 'applyCloudMainUpdate');
const pullSrc = grab(idxSrc, /^async function pullFullMainAfterPartialMiss\(\) \{[\s\S]*?\n\}/m, 'pullFullMainAfterPartialMiss');
const tailConstSrc = grab(idxSrc, /^const MAIN_TAIL_COUNT = \d+;/m, 'MAIN_TAIL_COUNT');
const subscribeOnceSrc = grab(idxSrc, /^function subscribeMainChatOnce\(\) \{[\s\S]*?\n\}/m, 'subscribeMainChatOnce');
const resumeSrc = grab(idxSrc, /^async function refreshChatsOnResume\(\) \{[\s\S]*?\n\}/m, 'refreshChatsOnResume');

// ---------- 虚拟服务端：和 69125c7 的判据一致 ----------
function makeServer(initial) {
  const s = {
    msgs: initial.slice(), ver: 1, calls: [],
    bump() { s.ver++; },
    handle(body) {
      s.calls.push(JSON.parse(JSON.stringify(body)));
      const updated_at = 'v' + s.ver;
      if (body.since && body.since === updated_at) return { data: { unchanged: true, updated_at } };
      const k = body.tailCount;
      const kOk = Number.isInteger(k) && k >= 1 && k <= 200;
      if (body.kind === 'main' && kOk && s.msgs.length > k)
        return { data: { data: s.msgs.slice(-k), partial: true, total: s.msgs.length, updated_at } };
      return { data: { data: s.msgs.slice(), updated_at } };
    },
  };
  return s;
}
const mk = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ id: 'm' + (a + i) }));
const ids = l => l.map(m => m.id).join(',');
const hasDup = l => new Set(l.map(m => m.id)).size !== l.length;

// ---------- 页面环境（messages/mainGenerating 是 let，和 index.html 一样放在闭包里） ----------
function makeEnv(server, localInit) {
  const log = { parked: 0, persisted: 0, repainted: 0, seeded: [], warns: [] };
  const factory = new Function('server', 'localInit', 'log', `
    let messages = localInit.slice();
    let mainGenerating = false, activeStreamMsgId = null;
    const deletedIdTombstones = new Map(); const DELETED_ID_TTL_MS = 3600e3;
    const console = { warn: (...a) => log.warns.push(a.join(' ')), log() {} };
    const parkCloudRow = () => { log.parked++; };
    const persistMessagesNow = () => { log.persisted++; };
    const repaintTail = () => { log.repainted++; };
    const window = { supabaseChats: {
      getChat: async (kind, opts) => server.handle({ kind, ...(opts && opts.since ? { since: opts.since } : {}) }),
      seedMainChatVersion: v => log.seeded.push(v),
    } };
    ${tailConstSrc}
    let mainFullPullInFlight = false;
    ${filterSrc}
    ${mergeSrc}
    ${sameSrc}
    ${staleSrc}
    ${applySrc}
    ${pullSrc}
    return {
      apply: applyCloudMainUpdate, merge: mergeCloudTailIntoLocal,
      get messages() { return messages; }, set messages(v) { messages = v; },
      set generating(v) { mainGenerating = v; },
      tombstone(id) { deletedIdTombstones.set(id, Date.now()); },
      get inFlight() { return mainFullPullInFlight; },
      MAIN_TAIL_COUNT,
    };
  `);
  return { env: factory(server, localInit, log), log };
}
const tick = () => new Promise(r => setTimeout(r, 0));

// ================= 1. getChat 请求体 =================
{
  let sent = null;
  const mkGet = new Function('api', getChatSrc + '\nreturn getChat;');
  const getChat = mkGet(async (_p, body) => { sent = body; return { data: null }; });
  await getChat('main', { since: 'v1', tailCount: 100 });
  ok(sent.since === 'v1' && sent.tailCount === 100, '1a since+tailCount 都带');
  await getChat('main', { tailCount: 100 });
  ok(!('tailCount' in sent) && !('since' in sent), '1b 没有 since 就不带 tailCount（首屏/冲突分支=全量对账）');
  await getChat('main');
  ok(JSON.stringify(sent) === '{"kind":"main"}', '1c 无 opts 与旧行为逐字节一致');
  await getChat('main', { since: 'v1' });
  ok(!('tailCount' in sent), '1d 没传 tailCount 就不带');
  await getChat('subchats', { since: 'v1', tailCount: 100 });
  ok(!('tailCount' in sent), '1e subchats 永不带 tailCount');
  for (const bad of [0, 201, 1.5, -1, '100', null, NaN]) {
    await getChat('main', { since: 'v1', tailCount: bad });
    ok(!('tailCount' in sent), '1f 非法 K 不发: ' + String(bad));
  }
  await getChat('main', { since: 'v1', tailCount: 1 }); ok(sent.tailCount === 1, '1g K=1 合法');
  await getChat('main', { since: 'v1', tailCount: 200 }); ok(sent.tailCount === 200, '1h K=200 合法');
}

// ================= 2. subscribe opt-in + pollMainChat 带 tailCount =================
{
  const run = async (subOpts) => {
    const bodies = [];
    const f = new Function('api', `
      let mainChatPollCallback = null, mainPollInFlight = false, lastMainChatUpdatedAt = 'v1';
      let mainChatShouldSkipPoll = null, mainChatTailCount = 0, mainChatPollTimer = null;
      function startMainChatPoll() {}
      ${getChatSrc}
      ${subSrc}
      ${pollSrc}
      subscribeMainChat(() => true, null, ${JSON.stringify(subOpts)});
      return pollMainChat;
    `);
    const poll = f(async (_p, body) => { bodies.push(body); return { data: { unchanged: true, updated_at: 'v1' } }; });
    await poll();
    return bodies[0];
  };
  ok((await run({ tailCount: 100 })).tailCount === 100, '2a 订阅 opt-in 后轮询带 tailCount=100');
  ok(!('tailCount' in await run(undefined)), '2b 不传第三参（旧页面）轮询不带 tailCount');
  ok(!('tailCount' in await run({ tailCount: 999 })), '2c 订阅方传越界值被忽略');
  ok(/subscribeMainChat\(row => applyCloudMainUpdate\(row\), shouldSkipMainChatPollSafely, \{ tailCount: MAIN_TAIL_COUNT \}\)/.test(subscribeOnceSrc), '2d index.html 订阅处确实传了 tailCount');
  ok(/getChat\('main', \{ since: getMainChatVersionSafely\(\), tailCount: MAIN_TAIL_COUNT \}\)/.test(resumeSrc), '2e 回前台刷新带 tailCount');
  ok(/getChat\('main'\);/.test(idxSrc.match(/^async function initChatSync[\s\S]*?\n\}/m)[0]), '2f 首屏 initChatSync 的 getChat 仍是无参全量');
}

// ================= 3. 锚点命中：只拼尾巴 =================
{
  const server = makeServer(mk(1, 500));
  const { env, log } = makeEnv(server, mk(1, 497));      // 本机缺 3 条新的
  const row = server.handle({ kind: 'main', since: 'old', tailCount: 100 }).data;
  ok(row.partial === true && row.data.length === 100, '3a 虚拟服务端返回尾窗');
  const r = env.apply(row);
  ok(r === true, '3b 锚点命中=消费');
  ok(ids(env.messages) === ids(mk(1, 500)), '3c 合并结果=服务端全量序列');
  ok(!hasDup(env.messages), '3d 无重复');
  ok(server.calls.length === 1 && log.persisted === 1 && log.repainted === 1, '3e 没触发全量拉取，落盘/重画各 1 次');
}

// ================= 4. 锚点缺失：转全量，不走回退对齐 =================
{
  const server = makeServer(mk(1, 700));
  const { env, log } = makeEnv(server, mk(1, 500));      // 本机落后 200 条，窗口 601..700 锚点不在本地
  const row = server.handle({ kind: 'main', since: 'old', tailCount: 100 }).data;
  const calls0 = server.calls.length;
  const r = env.apply(row);
  ok(r === false, '4a 本份不消费（键不推进）');
  ok(log.parked === 0, '4b 不 park（重放只会再缺一次）');
  ok(ids(env.messages) === ids(mk(1, 500)), '4c 同步段内本地不被改动');
  await tick(); await tick();
  ok(server.calls.length === calls0 + 1 && !('tailCount' in server.calls[server.calls.length - 1]) && !('since' in server.calls[server.calls.length - 1]), '4d 恰好发了一次无 since 无 tailCount 的全量请求');
  ok(ids(env.messages) === ids(mk(1, 700)), '4e 全量应用后=服务端 700 条');
  ok(!hasDup(env.messages), '4f 无重复');
  ok(log.seeded.length === 1 && log.seeded[0] === 'v' + server.ver, '4g 全量吃掉后把去重键推进到全量版本');
  ok(env.inFlight === false, '4h in-flight 已释放');
}

// ================= 4x. 锚点被本地删掉（末条仍有交集）：不走回退对齐，转全量 =================
{
  const local = mk(1, 650).filter(m => m.id !== 'm601');
  const server = makeServer(mk(1, 700));
  const e2 = makeEnv(server, local);
  const row = server.handle({ kind: 'main', since: 'old', tailCount: 100 }).data;
  e2.env.apply(row); await tick(); await tick();
  ok(ids(e2.env.messages) === ids(mk(1, 700)) && !hasDup(e2.env.messages), '4k 锚点被本地删掉：转全量后恢复为服务端全量且无重复');
}

// ================= 5. 墓碑：窗口首条被本机删了 =================
{
  const server = makeServer(mk(1, 602));
  const { env } = makeEnv(server, mk(1, 600));
  const row = server.handle({ kind: 'main', since: 'old', tailCount: 100 }).data;
  const first = row.data[0].id;                                   // 窗口首条 = m503
  env.tombstone(first);
  env.messages = env.messages.filter(m => m.id !== first);        // 本机已删窗口首条
  const r = env.apply(row);
  ok(r === false, '5a 首条被删=锚点缺失→转全量');
  await tick(); await tick();
  ok(!env.messages.some(m => m.id === first), '5b 全量应用后墓碑照常滤掉被删的首条');
  ok(env.messages.some(m => m.id === 'm602') && !hasDup(env.messages), '5c 新条到位且无重复');
}

// ================= 6. 老服务端 / 全量行：不进新分支 =================
{
  const server = makeServer(mk(1, 700));
  const { env, log } = makeEnv(server, mk(1, 500));
  const calls0 = server.calls.length;
  const full = { data: mk(1, 700), updated_at: 'v1' };   // 无 partial 字段
  const r = env.apply(full);
  ok(r === true && ids(env.messages) === ids(mk(1, 700)), '6a 无 partial 字段=按全量消费，行为不变');
  ok(server.calls.length === calls0 && log.seeded.length === 0, '6b 没有额外请求');
  // 老服务端忽略 tailCount → 返回全量；apply 照旧
  const old = { handle: b => ({ data: { data: mk(1, 700), updated_at: 'v1' } }), calls: [] };
  const r2 = makeEnv(old, mk(1, 500)).env.apply(old.handle({}).data);
  ok(r2 === true, '6c 老服务端忽略 tailCount 返回全量可正常消费');
}

// ================= 7. 回合中：park，不发全量 =================
{
  const server = makeServer(mk(1, 700));
  const { env, log } = makeEnv(server, mk(1, 500));
  env.generating = true;
  const row = server.handle({ kind: 'main', since: 'old', tailCount: 100 }).data;
  const calls0 = server.calls.length;
  const r = env.apply(row);
  ok(r === false && log.parked === 1, '7a 回合中先 park（原有保护在新分支之前）');
  await tick();
  ok(server.calls.length === calls0, '7b 回合中不发全量拉取');
}

// ================= 8. in-flight 去重 / 失败容错 =================
{
  const server = makeServer(mk(1, 700));
  const { env } = makeEnv(server, mk(1, 500));
  const row = server.handle({ kind: 'main', since: 'old', tailCount: 100 }).data;
  const calls0 = server.calls.length;
  env.apply(row); env.apply(row); env.apply(row);
  await tick(); await tick();
  ok(server.calls.length === calls0 + 1, '8a 连续三次缺锚点只发一次全量（in-flight 守卫）');

  // 全量请求失败：不抛、释放标志、下次可重试
  const bad = makeServer(mk(1, 700));
  const orig = bad.handle.bind(bad);
  let failNext = true;
  bad.handle = body => { if (failNext && !body.since && !body.tailCount) { failNext = false; return { data: null, error: { message: 'boom' } }; } return orig(body); };
  const e2 = makeEnv(bad, mk(1, 500));
  const row2 = orig({ kind: 'main', since: 'old', tailCount: 100 }).data;
  e2.env.apply(row2); await tick(); await tick();
  ok(e2.env.inFlight === false && ids(e2.env.messages) === ids(mk(1, 500)), '8b 全量失败：标志释放、本地不动、不抛');
  e2.env.apply(row2); await tick(); await tick();
  ok(ids(e2.env.messages) === ids(mk(1, 700)), '8c 下一根再来就恢复');
}

// ================= 9. 尾窗之后收敛：同一份随后以 since 命中 =================
{
  const server = makeServer(mk(1, 700));
  const { env } = makeEnv(server, mk(1, 500));
  const row = server.handle({ kind: 'main', since: 'old', tailCount: 100 }).data;
  env.apply(row); await tick(); await tick();
  const next = server.handle({ kind: 'main', since: 'v' + server.ver, tailCount: 100 });
  ok(next.data.unchanged === true, '9a 去重键推进后下一根命中 unchanged');
}

console.log(fail === 0 ? `✓ 全绿 ${pass} 条断言` : `✗ ${fail} 条失败 / ${pass} 条通过`);
process.exit(fail === 0 ? 0 : 1);
