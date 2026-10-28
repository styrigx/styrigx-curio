// workers/core/src/api/_image.js
// 图片响应共用（/api/photo、/api/icon）。下划线开头：不是接口。
//
// 图片一律要过会话（Sloan 2026-10-29「一律都得过验证」）：index.js 先问网关会话，handler 再按角色查可见性，
// 之后才轮到这里。缓存规则：
//   - Cache-Control: private, no-cache —— 只许浏览器自己存，CDN / 共享缓存不许存；
//     no-cache = 每次用之前都回来问一遍（带 If-None-Match），所以锁屏、会话过期、访客钥匙吊销、条目改私密之后，
//     浏览器里存着的图也不会再不经验证就拿出来用。
//   - 内容没变回 304（不带正文，图标 / 照片不用重传）；304 同样排在会话和可见性检查之后，没会话拿不到 304。
//   - Vary: Cookie —— 万一前面有哪层缓存不认 private，也不会把带会话的回答给别的 cookie 用。
// 不用 max-age：以前照片 max-age 一年、图标一周，期间浏览器直接用本地副本，不经任何会话检查。

export const IMAGE_CACHE = 'private, no-cache';

/** 图片和 304 共用的缓存相关头 */
function cacheHeaders(etag) {
  const h = { 'Cache-Control': IMAGE_CACHE, 'Vary': 'Cookie' };
  if (etag) h.ETag = etag;
  return h;
}

/** 请求的 If-None-Match 是否命中 etag（逗号分隔多个、弱比较、*） */
export function etagMatches(request, etag) {
  if (!etag) return false;
  const inm = request.headers.get('If-None-Match');
  if (!inm) return false;
  const bare = (t) => t.trim().replace(/^W\//, '');
  const want = bare(etag);
  return inm.split(',').some((t) => { const b = bare(t); return b === '*' || b === want; });
}

/** 304：只在会话、可见性都检查过之后调用 */
export function notModified(etag) {
  return new Response(null, { status: 304, headers: cacheHeaders(etag) });
}

/** 200 图片 */
export function imageResponse(body, type, etag, extra = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...cacheHeaders(etag), ...extra },
  });
}

/** 由字符串（R2 key 等）算强 ETag："<sha256 前 32 位>" */
export async function etagOf(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return '"' + [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('') + '"';
}

/** R2 对象自带的 httpEtag（已带引号）；没有返回 '' */
export function r2Etag(obj) {
  const t = obj && typeof obj.httpEtag === 'string' ? obj.httpEtag : '';
  return /^(W\/)?"[^"]*"$/.test(t) ? t : '';
}
