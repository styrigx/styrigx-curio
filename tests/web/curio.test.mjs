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

test('hostOf / initial / hue：去 www、首字大写、同域名同颜色', () => {
  assert.equal(C.hostOf('https://www.example.com/a'), 'example.com');
  assert.equal(C.initial('github', 'https://github.com'), 'G');
  assert.equal(C.initial('', 'https://www.mdn.dev'), 'M');
  assert.equal(C.initial('珍格', ''), '珍');
  assert.equal(C.initial('😀 smile', ''), '😀');
  assert.equal(C.hue('https://a.com/x'), C.hue('https://a.com/y'));
  assert.ok(C.hue('https://a.com') >= 0 && C.hue('https://a.com') < 360);
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
