// 首页逻辑的纯函数（web/assets/js/curio.js）：双语取值、首字母、hash、筛选、挪位置、网址补全、导入结果的话。
// 运行：node --test tests/web/curio.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../web/assets/js/curio.js');

const CATS = [
  { id: 1, name: { zh: '开发', en: 'Dev' }, private: false, links: [
    { id: 11, url: 'https://github.com/', name: { zh: 'GitHub', en: '' }, desc: { zh: '代码托管', en: 'Code hosting' } },
    { id: 12, url: 'https://dash.cloudflare.com/', name: { zh: 'Cloudflare', en: '' }, desc: { zh: '域名与 Pages', en: '' } },
  ] },
  { id: 2, name: { zh: '空的', en: '' }, private: true, links: [] },
  { id: 3, name: { zh: '', en: 'Only EN' }, private: false, links: [
    { id: 31, url: 'https://ip.sb/', name: { zh: 'IP.SB', en: '' }, desc: { zh: '', en: '' } },
  ] },
];

test('pick：当前语言为空就用另一种', () => {
  assert.equal(C.pick({ zh: '开发', en: 'Dev' }, false), '开发');
  assert.equal(C.pick({ zh: '开发', en: 'Dev' }, true), 'Dev');
  assert.equal(C.pick({ zh: '', en: 'Only EN' }, false), 'Only EN');
  assert.equal(C.pick({ zh: '只有中文', en: '' }, true), '只有中文');
  assert.equal(C.pick(null, false), '');
});

test('hostOf / initial：去 www、首字大写', () => {
  assert.equal(C.hostOf('https://www.example.com/a'), 'example.com');
  assert.equal(C.initial('github', 'https://github.com'), 'G');
  assert.equal(C.initial('', 'https://www.mdn.dev'), 'M');
  assert.equal(C.initial('奇趣', ''), '奇');
  assert.equal(C.initial('😀 smile', ''), '😀');
});

test('hash：#c/<id> ↔ 分类，其余当全部', () => {
  assert.equal(C.parseHash('#c/12'), 12);
  assert.equal(C.parseHash(''), 0);
  assert.equal(C.parseHash('#c/x'), 0);
  assert.equal(C.catHash(3), '#c/3');
  assert.equal(C.catHash(0), '');
});

test('filterCats：按分类、按多个词（名字 / 简介 / 网址，两种语言，不分大小写）', () => {
  assert.deepEqual(C.filterCats(CATS, '', 0).map((c) => c.id), [1, 2, 3]);
  assert.deepEqual(C.filterCats(CATS, '', 2).map((c) => c.id), [2]);
  assert.deepEqual(C.filterCats(CATS, 'code', 0).map((c) => c.links.map((l) => l.id)), [[11]]);
  assert.deepEqual(C.filterCats(CATS, 'PAGES 域名', 0).map((c) => c.links.map((l) => l.id)), [[12]]);
  assert.deepEqual(C.filterCats(CATS, 'ip.sb', 1), []);
  assert.deepEqual(C.filterCats(CATS, 'zzz', 0), []);
  assert.equal(C.countLinks(CATS), 3);
  assert.equal(CATS[0].links.length, 2, '不改原数组');
});

test('moveId：上移 / 下移，到头返回 null', () => {
  assert.deepEqual(C.moveId([1, 2, 3], 2, -1), [2, 1, 3]);
  assert.deepEqual(C.moveId([1, 2, 3], 2, 1), [1, 3, 2]);
  assert.equal(C.moveId([1, 2, 3], 1, -1), null);
  assert.equal(C.moveId([1, 2, 3], 3, 1), null);
  assert.equal(C.moveId([1, 2, 3], 9, 1), null);
});

test('normalizeUrl：没写协议补 https；只收 http(s)', () => {
  assert.equal(C.normalizeUrl('github.com/styrigx'), 'https://github.com/styrigx');
  assert.equal(C.normalizeUrl(' http://a.com '), 'http://a.com/');
  assert.equal(C.normalizeUrl('javascript:alert(1)'), '');
  assert.equal(C.normalizeUrl(''), '');
});

test('importSummary：中英文', () => {
  assert.equal(C.importSummary({ added: 12, cats_added: 2, skipped: 3 }, false), '新增 12 条、2 个分类，3 条已经有了。');
  assert.equal(C.importSummary({ added: 1, cats_added: 0, skipped: 0 }, true), 'Added 1 link.');
});

/* ===== 设备 / 游戏（curio-items.js）、页签（curio-tabs.js） ===== */
const IT = require('../../web/assets/js/curio-items.js');
const TB = require('../../web/assets/js/curio-tabs.js');

test('usedDays：购买当天算第 1 天，退役了算到退役日；没填 / 倒了返回 null；daysText 满一年带年数', () => {
  assert.equal(IT.usedDays('2026-10-22', '', '2026-10-22'), 1);
  assert.equal(IT.usedDays('2024-02-28', '2024-03-01', '2026-01-01'), 3, '闰年');
  assert.equal(IT.usedDays('2025-10-22', '', '2026-10-22'), 366);
  assert.equal(IT.usedDays('', '', '2026-10-22'), null);
  assert.equal(IT.usedDays('2026-10-23', '', '2026-10-22'), null);
  assert.equal(IT.daysText(30, false), '30 天');
  assert.equal(IT.daysText(731, false), '731 天 · 约 2 年');
  assert.equal(IT.daysText(1, true), '1 day');
  assert.equal(IT.daysText(400, true), '400 days · about 1.1 years');
  assert.match(IT.todayStr(Date.UTC(2026, 9, 22, 12)), /^2026-10-2[12]$/);
});

test('筛选、换代历史、平台联想、缩图尺寸', () => {
  const D = [{ id: 1, retired_at: '2025-01-01', replaced_by: 2 }, { id: 2, retired_at: '', replaced_by: 0 }, { id: 3, retired_at: '2024-01-01', replaced_by: 2 }];
  assert.deepEqual(IT.filterDevices(D, 'active').map((d) => d.id), [2]);
  assert.deepEqual(IT.filterDevices(D, 'retired').map((d) => d.id), [1, 3]);
  assert.equal(IT.filterDevices(D, 'all').length, 3);
  assert.deepEqual(IT.lineage(D, 2).before.map((d) => d.id), [1, 3]);
  assert.equal(IT.lineage(D, 1).after.id, 2);
  assert.equal(IT.lineage(D, 2).after, null);
  const Gs = [{ status: 'done', platform: 'Switch' }, { status: 'want', platform: ' PC ' }, { status: 'done', platform: 'Switch' }, { status: 'want', platform: '' }];
  assert.equal(IT.filterGames(Gs, 'done').length, 2);
  assert.equal(IT.filterGames(Gs, 'all').length, 4);
  assert.deepEqual(IT.platformsOf(Gs), ['Switch', 'PC']);
  assert.deepEqual(IT.fitSize(4000, 3000, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(IT.fitSize(800, 600, 1600), { w: 800, h: 600 });
  assert.deepEqual(IT.KINDS.length, 9);
  assert.deepEqual(IT.STATUS, ['want', 'playing', 'done', 'shelved']);
});

test('页签 hash：#devices / #games，其余都是发现；切回发现保留 #c/<id>', () => {
  assert.equal(TB.tabOf('#devices'), 'devices');
  assert.equal(TB.tabOf('#games'), 'games');
  assert.equal(TB.tabOf('#c/3'), 'finds');
  assert.equal(TB.tabOf(''), 'finds');
  assert.equal(TB.hashFor('finds', '#c/3'), '#c/3');
  assert.equal(TB.hashFor('finds', '#games'), '');
  assert.equal(TB.hashFor('games', '#c/3'), '#games');
});
