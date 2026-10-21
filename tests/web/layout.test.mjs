// 页面模板（web/layouts）：沉浸式 app 顶栏（长条是搜索框）、抽屉同主站、首页部件都在、不被搜索引擎收录。
// 只读模板源码，不用构建；构建后的行为在手机 E2E（tests/web/e2e）。
// 运行：node --test tests/web/layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(REPO, p), 'utf8');
const base = read('web/layouts/_default/baseof.html');
const index = read('web/layouts/index.html');

test('顶栏：九宫格 · 搜索框（首页）/ 回首页链接（其他页）· 头像只展示；没有快捷面板和分段滑块', () => {
  assert.match(base, /class="sgx-tb-nav"/);
  assert.match(base, /<input id="cu-q" type="search"/);
  assert.match(base, /class="cu-search cu-search--link"/);
  assert.match(base, /<span class="sgx-tb-me" aria-hidden="true">/);
  assert.doesNotMatch(base, /sgx-tb-quick|sgx-qp|data-dm-seg|<a class="sgx-tb-me"/);
});

test('抽屉：主站共享外壳的 nav.json，模板不写死项；珍格（或主站换过来前的书签项）是当前项', () => {
  const drawer = base.slice(base.indexOf('<dialog id="sgx-drawer"'), base.indexOf('</dialog>'));
  assert.match(drawer, /range \$shellNav\.items/);
  assert.match(drawer, /range \$shellNav\.footer/);
  assert.match(drawer, /<hr class="sgx-drawer-div">/);
  assert.match(drawer, /eq \.id "curio"/);
  assert.match(drawer, /eq \.id "bookmarks"/);
});

test('首页部件：分类条、格子、收藏按钮、更多菜单（分类 / 导入 / 导出）、编辑弹层、确认', () => {
  for (const id of ['cu-chips', 'cu-menu-btn', 'cu-list', 'cu-empty', 'cu-fab', 'menu-cats', 'menu-import', 'menu-export',
    'f-url', 'f-fill', 'f-name', 'f-name2', 'f-desc', 'f-desc2', 'f-cats', 'f-cat-name', 'f-icon', 'f-private', 'f-up', 'f-down', 'edit-del', 'edit-save',
    'cats-list', 'cats-new', 'imp-file', 'imp-private', 'imp-go', 'confirm-ok']) {
    assert.match(index, new RegExp('id="' + id + '"'), id);
  }
  assert.match(index, /id="menu-export"[^>]*href="\/api\/export/);
  assert.match(index, /id="imp-private"[^>]*checked/);
});

test('不被收录、外观和语言跟主站（ui-inherit-run 在样式前）', () => {
  assert.match(base, /<meta name="robots" content="noindex">/);
  assert.ok(base.indexOf('ui-inherit-run.js') < base.indexOf('css/main.css'));
  assert.doesNotMatch(base + index, /daymark|日刻分区|dm-/);
});
