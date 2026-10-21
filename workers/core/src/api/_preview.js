/**
 * @fileoverview 网址预览：抓网页，取标题、简介、图标网址。接口在 src/api/preview.js；图标缓存（src/api/icon.js）也用这里的地址检查。
 *
 * 安全：
 * - 只抓 http/https 公网地址：拒绝 IP 直连的内网/本机段、localhost、*.local/*.internal、styrigx.com 自己（防绕回网关）。
 * - 跳转手动跟，最多 3 次，每一跳都重新检查地址。
 * - 6 秒超时；只读前 256 KB；只解析 text/html。
 * - 不带任何 cookie / 凭证；返回的文字去控制字符并截断。
 */

export const PREVIEW_TIMEOUT_MS = 6000;
export const PREVIEW_MAX_BYTES = 262144;
const MAX_HOPS = 3;
const UA = 'Mozilla/5.0 (compatible; StyrigxCurio/1.0; +https://curio.styrigx.com)';

/**
 * 这个网址能不能抓。
 * @param {string} href
 */
export function previewAllowed(href) {
  let u;
  try {
    u = new URL(href);
  } catch (e) {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h || !h.includes('.')) return false; /* localhost、单段主机名 */
  if (/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h)) return false;
  if (h === 'styrigx.com' || h.endsWith('.styrigx.com')) return false;
  if (h.startsWith('[')) return false; /* IPv6 直连一律不抓 */
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}
function clean(s, max) {
  return decode(String(s || ''))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 把一个标签的属性读成对象（名字小写） */
function attrs(tag) {
  /** @type {Record<string,string>} */
  const out = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

/**
 * 从 HTML 里取标题、简介、图标。图标优先 apple-touch-icon（大），其次 icon，最后 /favicon.ico。
 * @param {string} html
 * @param {string} baseUrl  页面最终地址（相对图标按它补全）
 * @returns {{title:string, desc:string, icon:string}}
 */
export function parseHtmlMeta(html, baseUrl) {
  const head = html.slice(0, PREVIEW_MAX_BYTES);
  /** @type {Record<string,string>} */
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const k = (a.property || a.name || '').toLowerCase();
    if (k && a.content && !(k in meta)) meta[k] = a.content;
  }
  let touch = '';
  let icon = '';
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    if (!a.href) continue;
    if (!touch && rel.includes('apple-touch-icon')) touch = a.href;
    else if (!icon && rel.includes('icon')) icon = a.href;
  }
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = clean(meta['og:title'] || meta['twitter:title'] || (t ? t[1] : ''), 80);
  const desc = clean(meta['og:description'] || meta.description || meta['twitter:description'] || '', 160);
  let iconUrl = '';
  for (const cand of [touch, icon, '/favicon.ico']) {
    if (!cand || cand.startsWith('data:')) continue;
    try {
      const u = new URL(decode(cand), baseUrl);
      if (u.protocol === 'https:' || u.protocol === 'http:') { iconUrl = u.href.replace(/^http:/, 'https:'); break; }
    } catch (e) { /* 下一个 */ }
  }
  return { title, desc, icon: iconUrl };
}

/** 读前 max 字节的文本 */
async function readCapped(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
  }
  try { await reader.cancel(); } catch (e) { /* 已读完 */ }
  const buf = new Uint8Array(Math.min(n, max));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
    if (off >= buf.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/**
 * 抓网页取预览。
 * @param {string} href  已经 cleanUrl 过的网址
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ok:true, url:string, title:string, desc:string, icon:string} | {ok:false, error:string}>}
 */
export async function fetchPreview(href, fetchImpl = fetch) {
  let url = href;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PREVIEW_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!previewAllowed(url)) return { ok: false, error: 'blocked' };
      const res = await fetchImpl(url, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
        url = new URL(res.headers.get('Location') || '', url).href;
        try { await res.body?.cancel(); } catch (e) { /* 无所谓 */ }
        continue;
      }
      if (!res.ok) return { ok: false, error: 'http-' + res.status };
      const type = (res.headers.get('Content-Type') || '').toLowerCase();
      if (type && !type.includes('html')) {
        try { await res.body?.cancel(); } catch (e) { /* 无所谓 */ }
        return { ok: true, url, title: '', desc: '', icon: parseHtmlMeta('', url).icon };
      }
      const html = await readCapped(res, PREVIEW_MAX_BYTES);
      return { ok: true, url, ...parseHtmlMeta(html, url) };
    }
    return { ok: false, error: 'too-many-redirects' };
  } catch (e) {
    return { ok: false, error: ctl.signal.aborted ? 'timeout' : 'fetch' };
  } finally {
    clearTimeout(timer);
  }
}
