// 页面模板（web/layouts）：沉浸式 app 顶栏（长条是 发现 / 设备 / 游戏 分段滑块，没有搜索栏）、抽屉同主站、首页部件都在、不被搜索引擎收录。
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

test('顶栏：九宫格 · 长条（首页 = 分段滑块 发现 / 设备 / 游戏；其他页只有页名）· 右胶囊（分享 + 留言板）；没有搜索栏、快捷面板、头像', () => {
  assert.match(base, /class="sgx-tb-nav"/);
  assert.match(base, /<div class="sgx-seg" role="tablist"[^>]*data-cu-seg/);
  assert.match(base, /\{\{ else \}\}\s*<span class="sgx-tb-title">\{\{ \$pageName \}\}<\/span>/);
  assert.doesNotMatch(base, /sgx-seg--none/);
  for (const [id, zh, en, hash] of [['finds', '发现', 'Finds', ''], ['devices', '设备', 'Devices', '#devices'], ['games', '游戏', 'Games', '#games']]) {
    assert.match(base, new RegExp('\\(dict "id" "' + id + '" "zh" "' + zh + '" "en" "' + en + '" "hash" "' + hash + '"\\)'), id);
  }
  assert.match(base, /data-cu-tab="\{\{ \$t\.id \}\}"/);
  /* 留言板（三个子站同一个 pen-line 图标），链本站 /guestbook/、英文 /en/guestbook/ */
  assert.match(base, /\$gb := cond \$isEn "\/en\/guestbook\/" "\/guestbook\/"/);
  /* 2026-10-24：右胶囊 = 分享（共享外壳 share.js，图标 nav.json share）+ 留言板 */
  assert.match(base, /<div class="sgx-tb-end-group">\s*<button type="button" class="sgx-tb-gbtn sgx-tb-share" data-sgx-share [^>]*>\{\{ index \(resources\.Get "sgx-shell\/nav\.json" \| transform\.Unmarshal\)\.icons "share" \| safeHTML \}\}<\/button>\s*<a class="sgx-tb-gbtn sgx-tb-guestbook" href="\{\{ \$gb \}\}"[^>]*>\{\{ partial "icon\.html" "pen-line" \}\}<\/a>\s*<\/div>/);
  assert.match(base, /resources\.Get "js\/sgx\/share-host\.js" \| js\.Build/);
  assert.doesNotMatch(base, /cu-search|id="cu-q"|sgx-tb-quick|sgx-qp|sgx-tb-me|sgx-tb-avatar/);
});

test('没有版权页脚（© / Powered by），样式也删干净', () => {
  const css = read('web/assets/css/input.css');
  assert.doesNotMatch(base, /<footer|©|Powered by/);
  assert.doesNotMatch(css.slice(css.indexOf('/* @sgx-shell:end */')), /(^|[\s,}])footer\b|sgx-powered|sgx-tb-me/);
});

test('留言板：/guestbook/ + /en/guestbook/，共用 Giscus 讨论串（styrigx/styrigx · Announcements · specific term=guestbook）', () => {
  const gb = read('web/layouts/_default/guestbook.html');
  const cfg = read('web/hugo.yaml');
  assert.match(read('web/content/guestbook.md'), /title: 留言板\nlayout: guestbook\nurl: \/guestbook\//);
  assert.match(read('web/content/en/guestbook.md'), /title: Guestbook\nlayout: guestbook\nurl: \/en\/guestbook\//);
  for (const [k, v] of [['repo', 'styrigx/styrigx'], ['repoId', 'R_kgDOVDhNiA'], ['category', 'Announcements'], ['categoryId', 'DIC_kwDOVDhNiM4DJVrs'],
    ['mapping', 'specific'], ['term', 'guestbook'], ['strict', '0'], ['reactionsEnabled', '1'], ['inputPosition', 'top']]) {
    assert.match(cfg, new RegExp('\\n      ' + k + ": '" + v.replace('/', '\\/') + "'"), k);
  }
  assert.match(gb, /data-giscus /);
  assert.match(gb, /data-term="\{\{ \$g\.term \}\}"/);
  assert.match(gb, /data-lang="\{\{ cond \$isEn "en" "zh-CN" \}\}"/);
  assert.match(gb, /js\/guestbook\.js/);
  const js = read('web/assets/js/guestbook.js');
  assert.match(js, /https:\/\/giscus\.app\/client\.js/);
  assert.match(js, /setConfig: \{ theme: t \}/);
});

test('抽屉：主站共享外壳的 nav.json，模板不写死项；奇趣是当前项；结构同主站', () => {
  const drawer = base.slice(base.indexOf('<dialog id="sgx-drawer"'), base.indexOf('</dialog>'));
  assert.match(drawer, /range \$shellNav\.items/);
  assert.match(drawer, /with \$shellNav\.footer/);
  /* 和主站同一结构（2026-10-22）：头部字标 + 头像（链主站账号页），导航项下一条分隔线，底栏搜索框 */
  assert.match(drawer, /class="sgx-drawer-head"><span class="sgx-drawer-brand">\{\{ \$shellNav\.wordmark \| safeHTML \}\}/);
  assert.match(drawer, /<a class="sgx-drawer-me" href="\{\{ \$me \}\}"/);
  assert.match(drawer, /<hr class="sgx-drawer-sep" aria-hidden="true">/);
  assert.match(drawer, /<div class="sgx-drawer-foot"><a class="sgx-drawer-search"/);
  assert.match(drawer, /eq \.id "curio"/);
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

test('三个面板 + 设备 / 游戏的部件：筛选条、列表、新建按钮、详情、编辑弹层（照片、日期、退役、关联设备、状态、评分）', () => {
  assert.match(index, /<section id="cu-pane-finds" class="cu-pane" role="tabpanel" aria-labelledby="cu-tab-finds">/);
  assert.match(index, /<section id="cu-pane-devices"[^>]*hidden inert>/);
  assert.match(index, /<section id="cu-pane-games"[^>]*hidden inert>/);
  for (const id of ['dv-chips', 'dv-list', 'dv-empty', 'dv-fab', 'gm-chips', 'gm-list', 'gm-empty', 'gm-fab',
    'it-view-wrap', 'it-view-edit', 'it-view-body',
    'dv-photo', 'dv-photo-del', 'dv-name', 'dv-kind', 'dv-bought', 'dv-os', 'dv-specs', 'dv-acc', 'dv-notes', 'dv-retired', 'dv-retired-at', 'dv-replaced', 'dv-private', 'dv-del', 'dv-save',
    'gm-photo', 'gm-title', 'gm-status', 'gm-platform', 'gm-platforms', 'gm-device', 'gm-edition', 'gm-rating', 'gm-review', 'gm-private', 'gm-del', 'gm-save']) {
    assert.match(index, new RegExp('id="' + id + '"'), id);
  }
  assert.match(index, /id="dv-bought" type="date"/);
  /* 脚本顺序：curio.js（确认框等）→ curio-items.js → curio-tabs.js */
  const a = index.indexOf('js/curio.js'), b = index.indexOf('js/curio-items.js'), c = index.indexOf('js/curio-tabs.js');
  assert.ok(a > 0 && a < b && b < c);
});

test('不被收录、外观和语言跟主站（ui-inherit-run 在样式前）', () => {
  assert.match(base, /<meta name="robots" content="noindex">/);
  assert.ok(base.indexOf('ui-inherit-run.js') < base.indexOf('css/main.css'));
  assert.doesNotMatch(base + index, /daymark|日刻分区|dm-/);
});
