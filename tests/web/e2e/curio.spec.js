// 奇趣首页（手机）：接口用 page.route 假数据，不碰线上。
// - 顶栏：九宫格 · 搜索框 · 头像；抽屉同主站（字标 + 头像、分隔线、底栏搜索框），奇趣是当前项
// - 访客：没有「收藏」和「⋯」；格子点开新标签页；图标取不到显示首字母
// - 分类条筛选 + hash；搜索即时筛选，没结果有提示
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

test('访客：顶栏搜索框、抽屉同主站；没有收藏按钮和菜单；只看公开；图标取不到显示首字母', async ({ page }) => {
  await mock(page, false);
  await page.goto('/');
  await expect(page.locator('#cu-q')).toHaveAttribute('placeholder', '搜索奇趣');
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
  await page.locator('.sgx-tb-nav').click();
  await expect(page.locator('#sgx-drawer .sgx-drawer-item')).toHaveText(['首页', '奇趣', '日刻', '博客']);
  await expect(page.locator('#sgx-drawer [data-nav="curio"]')).toHaveAttribute('aria-current', 'page');
  /* 同主站：头部头像去主站账号页，导航项下一条分隔线，底栏搜索框去主站搜索 */
  await expect(page.locator('#sgx-drawer .sgx-drawer-me')).toHaveAttribute('href', 'https://styrigx.com/settings/account/');
  await expect(page.locator('#sgx-drawer hr.sgx-drawer-sep')).toHaveCount(1);
  await expect(page.locator('#sgx-drawer .sgx-drawer-search')).toHaveAttribute('href', 'https://styrigx.com/search/');
});

test('分类条筛选并写 hash；搜索即时筛选，清除复原，没结果有提示', async ({ page }) => {
  await mock(page, false);
  await page.goto('/');
  await expect(page.locator('.cu-chip')).toHaveText(['全部', '开发与云', '网络检测']);
  await page.locator('.cu-chip[data-cat="2"]').click();
  await expect(page).toHaveURL(/#c\/2$/);
  await expect(page.locator('.cu-tile')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.cu-chip[data-cat="2"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('.cu-chip[data-cat="0"]').click();
  await page.locator('#cu-q').fill('代码');
  await expect(page.locator('.cu-tile')).toHaveCount(1);
  await expect(page.locator('.cu-name')).toHaveText(['GitHub']);
  await page.locator('#cu-q').fill('zzz');
  await expect(page.locator('#cu-empty')).toHaveText('没有找到。');
  await page.locator('#cu-q-clear').click();
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

test('英文页：搜索提示、分类名用英文（英文空时退回中文）', async ({ page }) => {
  await mock(page, true);
  await page.goto('/en/');
  await expect(page.locator('#cu-q')).toHaveAttribute('placeholder', 'Search Curio');
  await expect(page.locator('.cu-chip')).toHaveText(['All', 'Dev & Cloud', 'Network Tests', '私房']);
  await expect(page.locator('.cu-tile[data-id="11"]')).toHaveAttribute('title', /^Code hosting · /);
  await expect(page.locator('.cu-tile .cu-desc')).toHaveCount(0);
  await expect(page.locator('#menu-export')).toHaveAttribute('href', '/api/export?lang=en');
});
