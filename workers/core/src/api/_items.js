// workers/core/src/api/_items.js
// 奇趣「设备」「游戏」两栏的数据层：表结构、校验、读写。下划线开头：不是接口（路由表见 src/routes.js）。
//
// 表（D1 styrigx-curio，迁移 migrations/0003_devices_games.sql；ITEM_SCHEMA 只兜底全新的库，两边一致，测试核对）：
//   devices  设备：名字、类型、购买 / 退役日期、换成了哪台（replaced_by）、系统版本、参数、配件、体验、照片（R2 key）、私密、排序
//   games    游戏：名字、平台、关联设备（device_id，可空）、版本、状态（想玩 / 在玩 / 通关 / 搁置）、评分 0–5、评价、封面（R2 key）、私密、排序
// 只存一种语言（主人自己写的话），不像收藏那样分中英文。
// 私密：访客看不到私密的条目；游戏关联的设备是私密的，访客拿到的游戏里 device_id 置 0（不泄露那台设备）。
// 照片的上传 / 读取 / 删除在 src/api/photo.js；删条目时顺手删 R2 里的照片（applyItemOp 返回 {removed} 交给调用方删）。

export const ITEM_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other', bought_at TEXT NOT NULL DEFAULT '', retired_at TEXT NOT NULL DEFAULT '', replaced_by INTEGER NOT NULL DEFAULT 0, os TEXT NOT NULL DEFAULT '', specs TEXT NOT NULL DEFAULT '', accessories TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', photo TEXT NOT NULL DEFAULT '', private INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, platform TEXT NOT NULL DEFAULT '', device_id INTEGER NOT NULL DEFAULT 0, edition TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'want', rating INTEGER NOT NULL DEFAULT 0, review TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', private INTEGER NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
  'CREATE INDEX IF NOT EXISTS games_status ON games (status, pos)',
];

export const DEVICE_KINDS = ['phone', 'tablet', 'laptop', 'desktop', 'watch', 'audio', 'console', 'camera', 'other'];
export const GAME_STATUS = ['want', 'playing', 'done', 'shelved'];

/** 上限：设备 500、游戏 2000；名字 80 字；短字段 120 字；长文本（参数 / 配件 / 体验 / 评价）4000 字 */
export const ITEM_LIMITS = { devices: 500, games: 2000, name: 80, short: 120, long: 4000 };

/** 单行：去控制字符（含换行）、去首尾空白、截断 */
function line(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
/** 多行：留换行（统一成 \n），去其它控制字符，截断 */
function text(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
/** 'YYYY-MM-DD' 且是真实日期，或空串；不合格返回 null */
export function cleanDate(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const y = Number(v.slice(0, 4));
  return y >= 1970 && y <= 2100 ? v : null;
}
function posInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : 0;
}
/** 0 或正整数（「不关联」= 0）；不合格返回 -1 */
function refId(v) {
  if (v === undefined || v === null || v === 0 || v === '0' || v === '') return 0;
  return posInt(v) || -1;
}
const bool = (v) => (v === true || v === 1 ? 1 : 0);

function idList(v, max) {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const ids = v.map(posInt);
  if (ids.some((n) => !n) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/** 字段规则：[列名, 清洗函数, 错误码]；清洗返回 null 视为不合格 */
const L = ITEM_LIMITS;
const DEVICE_FIELDS = {
  name: (v) => line(v, L.name) || null,
  kind: (v) => (DEVICE_KINDS.includes(v) ? v : null),
  bought_at: cleanDate,
  retired_at: cleanDate,
  replaced_by: (v) => { const n = refId(v); return n < 0 ? null : n; },
  os: (v) => line(v, L.short),
  specs: (v) => text(v, L.long),
  accessories: (v) => text(v, L.long),
  notes: (v) => text(v, L.long),
  private: bool,
};
const GAME_FIELDS = {
  title: (v) => line(v, L.name) || null,
  platform: (v) => line(v, L.short),
  device_id: (v) => { const n = refId(v); return n < 0 ? null : n; },
  edition: (v) => line(v, L.short),
  status: (v) => (GAME_STATUS.includes(v) ? v : null),
  rating: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null; },
  review: (v) => text(v, L.long),
  private: bool,
};
const DEFAULTS = {
  device: { kind: 'other', bought_at: '', retired_at: '', replaced_by: 0, os: '', specs: '', accessories: '', notes: '', private: 0 },
  game: { platform: '', device_id: 0, edition: '', status: 'want', rating: 0, review: '', private: 0 },
};
export const KINDS = {
  device: { table: 'devices', fields: DEVICE_FIELDS, required: 'name', photo: 'photo', limit: L.devices },
  game: { table: 'games', fields: GAME_FIELDS, required: 'title', photo: 'cover', limit: L.games },
};

/**
 * 校验写操作，返回规整后的操作或 {error}。kind = 'device' | 'game'。
 *   <kind>.add   {字段...}       名字（device: name / game: title）必填，其余缺省
 *   <kind>.edit  {id, 字段...}   只改给了的字段
 *   <kind>.del   {id}
 *   <kind>.order {ids:[...]}     全部条目的新顺序
 * @param {'device'|'game'} kind
 * @param {any} b
 */
export function parseItemOp(kind, b) {
  const K = KINDS[kind];
  if (!K || !b || typeof b !== 'object' || typeof b.op !== 'string') return { error: 'bad-op' };
  const [k, verb] = b.op.split('.');
  if (k !== kind) return { error: 'bad-op' };
  const take = (all) => {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [col, fn] of Object.entries(K.fields)) {
      if (b[col] === undefined) { if (all && col !== K.required) out[col] = DEFAULTS[kind][col]; continue; }
      const v = fn(b[col]);
      if (v === null) return { error: 'bad-' + col.replace(/_/g, '-') };
      out[col] = v;
    }
    return { fields: out };
  };
  switch (verb) {
    case 'add': {
      if (b[K.required] === undefined) return { error: 'bad-' + K.required };
      const r = take(true);
      return 'error' in r ? r : { op: b.op, kind, fields: r.fields };
    }
    case 'edit': {
      const id = posInt(b.id);
      if (!id) return { error: 'bad-id' };
      const r = take(false);
      if ('error' in r) return r;
      if (!Object.keys(r.fields).length) return { error: 'nothing' };
      if (kind === 'device' && r.fields.replaced_by === id) return { error: 'bad-replaced-by' };
      return { op: b.op, kind, id, fields: r.fields };
    }
    case 'del': {
      const id = posInt(b.id);
      return id ? { op: b.op, kind, id } : { error: 'bad-id' };
    }
    case 'order': {
      const ids = idList(b.ids, K.limit);
      return ids ? { op: b.op, kind, ids } : { error: 'bad-ids' };
    }
    default:
      return { error: 'bad-op' };
  }
}

const schemaDone = new WeakSet();
/** 建表（幂等） */
export async function ensureItemSchema(db) {
  if (schemaDone.has(db)) return;
  await db.batch(ITEM_SCHEMA.map((s) => db.prepare(s)));
  schemaDone.add(db);
}

function rowDevice(r) {
  return {
    id: r.id, name: r.name, kind: r.kind, bought_at: r.bought_at, retired_at: r.retired_at, replaced_by: r.replaced_by,
    os: r.os, specs: r.specs, accessories: r.accessories, notes: r.notes, photo: !!r.photo, private: !!r.private,
  };
}
function rowGame(r) {
  return {
    id: r.id, title: r.title, platform: r.platform, device_id: r.device_id, edition: r.edition, status: r.status,
    rating: r.rating, review: r.review, cover: !!r.cover, private: !!r.private,
  };
}

/**
 * 读设备和游戏：{devices:[...], games:[...]}（照片只给有没有，图走 /api/photo）。
 * owner=false（访客）：私密的不给；设备的 replaced_by、游戏的 device_id 指向访客看不到的设备时置 0。
 * @param {any} db
 * @param {boolean} owner
 */
export async function listItems(db, owner) {
  const [ds, gs] = await db.batch([
    db.prepare('SELECT * FROM devices ORDER BY pos, id'),
    db.prepare('SELECT * FROM games ORDER BY pos, id'),
  ]);
  const devices = (ds.results || []).filter((r) => owner || !r.private).map(rowDevice);
  const seen = new Set(devices.map((d) => d.id));
  for (const d of devices) if (d.replaced_by && !seen.has(d.replaced_by)) d.replaced_by = 0;
  const games = (gs.results || []).filter((r) => owner || !r.private).map(rowGame);
  for (const g of games) if (g.device_id && !seen.has(g.device_id)) g.device_id = 0;
  return { devices, games };
}

async function one(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

/**
 * 执行一个已校验的写操作。返回 {error} 或 {removed: [R2 key...]}（删条目时它的照片，交给调用方从 R2 删）。
 * 错误码：not-found / limit / mismatch。关联的设备（replaced_by / device_id）必须存在，否则 not-found。
 * 删设备时：别的设备 replaced_by 指向它、游戏 device_id 指向它的，都置 0。
 * @param {any} db
 * @param {any} o  parseItemOp 的结果
 * @param {number} [now]
 */
export async function applyItemOp(db, o, now = Date.now()) {
  const K = KINDS[o.kind];
  const T = K.table;
  const verb = o.op.split('.')[1];
  const refOk = async (f) => {
    const ref = o.kind === 'device' ? f.replaced_by : f.device_id;
    return !ref || !!(await one(db, 'SELECT id FROM devices WHERE id = ?1', ref));
  };
  switch (verb) {
    case 'add': {
      const n = await one(db, `SELECT COUNT(*) AS n, COALESCE(MAX(pos), -1) AS p FROM ${T}`);
      if (n && n.n >= K.limit) return { error: 'limit' };
      if (!(await refOk(o.fields))) return { error: 'not-found' };
      const cols = Object.keys(o.fields);
      const vals = cols.map((c) => o.fields[c]);
      cols.push('pos', 'created_at', 'updated_at');
      vals.push((n ? n.p : -1) + 1, now, now);
      const r = await db.prepare(`INSERT INTO ${T} (${cols.join(', ')}) VALUES (${cols.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...vals).run();
      return { removed: [], id: r.meta && r.meta.last_row_id };
    }
    case 'edit': {
      const cur = await one(db, `SELECT id FROM ${T} WHERE id = ?1`, o.id);
      if (!cur) return { error: 'not-found' };
      if (!(await refOk(o.fields))) return { error: 'not-found' };
      const cols = Object.keys(o.fields);
      const args = cols.map((c) => o.fields[c]);
      args.push(now, o.id);
      await db.prepare(`UPDATE ${T} SET ${cols.map((c, i) => c + ' = ?' + (i + 1)).join(', ')}, updated_at = ?${cols.length + 1} WHERE id = ?${cols.length + 2}`).bind(...args).run();
      return { removed: [] };
    }
    case 'del': {
      const cur = await one(db, `SELECT id, ${K.photo} AS photo FROM ${T} WHERE id = ?1`, o.id);
      if (!cur) return { error: 'not-found' };
      const stmts = [db.prepare(`DELETE FROM ${T} WHERE id = ?1`).bind(o.id)];
      if (o.kind === 'device') {
        stmts.push(db.prepare('UPDATE devices SET replaced_by = 0 WHERE replaced_by = ?1').bind(o.id));
        stmts.push(db.prepare('UPDATE games SET device_id = 0 WHERE device_id = ?1').bind(o.id));
      }
      await db.batch(stmts);
      return { removed: cur.photo ? [cur.photo] : [] };
    }
    case 'order': {
      const all = await db.prepare(`SELECT id FROM ${T}`).all();
      const have = new Set((all.results || []).map((r) => r.id));
      if (have.size !== o.ids.length || o.ids.some((id) => !have.has(id))) return { error: 'mismatch' };
      await db.batch(o.ids.map((id, i) => db.prepare(`UPDATE ${T} SET pos = ?1 WHERE id = ?2`).bind(i, id)));
      return { removed: [] };
    }
    default:
      return { error: 'bad-op' };
  }
}
