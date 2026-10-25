// styrigx-curio-core 的「设备」「游戏」两栏（/api/items、/api/photo）：
// - 未登录 401；写：非同源 / 访客 403
// - 校验：名字必填、类型 / 状态 / 评分 / 日期只收合法值、关联设备必须存在、不能「换成」自己
// - 读：访客看不到私密条目；指向私密设备的 replaced_by / device_id 对访客置 0
// - 增改删排序；删设备时别人指向它的都清零；删条目连 R2 照片一起删
// - 照片：只收 webp / jpeg / png（看字节）、≤ 3 MB；换照片删旧的；访客拿不到私密条目的照片；DELETE 清空
// - 迁移 0003 和 ITEM_SCHEMA 建出来的表一致
// SQL 用 node:sqlite 真跑（CI 用 Node 22）。运行：node --test tests/workers/items.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W = REPO + '/workers/core';
const worker = (await import(W + '/src/index.js')).default;
const IT = await import(W + '/src/api/_items.js');
const PH = await import(W + '/src/api/photo.js');

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
function makeR2() {
  const m = new Map();
  return {
    m,
    async put(key, value, opt = {}) { m.set(key, { bytes: new Uint8Array(value), httpMetadata: opt.httpMetadata || {} }); },
    async get(key) { const o = m.get(key); return o ? { body: o.bytes, httpMetadata: o.httpMetadata } : null; },
    async delete(key) { m.delete(key); },
  };
}
const auth = (role) => ({ async lockSession() { return role ? { ok: true, role } : { ok: false }; } });
const ORIGIN = 'https://curio.styrigx.com';
function call(p, { role = null, db, r2, method = 'GET', body, origin = ORIGIN, type } = {}) {
  const headers = { Cookie: 'sgx-lock-session=x' };
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = type || 'application/json';
  const b = body === undefined ? undefined : body instanceof Uint8Array || typeof body === 'string' ? body : JSON.stringify(body);
  return worker.fetch(new Request(ORIGIN + p, { method, headers, body: b }), { AUTH: auth(role), D1_FINDS: db, D1_DEVICES: db, D1_GAMES: db, R2_PHOTOS: r2 }, { waitUntil() {} });
}
const env = () => ({ db: makeD1(), r2: makeR2() });
const post = (e, body, role = 'admin') => call('/api/items', { ...e, role, method: 'POST', body });
const get = async (e, role) => (await call('/api/items', { ...e, role })).json();

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);

test('未登录 401；写：非同源 403、访客 403；坏 JSON 400', async () => {
  const e = env();
  for (const p of ['/api/items', '/api/photo?kind=device&id=1']) assert.equal((await call(p, e)).status, 401, p);
  const body = { op: 'device.add', name: 'S24' };
  assert.equal((await call('/api/items', { ...e, role: 'admin', method: 'POST', body, origin: 'https://evil.com' })).status, 403);
  assert.equal((await post(e, body, 'visitor')).status, 403);
  assert.equal((await call('/api/items', { ...e, role: 'admin', method: 'POST', body: '{x', type: 'application/json' })).status, 400);
  assert.equal((await call('/api/photo?kind=device&id=1', { ...e, role: 'visitor', method: 'POST', body: WEBP, type: 'image/webp' })).status, 403);
});

test('校验：名字必填，类型 / 状态 / 评分 / 日期只收合法值，多行文本留换行', () => {
  assert.equal(IT.parseItemOp('device', { op: 'device.add' }).error, 'bad-name');
  assert.equal(IT.parseItemOp('device', { op: 'device.add', name: '  ' }).error, 'bad-name');
  assert.equal(IT.parseItemOp('device', { op: 'device.add', name: 'x', kind: 'toaster' }).error, 'bad-kind');
  assert.equal(IT.parseItemOp('device', { op: 'device.add', name: 'x', bought_at: '2026-02-30' }).error, 'bad-bought-at');
  assert.equal(IT.parseItemOp('device', { op: 'device.add', name: 'x', bought_at: '24-01-01' }).error, 'bad-bought-at');
  assert.equal(IT.parseItemOp('device', { op: 'device.edit', id: 3, replaced_by: 3 }).error, 'bad-replaced-by');
  assert.equal(IT.parseItemOp('device', { op: 'game.add', title: 'x' }).error, 'bad-op');
  assert.equal(IT.parseItemOp('game', { op: 'game.add', title: 'x', status: 'beaten' }).error, 'bad-status');
  assert.equal(IT.parseItemOp('game', { op: 'game.add', title: 'x', rating: 6 }).error, 'bad-rating');
  assert.equal(IT.parseItemOp('game', { op: 'game.edit', id: 1 }).error, 'nothing');
  const d = IT.parseItemOp('device', { op: 'device.add', name: 'Galaxy\nS24 ', specs: 'a\r\nb\u0007', bought_at: '2024-02-29' });
  assert.equal(d.fields.name, 'Galaxy S24');
  assert.equal(d.fields.specs, 'a\nb');
  assert.equal(d.fields.kind, 'other');
  assert.equal(d.fields.bought_at, '2024-02-29');
  const g = IT.parseItemOp('game', { op: 'game.add', title: 'Zelda', rating: 5, status: 'done' });
  assert.deepEqual([g.fields.status, g.fields.rating, g.fields.device_id], ['done', 5, 0]);
});

test('增改删排序；关联设备必须存在；删设备时 replaced_by / device_id 清零', async () => {
  const e = env();
  let r = await (await post(e, { op: 'device.add', name: 'Galaxy S23', kind: 'phone', bought_at: '2023-03-01', os: 'One UI 6' })).json();
  assert.ok(r.ok && r.id);
  const s23 = r.id;
  r = await (await post(e, { op: 'device.add', name: 'Galaxy S25', kind: 'phone' })).json();
  const s25 = r.id;
  assert.equal((await post(e, { op: 'device.edit', id: s23, retired_at: '2025-03-01', replaced_by: 999 })).status, 404);
  r = await (await post(e, { op: 'device.edit', id: s23, retired_at: '2025-03-01', replaced_by: s25 })).json();
  assert.deepEqual(r.devices.map((d) => [d.name, d.retired_at, d.replaced_by]), [['Galaxy S23', '2025-03-01', s25], ['Galaxy S25', '', 0]]);
  assert.equal((await post(e, { op: 'game.add', title: 'X', device_id: 77 })).status, 404);
  r = await (await post(e, { op: 'game.add', title: '塞尔达', platform: 'Switch', device_id: s25, status: 'playing' })).json();
  const zelda = r.id;
  r = await (await post(e, { op: 'game.add', title: 'Hades', status: 'done', rating: 5 })).json();
  r = await (await post(e, { op: 'game.order', ids: [r.id, zelda] })).json();
  assert.deepEqual(r.games.map((g) => g.title), ['Hades', '塞尔达']);
  assert.equal((await post(e, { op: 'game.order', ids: [zelda] })).status, 409);
  r = await (await post(e, { op: 'device.del', id: s25 })).json();
  assert.deepEqual(r.devices.map((d) => [d.name, d.replaced_by]), [['Galaxy S23', 0]]);
  assert.equal(r.games.find((g) => g.id === zelda).device_id, 0);
  assert.equal((await post(e, { op: 'device.del', id: s25 })).status, 404);
});

test('读：访客看不到私密条目，指向私密设备的关联置 0；管理员全看到', async () => {
  const e = env();
  const a = (await (await post(e, { op: 'device.add', name: '公开机', kind: 'phone' })).json()).id;
  const b = (await (await post(e, { op: 'device.add', name: '私密机', private: true })).json()).id;
  await post(e, { op: 'device.edit', id: a, replaced_by: b });
  await post(e, { op: 'game.add', title: '公开游戏', device_id: b });
  await post(e, { op: 'game.add', title: '私密游戏', private: true });
  const v = await get(e, 'visitor');
  assert.equal(v.admin, false);
  assert.deepEqual(v.devices.map((d) => [d.name, d.replaced_by]), [['公开机', 0]]);
  assert.deepEqual(v.games.map((g) => [g.title, g.device_id]), [['公开游戏', 0]]);
  const o = await get(e, 'admin');
  assert.equal(o.admin, true);
  assert.equal(o.devices.length, 2);
  assert.equal(o.games.length, 2);
  assert.equal(o.games[0].device_id, b);
});

test('照片：只收 webp/jpeg/png、≤ 3 MB；换照片删旧的；访客拿不到私密的；删条目连照片删', async () => {
  const e = env();
  const id = (await (await post(e, { op: 'device.add', name: 'S24' })).json()).id;
  const pid = (await (await post(e, { op: 'device.add', name: '私', private: true })).json()).id;
  const up = (i, body, type = 'image/webp') => call('/api/photo?kind=device&id=' + i, { ...e, role: 'admin', method: 'POST', body, type });
  assert.equal((await up(id, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status, 400);
  assert.equal((await up(id, new Uint8Array(PH.PHOTO_MAX_BYTES + 1))).status, 413);
  assert.equal((await up(999, WEBP)).status, 404);
  assert.equal((await call('/api/photo?kind=cat&id=1', { ...e, role: 'admin' })).status, 400);
  assert.equal((await up(id, WEBP)).status, 200);
  assert.equal(e.r2.m.size, 1);
  const first = [...e.r2.m.keys()][0];
  assert.match(first, new RegExp('^photos/device/' + id + '-\\d+\\.webp$'));
  await new Promise((r) => setTimeout(r, 2));
  assert.equal((await up(id, JPEG, 'image/jpeg')).status, 200);
  assert.equal(e.r2.m.size, 1, '旧照片删了');
  assert.ok(!e.r2.m.has(first));
  const g = await call('/api/photo?kind=device&id=' + id, { ...e, role: 'visitor' });
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await get(e, 'visitor')).devices[0].photo, true);
  assert.equal((await up(pid, WEBP)).status, 200);
  assert.equal((await call('/api/photo?kind=device&id=' + pid, { ...e, role: 'visitor' })).status, 404);
  assert.equal((await call('/api/photo?kind=device&id=' + pid, { ...e, role: 'admin' })).status, 200);
  assert.equal(e.r2.m.size, 2);
  await post(e, { op: 'device.del', id: pid });
  assert.equal(e.r2.m.size, 1, '删条目连照片删');
  const d = await call('/api/photo?kind=device&id=' + id, { ...e, role: 'admin', method: 'DELETE' });
  assert.equal(d.status, 200);
  assert.equal(e.r2.m.size, 0);
  assert.equal((await get(e, 'admin')).devices[0].photo, false);
  /* 游戏封面同一个接口 */
  const gid = (await (await post(e, { op: 'game.add', title: 'Hades' })).json()).id;
  assert.equal((await call('/api/photo?kind=game&id=' + gid, { ...e, role: 'admin', method: 'POST', body: WEBP, type: 'image/webp' })).status, 200);
  assert.equal((await get(e, 'admin')).games[0].cover, true);
});

test('迁移 0003 连跑两次不报错，和 ITEM_SCHEMA 建出来的表一样', () => {
  const a = new DatabaseSync(':memory:');
  const sql = readFileSync(W + '/migrations/0003_devices_games.sql', 'utf8');
  a.exec(sql); a.exec(sql);
  const b = new DatabaseSync(':memory:');
  for (const s of IT.ITEM_SCHEMA) b.exec(s);
  const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value]);
  for (const t of ['devices', 'games']) assert.deepEqual(cols(b, t), cols(a, t), t);
});

test('绑定：设备走 D1_DEVICES、游戏走 D1_GAMES（同一个库）；wrangler.toml 三个 D1 绑定同一个库、迁移只配一次', async () => {
  const raw = new DatabaseSync(':memory:');
  const seen = { D1_DEVICES: new Set(), D1_GAMES: new Set(), D1_FINDS: new Set() };
  /* 同一个库包三层，记下每个绑定碰过哪些表 */
  const tag = (name) => {
    const d = makeD1(raw);
    const note = (sql) => { for (const t of ['devices', 'games', 'links', 'cats']) if (new RegExp('\\b' + t + '\\b').test(sql)) seen[name].add(t); };
    return { ...d, prepare: (sql) => { note(sql); return d.prepare(sql); } };
  };
  const envOf = (role) => ({ AUTH: auth(role), D1_FINDS: tag('D1_FINDS'), D1_DEVICES: tag('D1_DEVICES'), D1_GAMES: tag('D1_GAMES'), R2_PHOTOS: makeR2() });
  const req = (p, method = 'GET', body) => new Request(ORIGIN + p, { method, headers: { Cookie: 'sgx-lock-session=x', Origin: ORIGIN, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const E = envOf('admin');
  assert.equal((await worker.fetch(req('/api/items', 'POST', { op: 'device.add', name: 'S24' }), E, { waitUntil() {} })).status, 200);
  assert.equal((await worker.fetch(req('/api/items', 'POST', { op: 'game.add', title: 'Zelda' }), E, { waitUntil() {} })).status, 200);
  seen.D1_GAMES.clear(); // 第一次调用时这个绑定跑过建表 batch（devices + games），之后不再跑
  assert.equal((await worker.fetch(req('/api/items', 'POST', { op: 'game.add', title: 'Zelda 2', device_id: 1 }), E, { waitUntil() {} })).status, 200);
  assert.equal((await worker.fetch(req('/api/items', 'POST', { op: 'game.edit', id: 2, title: 'Zelda II', device_id: 1 }), E, { waitUntil() {} })).status, 200);
  /* 游戏的增改只碰 games；查关联设备走 D1_DEVICES */
  assert.deepEqual([...seen.D1_GAMES], ['games']);
  assert.equal(seen.D1_FINDS.size, 0);
  const t = readFileSync(W + '/wrangler.toml', 'utf8');
  for (const b of ['D1_FINDS', 'D1_DEVICES', 'D1_GAMES']) {
    assert.match(t, new RegExp('binding = "' + b + '"\\ndatabase_name = "styrigx-curio-core"\\ndatabase_id = "26ae9cd2-43c9-4bc0-b558-b35560ed9d7c"'), b);
  }
  assert.equal(t.match(/^migrations_dir = /gm).length, 1);
  assert.match(t, /\[\[r2_buckets\]\]\nbinding = "R2_PHOTOS"\nbucket_name = "styrigx-curio-core"/);
});
