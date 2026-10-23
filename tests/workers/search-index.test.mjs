// styrigx-curio-core 的全站搜索索引（src/search-index.js，KV styrigx-search-index 的 site:curio）：
// - 条目映射：收藏 / 设备 / 游戏各出 zh + en 两条；标题、副标题（页签 · 分类 / 类型 / 平台）、text、url 深链
// - 私密：分类或收藏任一私密 → private:true；私密设备 / 游戏同样；公开的不带 private
// - 改内容的写接口（links / items / import）成功后 ctx.waitUntil 重建并 put；读接口、失败的写、照片接口不重建
// - Cron scheduled 重建；KV / D1 出错、绑定缺失都只打日志不抛，接口照常回答
// - wrangler.toml：KV_SEARCH_INDEX 绑定 + 每小时 Cron
// SQL 用 node:sqlite 真跑（CI 用 Node 22）。运行：node --test tests/workers/search-index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W = REPO + '/workers/core';
const worker = (await import(W + '/src/index.js')).default;
const SI = await import(W + '/src/search-index.js');

/** node:sqlite 包成 D1 的样子（batch 是一个事务；SELECT 回 results） */
function makeD1(db = new DatabaseSync(':memory:')) {
  const isRead = (sql) => /^\s*SELECT/i.test(sql);
  const runIt = (sql, args) => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => runIt(sql, args),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    _exec: () => (isRead(sql) ? { results: db.prepare(sql).all(...args) } : runIt(sql, args)),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
function makeKV({ fail = false } = {}) {
  const m = new Map();
  return { m, puts: 0, async put(k, v) { this.puts++; if (fail) throw new Error('kv down'); m.set(k, v); }, async get(k) { return m.get(k) ?? null; } };
}
function makeR2() {
  const m = new Map();
  return { m, async put(k, v) { m.set(k, v); }, async get(k) { return m.has(k) ? { body: m.get(k), httpMetadata: {} } : null; }, async delete(k) { m.delete(k); } };
}
const auth = (role) => ({ async session() { return role ? { ok: true, role } : { ok: false }; } });
const ORIGIN = 'https://curio.styrigx.com';

/** 发请求并等完 waitUntil 里的活 */
async function call(env, p, { role = 'owner', method = 'GET', body } = {}) {
  const pending = [];
  const headers = { Cookie: 'sgx-verified=x', Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(
    new Request(ORIGIN + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { AUTH: auth(role), ...env },
    { waitUntil: (x) => pending.push(x) },
  );
  await Promise.all(pending);
  return { res, pending: pending.length };
}
/** 静音 console.error，返回收集到的日志 */
async function quiet(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try { return { out: await fn(), logs }; } finally { console.error = orig; }
}

async function seeded() {
  const d1 = makeD1();
  await SI.buildIndex(d1); // 建表
  d1.raw.exec(`
    INSERT INTO cats (id, name_zh, name_en, private, pos) VALUES (1, '工具', 'Tools', 0, 0), (2, '私藏', 'Secret', 1, 1);
    INSERT INTO links (id, cat_id, url, name_zh, name_en, desc_zh, desc_en, private, pos) VALUES
      (10, 1, 'https://a.example/', '好工具', '', '一个好用的工具', 'A handy tool', 0, 0),
      (11, 1, 'https://b.example/', '', 'Only English', '', 'desc en', 1, 1),
      (12, 2, 'https://c.example/', '藏起来', 'Hidden', '', '', 0, 0);
    INSERT INTO devices (id, name, kind, os, specs, accessories, notes, private, pos) VALUES
      (1, 'Galaxy S25', 'phone', 'One UI 8', '12GB', '壳', '很顺手', 0, 0),
      (2, '旧平板', 'tablet', '', '', '', '', 1, 1);
    INSERT INTO games (id, title, platform, edition, status, review, private, pos) VALUES
      (1, '塞尔达传说', 'Switch', '王国之泪', 'done', '自由', 0, 0),
      (2, '秘密游戏', '', '', 'want', '', 1, 1);
  `);
  return d1;
}
const byId = (ix) => new Map(ix.items.map((it) => [it.id, it]));

test('buildIndex：收藏 / 设备 / 游戏各出 zh + en 两条，标题、副标题、text、深链', async () => {
  const ix = await SI.buildIndex(await seeded(), Date.UTC(2026, 9, 22));
  assert.equal(ix.site, 'curio');
  assert.equal(ix.generated, '2026-10-22T00:00:00.000Z');
  assert.equal(ix.items.length, 14);
  const m = byId(ix);
  for (const it of ix.items) {
    assert.equal(it.type, 'item');
    assert.ok(it.url.startsWith(ORIGIN + '/'));
    assert.ok(!it.text || it.text.length <= 2000);
  }
  assert.deepEqual(m.get('link:10'), {
    id: 'link:10', type: 'item', lang: 'zh', title: '好工具', url: ORIGIN + '/#c/1',
    subtitle: '发现 · 工具', text: '一个好用的工具\nA handy tool\nhttps://a.example/',
  });
  // 英文名空着 → 用中文名；分类名、页签名用英文；链到 /en/
  const en = m.get('link:10:en');
  assert.equal(en.lang, 'en');
  assert.equal(en.title, '好工具');
  assert.equal(en.subtitle, 'Finds · Tools');
  assert.equal(en.url, ORIGIN + '/en/#c/1');
  assert.equal(m.get('link:11').title, 'Only English');

  assert.equal(m.get('device:1').subtitle, '设备 · 手机 · One UI 8');
  assert.equal(m.get('device:1:en').subtitle, 'Devices · Phone · One UI 8');
  assert.equal(m.get('device:1').text, 'One UI 8\n12GB\n壳\n很顺手');
  assert.equal(m.get('device:1').url, ORIGIN + '/#devices');
  assert.equal(m.get('device:1:en').url, ORIGIN + '/en/#devices');

  assert.equal(m.get('game:1').title, '塞尔达传说');
  assert.equal(m.get('game:1').subtitle, '游戏 · Switch · 通关');
  assert.equal(m.get('game:1:en').subtitle, 'Games · Switch · Finished');
  assert.equal(m.get('game:1').text, 'Switch\n王国之泪\n自由');
  assert.equal(m.get('game:1').url, ORIGIN + '/#games');
});

test('私密：分类或收藏任一私密 → private:true；私密设备 / 游戏同样；公开的不带 private', async () => {
  const m = byId(await SI.buildIndex(await seeded()));
  for (const id of ['link:11', 'link:11:en', 'link:12', 'link:12:en', 'device:2', 'device:2:en', 'game:2', 'game:2:en']) {
    assert.equal(m.get(id).private, true, id);
  }
  for (const id of ['link:10', 'link:10:en', 'device:1', 'game:1:en']) assert.equal('private' in m.get(id), false, id);
  // 分类不在了（孤儿收藏）也当私密，链到首页
  const orphan = SI.linkItems({ id: 9, cat_id: 99, url: 'https://x/', name_zh: '孤儿', name_en: '' }, undefined);
  assert.equal(orphan[0].private, true);
  assert.equal(orphan[0].url, ORIGIN + '/');
  assert.equal(orphan[0].subtitle, '发现');
});

test('截断：标题 ≤ 80 字、text ≤ 2000 字；没名字不出条目', () => {
  const [it] = SI.deviceItems({ id: 3, name: '长'.repeat(200), kind: 'nope', notes: 'x'.repeat(5000) });
  assert.equal([...it.title].length, 80);
  assert.ok(it.title.endsWith('…'));
  assert.equal(it.text.length, 2000);
  assert.equal(it.subtitle, '设备 · 其他');
  assert.deepEqual(SI.gameItems({ id: 4, title: '  ' }), []);
});

test('改收藏成功后 waitUntil 重建并 put site:curio；读接口、失败的写不重建', async () => {
  const env = { D1_FINDS: makeD1(), KV_SEARCH_INDEX: makeKV(), R2_PHOTOS: makeR2() };
  let r = await call(env, '/api/links');
  assert.equal(r.res.status, 200);
  assert.equal(env.KV_SEARCH_INDEX.puts, 0);

  r = await call(env, '/api/links', { method: 'POST', body: { op: 'cat.add', name: { zh: '新分类' } } });
  assert.equal(r.res.status, 200);
  assert.equal(env.KV_SEARCH_INDEX.puts, 1);
  r = await call(env, '/api/links', { method: 'POST', body: { op: 'link.add', cat: 1, url: 'https://new.example/', name: { zh: '新收藏' } } });
  assert.equal(r.res.status, 200);
  assert.equal(env.KV_SEARCH_INDEX.puts, 2);
  const ix = JSON.parse(env.KV_SEARCH_INDEX.m.get('site:curio'));
  assert.equal(ix.site, 'curio');
  assert.deepEqual(ix.items.map((it) => it.title), ['新收藏', '新收藏']);

  r = await call(env, '/api/links', { method: 'POST', body: { op: 'link.del', id: 999 } });
  assert.equal(r.res.status, 404);
  r = await call(env, '/api/links', { role: 'visitor', method: 'POST', body: { op: 'cat.add', name: { zh: 'x' } } });
  assert.equal(r.res.status, 403);
  assert.equal(env.KV_SEARCH_INDEX.puts, 2);
});

test('改设备 / 游戏成功后也重建；照片接口不重建', async () => {
  const db = makeD1();
  const env = { D1_FINDS: db, D1_DEVICES: db, D1_GAMES: db, KV_SEARCH_INDEX: makeKV(), R2_PHOTOS: makeR2() };
  const r = await call(env, '/api/items', { method: 'POST', body: { op: 'game.add', title: '空洞骑士', platform: 'PC', status: 'playing' } });
  assert.equal(r.res.status, 200, await r.res.clone().text());
  assert.equal(env.KV_SEARCH_INDEX.puts, 1);
  const ix = JSON.parse(env.KV_SEARCH_INDEX.m.get('site:curio'));
  assert.equal(ix.items[0].subtitle, '游戏 · PC · 在玩');
  assert.equal(SI.isContentMutation('/api/photo', 'POST', 200), false);
  assert.equal(SI.isContentMutation('/api/photo', 'DELETE', 200), false);
  assert.equal(SI.isContentMutation('/api/import', 'POST', 200), true);
  assert.equal(SI.isContentMutation('/api/items', 'GET', 200), false);
  assert.equal(SI.isContentMutation('/api/items', 'POST', 409), false);
});

test('Cron scheduled：重建并 put', async () => {
  const env = { D1_FINDS: await seeded(), KV_SEARCH_INDEX: makeKV() };
  const pending = [];
  await worker.scheduled({ cron: '23 * * * *' }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(env.KV_SEARCH_INDEX.puts, 1);
  assert.equal(JSON.parse(env.KV_SEARCH_INDEX.m.get('site:curio')).items.length, 14);
});

test('出错不抛：KV 写失败、D1 出错、绑定缺失只打日志；写接口照常 200', async () => {
  let q = await quiet(() => SI.rebuildSearchIndex({ D1_FINDS: makeD1(), KV_SEARCH_INDEX: makeKV({ fail: true }) }));
  assert.deepEqual(q.out, { ok: false, error: 'rebuild-failed' });
  assert.ok(q.logs.some((l) => l.includes('[curio-search]')));
  const badDb = { prepare() { throw new Error('d1 down'); }, batch: async () => { throw new Error('d1 down'); } };
  q = await quiet(() => SI.rebuildSearchIndex({ D1_FINDS: badDb, KV_SEARCH_INDEX: makeKV() }));
  assert.equal(q.out.ok, false);
  q = await quiet(() => SI.rebuildSearchIndex({ D1_FINDS: makeD1() }));
  assert.deepEqual(q.out, { ok: false, error: 'kv-binding-missing' });
  q = await quiet(() => SI.rebuildSearchIndex({ KV_SEARCH_INDEX: makeKV() }));
  assert.deepEqual(q.out, { ok: false, error: 'db-binding-missing' });

  const env = { D1_FINDS: makeD1(), KV_SEARCH_INDEX: makeKV({ fail: true }), R2_PHOTOS: makeR2() };
  q = await quiet(() => call(env, '/api/links', { method: 'POST', body: { op: 'cat.add', name: { zh: 'a' } } }));
  assert.equal(q.out.res.status, 200);
  assert.equal(q.out.pending, 1);
  q = await quiet(() => worker.scheduled({}, { D1_FINDS: makeD1(), KV_SEARCH_INDEX: makeKV({ fail: true }) }, { waitUntil() {} }));
  assert.equal(q.out, undefined);
});

test('wrangler.toml：KV_SEARCH_INDEX 绑 styrigx-search-index、每小时 Cron', () => {
  const t = readFileSync(W + '/wrangler.toml', 'utf8');
  assert.match(t, /\[\[kv_namespaces\]\]\nbinding = "KV_SEARCH_INDEX"\nid = "bd1babcc3fe74d58994e254c74d34ced"/);
  assert.match(t, /^\[triggers\]\ncrons = \["23 \* \* \* \*"\]$/m);
});
