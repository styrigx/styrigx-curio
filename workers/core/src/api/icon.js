// workers/core/src/api/icon.js
// GET /api/icon?id=<收藏 id>  —— 收藏的小图标，缓存在 R2（R2_PHOTOS）。任何有效会话；访客只能取公开收藏的图标。
//
// 缓存 key：收藏自己填了图标网址 → icons/u/<sha256(图标网址) 前 24 位>；没填 → icons/h/<域名>（同一个网站的收藏共用一份）。
// 没缓存时现抓：自己填的图标网址，否则 https://<域名>/apple-touch-icon.png、/favicon.ico。
//   只抓公网地址（_preview.js 的 previewAllowed，每一跳都查），最多 3 次跳转，6 秒，最大 256 KB，只收图片。
// 都抓不到 → 存一个「没有」的标记（7 天内不再抓），回 404，前端显示首字母方块。
// 响应：200 图片，Cache-Control private, no-cache + ETag（R2 的 httpEtag）+ Vary: Cookie（_image.js）：
//   浏览器每次用前都回来验会话，图标没变回 304（不重传）；会话失效 / 收藏改私密后本地副本不会再被直接拿出来用。
import { err, methodNotAllowed } from './_lib.js';
import { sessionRole } from './_auth.js';
import { idParam } from './_write.js';
import { previewAllowed } from './_preview.js';
import { etagMatches, imageResponse, notModified, r2Etag } from './_image.js';

export const ICON_MAX_BYTES = 262144;
export const MISS_TTL_MS = 7 * 24 * 3600e3;
const TIMEOUT_MS = 6000;
const UA = 'Mozilla/5.0 (compatible; StyrigxCurio/1.0; +https://curio.styrigx.com)';

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 缓存 key 和要试的地址 */
export async function iconPlan(link) {
  if (link.icon) return { key: 'icons/u/' + (await sha(link.icon)).slice(0, 24), urls: [link.icon] };
  let host = '';
  try { host = new URL(link.url).hostname.toLowerCase(); } catch (e) { /* 坏网址 */ }
  if (!host) return { key: '', urls: [] };
  return { key: 'icons/h/' + host, urls: ['https://' + host + '/apple-touch-icon.png', 'https://' + host + '/favicon.ico'] };
}

/** 像不像图片：看 Content-Type，.ico 常被标成 octet-stream，再看头几个字节 */
export function isImage(type, bytes) {
  const t = String(type || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  const b = bytes || new Uint8Array(0);
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return true; /* ICO */
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; /* PNG */
  if (b[0] === 0xff && b[1] === 0xd8) return true; /* JPEG */
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true; /* GIF */
  return false;
}

/** 抓一个图标；返回 {bytes, type} 或 null */
export async function fetchIcon(href, fetchImpl = fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let url = href;
  try {
    for (let hop = 0; hop <= 3; hop++) {
      if (!previewAllowed(url)) return null;
      const res = await fetchImpl(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.5' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
        url = new URL(res.headers.get('Location') || '', url).href;
        continue;
      }
      if (!res.ok) return null;
      const len = Number(res.headers.get('Content-Length') || 0);
      if (len > ICON_MAX_BYTES) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > ICON_MAX_BYTES) return null;
      const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!isImage(type, bytes)) return null;
      /* SVG 可能带脚本，不要 */
      if (type.includes('svg')) return null;
      return { bytes, type: type.startsWith('image/') ? type : 'image/x-icon' };
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* 抓来的是别人网站的图：再加一道 CSP，万一被当文档打开也跑不了脚本 */
function image(bytes, type, etag) {
  return imageResponse(bytes, type, etag, { 'Content-Security-Policy': "default-src 'none'" });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const role = await sessionRole(context);
  if (!role) return err('unauthorized', 401);
  const id = idParam(request);
  if (!id) return err('bad-id', 400);
  const db = env && env.D1_FINDS;
  const r2 = env && env.R2_PHOTOS;
  if (!db || !r2) return err('server', 503);
  const link = await db
    .prepare('SELECT l.url, l.icon, l.private AS lp, c.private AS cp FROM links l LEFT JOIN cats c ON c.id = l.cat_id WHERE l.id = ?1')
    .bind(id)
    .first();
  if (!link || (role !== 'admin' && (link.lp || link.cp))) return err('not-found', 404);
  const plan = await iconPlan(link);
  if (!plan.key) return err('not-found', 404);

  const hit = await r2.get(plan.key);
  if (hit) {
    const miss = hit.customMetadata && hit.customMetadata.miss;
    if (!miss) {
      /* 会话（index.js）和可见性（上面）都过了才看缓存 */
      const etag = r2Etag(hit);
      if (etagMatches(request, etag)) {
        if (hit.body && typeof hit.body.cancel === 'function') hit.body.cancel().catch(() => {});
        return notModified(etag);
      }
      return image(hit.body, (hit.httpMetadata && hit.httpMetadata.contentType) || 'image/x-icon', etag);
    }
    if (Date.now() - Number(miss) < MISS_TTL_MS) return err('no-icon', 404);
  }
  for (const u of plan.urls) {
    const got = await fetchIcon(u, context.fetchImpl);
    if (got) {
      const put = await r2.put(plan.key, got.bytes, { httpMetadata: { contentType: got.type } });
      return image(got.bytes, got.type, r2Etag(put));
    }
  }
  await r2.put(plan.key, '', { customMetadata: { miss: String(Date.now()) } });
  return err('no-icon', 404);
}

export function onRequest() {
  return methodNotAllowed('GET');
}
