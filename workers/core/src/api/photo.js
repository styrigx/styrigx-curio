// workers/core/src/api/photo.js
// 设备照片 / 游戏封面（R2 R2_PHOTOS：photos/<device|game>/<id>-<时间>.<webp|jpg|png>）。
//   GET    /api/photo?kind=device|game&id=N   任何有效会话；访客拿不到私密条目的图（404，同不存在）。没照片 404。
//   POST   /api/photo?kind=…&id=N             admin + 同源；body 是图片本身（Content-Type image/webp|jpeg|png，看头几个字节核对），≤ 3 MB。
//                                             换照片：先写新的、再改 D1、最后删旧的。→ {ok:true}
//   DELETE /api/photo?kind=…&id=N             admin + 同源；删照片并清空 D1 里的 key。→ {ok:true}
// 前端上传前在浏览器里缩到长边 1600、转 webp，所以一般只有几百 KB。
// 响应头：Cache-Control private, no-cache + ETag + Vary: Cookie（_image.js）：浏览器每次用前都回来验会话，内容没变回 304。
//   ETag 由 R2 key 算（key 带时间，换照片 = 换 key = 换 ETag），304 不用读 R2。前端 ?v= 照旧用来换地址。
import { err, json, methodNotAllowed } from './_lib.js';
import { sessionRole } from './_auth.js';
import { guardWrite, idParam } from './_write.js';
import { ensureItemSchema, KINDS, itemDb } from './_items.js';
import { etagMatches, etagOf, imageResponse, notModified } from './_image.js';

export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/** 看头几个字节认图片类型：webp / jpeg / png，其它返回 '' */
export function sniffImage(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function target(request) {
  const kind = new URL(request.url).searchParams.get('kind') || '';
  const K = KINDS[kind];
  const id = idParam(request);
  return K && id ? { kind, K, id } : null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const role = await sessionRole(context);
  if (!role) return err('unauthorized', 401);
  const t = target(request);
  if (!t) return err('bad-id', 400);
  const db = itemDb(env, t.kind); // 设备 → D1_DEVICES，游戏 → D1_GAMES
  if (!db || !env.R2_PHOTOS) return err('server', 503);
  await ensureItemSchema(db);
  const row = await db.prepare(`SELECT ${t.K.photo} AS photo, private FROM ${t.K.table} WHERE id = ?1`).bind(t.id).first();
  if (!row || !row.photo || (role !== 'admin' && row.private)) return err('not-found', 404);
  /* 会话（index.js）和可见性（上一行）都过了才看缓存 */
  const etag = await etagOf(row.photo);
  if (etagMatches(request, etag)) return notModified(etag);
  const obj = await env.R2_PHOTOS.get(row.photo);
  if (!obj) return err('not-found', 404);
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/webp';
  return imageResponse(obj.body, type, etag);
}

export async function onRequestPost(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const t = target(request);
  if (!t) return err('bad-id', 400);
  const db = itemDb(env, t.kind); // 设备 → D1_DEVICES，游戏 → D1_GAMES
  if (!db || !env.R2_PHOTOS) return err('server', 503);
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > PHOTO_MAX_BYTES) return err('too-large', 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > PHOTO_MAX_BYTES) return err('too-large', 413);
  const type = sniffImage(bytes);
  if (!type) return err('not-image', 400);
  await ensureItemSchema(db);
  const row = await db.prepare(`SELECT ${t.K.photo} AS photo FROM ${t.K.table} WHERE id = ?1`).bind(t.id).first();
  if (!row) return err('not-found', 404);
  const key = `photos/${t.kind}/${t.id}-${Date.now()}.${EXT[type]}`;
  try {
    await env.R2_PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  } catch (e) {
    return err('storage', 503);
  }
  await db.prepare(`UPDATE ${t.K.table} SET ${t.K.photo} = ?1, updated_at = ?2 WHERE id = ?3`).bind(key, Date.now(), t.id).run();
  if (row.photo) { try { await env.R2_PHOTOS.delete(row.photo); } catch (e) { console.error('[curio-photo] old delete failed'); } }
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const t = target(request);
  if (!t) return err('bad-id', 400);
  const db = itemDb(env, t.kind); // 设备 → D1_DEVICES，游戏 → D1_GAMES
  if (!db || !env.R2_PHOTOS) return err('server', 503);
  await ensureItemSchema(db);
  const row = await db.prepare(`SELECT ${t.K.photo} AS photo FROM ${t.K.table} WHERE id = ?1`).bind(t.id).first();
  if (!row) return err('not-found', 404);
  await db.prepare(`UPDATE ${t.K.table} SET ${t.K.photo} = '', updated_at = ?1 WHERE id = ?2`).bind(Date.now(), t.id).run();
  if (row.photo) { try { await env.R2_PHOTOS.delete(row.photo); } catch (e) { console.error('[curio-photo] delete failed'); } }
  return json({ ok: true });
}

export function onRequest() {
  return methodNotAllowed('GET, POST, DELETE');
}
