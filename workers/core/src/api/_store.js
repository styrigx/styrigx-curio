// workers/core/src/api/_store.js
// 奇趣的数据层：表结构、校验、读写。下划线开头：不是接口（路由表见 src/routes.js）。
//
// 表（D1 styrigx-curio，迁移 migrations/0001_init.sql，代码里的 CREATE TABLE IF NOT EXISTS 只兜底全新的库）：
//   cats    分类：id、中英文名、是否私密、排序
//   links   收藏：id、所属分类、网址、中英文名、中英文简介、图标网址、是否私密、排序、时间
//   imports 导入记录：每次导入的原始文件存在 R2（imports/<时间>-<哈希>.html），这里记 key 和结果
//
// 中英文：名字 / 简介各两份；一种留空时前端显示另一种，所以只填一种也行。
// 私密：分类或收藏任一私密，访客就看不到这条（管理员全看得到）。从浏览器导入的默认私密。

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name_zh TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '', private INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY AUTOINCREMENT, cat_id INTEGER NOT NULL, url TEXT NOT NULL, name_zh TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '', desc_zh TEXT NOT NULL DEFAULT '', desc_en TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', private INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
  'CREATE INDEX IF NOT EXISTS links_cat ON links (cat_id, pos)',
  'CREATE INDEX IF NOT EXISTS links_url ON links (url)',
  "CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY AUTOINCREMENT, r2_key TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, cats_added INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0)",
];

/** 上限：分类 200、收藏 5000、名字 80 字、简介 160 字、网址 2048 字符 */
export const LIMITS = { cats: 200, links: 5000, name: 80, desc: 160, url: 2048 };

/** 去控制字符、去首尾空白、截断 */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

/**
 * 只收 http/https、不带账号密码的网址；返回规整后的字符串，不合格返回 ''。
 * @param {unknown} v
 */
export function cleanUrl(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > LIMITS.url) return '';
  let u;
  try {
    u = new URL(s);
  } catch (e) {
    return '';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  if (u.username || u.password) return '';
  return u.href;
}

/** 图标网址：只收 https，或空 */
export function cleanIcon(v) {
  const u = cleanUrl(v);
  return u.startsWith('https://') ? u : '';
}

/**
 * {zh,en} 双语字段；required 时至少一种非空。
 * @param {any} v
 * @param {number} max
 * @param {boolean} required
 * @returns {{zh:string,en:string}|null}
 */
export function cleanPair(v, max, required) {
  if (typeof v === 'string') v = { zh: v, en: '' };
  if (!v || typeof v !== 'object') return required ? null : { zh: '', en: '' };
  const zh = cleanText(v.zh, max);
  const en = cleanText(v.en, max);
  if (required && !zh && !en) return null;
  return { zh, en };
}

export function posInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : 0;
}

function idList(v, max) {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const ids = v.map(posInt);
  if (ids.some((n) => !n) || new Set(ids).size !== ids.length) return null;
  return ids;
}

const bool = (v) => (v === true || v === 1 ? 1 : 0);

/**
 * 校验写操作，返回规整后的操作或 {error}。
 *   cat.add    {name:{zh,en}, private?}
 *   cat.edit   {id, name?, private?}
 *   cat.del    {id}                 分类里还有收藏 → not-empty
 *   cat.order  {ids:[...]}          全部分类的新顺序
 *   link.add   {cat, url, name, desc?, icon?, private?}
 *   link.edit  {id, cat?, url?, name?, desc?, icon?, private?}   只改给了的字段
 *   link.del   {id}
 *   link.order {cat, ids:[...]}     这个分类里全部收藏的新顺序
 * @param {any} b
 */
export function parseOp(b) {
  if (!b || typeof b !== 'object' || typeof b.op !== 'string') return { error: 'bad-op' };
  const L = LIMITS;
  switch (b.op) {
    case 'cat.add': {
      const name = cleanPair(b.name, L.name, true);
      return name ? { op: b.op, name, private: bool(b.private) } : { error: 'bad-name' };
    }
    case 'cat.edit': {
      const id = posInt(b.id);
      if (!id) return { error: 'bad-id' };
      /** @type {any} */
      const out = { op: b.op, id };
      if (b.name !== undefined) { out.name = cleanPair(b.name, L.name, true); if (!out.name) return { error: 'bad-name' }; }
      if (b.private !== undefined) out.private = bool(b.private);
      return Object.keys(out).length === 2 ? { error: 'nothing' } : out;
    }
    case 'cat.del':
    case 'link.del': {
      const id = posInt(b.id);
      return id ? { op: b.op, id } : { error: 'bad-id' };
    }
    case 'cat.order': {
      const ids = idList(b.ids, L.cats);
      return ids ? { op: b.op, ids } : { error: 'bad-ids' };
    }
    case 'link.order': {
      const cat = posInt(b.cat);
      const ids = idList(b.ids, L.links);
      if (!cat) return { error: 'bad-cat' };
      return ids ? { op: b.op, cat, ids } : { error: 'bad-ids' };
    }
    case 'link.add': {
      const cat = posInt(b.cat);
      const url = cleanUrl(b.url);
      const name = cleanPair(b.name, L.name, true);
      if (!cat) return { error: 'bad-cat' };
      if (!url) return { error: 'bad-url' };
      if (!name) return { error: 'bad-name' };
      return { op: b.op, cat, url, name, desc: cleanPair(b.desc, L.desc, false), icon: cleanIcon(b.icon), private: bool(b.private) };
    }
    case 'link.edit': {
      const id = posInt(b.id);
      if (!id) return { error: 'bad-id' };
      /** @type {any} */
      const out = { op: b.op, id };
      if (b.cat !== undefined) { out.cat = posInt(b.cat); if (!out.cat) return { error: 'bad-cat' }; }
      if (b.url !== undefined) { out.url = cleanUrl(b.url); if (!out.url) return { error: 'bad-url' }; }
      if (b.name !== undefined) { out.name = cleanPair(b.name, L.name, true); if (!out.name) return { error: 'bad-name' }; }
      if (b.desc !== undefined) out.desc = cleanPair(b.desc, L.desc, false);
      if (b.icon !== undefined) out.icon = cleanIcon(b.icon);
      if (b.private !== undefined) out.private = bool(b.private);
      if (Object.keys(out).length === 2) return { error: 'nothing' };
      return out;
    }
    default:
      return { error: 'bad-op' };
  }
}

/** 同一个 Worker 实例里建过表就不再建（每个 db 对象记一次） */
const schemaDone = new WeakSet();

/** 建表（幂等） */
export async function ensureSchema(db) {
  if (schemaDone.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaDone.add(db);
}

/**
 * 读全部收藏，组成 [{id, name:{zh,en}, private, links:[{id,url,name,desc,icon,private}]}]。
 * admin=false（访客）：私密分类整个不给，私密收藏不给，空分类不给。
 * @param {any} db
 * @param {boolean} admin
 */
export async function listAll(db, admin) {
  const [cats, links] = await db.batch([
    db.prepare('SELECT id, name_zh, name_en, private FROM cats ORDER BY pos, id'),
    db.prepare('SELECT id, cat_id, url, name_zh, name_en, desc_zh, desc_en, icon, private FROM links ORDER BY pos, id'),
  ]);
  /** @type {Map<number, any>} */
  const byId = new Map();
  const out = [];
  for (const r of cats.results || []) {
    if (!admin && r.private) continue;
    const c = { id: r.id, name: { zh: r.name_zh, en: r.name_en }, private: !!r.private, links: [] };
    byId.set(r.id, c);
    out.push(c);
  }
  for (const r of links.results || []) {
    if (!admin && r.private) continue;
    const c = byId.get(r.cat_id);
    if (!c) continue;
    c.links.push({ id: r.id, url: r.url, name: { zh: r.name_zh, en: r.name_en }, desc: { zh: r.desc_zh, en: r.desc_en }, icon: r.icon, private: !!r.private });
  }
  return admin ? out : out.filter((c) => c.links.length > 0);
}

export async function one(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

/**
 * 执行一个已校验的写操作。返回 null 表示成功，否则返回错误码（not-found / not-empty / limit / mismatch / duplicate）。
 * @param {any} db
 * @param {any} o  parseOp 的结果
 * @param {number} [now]
 */
export async function applyOp(db, o, now = Date.now()) {
  switch (o.op) {
    case 'cat.add': {
      const n = await one(db, 'SELECT COUNT(*) AS n, COALESCE(MAX(pos), -1) AS p FROM cats');
      if (n && n.n >= LIMITS.cats) return 'limit';
      await db.prepare('INSERT INTO cats (name_zh, name_en, private, pos, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(o.name.zh, o.name.en, o.private, (n ? n.p : -1) + 1, now).run();
      return null;
    }
    case 'cat.edit': {
      const sets = [];
      const args = [];
      const add = (col, v) => { args.push(v); sets.push(col + ' = ?' + args.length); };
      if (o.name) { add('name_zh', o.name.zh); add('name_en', o.name.en); }
      if (o.private !== undefined) add('private', o.private);
      args.push(o.id);
      const r = await db.prepare('UPDATE cats SET ' + sets.join(', ') + ' WHERE id = ?' + args.length).bind(...args).run();
      return r.meta && r.meta.changes ? null : 'not-found';
    }
    case 'cat.del': {
      const used = await one(db, 'SELECT COUNT(*) AS n FROM links WHERE cat_id = ?1', o.id);
      if (used && used.n > 0) return 'not-empty';
      const r = await db.prepare('DELETE FROM cats WHERE id = ?1').bind(o.id).run();
      return r.meta && r.meta.changes ? null : 'not-found';
    }
    case 'cat.order': {
      const all = await db.prepare('SELECT id FROM cats').all();
      const have = new Set((all.results || []).map((r) => r.id));
      if (have.size !== o.ids.length || o.ids.some((id) => !have.has(id))) return 'mismatch';
      await db.batch(o.ids.map((id, i) => db.prepare('UPDATE cats SET pos = ?1 WHERE id = ?2').bind(i, id)));
      return null;
    }
    case 'link.add': {
      const cat = await one(db, 'SELECT id FROM cats WHERE id = ?1', o.cat);
      if (!cat) return 'not-found';
      const n = await one(db, 'SELECT COUNT(*) AS n FROM links');
      if (n && n.n >= LIMITS.links) return 'limit';
      const dup = await one(db, 'SELECT id FROM links WHERE url = ?1', o.url);
      if (dup) return 'duplicate';
      const p = await one(db, 'SELECT COALESCE(MAX(pos), -1) AS p FROM links WHERE cat_id = ?1', o.cat);
      await db
        .prepare('INSERT INTO links (cat_id, url, name_zh, name_en, desc_zh, desc_en, icon, private, pos, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)')
        .bind(o.cat, o.url, o.name.zh, o.name.en, o.desc.zh, o.desc.en, o.icon, o.private, (p ? p.p : -1) + 1, now)
        .run();
      return null;
    }
    case 'link.edit': {
      const cur = await one(db, 'SELECT id, cat_id FROM links WHERE id = ?1', o.id);
      if (!cur) return 'not-found';
      const sets = [];
      const args = [];
      const add = (col, v) => { args.push(v); sets.push(col + ' = ?' + args.length); };
      if (o.cat && o.cat !== cur.cat_id) {
        const cat = await one(db, 'SELECT id FROM cats WHERE id = ?1', o.cat);
        if (!cat) return 'not-found';
        const p = await one(db, 'SELECT COALESCE(MAX(pos), -1) AS p FROM links WHERE cat_id = ?1', o.cat);
        add('cat_id', o.cat);
        add('pos', (p ? p.p : -1) + 1); /* 换分类 → 排到新分类最后 */
      }
      if (o.url) {
        const dup = await one(db, 'SELECT id FROM links WHERE url = ?1 AND id != ?2', o.url, o.id);
        if (dup) return 'duplicate';
        add('url', o.url);
      }
      if (o.name) { add('name_zh', o.name.zh); add('name_en', o.name.en); }
      if (o.desc) { add('desc_zh', o.desc.zh); add('desc_en', o.desc.en); }
      if (o.icon !== undefined) add('icon', o.icon);
      if (o.private !== undefined) add('private', o.private);
      add('updated_at', now);
      args.push(o.id);
      await db.prepare('UPDATE links SET ' + sets.join(', ') + ' WHERE id = ?' + args.length).bind(...args).run();
      return null;
    }
    case 'link.del': {
      const r = await db.prepare('DELETE FROM links WHERE id = ?1').bind(o.id).run();
      return r.meta && r.meta.changes ? null : 'not-found';
    }
    case 'link.order': {
      const all = await db.prepare('SELECT id FROM links WHERE cat_id = ?1').bind(o.cat).all();
      const have = new Set((all.results || []).map((r) => r.id));
      if (have.size !== o.ids.length || o.ids.some((id) => !have.has(id))) return 'mismatch';
      await db.batch(o.ids.map((id, i) => db.prepare('UPDATE links SET pos = ?1 WHERE id = ?2').bind(i, id)));
      return null;
    }
    default:
      return 'bad-op';
  }
}
