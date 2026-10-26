// workers/core/src/api/items.js
// GET  /api/items   任何有效会话：{ok, admin, devices:[...], games:[...]}；访客只拿公开的（见 _items.js listItems）。
// POST /api/items   admin + 同源：body {op:'device.add'|'device.edit'|'device.del'|'device.order'|'game.*', ...}（校验见 _items.js parseItemOp）。
//                   成功 → {ok:true, admin:true, id?, devices, games}（带回最新全部，前端整页重画；add 带新条目 id，好接着传照片）
//                   删条目时它的照片从 R2 一起删（R2 删失败不影响结果，只记日志）。
//                   400 参数不对；404 不存在（含关联的设备不存在）；409 limit / mismatch
import { json, err, methodNotAllowed } from './_lib.js';
import { sessionRole } from './_auth.js';
import { readBody, guardWrite } from './_write.js';
import { ensureItemSchema, listItems, parseItemOp, applyItemOp, itemDb } from './_items.js';

const STATUS = { 'not-found': 404, mismatch: 409, limit: 409 };

export async function onRequestGet(context) {
  const { request, env } = context;
  const role = await sessionRole(context);
  if (!role) return err('unauthorized', 401);
  /* 设备 + 游戏一起读是跨两套数据的一个 batch：用主表 devices 的绑定 D1_DEVICES（见 _items.js listItems） */
  if (!env || !env.D1_DEVICES) return err('server', 503);
  const admin = role === 'admin';
  await ensureItemSchema(env.D1_DEVICES);
  return json({ ok: true, admin, ...(await listItems(env.D1_DEVICES, admin)) });
}

export async function onRequestPost(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { env } = context;
  if (!env || !env.D1_DEVICES || !env.D1_GAMES) return err('server', 503);
  const { body, response } = await readBody(context.request);
  if (response) return response;
  const kind = body && typeof body.op === 'string' ? body.op.split('.')[0] : '';
  const o = parseItemOp(kind, body);
  if ('error' in o) return err(o.error, 400);
  /* 本表用自己的绑定（device → D1_DEVICES，game → D1_GAMES）；查关联设备、删设备的跨表 batch 用 D1_DEVICES */
  const db = itemDb(env, o.kind);
  await ensureItemSchema(db);
  const r = await applyItemOp(db, o, Date.now(), env.D1_DEVICES);
  if (r.error) return err(r.error, STATUS[r.error] || 400);
  for (const key of r.removed) {
    try { if (env.R2_PHOTOS) await env.R2_PHOTOS.delete(key); } catch (e) { console.error('[curio-items] photo delete failed'); }
  }
  const out = { ok: true, admin: true, ...(await listItems(env.D1_DEVICES, true)) };
  if (r.id) out.id = r.id;
  return json(out);
}

export function onRequest() {
  return methodNotAllowed('GET, POST');
}
