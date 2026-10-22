// 奇趣首页（手机）：接口用 page.route 假数据，不碰线上。
// - 顶栏：九宫格 · 分段滑块 发现 / 设备 / 游戏 · 留言板圆（没有搜索栏、没有页脚）；抽屉同主站（字标 + 头像、主站 / 奇趣（书签+星）/ 日刻 / 博客、分隔线、底栏搜索框），奇趣是当前项
// - 留言板 /guestbook/：长条只有页名，卡片里是共用的 Giscus 讨论串（giscus.app 用 page.route 拦掉）
// - 访客：没有「收藏」和「⋯」；格子点开新标签页；图标取不到显示首字母
// - 分类条筛选 + hash；页签切换 + hash + 左右滑
// - 设备 / 游戏：访客只读；主人新建（照片缩图后上传）、详情、编辑、删除；使用天数
// - 主人：私密带锁；收藏 → 填网址自动补全 → 保存发 link.add；长按格子编辑、删除要确认；管理分类；导入发原文
// - 英文页
const { test, expect } = require('@playwright/test');

const CATS = [
  { id: 1, name: { zh: '开发与云', en: 'Dev & Cloud' }, private: false, links: [
    { id: 11, url: 'https://github.com/', name: { zh: 'GitHub', en: '' }, desc: { zh: '代码托管', en: 'Code hosting' }, icon: '', private: false },
    { id: 12, url: 'https://dash.cloudflare.com/', name: { zh: 'Cloudflare', en: '' }, desc: { zh: '域名、CDN 与 Pages', en: '' }, icon: '', private: true },
  ] },
  { id: 2, name: { zh: '网络检测', en: 'Network Tests' }, private: false, links: [
    { id: 21, url: 'https://ip.sb/', name: { zh: 'IP.SB', en: '' }, desc: { zh: 'IPv4 / IPv6 地址查询', en: '' }, icon: '', private: false },
  ] },
  { id: 3, name: { zh: '私房', en: '' }, private: true, links: [] },
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function mock(page, owner) {
  let cats = owner
    ? JSON.parse(JSON.stringify(CATS))
    : JSON.parse(JSON.stringify(CATS)).filter((c) => !c.private).map((c) => ({ ...c, links: c.links.filter((l) => !l.private) })).filter((c) => c.links.length);
  const calls = [];
  await page.route('**/avatar/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' }));
  await page.route('**/api/session-check', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/icon**', (r) => (new URL(r.request().url()).searchParams.get('id') === '11'
    ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    : r.fulfill({ status: 404, json: { ok: false } })));
  await page.route('**/api/preview**', (r) => r.fulfill({ json: { ok: true, url: 'https://mdn.dev/', title: 'MDN Web Docs', desc: 'Web 开发文档', icon: '' } }));
  await page.route('**/api/import**', async (r) => {
    calls.push({ url: r.request().url(), body: r.request().postData(), type: r.request().headers()['content-type'] });
    cats = cats.concat({ id: 9, name: { zh: '工具', en: '' }, private: true, links: [{ id: 91, url: 'https://t.example/', name: { zh: 'T', en: '' }, desc: { zh: '', en: '' }, icon: '', private: true }] });
    return r.fulfill({ json: { ok: true, found: 3, added: 1, skipped: 2, invalid: 0, cats_added: 1, backup: 'imports/x.html', owner: true, cats } });
  });
  let devices = [
    { id: 1, name: 'Galaxy S23', kind: 'phone', bought_at: '2023-03-01', retired_at: '2025-03-01', replaced_by: 2, os: 'One UI 6', specs: '8GB / 256GB', accessories: '', notes: '小屏好用', photo: false, private: false },
    { id: 2, name: 'Galaxy S25 Ultra', kind: 'phone', bought_at: '2025-03-01', retired_at: '', replaced_by: 0, os: 'One UI 8', specs: '', accessories: '原装壳', notes: '', photo: true, private: false },
    { id: 3, name: '私密平板', kind: 'tablet', bought_at: '', retired_at: '', replaced_by: 0, os: '', specs: '', accessories: '', notes: '', photo: false, private: true },
  ];
  let games = [
    { id: 7, title: '塞尔达传说 王国之泪', platform: 'Switch', device_id: 0, edition: '实体版', status: 'done', rating: 5, review: '神作', cover: false, private: false },
    { id: 8, title: 'Hades II', platform: 'PC', device_id: 0, edition: '', status: 'playing', rating: 0, review: '', cover: false, private: false },
  ];
  if (!owner) devices = devices.filter((d) => !d.private);
  let nextId = 100;
  await page.route('**/api/photo**', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    calls.push({ photo: req.method(), url: req.url(), type: req.headers()['content-type'], size: (req.postDataBuffer() || Buffer.alloc(0)).length });
    return r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/items**', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: { ok: true, owner, devices, games } });
    const body = req.postDataJSON();
    calls.push(body);
    let id;
    if (body.op === 'device.add') { id = nextId++; devices.push({ photo: false, ...body, id, op: undefined }); }
    if (body.op === 'device.edit') devices = devices.map((d) => (d.id === body.id ? { ...d, ...body, op: undefined } : d));
    if (body.op === 'device.del') devices = devices.filter((d) => d.id !== body.id);
    if (body.op === 'game.add') { id = nextId++; games.push({ cover: false, ...body, id, op: undefined }); }
    return r.fulfill({ json: { ok: true, owner: true, id, devices, games } });
  });
  await page.route('**/api/links**', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: { ok: true, owner, cats } });
    const body = req.postDataJSON();
    calls.push(body);
    if (body.op === 'link.add') cats[0].links.push({ id: 99, url: body.url, name: body.name, desc: body.desc, icon: '', private: !!body.private });
    if (body.op === 'link.del') cats.forEach((c) => { c.links = c.links.filter((l) => l.id !== body.id); });
    if (body.op === 'cat.add') cats.push({ id: 50, name: body.name, private: false, links: [] });
    return r.fulfill({ json: { ok: true, owner: true, cats } });
  });
  return calls;
}

test('访客：顶栏分段滑块（没有搜索栏）、抽屉同主站；没有收藏按钮和菜单；只看公开；图标取不到显示首字母', async ({ page }) => {
  await mock(page, false);
  await page.goto('/');
  await expect(page.locator('[data-cu-seg] .sgx-seg-btn')).toHaveText(['发现', '设备', '游戏']);
  await expect(page.locator('#cu-tab-finds')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cu-q')).toHaveCount(0);
  await expect(page.locator('.cu-sec-h > span:first-child')).toHaveText(['开发与云', '网络检测']);
  await expect(page.locator('.cu-tile')).toHaveCount(2);
  await expect(page.locator('#cu-fab')).toBeHidden();
  await expect(page.locator('#cu-menu-btn')).toBeHidden();
  await expect(page.locator('.cu-lock')).toHaveCount(0);
  const gh = page.locator('.cu-tile[data-id="11"]');
  await expect(gh).toHaveAttribute('href', 'https://github.com/');
  await expect(gh).toHaveAttribute('target', '_blank');
  await expect(gh.locator('img')).toHaveCount(1);
  await expect(page.locator('.cu-tile[data-id="21"] img')).toHaveCount(0);
  await expect(page.locator('.cu-tile[data-id="21"] .cu-ic-letter')).toHaveText('I');
  /* 右圆 = 留言板（本站 /guestbook/）；没有顶栏头像、没有版权页脚 */
  await expect(page.locator('.sgx-topbar > *')).toHaveCount(3);
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('href', '/guestbook/');
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('aria-label', '留言板');
  await expect(page.locator('.sgx-tb-me, footer')).toHaveCount(0);
  await expect(page.getByText('Powered by')).toHaveCount(0);
  await page.locator('.sgx-tb-nav').click();
  await expect(page.locator('#sgx-drawer .sgx-drawer-item')).toHaveText(['主站', '奇趣', '日刻', '博客']);
  await expect(page.locator('#sgx-drawer [data-nav="home"]')).toHaveAttribute('href', 'https://styrigx.com/');
  /* 奇趣图标 = 书签 + 星（同主站 #180） */
  await expect(page.locator('#sgx-drawer [data-nav="curio"] path').first()).toHaveAttribute('d', /^M6 4\.5A1\.5/);
  await expect(page.locator('#sgx-drawer [data-nav="curio"]')).toHaveAttribute('aria-current', 'page');
  /* 同主站：头部头像去主站账号页，导航项下一条分隔线，底栏搜索框原地开搜索层（href 只是没 JS 时的退路） */
  await expect(page.locator('#sgx-drawer .sgx-drawer-me')).toHaveAttribute('href', 'https://styrigx.com/settings/account/');
  await expect(page.locator('#sgx-drawer hr.sgx-drawer-sep')).toHaveCount(1);
  await expect(page.locator('#sgx-drawer .sgx-drawer-search')).toHaveAttribute('href', 'https://styrigx.com/search/');
});

test('抽屉底栏搜索：原地打开搜索层（不跳站、不刷新），底栏带星图标、自动聚焦，结果走本站 /api/search；返回只关搜索层', async ({ page }) => {
  await mock(page, false);
  const asked = [];
  await page.route('**/api/search**', (r) => {
    asked.push(new URL(r.request().url()).host);
    return r.fulfill({ json: { hits: [{ title: 'GitHub', subtitle: '开发与云', url: '/#c/1', type: 'item' }] } });
  });
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  await page.evaluate(() => { window.__noReload = 1; });
  const histLen = await page.evaluate(() => history.length);
  await page.locator('.sgx-tb-nav').click();
  await page.locator('#sgx-drawer .sgx-drawer-search').click();
  await expect(page.locator('.sgx-srch-bar')).toBeVisible();
  await expect(page.locator('#sgx-srch-input')).toBeFocused();
  await expect(page.locator('#sgx-drawer')).not.toHaveAttribute('open', '');
  expect(new URL(page.url()).origin).toBe(origin);
  expect(await page.evaluate(() => window.__noReload)).toBe(1);
  /* 底栏和空白页的放大镜 = 抽屉同款带星图标 */
  await expect(page.locator('.sgx-srch-bar .sgx-srch-ic path').first()).toHaveAttribute('d', /^M14\.9 9\.6/);
  await expect(page.locator('.sgx-srch-empty .sgx-srch-empty-ic path').first()).toHaveAttribute('d', /^M14\.9 9\.6/);
  await page.locator('#sgx-srch-input').fill('git');
  await expect(page.locator('#sgx-srch-list [data-srch-u]').first()).toContainText('GitHub');
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((h) => h === new URL(origin).host)).toBe(true);
  /* 抽屉的历史哨兵让给搜索层：只多一条；系统返回只关搜索层，停在本页 */
  expect(await page.evaluate(() => history.length)).toBe(histLen + 1);
  await page.goBack();
  await expect(page.locator('.sgx-srch-bar')).toBeHidden();
  expect(new URL(page.url()).origin).toBe(origin);
  expect(await page.evaluate(() => window.__noReload)).toBe(1);
});

test('分类条筛选并写 hash，刷新还在', async ({ page }) => {
  await mock(page, false);
  await page.goto('/');
  await expect(page.locator('#cu-chips .cu-chip')).toHaveText(['全部', '开发与云', '网络检测']);
  await page.locator('.cu-chip[data-cat="2"]').click();
  await expect(page).toHaveURL(/#c\/2$/);
  await expect(page.locator('.cu-tile')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.cu-chip[data-cat="2"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('.cu-chip[data-cat="0"]').click();
  await expect(page.locator('.cu-tile')).toHaveCount(2);
});

test('主人：私密带锁、空分类也在；收藏 → 自动填写 → 保存发 link.add', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/');
  await expect(page.locator('#cu-fab')).toBeVisible();
  await expect(page.locator('.cu-tile[data-id="12"] .cu-lock')).toHaveCount(1);
  await expect(page.locator('.cu-sec')).toHaveCount(3);
  await page.locator('#cu-fab').click();
  await expect(page.locator('#edit-wrap')).toHaveClass(/open/);
  await expect(page.locator('#edit-title')).toHaveText('收藏');
  await page.locator('#f-url').fill('mdn.dev');
  await page.locator('#f-fill').click();
  await expect(page.locator('#f-name')).toHaveValue('MDN Web Docs');
  await expect(page.locator('#f-desc')).toHaveValue('Web 开发文档');
  await expect(page.locator('#f-cats .cu-chip[aria-checked="true"]')).toHaveText('开发与云');
  await page.locator('#f-cats .cu-chip[data-cat="2"]').click();
  await page.locator('#edit-save').click();
  await expect(page.locator('#edit-wrap')).not.toHaveClass(/open/);
  const add = calls.find((c) => c.op === 'link.add');
  expect(add).toMatchObject({ url: 'https://mdn.dev/', cat: 2, name: { zh: 'MDN Web Docs', en: '' }, desc: { zh: 'Web 开发文档', en: '' }, private: false });
  await expect(page.locator('#bk-toast')).toHaveText('已保存');
});

test('主人：长按格子编辑，删除要确认', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/');
  const tile = page.locator('.cu-tile[data-id="21"]');
  const box = await tile.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator('#edit-wrap')).toHaveClass(/open/);
  await expect(page.locator('#f-url')).toHaveValue('https://ip.sb/');
  await expect(page.locator('#f-move')).toBeVisible();
  await page.locator('#edit-del').click();
  await expect(page.locator('#confirm-wrap')).toHaveClass(/open/);
  await page.locator('#confirm-ok').click();
  await expect.poll(() => calls.some((c) => c.op === 'link.del' && c.id === 21)).toBe(true);
  await expect(page.locator('.cu-tile[data-id="21"]')).toHaveCount(0);
});

test('主人：管理分类新建；导入把文件原文发给 /api/import（默认私密）并显示结果', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/');
  await page.locator('#cu-menu-btn').click();
  await page.locator('#menu-cats').click();
  await expect(page.locator('#cats-list .cu-catrow')).toHaveCount(3);
  await expect(page.locator('#cats-list .cu-catrow[data-id="1"] [data-act="del"]')).toBeDisabled();
  await expect(page.locator('#cats-list .cu-catrow[data-id="3"] [data-act="del"]')).toBeEnabled();
  await page.locator('#cats-new').fill('读书');
  await page.locator('#cats-add').click();
  await expect(page.locator('#cats-list .cu-catrow')).toHaveCount(4);
  expect(calls.find((c) => c.op === 'cat.add')).toMatchObject({ name: { zh: '读书', en: '' } });
  await page.locator('#cats-wrap [data-close="cats"]').first().click();

  await page.locator('#cu-menu-btn').click();
  await page.locator('#menu-import').click();
  await expect(page.locator('#imp-go')).toBeDisabled();
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://t.example/">T</A></DL>';
  await page.locator('#imp-file').setInputFiles({ name: 'bookmarks.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await expect(page.locator('#imp-file-name')).toHaveText('bookmarks.html');
  await page.locator('#imp-go').click();
  await expect(page.locator('#imp-msg')).toHaveText('新增 1 条、1 个分类，2 条已经有了。');
  const imp = calls.find((c) => c.url && c.url.includes('/api/import'));
  expect(imp.body).toBe(html);
  expect(imp.url).not.toContain('private=0');
  await expect(page.locator('.cu-tile[data-id="91"]')).toHaveCount(1);
});

test('英文页：页签、分类名用英文（英文空时退回中文）', async ({ page }) => {
  await mock(page, true);
  await page.goto('/en/');
  await expect(page.locator('[data-cu-seg] .sgx-seg-btn')).toHaveText(['Finds', 'Devices', 'Games']);
  await expect(page.locator('#cu-chips .cu-chip')).toHaveText(['All', 'Dev & Cloud', 'Network Tests', '私房']);
  await expect(page.locator('.cu-tile[data-id="11"]')).toHaveAttribute('title', /^Code hosting · /);
  await expect(page.locator('.cu-tile .cu-desc')).toHaveCount(0);
  await expect(page.locator('#menu-export')).toHaveAttribute('href', '/api/export?lang=en');
});

/* ================= 三个页签：设备 / 游戏 ================= */

test('页签：点「设备」切面板写 #devices、换右下角按钮；刷新停在设备；左右滑切到游戏；点「发现」回来保留分类', async ({ page }) => {
  await mock(page, true);
  await page.goto('/#c/2');
  await expect(page.locator('#cu-fab')).toBeVisible();
  await page.locator('#cu-tab-devices').click();
  await expect(page).toHaveURL(/#devices$/);
  await expect(page.locator('#cu-pane-devices')).toBeVisible();
  await expect(page.locator('#cu-pane-finds')).toBeHidden();
  await expect(page.locator('#cu-fab')).toBeHidden();
  await expect(page.locator('#dv-fab')).toBeVisible();
  await expect(page.locator('#gm-fab')).toBeHidden();
  await page.reload();
  await expect(page.locator('#cu-tab-devices')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#dv-list .it-card')).toHaveCount(3);
  /* 左滑 → 游戏 */
  const box = await page.locator('#cu-panes').boundingBox();
  const y = box.y + 120;
  await page.locator('#cu-panes').dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 300, clientY: y }], changedTouches: [{ identifier: 1, clientX: 300, clientY: y }] });
  await page.locator('#cu-panes').dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: 120, clientY: y + 5 }] });
  await expect(page.locator('#cu-tab-games')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#games$/);
  await expect(page.locator('#gm-fab')).toBeVisible();
  await page.locator('#cu-tab-finds').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#cu-pane-finds')).toBeVisible();
});

test('访客：设备 / 游戏只读（没有新建按钮、详情没有编辑）；看不到私密设备；退役的标出来；使用天数算到退役日', async ({ page }) => {
  await mock(page, false);
  await page.goto('/#devices');
  await expect(page.locator('#dv-list .it-name')).toHaveText(['Galaxy S23', 'Galaxy S25 Ultra']);
  await expect(page.locator('#dv-fab')).toBeHidden();
  const s23 = page.locator('#dv-list [data-dev="1"]');
  await expect(s23).toHaveClass(/is-retired/);
  await expect(s23.locator('.it-meta')).toHaveText('用了 732 天 · 约 2 年');
  await expect(page.locator('#dv-list [data-dev="2"] img')).toHaveCount(1);
  await page.locator('#dv-chips [data-f="retired"]').click();
  await expect(page.locator('#dv-list .it-card')).toHaveCount(1);
  await s23.click();
  await expect(page.locator('#it-view-wrap')).toHaveClass(/open/);
  await expect(page.locator('#it-view-title')).toHaveText('Galaxy S23');
  await expect(page.locator('#it-view-edit')).toBeHidden();
  await expect(page.locator('#it-view-body')).toContainText('小屏好用');
  /* 换代：点「换成了」跳到新机详情，那边显示「换下了」旧机 */
  await page.locator('#it-view-body .it-link[data-dev="2"]').click();
  await expect(page.locator('#it-view-title')).toHaveText('Galaxy S25 Ultra');
  await expect(page.locator('#it-view-body .it-link[data-dev="1"]')).toHaveText('Galaxy S23');
  await page.locator('#it-view-wrap button[data-close="it-view"]').click();
  await page.locator('#cu-tab-games').click();
  await expect(page.locator('#gm-list .it-name')).toHaveText(['塞尔达传说 王国之泪', 'Hades II']);
  await expect(page.locator('#gm-list [data-game="7"] .it-star.on')).toHaveCount(5);
  await page.locator('#gm-chips [data-f="playing"]').click();
  await expect(page.locator('#gm-list .it-name')).toHaveText(['Hades II']);
  await expect(page.locator('#gm-fab')).toBeHidden();
});

test('主人：添加设备（类型、日期、照片缩图转 webp 上传），详情里编辑成退役并选换成的那台；删除要确认', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/#devices');
  await expect(page.locator('#dv-list .it-card')).toHaveCount(3);
  await expect(page.locator('#dv-list [data-dev="3"] .cu-lock-inline')).toHaveCount(1);
  await page.locator('#dv-fab').click();
  await expect(page.locator('#dv-edit-wrap')).toHaveClass(/open/);
  await expect(page.locator('#dv-edit-title')).toHaveText('添加设备');
  await page.locator('#dv-save').click();
  await expect(page.locator('#dv-err')).toHaveText('起个名字。');
  await page.locator('#dv-name').fill('Galaxy Watch 8');
  await page.locator('#dv-kind [data-k="watch"]').click();
  await page.locator('#dv-bought').fill('2026-08-01');
  await page.locator('#dv-os').fill('One UI 8 Watch');
  await page.locator('#dv-specs').fill('44mm\n蓝牙版');
  /* 3000×2000 的 PNG：浏览器里缩到 1600 宽、转 webp */
  const big = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const g = c.getContext('2d'); g.fillStyle = '#3a6'; g.fillRect(0, 0, 3000, 2000); return c.toDataURL('image/png').split(',')[1]; });
  await page.locator('#dv-photo').setInputFiles({ name: 'watch.png', mimeType: 'image/png', buffer: Buffer.from(big, 'base64') });
  await expect(page.locator('#dv-photo-prev img')).toHaveCount(1);
  await expect(page.locator('#dv-photo-del')).toBeVisible();
  await page.locator('#dv-save').click();
  await expect(page.locator('#dv-edit-wrap')).not.toHaveClass(/open/);
  expect(calls.find((c) => c.op === 'device.add')).toMatchObject({ name: 'Galaxy Watch 8', kind: 'watch', bought_at: '2026-08-01', os: 'One UI 8 Watch', specs: '44mm\n蓝牙版', retired_at: '', replaced_by: 0, private: false });
  await expect.poll(() => calls.find((c) => c.photo === 'POST')).toBeTruthy();
  const up = calls.find((c) => c.photo === 'POST');
  expect(up.url).toContain('kind=device&id=100');
  expect(up.type).toBe('image/webp');
  expect(up.size).toBeGreaterThan(0);
  await expect(page.locator('#bk-toast')).toHaveText('已保存');

  /* 编辑：S25 退役，换成新加的 Watch（只是测选择框） */
  await page.locator('#dv-list [data-dev="2"]').click();
  await page.locator('#it-view-edit').click();
  await expect(page.locator('#dv-edit-title')).toHaveText('编辑设备');
  await expect(page.locator('#dv-name')).toHaveValue('Galaxy S25 Ultra');
  await expect(page.locator('#dv-retire-wrap')).toBeHidden();
  await page.locator('label:has(#dv-retired)').click();
  await expect(page.locator('#dv-retire-wrap')).toBeVisible();
  await expect(page.locator('#dv-retired-at')).not.toHaveValue('');
  await expect(page.locator('#dv-replaced option')).toHaveText(['无', 'Galaxy S23', '私密平板', 'Galaxy Watch 8']);
  await page.locator('#dv-retired-at').fill('2026-10-01');
  await page.locator('#dv-replaced').selectOption('100');
  await page.locator('#dv-save').click();
  await expect(page.locator('#dv-edit-wrap')).not.toHaveClass(/open/);
  expect(calls.find((c) => c.op === 'device.edit')).toMatchObject({ id: 2, retired_at: '2026-10-01', replaced_by: 100 });
  await expect(page.locator('#dv-list [data-dev="2"]')).toHaveClass(/is-retired/);

  /* 删除 */
  await page.locator('#dv-list [data-dev="3"]').click();
  await page.locator('#it-view-edit').click();
  await page.locator('#dv-del').click();
  await expect(page.locator('#confirm-msg')).toHaveText('确定删除这台设备吗？');
  await page.locator('#confirm-ok').click();
  await expect.poll(() => calls.some((c) => c.op === 'device.del' && c.id === 3)).toBe(true);
  await expect(page.locator('#dv-list [data-dev="3"]')).toHaveCount(0);
});

test('主人：添加游戏（状态、评分、平台联想、关联设备）', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/#games');
  await page.locator('#gm-fab').click();
  await expect(page.locator('#gm-edit-title')).toHaveText('添加游戏');
  await expect(page.locator('#gm-status [aria-checked="true"]')).toHaveText('想玩');
  await expect(page.locator('#gm-platforms option')).toHaveCount(2);
  await page.locator('#gm-title').fill('绝区零');
  await page.locator('#gm-status [data-s="playing"]').click();
  await page.locator('#gm-platform').fill('Android');
  await page.locator('#gm-device').selectOption('2');
  await page.locator('#gm-rating [data-r="4"]').click();
  await expect(page.locator('#gm-rating .it-star-btn.on')).toHaveCount(4);
  await page.locator('#gm-rating [data-r="4"]').click();
  await expect(page.locator('#gm-rating .it-star-btn.on')).toHaveCount(0);
  await page.locator('#gm-rating [data-r="3"]').click();
  await page.locator('#gm-review').fill('上头');
  await page.locator('#gm-save').click();
  await expect(page.locator('#gm-edit-wrap')).not.toHaveClass(/open/);
  expect(calls.find((c) => c.op === 'game.add')).toMatchObject({ title: '绝区零', status: 'playing', rating: 3, platform: 'Android', device_id: 2, review: '上头', private: false });
  expect(calls.some((c) => c.photo)).toBe(false);
  const card = page.locator('#gm-list .it-card').last();
  await expect(card.locator('.it-sub')).toHaveText('Android · Galaxy S25 Ultra');
  await expect(card.locator('.it-status')).toHaveText('在玩');
});

test('留言板：右圆进 /guestbook/，长条只有页名，卡片里插入共用 Giscus（specific term=guestbook、输入框在上、跟浅色）；英文页 lang=en', async ({ page }) => {
  await mock(page, false);
  const giscus = [];
  await page.route('https://giscus.app/**', (r) => { giscus.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  await page.goto('/');
  await page.locator('.sgx-topbar .sgx-tb-end').click();
  await expect(page).toHaveURL(/\/guestbook\/$/);
  await expect(page.locator('.sgx-tb-pill .sgx-tb-title')).toHaveText('留言板');
  await expect(page.locator('.sgx-tb-pill .sgx-seg')).toHaveCount(0);
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.cu-gb-card')).toBeVisible();
  const s = page.locator('[data-giscus] script[src="https://giscus.app/client.js"]');
  await expect(s).toHaveCount(1);
  for (const [k, v] of [['data-repo', 'styrigx/styrigx'], ['data-repo-id', 'R_kgDOVDhNiA'], ['data-category', 'Announcements'], ['data-category-id', 'DIC_kwDOVDhNiM4DJVrs'],
    ['data-mapping', 'specific'], ['data-term', 'guestbook'], ['data-strict', '0'], ['data-reactions-enabled', '1'], ['data-input-position', 'top'], ['data-lang', 'zh-CN'], ['data-theme', 'light']]) {
    await expect(s, k).toHaveAttribute(k, v);
  }
  expect(giscus.length).toBeGreaterThan(0);
  await expect(page.locator('footer')).toHaveCount(0);
  /* 卡片不超出屏幕 */
  const box = await page.locator('.cu-gb-card').boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await page.goto('/en/guestbook/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.sgx-tb-pill .sgx-tb-title')).toHaveText('Guestbook');
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('href', '/en/guestbook/');
  await expect(page.locator('[data-giscus] script')).toHaveAttribute('data-lang', 'en');
});
