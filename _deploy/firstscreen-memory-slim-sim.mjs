// 首屏瘦身 A-3 契约测试 + 记忆迁移挪出首屏（A2 施工）契约测试
//
// 背景（home-firstscreen-slim-plan-for-deepseek.md 轨道 A）：
//   首屏两次 /api/buckets 各约 500 条详情（≈1030 次 GET /api/bucket/<id>），
//   来源是 initSupabaseMemorySync 里顺序两行：
//     await migrateLocalToSupabase();      // getMemories(null, 1000)
//     await refreshMemoryFromSupabase();   // getMemories(null, 500)   ← A-3 已删
//
// A2 施工（ao 2026-10-11 拍板五点）又把迁移本身挪出首屏，并补三项耐久性措施：
//   1. requestIdleCallback + setTimeout 兜底，timeout 3000ms，门闩判两次；
//   2. sbId 判重必加；逐条落盘改为「每 10 条一次 + 结束必落」；
//   3. 失败计数，3 次失败后写 24h 退避时间戳，成功清零；
//   4. 被杀时正在飞的那一条只靠 content 去重兜底（接受，本条只做说明不断言）；
//   5. 本脚本同批更新（C 段两条断言），改前先红、改后全绿。
//   6. 补丁（ao 2026-10-11 二批）：失败计数从「只在 fetchErr 分支 +1」前移到
//      getMemories 拉取**之前** +1，完整跑到置门闩处才清零 ⇒ 页面中途被杀（迁移要发
//      几百次请求）也算一次尝试，连续 3 次即 24h 退避。C-8 段 7 条断言对应该补丁。
//
// 这个脚本从 index.html **抠出真函数**跑（不是抄一份），用假的 localStorage/window/console
// 和一个"手动 flush 的 rIC/setTimeout"，断言：
//   A. 启动路径调用账：迁移不再 await 在首屏；flush 后只剩 migrate 的 1000 一条；门闩置位时 0 条
//   B. refreshMemoryFromSupabase 函数体**保留**（ao 明确要求不删），只是没人调
//   C. migrate 的门闩（两次）、退避、sbId 判重、落盘节奏
//   D. token 估算链不依赖云端：buildMemoryInjection 只读本地 memory 数组
//   E. refreshTokenEstimate 在别处仍有调用点
//   F. 导出备份走 IDB，不经 memory 数组（源码级断言）
//
// 用法：node _deploy/firstscreen-memory-slim-sim.mjs
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const HOME = path.join(here, '..');
const idxSrc = fs.readFileSync(path.join(HOME, 'index.html'), 'utf8');

function grab(src, re, what) {
  const m = src.match(re);
  if (!m) { console.error(`✗ 没在源文件里找到 ${what}`); process.exit(1); }
  return m[0];
}
// A2 新引入的函数/常量：允许缺失（"改前先红"那一次它们本来就不存在），
// 缺了就让下游断言自己变红，而不是整个脚本 exit。
function grabSoft(src, re) {
  const m = src.match(re);
  return m ? m[0] : '';
}

const failures = [];
function ok(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`); failures.push(label); }
}

// ---------- 抠源码 ----------
const initSrc = grab(idxSrc, /^async function initSupabaseMemorySync\(\) \{[\s\S]*?\n\}/m, 'index.html initSupabaseMemorySync');
const migSrc = grab(idxSrc, /^async function migrateLocalToSupabase\(\) \{[\s\S]*?\n\}/m, 'index.html migrateLocalToSupabase');
const refreshSrc = grab(idxSrc, /^async function refreshMemoryFromSupabase\(\) \{[\s\S]*?\n\}/m, 'index.html refreshMemoryFromSupabase');
const pinSrc = grab(idxSrc, /^function getPinnedMemories\(\) \{[\s\S]*?\n\}/m, 'index.html getPinnedMemories');
const injectSrc = grab(idxSrc, /^function buildMemoryInjection\(\) \{[\s\S]*?\n\}/m, 'index.html buildMemoryInjection');
const isPinnedSrc = grab(idxSrc, /^function isPinnedMemory\(m\) \{[\s\S]*?\n\}/m, 'index.html isPinnedMemory');

// A2 新增件（软抓）
const schedSrc = grabSoft(idxSrc, /^function scheduleMemoryMigration\(\) \{[\s\S]*?\n\}/m);
const failsSrc = grabSoft(idxSrc, /^function memoryMigrateFails\(\) \{[\s\S]*?\n\}/m);
const noteFailSrc = grabSoft(idxSrc, /^function noteMemoryMigrateFailure\(\) \{[\s\S]*?\n\}/m);
const clearFailSrc = grabSoft(idxSrc, /^function clearMemoryMigrateFailure\(\) \{[\s\S]*?\n\}/m);
const inBackoffSrc = grabSoft(idxSrc, /^function memoryMigrateInBackoff\(\) \{[\s\S]*?\n\}/m);
const memConstSrc = grabSoft(idxSrc, /^const LS_MEMORY_MIGRATE_FAILS = [\s\S]*?^const MEMORY_MIGRATE_PERSIST_EVERY = \d+;$/m);

const HAS_A2 = !!(schedSrc && failsSrc && noteFailSrc && clearFailSrc && inBackoffSrc && memConstSrc);

// 去掉注释再判断"有没有调用"，免得被注释里提到的函数名骗到
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ---------- 沙箱：跑真的 initSupabaseMemorySync / migrateLocalToSupabase ----------
// rIC 与 setTimeout 都被换成本地队列，由 flush() / fireTimers() 手动驱动，
// 这样才能断言"首屏返回时迁移还没跑"（A2 的核心）。
function makeSandbox(opts = {}) {
  const {
    migrated = false, fails = null, backoffUntil = null,
    localCount = 2, fetchError = false, addError = false, hangAtAdd = 0,
  } = opts;

  const store = new Map();
  if (migrated) store.set('nest_memory_migrated_v1', '1');
  if (fails !== null) store.set('nest_memory_migrate_fails', String(fails));
  if (backoffUntil !== null) store.set('nest_memory_migrate_backoff_until', String(backoffUntil));
  const calls = { getMemories: [], addMemory: 0, addedContents: [], persist: 0, refreshToken: 0, warns: [] };

  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };

  // 本地记忆：m1 已挂 sbId=sb1（云端那份的正文与它不同，用来验 sbId 判重），m2 未挂
  const base = [
    { id: 'm1', content: '本地第一条', type: '侧写', importance: 5, sbId: 'sb1' },
    { id: 'm2', content: '本地第二条', type: '共鸣', importance: 3 },
  ];
  const extra = [];
  for (let i = base.length; i < localCount; i++) {
    extra.push({ id: 'm' + (i + 1), content: '本地第' + (i + 1) + '条', type: '学业', importance: 4 });
  }
  const memoryRef = { value: [...base, ...extra].slice(0, Math.max(localCount, 0)) };

  let addSeq = 0;
  // hangAtAdd > 0：第 N 次 addMemory 永不 resolve —— 模拟「页面在处理到第 N 条时被杀」
  let addCalls = 0;
  const supabaseMemory = {
    async getMemories(type, limit) {
      calls.getMemories.push({ type, limit });
      if (fetchError) return { data: null, error: { message: 'boom' } };
      // 服务端返回：一条已在本地（id=sb1，正文与本地 m1 不同），一条是云端新增
      return {
        data: [
          { id: 'sb1', content: '本地第一条(云端版)', type: '侧写', importance: 7, tags: [] },
          { id: 'sb9', content: '云端独有', type: '学业', importance: 4, created_at: '2026-01-01T00:00:00Z' },
        ],
        error: null,
      };
    },
    async addMemory(content, type, importance, flags, source, tags) {
      calls.addMemory++; calls.addedContents.push(content);
      if (addError) return { data: null, error: { message: 'nope' } };
      if (hangAtAdd && ++addCalls >= hangAtAdd) return new Promise(() => {});
      return { data: [{ id: 'new' + (++addSeq), content }], error: null };
    },
  };

  // 手动驱动的 rIC / setTimeout
  const idleQueue = [];
  const timers = [];
  let timerSeq = 0;
  const requestIdleCallback = (cb, o) => { idleQueue.push({ cb, o }); return idleQueue.length; };
  const setTimeoutFn = (cb, ms) => { const id = ++timerSeq; timers.push({ id, cb, ms }); return id; };
  const clearTimeoutFn = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const drainMicro = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

  const factory = new Function(
    'localStorage', 'window', 'console', 'memoryRef', 'calls',
    'requestIdleCallback', 'setTimeout', 'clearTimeout',
    `
    let memory = memoryRef.value;
    const LS_MEMORY_MIGRATED = 'nest_memory_migrated_v1';
    const LS_MEMORY = 'nest_memory';
    const MEM_TYPE_TO_SUPABASE = {};
    const SUPABASE_TYPE_TO_MEM = {};
    function genId() { return 'gen-' + Math.random().toString(36).slice(2, 6); }
    function timeStr() { return '00:00'; }
    function persistMemory() { memoryRef.value = memory; calls.persist++; }
    function refreshTokenEstimate() { calls.refreshToken++; }
    function updateDecay() { return 1; }
    ${memConstSrc}
    ${failsSrc}
    ${noteFailSrc}
    ${clearFailSrc}
    ${inBackoffSrc}
    ${migSrc}
    ${refreshSrc}
    ${schedSrc}
    ${initSrc}
    return {
      init: initSupabaseMemorySync,
      migrate: migrateLocalToSupabase,
      refresh: refreshMemoryFromSupabase,
      schedule: (typeof scheduleMemoryMigration === 'function') ? scheduleMemoryMigration : null,
      inBackoff: (typeof memoryMigrateInBackoff === 'function') ? memoryMigrateInBackoff : null,
    };
  `);
  const api = factory(
    localStorage, { supabaseMemory },
    { warn: (...a) => calls.warns.push(a.map(x => (x && x.message) || String(x)).join(' ')), log: () => {} },
    memoryRef, calls,
    requestIdleCallback, setTimeoutFn, clearTimeoutFn,
  );

  api.flushIdle = async () => { while (idleQueue.length) idleQueue.shift().cb(); await drainMicro(); };
  api.fireTimers = async () => { const list = timers.splice(0, timers.length); for (const t of list) t.cb(); await drainMicro(); };
  api.drain = drainMicro;   // 「页面被杀」用：让挂在 await 上的 migrate 尽量往前跑，但不等它返回
  api.pendingIdle = () => idleQueue.length;
  api.pendingTimers = () => timers.length;
  api.store = store;
  return { api, calls, memoryRef, store };
}

console.log('=== A. 启动路径的 getMemories 调用账（含「迁移已挪出首屏」）===');

// A1 门闩未置位（首次加载）：init 返回时迁移必须**还没跑**；flush 后只剩 migrate 的 1000 一条
{
  const { api, calls } = makeSandbox({ migrated: false });
  await api.init();
  ok(calls.getMemories.length === 0, `initSupabaseMemorySync 返回时迁移尚未执行（实测 ${calls.getMemories.length} 条拉取）`);
  ok(api.pendingIdle() + api.pendingTimers() > 0, '迁移已被排进 rIC / setTimeout 兜底队列（没有同步跑）');

  await api.flushIdle();
  const limits = calls.getMemories.map(c => c.limit);
  ok(!limits.includes(500), '启动路径**不再**出现 limit=500 的拉取（A-3 的目标）');
  ok(limits.includes(1000), '迁移那条 limit=1000 **仍在**（ao：migrate 保持原样）');
  ok(calls.getMemories.length === 1, `flush 后 getMemories 总次数 = 1（实测 ${calls.getMemories.length}）`);
  ok(calls.getMemories.every(c => c.type === null), '两条（若还在）都以 type=null 拉全量（与改动前同形）');
}

// A2 门闩已置位（老用户的常态）：一次网络读都不该有
{
  const { api, calls } = makeSandbox({ migrated: true });
  await api.init();
  await api.flushIdle();
  await api.fireTimers();
  ok(calls.getMemories.length === 0, '门闩置位时：启动路径 getMemories 次数 = 0（首屏零 N+1）');
  ok(api.pendingIdle() === 0, '门闩置位时：不排 rIC 回调（第一次判门闩就早退）');
  ok(api.pendingTimers() === 0, '门闩置位时：也不排 setTimeout 兜底');
}

console.log('\n=== B. refreshMemoryFromSupabase 函数体保留、但已无调用点 ===');

{
  ok(/^async function refreshMemoryFromSupabase\(\) \{/.test(refreshSrc), 'refreshMemoryFromSupabase 函数体仍完整存在于 index.html（ao：函数保留不删）');
  ok(/getMemories\(null, 500\)/.test(refreshSrc), '函数体内部的 getMemories(null, 500) 原样未动（只是不再被启动路径调用）');
  const initBody = stripComments(initSrc);
  ok(!/refreshMemoryFromSupabase\s*\(/.test(initBody), 'initSupabaseMemorySync 体内**已无** refreshMemoryFromSupabase 调用');
  const callsInFile = (stripComments(idxSrc).match(/refreshMemoryFromSupabase\s*\(/g) || []).length;
  ok(callsInFile === 1, `全文件 refreshMemoryFromSupabase( 出现次数 = 1（只剩函数定义那一处；实测 ${callsInFile}）`);
}

console.log('\n=== C. migrate 的门闩（两次）、退避、sbId 判重、落盘节奏 ===');

{
  const bodyM = stripComments(migSrc);
  const bodyS = stripComments(schedSrc);
  const bodyInit = stripComments(initSrc);

  // --- C-1 门闩：早退 + 置位仍在 ---
  ok(/localStorage\.getItem\(LS_MEMORY_MIGRATED\)\) return;/.test(bodyM), '门闩 getItem(LS_MEMORY_MIGRATED) 早退仍在 migrate 体内');
  ok(/localStorage\.setItem\(LS_MEMORY_MIGRATED, '1'\)/.test(bodyM), '门闩置位 setItem 仍在 migrate 体内');

  // --- C-2 门闩判两次：排之前 + 真跑之前 ---
  const gatesInInit = (bodyInit.match(/getItem\(LS_MEMORY_MIGRATED\)/g) || []).length;
  const gatesInSched = (bodyS.match(/getItem\(LS_MEMORY_MIGRATED\)/g) || []).length;
  ok(HAS_A2, 'A2 新增件齐备（scheduleMemoryMigration / 退避三助手 / 退避常量块都在）');
  ok(gatesInSched === 2, `scheduleMemoryMigration 里判门闩**两次**（排之前 + 回调里各一次；实测 ${gatesInSched}）`);
  ok(/scheduleMemoryMigration\(\)/.test(bodyInit), 'initSupabaseMemorySync 改调 scheduleMemoryMigration（不再 await migrate）');
  ok(!/await\s+migrateLocalToSupabase\s*\(/.test(bodyInit), 'initSupabaseMemorySync 体内**已无** await migrateLocalToSupabase（迁移不再占首屏）');

  // --- C-3 空闲调度：rIC + setTimeout 兜底，timeout 3000ms，两者共用一个 done 闩 ---
  ok(/requestIdleCallback\(run, \{ timeout: 3000 \}\)/.test(bodyS), 'rIC 带 timeout: 3000（保证最长 3s 内必然执行）');
  ok(/typeof requestIdleCallback === 'function'/.test(bodyS), 'rIC 存在性检查（不支持的浏览器不抛）');
  ok(/setTimeout\(run, 3000\)/.test(bodyS), 'setTimeout(run, 3000) 兜底仍在');
  ok(/if \(done\) return;/.test(bodyS), '两条调度路径共用一个 done 闩（谁先到谁跑，另一个空转）');

  // --- C-4 A-2 的新兜底：失败计数 → 3 次写 24h 退避戳；成功清零 ---
  // 改动前 scheduleMemoryMigration 不存在，这里会整段跳过（红由上面 C-2 的 ok(HAS_A2) 报出），
  // 而不是抛 TypeError 把脚本打断 —— "先红"要求的是清晰的红，不是崩溃。
  if (!HAS_A2) {
    ok(false, 'A2 未施工：C-4 的退避/清零行为断言整段跳过（先红那一刻即是此态）');
  } else {
    const s1 = makeSandbox({ migrated: false, fetchError: true });
    await s1.api.schedule(); await s1.api.flushIdle();
    ok(s1.store.get('nest_memory_migrate_fails') === '1', `第 1 次失败：计数 = 1（实测 ${s1.store.get('nest_memory_migrate_fails')}）`);
    ok(!s1.store.has('nest_memory_migrate_backoff_until'), '第 1 次失败：**还没**写退避戳（门槛是 3 次）');
    ok(s1.store.get('nest_memory_migrated_v1') === undefined, '拉取失败：门闩**不**置位（A-2 的既有语义保持原样）');

    const s2 = makeSandbox({ migrated: false, fails: 2, fetchError: true });
    await s2.api.schedule(); await s2.api.flushIdle();
    const until = Number(s2.store.get('nest_memory_migrate_backoff_until'));
    ok(s2.store.get('nest_memory_migrate_fails') === '3', `第 3 次失败：计数 = 3（实测 ${s2.store.get('nest_memory_migrate_fails')}）`);
    ok(until > Date.now() + 23 * 3600 * 1000 && until <= Date.now() + 25 * 3600 * 1000,
       `第 3 次失败：写入 24h 退避戳（实测 ${((until - Date.now()) / 3600000).toFixed(2)} 小时后）`);
    ok(s2.calls.warns.some(w => /24/.test(w)), '第 3 次失败：console.warn 提示退避（一次）');

    // 退避窗口内：连调度都不排
    const s3 = makeSandbox({ migrated: false, fails: 3, backoffUntil: Date.now() + 3600 * 1000 });
    await s3.api.schedule(); await s3.api.flushIdle(); await s3.api.fireTimers();
    ok(s3.calls.getMemories.length === 0, `退避窗口内：一次拉取都不发（实测 ${s3.calls.getMemories.length}）`);
    ok(s3.api.pendingIdle() === 0 && s3.api.pendingTimers() === 0, '退避窗口内：rIC 与兜底定时器都不排');

    // 退避戳过期：恢复重试
    const s4 = makeSandbox({ migrated: false, fails: 3, backoffUntil: Date.now() - 1000 });
    await s4.api.schedule(); await s4.api.flushIdle();
    ok(s4.calls.getMemories.length === 1, '退避戳过期后：恢复正常调度（发 1 条 1000 拉取）');

    // 成功清零
    const s5 = makeSandbox({ migrated: false, fails: 2, backoffUntil: Date.now() + 3600 * 1000 });
    await s5.api.migrate();
    await s5.api.schedule(); // 退避中会被挡（这条只为确认下面手动清完能恢复）
    s5.store.delete('nest_memory_migrate_backoff_until');
    await s5.api.schedule(); await s5.api.flushIdle();
    ok(!s5.store.has('nest_memory_migrate_fails'), '迁移走完：失败计数被清零');
    ok(!s5.store.has('nest_memory_migrate_backoff_until'), '迁移走完：退避戳被清掉');
    ok(s5.store.get('nest_memory_migrated_v1') === '1', '迁移走完：门闩置位');
  }

  // --- C-5 sbId 判重必加 ---
  {
    const { api, calls } = makeSandbox({ migrated: false, localCount: 2 });
    await api.migrate();
    ok(!calls.addedContents.includes('本地第一条'),
       'sbId 判重生效：本地 m1（sbId=sb1 命中云端同 id、但正文与云端不同）**没有**被重复 addMemory');
    ok(calls.addedContents.includes('本地第二条'), 'm2 无 sbId、正文也不撞 → 正常写入');
    ok(calls.addMemory === 1, `默认两条时 addMemory 次数 = 1（实测 ${calls.addMemory}）`);
  }

  // --- C-6 落盘节奏：每 10 条一次 + 结束必落 ---
  {
    const s10 = makeSandbox({ migrated: false, localCount: 10 });
    await s10.api.migrate();
    ok(s10.calls.persist === 1, `10 条：第 10 条那次 + 结束那次合并为 1 次落盘（实测 ${s10.calls.persist}）`);

    const s25 = makeSandbox({ migrated: false, localCount: 25 });
    await s25.api.migrate();
    ok(s25.calls.persist === 3, `25 条：处理到 10/20/25 各落一次 = 3 次（实测 ${s25.calls.persist}）`);

    const s0 = makeSandbox({ migrated: false, localCount: 0 });
    await s0.api.migrate();
    ok(s0.calls.persist === 1, `0 条：结束仍必落一次（实测 ${s0.calls.persist}）`);
  }

  // --- C-7 既有断言（保留）：拉取失败早退在置门闩之前 ---
  {
    const fetchGuard = bodyM.indexOf('if (fetchErr)');
    const setFlag = bodyM.indexOf("setItem(LS_MEMORY_MIGRATED");
    ok(fetchGuard !== -1 && setFlag !== -1 && fetchGuard < setFlag,
      '已知机理仍在：拉取失败早退（if (fetchErr)）位于置门闩**之前** ⇒ 失败时门闩不置位；本次不改它，改由 24h 退避兜底');
    const { api, calls } = makeSandbox({ migrated: false });
    await api.migrate();
    ok(calls.persist >= 1, '迁移末尾仍调 persistMemory（落 IDB）');
  }

  // --- C-8 ao 2026-10-11 补丁：尝试次数「拉取前」就 +1，走完才清零 ---
  // 目的：页面中途被杀（迁移要发几百次请求）既不计失败、门闩也不置 ⇒ 下次打开永远重来。
  // 把记账点前移到 getMemories 之前，被杀的也算一次；只有完整走到置门闩处才清零。
  {
    // (1) 拉取前就 +1：只用「拉取即报错」的沙箱，看计数是否在没有走完 migrate 时已经变 1。
    //     判据不依赖失败分支是否还在 —— 不管 fetchErr 分支有没有重复 +1，这里都必须是 1。
    const p1 = makeSandbox({ migrated: false, fetchError: true });
    await p1.api.migrate();
    ok(p1.store.get('nest_memory_migrate_fails') === '1',
       `拉取前已 +1：拉取失败后计数 = 1（不是 2；实测 ${p1.store.get('nest_memory_migrate_fails')}）`);
    ok(!bodyM.includes('noteMemoryMigrateFailure(); return;'),
       '原 fetchErr 分支**不再**重复 +1（那条早退分支里已无 noteMemoryMigrateFailure）');

    // (2) 中途终止后计数保留：处理到第 2 条时页面被杀（addMemory 永不 resolve）。
    //     begin 记账点若在拉取之后、结束清零之前，2 号沙箱必须累计成 3 并落 24h 退避戳。
    const p2 = makeSandbox({ migrated: false, fails: 2, localCount: 5, hangAtAdd: 2 });
    // 故意不 await 这个 promise（void 明说不等它）：它永远悬在「第 2 条 addMemory」上 —— 这就是「页面被杀」
    void p2.api.migrate();
    await p2.api.drain();
    const until2 = Number(p2.store.get('nest_memory_migrate_backoff_until'));
    ok(p2.store.get('nest_memory_migrate_fails') === '3',
       `中途终止后计数保留：被杀这一次也算（2 次旧计数 + 本轮 1 = 3；实测 ${p2.store.get('nest_memory_migrate_fails')}）`);
    ok(until2 > Date.now() + 23 * 3600 * 1000 && until2 <= Date.now() + 25 * 3600 * 1000,
       `中途终止后计数保留：第 3 次即落 24h 退避戳（实测 ${((until2 - Date.now()) / 3600000).toFixed(2)} 小时后）`);
    ok(p2.store.get('nest_memory_migrated_v1') === undefined, '中途终止：门闩**不**置位（下次还会（受退避约束地）重来）');

    // (3) 走完清零：正常路径必须把计数与退避戳一起清掉
    const p3 = makeSandbox({ migrated: false, fails: 2, localCount: 2 });
    await p3.api.migrate();
    ok(!p3.store.has('nest_memory_migrate_fails'), '走完清零：失败计数被清掉');
    ok(p3.store.get('nest_memory_migrated_v1') === '1', '走完清零：门闩置位（这一条同时是清零的触发条件）');
  }
}

console.log('\n=== D. token 估算链不依赖云端：只读本地 memory 数组 ===');

{
  const injectBody = stripComments(injectSrc);
  ok(!/await|fetch|supabaseMemory|getMemories/.test(injectBody), 'buildMemoryInjection 体内无 await/网络调用 ⇒ 不依赖启动拉取');
  ok(!/sbId|created_at/.test(injectBody), '注入只看本地字段（content/createdAt/type/protected），不看云端字段 ⇒ 与拉取解耦');

  const mk = local => new Function('localMemory', `
    let memory = localMemory;
    function formatMemoryAge(t) { return 'x天前'; }
    ${isPinnedSrc}
    ${pinSrc}
    ${injectSrc}
    return buildMemoryInjection();
  `)(local);
  const out1 = mk([{ content: '钉住的事', type: '侧写', protected: true, createdAt: 1 }]);
  ok(typeof out1 === 'string' && out1.includes('钉住的事'), '本地有钉住记忆时：注入正常产出（不依赖任何云端拉取）');
  const out2 = mk([{ content: '没钉住', type: '侧写', protected: false, createdAt: 1 }]);
  ok(out2 === '', '本地无钉住记忆时：注入为空串（:5121 原逻辑，不阻塞发送）');
  let threw = null;
  try { mk([]); } catch (e) { threw = e; }
  ok(!threw, '本地记忆为空数组时不抛（最坏退化为空注入）');
}

console.log('\n=== E. refreshTokenEstimate 在别处仍有调用点 ===');

{
  const src = stripComments(idxSrc);
  const defIdx = src.search(/function refreshTokenEstimate\(\)/);
  const total = (src.match(/refreshTokenEstimate\s*\(/g) || []).length;
  ok(defIdx !== -1, 'refreshTokenEstimate 定义仍存在');
  ok(total - 1 >= 3, `除定义外仍有 ≥3 个调用点（实测 ${total - 1}）⇒ 删掉 :4730 不至于让 token 标签永不更新`);
  const outsideRefresh = /if \(pageName === 'space'\)[\s\S]{0,200}?refreshTokenEstimate\(\)/.test(src);
  ok(outsideRefresh, '切到 space 页仍会刷新 token 估算（一处独立调用点）');
}

console.log('\n=== F. 导出备份走 IDB，不经 memory 数组 ===');

{
  const src = stripComments(idxSrc);
  ok(/nest_memory:\s*JSON\.stringify\(\(await idbGet\(LS_MEMORY\)\)/.test(src),
    'exportBackupBtn 的 nest_memory 取自 idbGet(LS_MEMORY) ⇒ 停掉启动拉取不会让备份变空');
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(`✗ ${failures.length} 条断言未通过：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log('✓ 全部断言通过：迁移已挪出首屏（rIC + 3s 兜底），门闩判两次、退避/判重/落盘节奏齐备；');
console.log('  启动路径只剩 migrate 一条 1000 拉取（门闩置位时 0 条），refresh 函数保留但已无调用点。');
