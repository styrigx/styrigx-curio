// workers/core/src/api/_lib.js
// 共享工具：JSON 响应、同源 / 同站检查。下划线开头：不是接口，只供其它接口 import（路由表见 src/routes.js）。

export const NO_STORE = 'private, no-store';

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE, ...extraHeaders },
  });
}

export function err(error, status = 400) {
  return json({ ok: false, error }, status);
}

export function methodNotAllowed(allowed) {
  return json({ ok: false, error: 'method' }, 405, { Allow: allowed });
}

/** 写操作必须同源：Origin 头的 host 等于请求 host（curio.styrigx.com） */
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (e) {
    return false;
  }
}

/**
 * 同站读请求：浏览器对同源 GET（fetch 或直接点链接下载）通常不带 Origin，只带 Sec-Fetch-Site。
 * 有 Origin 就按 Origin 判；没有就要求 Sec-Fetch-Site: same-origin。两样都没有（脚本直接调）一律拒绝。
 */
export function isSameSite(request) {
  if (request.headers.get('Origin')) return isSameOrigin(request);
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}
