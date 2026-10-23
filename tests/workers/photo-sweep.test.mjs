// styrigx-curio-core 照片兜底清扫（src/photo-sweep.js）：
// - 只删 photos/ 下没被 devices.photo / games.cover 引用、且上传超过 1 小时的
// - icons/、imports/ 不动；D1 读不到整轮不删
// - Cron 只在 UTC 19 点那轮扫
// 运行：node --test tests/workers/photo-sweep.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W = REPO + '/workers/core';
const S = await import(W + '/src/photo-sweep.js');
const worker = (await import(W + '/src/index.js')).default;

function makeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { meta: {} }; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    _exec: () => (/^\s*SELECT/i.test(sql) ? { results: db.prepare(sql).all(...args) } : db.prepare(sql).run(...args)),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (l) => l.map((s) => s._exec()), exec: async (q) => db.exec(q) };
}
function makeR2(objs) {
  const m = new Map(objs.map(([k, t]) => [k, t]));
  return {
    m,
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + Math.min(limit, 2));
      const next = start + page.length;
      return { objects: page.map((k) => ({ key: k, uploaded: new Date(m.get(k)) })), truncated: next < keys.length, cursor: String(next) };
    },
    async delete(k) { for (const x of [].concat(k)) m.delete(x); },
  };
}

const NOW = Date.UTC(2026, 9, 24, 19, 23);
const OLD = NOW - 2 * 3600e3;
const FRESH = NOW - 10 * 60e3;

async function seed(db) {
  const IT = await import(W + '/src/api/_items.js');
  await IT.ensureItemSchema(db);
  db.raw.prepare("INSERT INTO devices (name, photo) VALUES ('S24', 'photos/device/1-100.webp')").run();
  db.raw.prepare("INSERT INTO games (title, cover) VALUES ('Zelda', 'photos/game/1-200.webp')").run();
  db.raw.prepare("INSERT INTO games (title, cover) VALUES ('NoCover', '')").run();
}

test('只删没人引用、上传超过 1 小时的 photos/；引用的、刚传的、icons/、imports/ 都留着（翻页也扫全）', async () => {
  const db = makeD1();
  await seed(db);
  const r2 = makeR2([
    ['photos/device/1-100.webp', OLD],
    ['photos/device/1-050.webp', OLD],
    ['photos/game/1-200.webp', OLD],
    ['photos/game/9-300.webp', OLD],
    ['photos/game/2-999.webp', FRESH],
    ['icons/a.png', OLD],
    ['imports/x.html', OLD],
  ]);
  const r = await S.sweepPhotos({ D1_DEVICES: db, R2_PHOTOS: r2 }, NOW);
  assert.deepEqual([r.ok, r.scanned, r.deleted], [true, 5, 2]);
  assert.deepEqual([...r2.m.keys()].sort(), [
    'icons/a.png', 'imports/x.html', 'photos/device/1-100.webp', 'photos/game/1-200.webp', 'photos/game/2-999.webp',
  ]);
});

test('D1 读不到：整轮不删', async () => {
  const r2 = makeR2([['photos/game/9-300.webp', OLD]]);
  const bad = { prepare() { throw new Error('boom'); }, batch() { throw new Error('boom'); }, exec() { throw new Error('boom'); } };
  const r = await S.sweepPhotos({ D1_DEVICES: bad, R2_PHOTOS: r2 }, NOW);
  assert.equal(r.ok, false);
  assert.equal(r2.m.size, 1);
  assert.deepEqual(await S.sweepPhotos({ R2_PHOTOS: r2 }, NOW), { ok: false, scanned: 0, deleted: 0, reason: 'unbound' });
});

test('Cron：只有 UTC 19 点那轮扫照片；其它整点只重建索引', async () => {
  assert.equal(S.isSweepHour(Date.UTC(2026, 9, 24, 19, 23)), true);
  assert.equal(S.isSweepHour(Date.UTC(2026, 9, 24, 20, 23)), false);
  const db = makeD1();
  await seed(db);
  const r2 = makeR2([['photos/game/9-300.webp', OLD]]);
  const env = { D1_DEVICES: db, R2_PHOTOS: r2 };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 24, 18, 23) }, env, { waitUntil() {} });
  assert.equal(r2.m.size, 1);
  await worker.scheduled({ scheduledTime: NOW }, env, { waitUntil() {} });
  assert.equal(r2.m.size, 0);
});
