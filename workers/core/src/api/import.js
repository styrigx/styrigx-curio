// workers/core/src/api/import.js
// POST /api/import[?private=0]   body：浏览器导出的书签文件原文（.html，最多 8 MB）
//
// 只有主人；必须同源。步骤：
//   1. 先把原始文件原样存进 R2：imports/<UTC 时间>-<sha256 前 12 位>.html（存不进去就整个不导入：备份优先，书签不能再丢）
//   2. 解析（_netscape.js）：文件夹路径 → 分类名；已有同名分类就并进去，没有就新建
//   3. 网址已经收藏过的跳过（库里按网址去重；同一个文件里重复的也只留一个）
//   4. 一次性写入（json_each 批量插入，D1 免费版每次请求的查询数有上限，不能一条一条插）
//   5. imports 表记一笔
// 默认导入成私密（浏览器书签里什么都有）；?private=0 导入成公开。新建的分类也跟着这个设置。
// 返回 {ok:true, found, added, skipped, invalid, cats_added, backup:<R2 key>, owner:true, cats:[...]}
// 400 not-bookmarks（不是书签文件）/ empty（一条网址都没有）；409 limit（超出 5000 条，一条都不写）；413 too-large；503 backup（R2 不可用）
import { json, err, methodNotAllowed } from './_lib.js';
import { guardWrite } from './_write.js';
import { ensureSchema, listAll, LIMITS } from './_store.js';
import { parseBookmarks, looksLikeBookmarks, UNSORTED } from './_netscape.js';

export const MAX_IMPORT = 8 * 1024 * 1024;
const CHUNK = 500; /* 每条 INSERT 带的条数（json 参数远小于 D1 单值 2 MB 上限） */

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function backupKey(now, hash) {
  const t = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return 'imports/' + t + '-' + hash.slice(0, 12) + '.html';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await guardWrite(context);
  if (denied) return denied;
  const db = env && env.DB;
  const r2 = env && env.FILES;
  if (!db) return err('server', 503);
  if (!r2) return err('backup', 503);
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_IMPORT) return err('too-large', 413);
  const raw = await request.text();
  if (raw.length > MAX_IMPORT) return err('too-large', 413);
  if (!looksLikeBookmarks(raw)) return err('not-bookmarks', 400);
  const parsed = parseBookmarks(raw);
  if (!parsed.items.length) return err('empty', 400);
  const priv = new URL(request.url).searchParams.get('private') === '0' ? 0 : 1;
  const now = Date.now();

  /* 1. 备份原文 */
  const key = backupKey(now, await sha256hex(raw));
  try {
    await r2.put(key, raw, { httpMetadata: { contentType: 'text/html; charset=utf-8' }, customMetadata: { found: String(parsed.found) } });
  } catch (e) {
    console.error('[curio-import] r2 put failed');
    return err('backup', 503);
  }

  await ensureSchema(db);
  /* 2–3. 已有分类、已有网址 */
  const [catRows, urlRows, cnt] = await db.batch([
    db.prepare('SELECT id, name_zh, name_en FROM cats ORDER BY pos, id'),
    db.prepare('SELECT url FROM links'),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(pos), -1) AS p FROM cats'),
  ]);
  const have = new Set((urlRows.results || []).map((r) => r.url));
  const fresh = parsed.items.filter((it) => !have.has(it.url));
  const skipped = parsed.items.length - fresh.length;
  if ((urlRows.results || []).length + fresh.length > LIMITS.links) return err('limit', 409);

  /** @type {Map<string, number>} 分类名（中文名或英文名）→ id */
  const catId = new Map();
  for (const r of catRows.results || []) {
    if (r.name_zh && !catId.has(r.name_zh)) catId.set(r.name_zh, r.id);
    if (r.name_en && !catId.has(r.name_en)) catId.set(r.name_en, r.id);
  }
  const nameOf = (it) => it.cat || UNSORTED.zh;
  const newCats = [...new Set(fresh.map(nameOf))].filter((n) => !catId.has(n));
  const catCount = (cnt.results && cnt.results[0]) || { n: 0, p: -1 };
  if (catCount.n + newCats.length > LIMITS.cats) return err('limit', 409);

  /* 4. 写：先建分类，再读回 id，再批量插收藏 */
  if (newCats.length) {
    const rows = newCats.map((n, i) => ({ zh: n, en: n === UNSORTED.zh ? UNSORTED.en : '', p: catCount.p + 1 + i }));
    await db
      .prepare("INSERT INTO cats (name_zh, name_en, private, pos, created_at) SELECT json_extract(value, '$.zh'), json_extract(value, '$.en'), ?2, json_extract(value, '$.p'), ?3 FROM json_each(?1)")
      .bind(JSON.stringify(rows), priv, now)
      .run();
    const back = await db.prepare('SELECT id, name_zh FROM cats WHERE created_at = ?1').bind(now).all();
    for (const r of back.results || []) if (!catId.has(r.name_zh)) catId.set(r.name_zh, r.id);
  }
  const posBase = new Map();
  if (fresh.length) {
    const pos = await db.prepare('SELECT cat_id, MAX(pos) AS p FROM links GROUP BY cat_id').all();
    for (const r of pos.results || []) posBase.set(r.cat_id, r.p);
  }
  const rows = fresh.map((it) => {
    const c = catId.get(nameOf(it));
    const p = (posBase.has(c) ? posBase.get(c) : -1) + 1;
    posBase.set(c, p);
    return { c, u: it.url, n: it.title, p, t: it.added || now };
  });
  const stmts = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    stmts.push(
      db
        .prepare("INSERT INTO links (cat_id, url, name_zh, private, pos, created_at, updated_at) SELECT json_extract(value, '$.c'), json_extract(value, '$.u'), json_extract(value, '$.n'), ?2, json_extract(value, '$.p'), json_extract(value, '$.t'), ?3 FROM json_each(?1)")
        .bind(JSON.stringify(rows.slice(i, i + CHUNK)), priv, now)
    );
  }
  /* 5. 记录 */
  stmts.push(
    db.prepare('INSERT INTO imports (r2_key, bytes, found, added, skipped, cats_added, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(key, raw.length, parsed.found, rows.length, skipped + parsed.dupes, newCats.length, now)
  );
  await db.batch(stmts);
  return json({
    ok: true,
    found: parsed.found,
    added: rows.length,
    skipped: skipped + parsed.dupes,
    invalid: parsed.invalid,
    cats_added: newCats.length,
    backup: key,
    owner: true,
    cats: await listAll(db, true),
  });
}

export function onRequest() {
  return methodNotAllowed('POST');
}
