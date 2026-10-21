// workers/core/src/api/_netscape.js
// 浏览器书签文件（Netscape Bookmark File，Chrome / Edge / 三星浏览器 / Firefox / Safari 导出的 .html）的解析和生成。
// 下划线开头：不是接口。导入在 src/api/import.js，导出在 src/api/export.js。
//
// 解析规则：
// - 文件夹（<H3>）一层层往下，路径用「 / 」连起来当分类名（最长 80 字）；
// - 浏览器自带的根文件夹（书签栏、其他书签、移动设备书签……）不算进路径；直接放在根上的收藏归「未归类」；
// - 只收 http / https、不带账号密码的网址；同一个文件里重复的网址只留第一个；
// - 标题去控制字符、解码 HTML 实体，空标题用域名。
import { cleanUrl, cleanText, LIMITS } from './_store.js';

/** 浏览器自带的根文件夹名（小写比较） */
const ROOTS = new Set([
  'bookmarks bar', 'bookmarks toolbar', 'favorites bar', 'other bookmarks', 'mobile bookmarks', 'bookmarks menu', 'bookmarks', 'favorites',
  '书签栏', '书签工具栏', '收藏夹栏', '其他书签', '其他收藏夹', '移动设备书签', '移动书签', '书签菜单', '书签', '收藏夹',
  '書籤列', '其他書籤', '行動裝置書籤', '書籤',
]);
export const UNSORTED = { zh: '未归类', en: 'Unsorted' };

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

function attrs(tag) {
  /** @type {Record<string,string>} */
  const out = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

const text = (s, max) => cleanText(decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' '), max);

/** 这个文件看起来是不是浏览器书签文件 */
export function looksLikeBookmarks(html) {
  const head = String(html).slice(0, 4096).toLowerCase();
  return head.includes('netscape-bookmark-file') || (/<dl\b/.test(String(html).slice(0, 65536).toLowerCase()) && /<a\s[^>]*href=/i.test(html));
}

/**
 * 解析书签文件。
 * @param {string} html
 * @returns {{items:{cat:string, url:string, title:string, added:number}[], found:number, dupes:number, invalid:number}}
 *   cat 为 '' 表示放在根上（归「未归类」）；added 是毫秒时间戳（文件没写就是 0）
 */
export function parseBookmarks(html) {
  const src = String(html || '');
  /** @type {string[]} */
  const stack = [];
  let pending = null; /* 刚读到的 <H3>，等下一个 <DL> 才进去 */
  const items = [];
  const seen = new Set();
  let found = 0;
  let dupes = 0;
  let invalid = 0;
  const tagRe = /<h3\b([^>]*)>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl\s*>/gi;
  let m;
  while ((m = tagRe.exec(src))) {
    const t = m[0].slice(0, 4).toLowerCase();
    if (t.startsWith('<h3')) {
      const a = attrs(m[1] || '');
      const name = text(m[2] || '', LIMITS.name);
      const root = a.personal_toolbar_folder === 'true' || a.unfiled_bookmarks_folder === 'true' || ROOTS.has(name.toLowerCase());
      pending = root && stack.every((s) => s === null) ? null : name || '…';
      continue;
    }
    if (t.startsWith('<a')) {
      found++;
      const a = attrs(m[3] || '');
      const url = cleanUrl(decodeEntities(a.href || ''));
      if (!url) { invalid++; continue; }
      if (seen.has(url)) { dupes++; continue; }
      seen.add(url);
      let title = text(m[4] || '', LIMITS.name);
      if (!title) { try { title = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { title = url.slice(0, LIMITS.name); } }
      const ts = Number(a.add_date || 0);
      const cat = stack.filter((s) => s !== null).join(' / ').slice(0, LIMITS.name);
      items.push({ cat, url, title, added: Number.isFinite(ts) && ts > 0 ? (ts > 1e11 ? Math.floor(ts / 1000) : ts * 1000) : 0 });
      continue;
    }
    if (t.startsWith('<dl')) {
      /* 根 <DL>（还没读到任何 <H3>）和根文件夹都记 null：不算进分类路径 */
      stack.push(pending);
      pending = null;
      continue;
    }
    /* </DL> */
    stack.pop();
    pending = null;
  }
  return { items, found, dupes, invalid };
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * 生成书签文件（浏览器都能导入）。分类 → 一层文件夹；名字优先用 lang 那种，另一种兜底。
 * @param {{name:{zh:string,en:string}, links:{url:string,name:{zh:string,en:string},desc?:{zh:string,en:string},created_at?:number}[]}[]} cats
 * @param {'zh'|'en'} [lang]
 * @param {number} [now]
 */
export function renderBookmarks(cats, lang = 'zh', now = Date.now()) {
  const other = lang === 'zh' ? 'en' : 'zh';
  const pick = (p) => (p && (p[lang] || p[other])) || '';
  const sec = (ms) => Math.floor((ms || now) / 1000);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. Exported from Curio (curio.styrigx.com). -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  for (const c of cats) {
    lines.push('    <DT><H3 ADD_DATE="' + sec(now) + '">' + escHtml(pick(c.name)) + '</H3>');
    lines.push('    <DL><p>');
    for (const l of c.links) {
      lines.push('        <DT><A HREF="' + escHtml(l.url) + '" ADD_DATE="' + sec(l.created_at) + '">' + escHtml(pick(l.name) || l.url) + '</A>');
      const d = pick(l.desc);
      if (d) lines.push('        <DD>' + escHtml(d));
    }
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>', '');
  return lines.join('\n');
}
