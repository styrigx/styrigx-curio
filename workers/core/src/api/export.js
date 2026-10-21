// workers/core/src/api/export.js
// GET /api/export[?lang=en]  —— 导出全部收藏为浏览器书签文件（Netscape HTML，Chrome / 三星浏览器都能导入）。
// 只有主人；必须同站（_lib.js 的 isSameSite：直接点链接下载时浏览器只带 Sec-Fetch-Site）。私密的也导出。
import { err, methodNotAllowed, isSameSite } from './_lib.js';
import { requireOwner } from './_auth.js';
import { ensureSchema } from './_store.js';
import { renderBookmarks } from './_netscape.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isSameSite(request)) return err('origin', 403);
  const { response } = await requireOwner(context);
  if (response) return response;
  const db = env && env.DB;
  if (!db) return err('server', 503);
  await ensureSchema(db);
  const [cats, links] = await db.batch([
    db.prepare('SELECT id, name_zh, name_en FROM cats ORDER BY pos, id'),
    db.prepare('SELECT cat_id, url, name_zh, name_en, desc_zh, desc_en, created_at FROM links ORDER BY pos, id'),
  ]);
  const byId = new Map();
  const out = [];
  for (const r of cats.results || []) {
    const c = { name: { zh: r.name_zh, en: r.name_en }, links: [] };
    byId.set(r.id, c);
    out.push(c);
  }
  for (const r of links.results || []) {
    const c = byId.get(r.cat_id);
    if (c) c.links.push({ url: r.url, name: { zh: r.name_zh, en: r.name_en }, desc: { zh: r.desc_zh, en: r.desc_en }, created_at: r.created_at });
  }
  const lang = new URL(request.url).searchParams.get('lang') === 'en' ? 'en' : 'zh';
  const now = Date.now();
  const day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(renderBookmarks(out, lang, now), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="curio-' + day + '.html"',
      'Cache-Control': 'private, no-store',
    },
  });
}

export function onRequest() {
  return methodNotAllowed('GET');
}
