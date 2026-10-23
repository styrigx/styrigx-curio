// workers/core/src/photo-sweep.js
// 照片兜底清扫：R2 里 photos/ 下没有被 D1（devices.photo / games.cover）引用的对象删掉。
// 正常路径（换照片、删照片、删条目）已经当场删 R2；这里只兜「当场删失败」「写了 R2 但 D1 没改成」这类残余。
// - 每天一次：挂在每小时的 Cron 上，只在 UTC 19 点（北京 03 点）那一轮跑。
// - 只删上传超过 1 小时的：上传是「先写 R2、再改 D1」，刚写进去的可能还没登记。
// - D1 读不到（表不在、库出错）就整轮不删：宁可留残余，不能误删。
// - 只碰 photos/；icons/、imports/（导入备份）不动。
import { ensureItemSchema, KINDS } from './api/_items.js';

export const SWEEP_PREFIX = 'photos/';
export const SWEEP_UTC_HOUR = 19;
export const SWEEP_MIN_AGE_MS = 3600 * 1000;

/** 这一轮该不该扫 @param {number} at 毫秒 */
export function isSweepHour(at) {
  return new Date(at).getUTCHours() === SWEEP_UTC_HOUR;
}

/**
 * @param {Record<string, any>} env  D1_DEVICES + R2_PHOTOS
 * @param {number} now
 * @returns {Promise<{ok:boolean, scanned:number, deleted:number, reason?:string}>}
 */
export async function sweepPhotos(env, now = Date.now()) {
  if (!env || !env.D1_DEVICES || !env.R2_PHOTOS) return { ok: false, scanned: 0, deleted: 0, reason: 'unbound' };
  /** @type {Set<string>} */
  const used = new Set();
  try {
    /* 一条 UNION ALL 同时读 devices.photo 和 games.cover（跨两套数据，要同一快照才不会误删）：
       用主表 devices 那套的绑定 D1_DEVICES 执行（与 D1_GAMES 是同一个库） */
    await ensureItemSchema(env.D1_DEVICES);
    const sql = Object.values(KINDS)
      .map((K) => `SELECT ${K.photo} AS k FROM ${K.table} WHERE ${K.photo} <> ''`)
      .join(' UNION ALL ');
    const r = await env.D1_DEVICES.prepare(sql).all();
    for (const row of (r && r.results) || []) if (row.k) used.add(String(row.k));
  } catch (e) {
    console.error('[curio-sweep] db read failed, skip');
    return { ok: false, scanned: 0, deleted: 0, reason: 'db' };
  }
  let scanned = 0;
  /** @type {string[]} */
  const stale = [];
  let cursor;
  try {
    do {
      const page = await env.R2_PHOTOS.list({ prefix: SWEEP_PREFIX, cursor, limit: 1000 });
      for (const o of page.objects || []) {
        scanned++;
        const up = o.uploaded instanceof Date ? o.uploaded.getTime() : Number(new Date(o.uploaded));
        if (!used.has(o.key) && Number.isFinite(up) && now - up >= SWEEP_MIN_AGE_MS) stale.push(o.key);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (e) {
    console.error('[curio-sweep] r2 list failed, skip');
    return { ok: false, scanned, deleted: 0, reason: 'r2' };
  }
  let deleted = 0;
  for (let i = 0; i < stale.length; i += 1000) {
    const chunk = stale.slice(i, i + 1000);
    try { await env.R2_PHOTOS.delete(chunk); deleted += chunk.length; } catch (e) { console.error('[curio-sweep] delete failed'); }
  }
  if (deleted) console.log('[curio-sweep] deleted ' + deleted + ' orphan photo(s)');
  return { ok: true, scanned, deleted };
}
