// styrigx-curio-core（workers/core）：
// - 路由表与 src/api 接口文件一一对应；没有公开接口，全部先问网关；网关出错 → 500 不是 401
// - 收藏：访客只看公开（私密分类 / 私密收藏 / 空分类都不给），主人看全部；写：非同源 403、访客 403、校验、增改删排序
// - 导入：先备份原文到 R2（R2 不可用就不导入）、文件夹 → 分类、按网址去重、默认私密、超上限一条不写、记录 imports
// - 导出：Netscape HTML，只给主人 + 同源
// - 图标：R2 缓存命中直接回；没缓存现抓并存；抓不到存「没有」标记；访客拿不到私密收藏的图标；内网地址不抓
// - 迁移 0001 + 0002 在 SQLite 上跑两次不报错，种子和 data/seed.json 一致；SCHEMA 与迁移一致
// - wrangler.toml：不开 workers.dev，只挂 curio.styrigx.com/api/*，D1 + R2 + 网关服务绑定，不持钥匙
// SQL 用 node:sqlite 真跑（CI 用 Node 22）。
// 运行：node --test tests/workers/core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W = REPO + '/workers/core';
const worker = (await import(W + '/src/index.js')).default;
const { API_ROUTES } = await import(W + '/src/routes.js');
const S = await import(W + '/src/api/_store.js');
const N = await import(W + '/src/api/_netscape.js');
const P = await import(W + '/src/api/_preview.js');
const I = await import(W + '/src/api/icon.js');
const IMP = await import(W + '/src/api/import.js');
const SEED = await import(REPO + '/scripts/gen-seed-sql.mjs');

/** node:sqlite 包成 D1 的样子（batch 是一个事务；SELECT 回 results） */
function makeD1(db = new DatabaseSync(':memory:')) {
  const isRead = (sql) => /^\s*SELECT/i.test(sql);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    _exec: () => (isRead(sql) ? { results: db.prepare(sql).all(...args) } : { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
/** 内存版 R2 */
function makeR2(fail = false) {
  const m = new Map();
  return {
    m,
    async put(key, value, opt = {}) {
      if (fail) throw new Error('r2 down');
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      m.set(key, { bytes, httpMetadata: opt.httpMetadata || {}, customMetadata: opt.customMetadata || {} });
    },
    async get(key) {
      const o = m.get(key);
      return o ? { body: o.bytes, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata } : null;
    },
  };
}
function auth(role = null, throws = false) {
  return {
    async session() {
      if (throws) throw new Error('down');
      return role ? { ok: true, role } : { ok: false, reason: 'no-cookie' };
    },
  };
}
const CTX = { waitUntil() {} };
const ORIGIN = 'https://curio.styrigx.com';
function call(p, { role = null, db = makeD1(), r2 = makeR2(), method = 'GET', body, origin = ORIGIN, throws = false, headers: extra = {} } = {}) {
  const headers = { Cookie: 'sgx-verified=x', ...extra };
  if (origin) headers.Origin = origin;
  if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const req = new Request(ORIGIN + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return worker.fetch(req, { AUTH: auth(role, throws), DB: db, FILES: r2 }, CTX);
}
const op = async (db, body, role = 'owner') => call('/api/links', { role, db, method: 'POST', body });
const list = async (db, role) => (await call('/api/links', { role, db })).json();

test('路由表与 src/api 接口文件一一对应', () => {
  const files = readdirSync(W + '/src/api').filter((n) => n.endsWith('.js') && !n.startsWith('_')).map((n) => '/api/' + n.slice(0, -3)).sort();
  assert.deepEqual([...API_ROUTES.keys()].sort(), files);
});

test('没有公开接口：未登录一律 401，带运行标记；不存在 404；网关挂了 500', async () => {
  for (const p of ['/api/links', '/api/icon?id=1', '/api/export', '/api/preview?url=https://a.com']) {
    const r = await call(p);
    assert.equal(r.status, 401, p);
    assert.equal(r.headers.get('X-Curio-Runtime'), 'worker');
  }
  assert.equal((await call('/api/import', { method: 'POST', body: 'x' })).status, 401);
  assert.equal((await call('/api/nope', { role: 'owner' })).status, 404);
  assert.equal((await call('/api/links', { throws: true })).status, 500);
  assert.equal((await call('/api/session-check')).status, 401);
  assert.equal((await call('/api/session-check', { role: 'visitor' })).status, 200);
});

test('写：非同源 403、没 Origin 403、访客 403', async () => {
  const body = { op: 'cat.add', name: 'x' };
  assert.equal((await call('/api/links', { role: 'owner', method: 'POST', body, origin: 'https://evil.com' })).status, 403);
  assert.equal((await call('/api/links', { role: 'owner', method: 'POST', body, origin: null })).status, 403);
  const v = await call('/api/links', { role: 'visitor', method: 'POST', body });
  assert.equal(v.status, 403);
  assert.equal((await v.json()).error, 'role');
  assert.equal((await call('/api/links', { role: 'owner', method: 'POST', body: '{oops' })).status, 400);
  assert.equal((await call('/api/links', { role: 'owner', method: 'DELETE' })).status, 405);
});

test('parseOp：网址只收 http/https、不收带账号密码的；名字必填、截断、去控制字符', () => {
  assert.equal(S.parseOp({ op: 'link.add', cat: 1, url: 'javascript:alert(1)', name: 'x' }).error, 'bad-url');
  assert.equal(S.parseOp({ op: 'link.add', cat: 1, url: 'https://a:b@x.com', name: 'x' }).error, 'bad-url');
  const ok = S.parseOp({ op: 'link.add', cat: 1, url: ' https://x.com ', name: '名字', private: true });
  assert.equal(ok.url, 'https://x.com/');
  assert.deepEqual(ok.name, { zh: '名字', en: '' });
  assert.equal(ok.private, 1);
  assert.equal(S.parseOp({ op: 'cat.add', name: { zh: ' ', en: '' } }).error, 'bad-name');
  assert.equal(S.parseOp({ op: 'cat.add', name: 'a\u0000b' }).name.zh, 'ab');
  assert.equal(S.parseOp({ op: 'cat.add', name: 'x'.repeat(200) }).name.zh.length, S.LIMITS.name);
  assert.equal(S.parseOp({ op: 'cat.order', ids: [1, 1] }).error, 'bad-ids');
  assert.equal(S.parseOp({ op: 'link.edit', id: 3 }).error, 'nothing');
  assert.equal(S.parseOp({ op: 'cat.edit', id: 3 }).error, 'nothing');
  assert.equal(S.parseOp({ op: 'drop.table' }).error, 'bad-op');
  assert.equal(S.cleanIcon('http://x.com/a.png'), '');
});

test('增、改、换分类、排序、删；重复网址 409；分类非空不能删', async () => {
  const db = makeD1();
  let j = await (await op(db, { op: 'cat.add', name: { zh: '工具', en: 'Tools' } })).json();
  const cat = j.cats[0];
  assert.deepEqual(cat.name, { zh: '工具', en: 'Tools' });
  await op(db, { op: 'link.add', cat: cat.id, url: 'https://a.example', name: 'A', desc: { zh: '甲' } });
  j = await (await op(db, { op: 'link.add', cat: cat.id, url: 'https://b.example', name: 'B' })).json();
  const [a, b] = j.cats[0].links;
  assert.deepEqual(j.cats[0].links.map((l) => l.name.zh), ['A', 'B']);
  assert.deepEqual(a.desc, { zh: '甲', en: '' });
  const dup = await op(db, { op: 'link.add', cat: cat.id, url: 'https://a.example/', name: 'A again' });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).error, 'duplicate');

  j = await (await op(db, { op: 'link.order', cat: cat.id, ids: [b.id, a.id] })).json();
  assert.deepEqual(j.cats[0].links.map((l) => l.id), [b.id, a.id]);
  assert.equal((await op(db, { op: 'link.order', cat: cat.id, ids: [a.id] })).status, 409);

  j = await (await op(db, { op: 'link.edit', id: a.id, name: { zh: 'A2', en: 'A2en' }, icon: 'https://a.example/i.png', private: true })).json();
  const a2 = j.cats[0].links.find((l) => l.id === a.id);
  assert.deepEqual(a2.name, { zh: 'A2', en: 'A2en' });
  assert.equal(a2.icon, 'https://a.example/i.png');
  assert.equal(a2.private, true);
  assert.equal((await op(db, { op: 'link.edit', id: a.id, url: 'https://b.example/' })).status, 409);

  const r409 = await op(db, { op: 'cat.del', id: cat.id });
  assert.equal(r409.status, 409);
  assert.equal((await r409.json()).error, 'not-empty');

  j = await (await op(db, { op: 'cat.add', name: '第二' })).json();
  const c2 = j.cats[1];
  j = await (await op(db, { op: 'link.edit', id: a.id, cat: c2.id })).json();
  assert.equal(j.cats[1].links[0].id, a.id);
  j = await (await op(db, { op: 'cat.order', ids: [c2.id, cat.id] })).json();
  assert.deepEqual(j.cats.map((c) => c.id), [c2.id, cat.id]);
  assert.equal((await op(db, { op: 'cat.order', ids: [cat.id] })).status, 409);
  j = await (await op(db, { op: 'cat.edit', id: c2.id, private: true })).json();
  assert.equal(j.cats[0].private, true);

  assert.equal((await op(db, { op: 'link.del', id: 99999 })).status, 404);
  assert.equal((await op(db, { op: 'link.add', cat: 99999, url: 'https://x.com', name: 'x' })).status, 404);
  assert.equal((await op(db, { op: 'link.del', id: b.id })).status, 200);
  j = await (await op(db, { op: 'cat.del', id: cat.id })).json();
  assert.deepEqual(j.cats.map((c) => c.id), [c2.id]);
});

test('读：访客只看公开（私密分类整个不给、私密收藏不给、空分类不给），主人全看到且 owner=true', async () => {
  const db = makeD1();
  await op(db, { op: 'cat.add', name: '公开' });
  await op(db, { op: 'cat.add', name: '私密', private: true });
  await op(db, { op: 'cat.add', name: '空的' });
  await op(db, { op: 'link.add', cat: 1, url: 'https://p.com', name: 'P' });
  await op(db, { op: 'link.add', cat: 1, url: 'https://q.com', name: 'Q', private: true });
  await op(db, { op: 'link.add', cat: 2, url: 'https://r.com', name: 'R' });
  const v = await list(db, 'visitor');
  assert.equal(v.owner, false);
  assert.deepEqual(v.cats.map((c) => c.name.zh), ['公开']);
  assert.deepEqual(v.cats[0].links.map((l) => l.url), ['https://p.com/']);
  const o = await list(db, 'owner');
  assert.equal(o.owner, true);
  assert.deepEqual(o.cats.map((c) => c.links.length), [2, 1, 0]);
});

/* ================= 书签文件 ================= */
const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="0" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://github.com/" ADD_DATE="1700000001" ICON="data:image/png;base64,AAAA">GitHub</A>
        <DT><H3 ADD_DATE="1700000002">工具</H3>
        <DL><p>
            <DT><A HREF="https://tools.example/a?x=1&amp;y=2" ADD_DATE="1700000003">Tom &amp; Jerry</A>
            <DT><H3>更深</H3>
            <DL><p>
                <DT><A HREF="https://deep.example">Deep</A>
            </DL><p>
            <DT><A HREF="chrome://settings">设置</A>
            <DT><A HREF="javascript:void(0)">小书签</A>
        </DL><p>
        <DT><A HREF="https://github.com/">GitHub 重复</A>
    </DL><p>
    <DT><H3 ADD_DATE="1700000004">其他书签</H3>
    <DL><p>
        <DT><A HREF="https://other.example"></A>
    </DL><p>
</DL><p>
`;

test('解析书签文件：根文件夹不算路径、子文件夹用 / 连、实体解码、只收 http(s)、文件内去重、空标题用域名', () => {
  const r = N.parseBookmarks(CHROME);
  assert.equal(r.found, 7);
  assert.equal(r.invalid, 2);
  assert.equal(r.dupes, 1);
  assert.deepEqual(r.items.map((i) => [i.cat, i.url, i.title]), [
    ['', 'https://github.com/', 'GitHub'],
    ['工具', 'https://tools.example/a?x=1&y=2', 'Tom & Jerry'],
    ['工具 / 更深', 'https://deep.example/', 'Deep'],
    ['', 'https://other.example/', 'other.example'],
  ]);
  assert.equal(r.items[0].added, 1700000001000);
  assert.equal(N.looksLikeBookmarks(CHROME), true);
  assert.equal(N.looksLikeBookmarks('<html><body>hi</body></html>'), false);
});

test('三星浏览器 / Firefox 写法：小写标签、没有 DOCTYPE、单引号属性也认', () => {
  const html = "<dl><p><dt><h3>Samsung</h3><dl><p><dt><a href='https://s.example/'>S</a></dl><p></dl>";
  const r = N.parseBookmarks(html);
  assert.deepEqual(r.items.map((i) => [i.cat, i.url]), [['Samsung', 'https://s.example/']]);
  assert.equal(N.looksLikeBookmarks(html), true);
});

test('导出的文件再解析回来，分类、网址、名字都一样', () => {
  const html = N.renderBookmarks([
    { name: { zh: '工具', en: 'Tools' }, links: [{ url: 'https://a.example/?q=<x>&y', name: { zh: 'A "甲"', en: '' }, desc: { zh: '说明', en: '' } }] },
    { name: { zh: '', en: 'Only EN' }, links: [{ url: 'https://b.example/', name: { zh: '', en: 'B' } }] },
  ], 'zh', 1700000000000);
  const r = N.parseBookmarks(html);
  assert.deepEqual(r.items.map((i) => [i.cat, i.url, i.title]), [
    ['工具', 'https://a.example/?q=%3Cx%3E&y', 'A "甲"'],
    ['Only EN', 'https://b.example/', 'B'],
  ]);
});

/* ================= 导入 ================= */
const imp = (db, r2, body, q = '', role = 'owner') => call('/api/import' + q, { role, db, r2, method: 'POST', body, headers: { 'Content-Type': 'text/html' } });

test('导入：先备份原文到 R2；文件夹 → 分类，已有同名分类并进去；按网址去重；默认私密；记录 imports', async () => {
  const db = makeD1();
  const r2 = makeR2();
  await op(db, { op: 'cat.add', name: '工具' });
  await op(db, { op: 'link.add', cat: 1, url: 'https://github.com', name: 'GitHub 已有' });
  const r = await imp(db, r2, CHROME);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.found, 7);
  assert.equal(j.added, 3);
  assert.equal(j.skipped, 2); /* 库里已有 1 + 文件内重复 1 */
  assert.equal(j.invalid, 2);
  assert.equal(j.cats_added, 2); /* 工具 / 更深、未归类 */
  assert.match(j.backup, /^imports\/\d{8}T\d{6}Z-[0-9a-f]{12}\.html$/);
  assert.equal(new TextDecoder().decode(r2.m.get(j.backup).bytes), CHROME);
  const byName = Object.fromEntries(j.cats.map((c) => [c.name.zh, c]));
  assert.deepEqual(byName['工具'].links.map((l) => l.url), ['https://github.com/', 'https://tools.example/a?x=1&y=2']);
  assert.equal(byName['工具'].links[1].private, true);
  assert.equal(byName['工具'].private, false);
  assert.equal(byName['工具 / 更深'].private, true);
  assert.deepEqual(byName['未归类'].name, { zh: '未归类', en: 'Unsorted' });
  assert.deepEqual(byName['未归类'].links.map((l) => l.url), ['https://other.example/']);
  const rec = db.raw.prepare('SELECT * FROM imports').all();
  assert.equal(rec.length, 1);
  assert.equal(rec[0].r2_key, j.backup);
  assert.equal(rec[0].added, 3);
  /* 访客看不到导入的私密收藏 */
  const v = await list(db, 'visitor');
  assert.deepEqual(v.cats.map((c) => c.links.map((l) => l.url)), [['https://github.com/']]);
  /* 再导一次：全跳过，不新建分类 */
  const j2 = await (await imp(db, r2, CHROME)).json();
  assert.equal(j2.added, 0);
  assert.equal(j2.cats_added, 0);
});

test('导入：?private=0 导入成公开', async () => {
  const db = makeD1();
  const j = await (await imp(db, makeR2(), CHROME, '?private=0')).json();
  assert.ok(j.cats.every((c) => !c.private && c.links.every((l) => !l.private)));
  assert.equal((await list(db, 'visitor')).cats.length, 3);
});

test('导入：R2 不可用就一条不写；不是书签文件 400；空的 400；访客 403；非同源 403', async () => {
  const db = makeD1();
  const r = await imp(db, makeR2(true), CHROME);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'backup');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'links'").get().n, 0);
  assert.equal((await (await imp(db, makeR2(), '<html><p>hello</p></html>')).json()).error, 'not-bookmarks');
  assert.equal((await (await imp(db, makeR2(), '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL>')).json()).error, 'empty');
  assert.equal((await imp(db, makeR2(), CHROME, '', 'visitor')).status, 403);
  assert.equal((await call('/api/import', { role: 'owner', db, method: 'POST', body: CHROME, origin: 'https://evil.com' })).status, 403);
});

test('导入：超过 5000 条上限一条不写', async () => {
  const db = makeD1();
  const many = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>' + Array.from({ length: S.LIMITS.links + 1 }, (_, i) => `<DT><A HREF="https://x${i}.example/">${i}</A>`).join('') + '</DL>';
  const r = await imp(db, makeR2(), many);
  assert.equal(r.status, 409);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM links').get().n, 0);
});

test('导入：一千多条一次写完（json_each 分块），顺序保持', async () => {
  const db = makeD1();
  const n = 1234;
  const many = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>大</H3><DL><p>' + Array.from({ length: n }, (_, i) => `<DT><A HREF="https://x${i}.example/">n${i}</A>`).join('') + '</DL></DL>';
  const j = await (await imp(db, makeR2(), many)).json();
  assert.equal(j.added, n);
  assert.equal(j.cats[0].links.length, n);
  assert.equal(j.cats[0].links[n - 1].name.zh, 'n' + (n - 1));
  assert.equal(IMP.backupKey(Date.UTC(2026, 9, 21, 6, 1, 2, 345), 'abcdef0123456789'), 'imports/20261021T060102Z-abcdef012345.html');
});

/* ================= 导出 ================= */

test('导出：主人 + 同源（直接点链接时认 Sec-Fetch-Site）；访客 403；文件能被再解析', async () => {
  const db = makeD1();
  await op(db, { op: 'cat.add', name: { zh: '工具', en: 'Tools' } });
  await op(db, { op: 'link.add', cat: 1, url: 'https://a.example', name: 'A', private: true });
  const r = await call('/api/export', { role: 'owner', db, origin: null, headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Disposition'), /^attachment; filename="curio-\d{8}\.html"$/);
  const parsed = N.parseBookmarks(await r.text());
  assert.deepEqual(parsed.items.map((i) => [i.cat, i.url]), [['工具', 'https://a.example/']]);
  const en = N.parseBookmarks(await (await call('/api/export?lang=en', { role: 'owner', db })).text());
  assert.equal(en.items[0].cat, 'Tools');
  assert.equal((await call('/api/export', { role: 'visitor', db })).status, 403);
  assert.equal((await call('/api/export', { role: 'owner', db, origin: null, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

/* ================= 图标 ================= */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
function fakeFetch(map) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const r = map[url];
    if (!r) return new Response('nope', { status: 404 });
    return r();
  };
  f.calls = calls;
  return f;
}

test('图标：没缓存现抓（apple-touch-icon → favicon.ico），存 R2 按域名共用；命中直接回', async () => {
  const db = makeD1();
  const r2 = makeR2();
  await op(db, { op: 'cat.add', name: 'x' });
  await op(db, { op: 'link.add', cat: 1, url: 'https://site.example/a', name: 'A' });
  await op(db, { op: 'link.add', cat: 1, url: 'https://site.example/b', name: 'B' });
  const f = fakeFetch({ 'https://site.example/favicon.ico': () => new Response(PNG, { headers: { 'Content-Type': 'application/octet-stream' } }) });
  const ctxFetch = { waitUntil() {} };
  const req = (id, role = 'owner') => new Request(ORIGIN + '/api/icon?id=' + id, { headers: { Cookie: 'x' } });
  const env = (role) => ({ AUTH: auth(role), DB: db, FILES: r2 });
  const r = await I.onRequestGet({ request: req(1), env: env('owner'), fetchImpl: f, ...ctxFetch });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'image/x-icon');
  assert.match(r.headers.get('Cache-Control'), /max-age=604800/);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), PNG);
  assert.deepEqual(f.calls, ['https://site.example/apple-touch-icon.png', 'https://site.example/favicon.ico']);
  assert.ok(r2.m.has('icons/h/site.example'));
  /* 同域名第二条：命中缓存，不再抓 */
  const r2b = await I.onRequestGet({ request: req(2), env: env('visitor'), fetchImpl: f });
  assert.equal(r2b.status, 200);
  assert.equal(f.calls.length, 2);
});

test('图标：抓不到存「没有」标记，7 天内不再抓；访客拿不到私密收藏的图标；坏 id 400', async () => {
  const db = makeD1();
  const r2 = makeR2();
  await op(db, { op: 'cat.add', name: 'x' });
  await op(db, { op: 'link.add', cat: 1, url: 'https://none.example/', name: 'N' });
  await op(db, { op: 'link.add', cat: 1, url: 'https://secret.example/', name: 'S', private: true });
  const f = fakeFetch({ 'https://none.example/favicon.ico': () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) });
  const env = (role) => ({ AUTH: auth(role), DB: db, FILES: r2 });
  const get = (id, role = 'owner') => I.onRequestGet({ request: new Request(ORIGIN + '/api/icon?id=' + id), env: env(role), fetchImpl: f });
  assert.equal((await get(1)).status, 404);
  assert.equal(f.calls.length, 2);
  assert.equal((await get(1)).status, 404);
  assert.equal(f.calls.length, 2);
  assert.equal((await get(2, 'visitor')).status, 404);
  assert.equal((await get(99)).status, 404);
  assert.equal((await I.onRequestGet({ request: new Request(ORIGIN + '/api/icon?id=x'), env: env('owner') })).status, 400);
});

test('图标：内网 / 本机 / 自家域名 / SVG / 太大都不要；跳转每一跳都查地址', async () => {
  for (const u of ['http://127.0.0.1/x.png', 'https://10.0.0.1/x.png', 'https://curio.styrigx.com/x.png', 'http://localhost/x.png']) {
    assert.equal(await I.fetchIcon(u, async () => { throw new Error('不该抓'); }), null, u);
  }
  const svg = await I.fetchIcon('https://a.example/i.svg', async () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }));
  assert.equal(svg, null);
  const big = await I.fetchIcon('https://a.example/i.png', async () => new Response(new Uint8Array(I.ICON_MAX_BYTES + 1), { headers: { 'Content-Type': 'image/png' } }));
  assert.equal(big, null);
  const hop = await I.fetchIcon('https://a.example/i.png', async () => new Response(null, { status: 302, headers: { Location: 'http://192.168.1.1/i.png' } }));
  assert.equal(hop, null);
  const plan = await I.iconPlan({ url: 'https://x.example/p', icon: 'https://cdn.example/i.png' });
  assert.match(plan.key, /^icons\/u\/[0-9a-f]{24}$/);
  assert.deepEqual(plan.urls, ['https://cdn.example/i.png']);
});

test('预览：内网、本机、自家域名、怪端口不抓；HTML 取 og 标题、简介、图标', () => {
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://[::1]/', 'https://styrigx.com/', 'https://curio.styrigx.com/', 'https://example.com:8080/']) {
    assert.equal(P.previewAllowed(u), false, u);
  }
  assert.equal(P.previewAllowed('https://github.com/'), true);
  const r = P.parseHtmlMeta('<title>F</title><meta property="og:title" content="Tom &amp; Jerry"><link rel="apple-touch-icon" href="/t.png">', 'https://ex.com/a/b');
  assert.deepEqual(r, { title: 'Tom & Jerry', desc: '', icon: 'https://ex.com/t.png' });
});

test('预览接口：访客 403、非同源 403、坏网址 400', async () => {
  assert.equal((await call('/api/preview?url=https://x.com', { role: 'visitor' })).status, 403);
  assert.equal((await call('/api/preview?url=https://x.com', { role: 'owner', origin: 'https://evil.com' })).status, 403);
  assert.equal((await call('/api/preview?url=javascript:1', { role: 'owner' })).status, 400);
  /* 同源 GET 浏览器不带 Origin：认 Sec-Fetch-Site；两样都没有拒绝 */
  assert.equal((await call('/api/preview?url=javascript:1', { role: 'owner', origin: null, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 400);
  assert.equal((await call('/api/preview?url=https://x.com', { role: 'owner', origin: null })).status, 403);
  assert.equal((await call('/api/preview?url=https://x.com', { role: 'owner', origin: null, headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
});

/* ================= 迁移 / 配置 ================= */

test('迁移：0001 + 0002 在空库上连跑两次不报错，得到种子的分类和收藏，全部公开', async () => {
  const raw = new DatabaseSync(':memory:');
  const dir = W + '/migrations';
  const files = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
  assert.deepEqual(files, ['0001_init.sql', '0002_seed.sql']);
  for (let k = 0; k < 2; k++) for (const f of files) raw.exec(readFileSync(dir + '/' + f, 'utf8'));
  const seed = SEED.loadSeed();
  const v = await list(makeD1(raw), 'visitor');
  assert.deepEqual(v.cats.map((c) => c.name), seed.map((c) => c.name));
  assert.deepEqual(v.cats.map((c) => c.links.length), seed.map((c) => c.links.length));
  assert.ok(v.cats.flatMap((c) => c.links).some((l) => l.url === 'https://blog.styrigx.com/'));
});

test('种子迁移与 data/seed.json 一致；SCHEMA 建出来的表和迁移的一样', () => {
  assert.equal(readFileSync(W + '/migrations/0002_seed.sql', 'utf8'), SEED.render(SEED.loadSeed()));
  const a = new DatabaseSync(':memory:');
  a.exec(readFileSync(W + '/migrations/0001_init.sql', 'utf8'));
  const b = new DatabaseSync(':memory:');
  for (const s of S.SCHEMA) b.exec(s);
  const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value]);
  for (const t of ['cats', 'links', 'imports']) assert.deepEqual(cols(b, t), cols(a, t), t);
});

test('wrangler.toml：不开 workers.dev，只挂 curio 的 /api/*，D1 + R2 + 网关服务绑定，没有钥匙', () => {
  const t = readFileSync(W + '/wrangler.toml', 'utf8');
  assert.match(t, /^name = "styrigx-curio-core"$/m);
  assert.match(t, /^workers_dev = false$/m);
  assert.match(t, /^preview_urls = false$/m);
  assert.match(t, /^pattern = "curio\.styrigx\.com\/api\/\*"$/m);
  assert.match(t, /^database_id = "[0-9a-f-]{36}"$/m);
  assert.match(t, /^bucket_name = "styrigx-curio"$/m);
  assert.match(t, /^service = "styrigx-auth-gateway"$/m);
  assert.doesNotMatch(t, /SGX_|\[vars\]/);
});
