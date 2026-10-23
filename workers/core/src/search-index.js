/**
 * @fileoverview 全站搜索索引：奇趣自己把收藏、设备、游戏写进 KV styrigx-search-index 的 site:curio。
 *
 * 值的格式（与 styrigx-space 仓库 workers/search-index/src/rank.js 一致）：
 *   { site: 'curio', generated: ISO 时间, items: Item[] }
 *   Item = { id, type: 'item', lang: 'zh'|'en', title, subtitle?, text?, url, private?: true }
 *
 * 每条出两条：中文条目（lang zh，链到 /）和英文条目（lang en，链到 /en/）。
 *   - 发现（links）：title = 名字（缺这种语言就用另一种）；subtitle =「发现 · 分类名」/ "Finds · <cat>"；
 *     text = 简介（两种语言）+ 网址；url = 所在分类 #c/<分类 id>（本站没有单条收藏的深链）
 *   - 设备（devices）：title = 名字；subtitle =「设备 · 类型 · 系统」；text = 系统、参数、配件、体验；url = #devices
 *   - 游戏（games）：title = 名字；subtitle =「游戏 · 平台 · 状态」；text = 版本、评价；url = #games
 *   - text 最多 2000 字，只参与匹配，搜索 Worker 不回给前端
 *   - private：访客看不到的标 private:true，只给站长搜到。规则同 _store.js 的 listAll、_items.js 的 listItems：
 *     收藏是「分类或收藏任一私密」，设备 / 游戏看自己的 private
 *
 * 什么时候写：
 *   - 每次改内容的写接口（/api/links、/api/items、/api/import）成功后由 index.js 用 ctx.waitUntil 重建
 *   - Cron 每小时兜底重建一次（wrangler.toml [triggers]），首次部署后也靠它填上
 * 出错只打日志，不抛给调用方，绝不影响接口本身。
 */
import { ensureSchema } from './api/_store.js';
import { ensureItemSchema } from './api/_items.js';

export const SITE = 'curio';
export const KEY = 'site:' + SITE;
export const ORIGIN = 'https://curio.styrigx.com';
const TITLE_MAX = 80;
const TEXT_MAX = 2000;
/* KV 单值上限 25 MiB；留余量，超了就去掉 text（标题、副标题还能搜） */
const VALUE_MAX = 24 * 1024 * 1024;

/* 页签名、设备类型、游戏状态：和页面上一样（web/assets/js/curio-items.js 的 T） */
const L = {
  zh: {
    finds: '发现', devices: '设备', games: '游戏',
    kinds: { phone: '手机', tablet: '平板', laptop: '笔记本', desktop: '台式机', watch: '手表', audio: '耳机音箱', console: '游戏机', camera: '相机', other: '其他' },
    status: { want: '想玩', playing: '在玩', done: '通关', shelved: '搁置' },
  },
  en: {
    finds: 'Finds', devices: 'Devices', games: 'Games',
    kinds: { phone: 'Phone', tablet: 'Tablet', laptop: 'Laptop', desktop: 'Desktop', watch: 'Watch', audio: 'Audio', console: 'Console', camera: 'Camera', other: 'Other' },
    status: { want: 'Want to play', playing: 'Playing', done: 'Finished', shelved: 'On hold' },
  },
};
const LANGS = /** @type {const} */ (['zh', 'en']);

/** 截断到 n 个字（按码点，不切坏表情），超了加省略号；换行压成空格 */
export function clip(s, n) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : flat;
}

/** 双语字段取一种：这种语言空着就用另一种（同前端） */
function pick(zh, en, lang) {
  const a = String((lang === 'en' ? en : zh) || '').trim();
  return a || String((lang === 'en' ? zh : en) || '').trim();
}

/** 首页（中文 /，英文 /en/）+ hash */
export function pageUrl(lang, hash) {
  return ORIGIN + (lang === 'en' ? '/en/' : '/') + (hash || '');
}

/** @param {Record<string, any>} it @param {string} subtitle @param {string[]} parts @param {boolean} priv */
function finish(it, subtitle, parts, priv) {
  if (subtitle) it.subtitle = subtitle;
  const text = parts.map((p) => String(p || '').trim()).filter(Boolean).join('\n').slice(0, TEXT_MAX);
  if (text) it.text = text;
  if (priv) it.private = true;
  return it;
}

/**
 * 一条收藏 → 两条索引。r 是 links 表的行，cat 是 cats 表的行（可能 undefined：分类已不在）。
 * @param {Record<string, any>} r @param {Record<string, any>|undefined} cat
 */
export function linkItems(r, cat) {
  const priv = !!r.private || !cat || !!cat.private;
  const out = [];
  for (const lang of LANGS) {
    const title = clip(pick(r.name_zh, r.name_en, lang), TITLE_MAX);
    if (!title) continue;
    const catName = cat ? pick(cat.name_zh, cat.name_en, lang) : '';
    const it = { id: 'link:' + r.id + (lang === 'en' ? ':en' : ''), type: 'item', lang, title, url: pageUrl(lang, cat ? '#c/' + cat.id : '') };
    const descMain = pick(r.desc_zh, r.desc_en, lang);
    const descOther = lang === 'en' ? r.desc_zh : r.desc_en;
    out.push(finish(it, [L[lang].finds, catName].filter(Boolean).join(' · '), [descMain, descOther !== descMain ? descOther : '', r.url], priv));
  }
  return out;
}

/** 一台设备 → 两条索引 @param {Record<string, any>} r */
export function deviceItems(r) {
  const out = [];
  for (const lang of LANGS) {
    const title = clip(r.name, TITLE_MAX);
    if (!title) continue;
    const T = L[lang];
    const it = { id: 'device:' + r.id + (lang === 'en' ? ':en' : ''), type: 'item', lang, title, url: pageUrl(lang, '#devices') };
    const sub = [T.devices, T.kinds[r.kind] || T.kinds.other, r.os].filter(Boolean).join(' · ');
    out.push(finish(it, sub, [r.os, r.specs, r.accessories, r.notes], !!r.private));
  }
  return out;
}

/** 一个游戏 → 两条索引 @param {Record<string, any>} r */
export function gameItems(r) {
  const out = [];
  for (const lang of LANGS) {
    const title = clip(r.title, TITLE_MAX);
    if (!title) continue;
    const T = L[lang];
    const it = { id: 'game:' + r.id + (lang === 'en' ? ':en' : ''), type: 'item', lang, title, url: pageUrl(lang, '#games') };
    const sub = [T.games, r.platform, T.status[r.status] || ''].filter(Boolean).join(' · ');
    out.push(finish(it, sub, [r.platform, r.edition, r.review], !!r.private));
  }
  return out;
}

/**
 * 从 D1 读全部收藏、设备、游戏（页面上的顺序），拼成索引值。
 * 一个 batch 跨 cats / links / devices / games 三套数据（同一快照），用主表 links 那套的绑定 D1_FINDS 执行
 * （D1_FINDS / D1_DEVICES / D1_GAMES 是同一个库 styrigx-curio-core）。
 * @param {any} db  D1_FINDS
 */
export async function buildIndex(db, now = Date.now()) {
  await ensureSchema(db);
  await ensureItemSchema(db);
  const [cats, links, devices, games] = await db.batch([
    db.prepare('SELECT id, name_zh, name_en, private FROM cats ORDER BY pos, id'),
    db.prepare('SELECT id, cat_id, url, name_zh, name_en, desc_zh, desc_en, private FROM links ORDER BY pos, id'),
    db.prepare('SELECT id, name, kind, os, specs, accessories, notes, private FROM devices ORDER BY pos, id'),
    db.prepare('SELECT id, title, platform, edition, status, review, private FROM games ORDER BY pos, id'),
  ]);
  const byId = new Map((cats.results || []).map((c) => [c.id, c]));
  const items = [];
  for (const r of links.results || []) items.push(...linkItems(r, byId.get(r.cat_id)));
  for (const r of devices.results || []) items.push(...deviceItems(r));
  for (const r of games.results || []) items.push(...gameItems(r));
  return { site: SITE, generated: new Date(now).toISOString(), items };
}

/**
 * 重建并写入 KV。永不抛错：成功 {ok:true, count}，失败 {ok:false, error}（只打日志，不带内容）。
 * @param {Record<string, any>} env
 */
export async function rebuildSearchIndex(env, now = Date.now()) {
  try {
    const kv = env && env.KV_SEARCH_INDEX;
    if (!kv || typeof kv.put !== 'function') {
      console.error('[curio-search] KV_SEARCH_INDEX binding missing');
      return { ok: false, error: 'kv-binding-missing' };
    }
    if (!env.D1_FINDS) {
      console.error('[curio-search] D1_FINDS binding missing');
      return { ok: false, error: 'db-binding-missing' };
    }
    const value = await buildIndex(env.D1_FINDS, now);
    let body = JSON.stringify(value);
    if (body.length > VALUE_MAX) {
      for (const it of value.items) delete it.text;
      body = JSON.stringify(value);
    }
    await kv.put(KEY, body);
    return { ok: true, count: value.items.length };
  } catch (e) {
    console.error('[curio-search] rebuild failed: ' + (e && e.message ? e.message : 'error'));
    return { ok: false, error: 'rebuild-failed' };
  }
}

/* 改内容的接口：收藏、设备 / 游戏、导入。照片（/api/photo）不进索引，换照片不用重建 */
const CONTENT_ROUTES = ['/api/links', '/api/items', '/api/import'];
const MUTATING = ['POST', 'PUT', 'DELETE', 'PATCH'];

/** 这次请求成功改了要进索引的内容吗（内容接口 + 写方法 + 2xx）；key 是 routeKey 后的路径 */
export function isContentMutation(key, method, status) {
  return CONTENT_ROUTES.includes(key) && MUTATING.includes(String(method || '').toUpperCase()) && status >= 200 && status < 300;
}
