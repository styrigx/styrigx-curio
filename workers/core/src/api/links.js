// workers/core/src/api/links.js
// GET  /api/links   任何有效会话：owner 拿全部（含私密），visitor 只拿公开的（私密分类 / 私密收藏 / 空分类都不给）。
//                   返回 {ok:true, owner, cats:[{id, name:{zh,en}, private, links:[{id, url, name, desc, icon, private}]}]}
// POST /api/links   owner + 同源：body {op, ...}（操作见 _store.js 的 parseOp）。
//                   成功 → {ok:true, owner:true, cats:[...]}（直接带回最新的全部收藏，前端整页重画）
//                   400 参数不对；404 不存在；409 not-empty / mismatch / limit / duplicate
import { json, err, methodNotAllowed } from './_lib.js';
import { verifySession } from './_auth.js';
import { readBody, guardWrite } from './_write.js';
import { ensureSchema, listAll, parseOp, applyOp } from './_store.js';

const STATUS = { 'not-found': 404, 'not-empty': 409, mismatch: 409, limit: 409, duplicate: 409 };

function db(env) {
  return env && env.D1_FINDS ? env.D1_FINDS : null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const role = await verifySession(request, env);
  if (!role) return err('unauthorized', 401);
  const d = db(env);
  if (!d) return err('server', 503);
  const owner = role === 'owner';
  await ensureSchema(d);
  return json({ ok: true, owner, cats: await listAll(d, owner) });
}

export async function onRequestPost(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const d = db(context.env);
  if (!d) return err('server', 503);
  const { body, response } = await readBody(context.request);
  if (response) return response;
  const o = parseOp(body);
  if ('error' in o) return err(o.error, 400);
  await ensureSchema(d);
  const e = await applyOp(d, o);
  if (e) return err(e, STATUS[e] || 400);
  return json({ ok: true, owner: true, cats: await listAll(d, true) });
}

export function onRequest() {
  return methodNotAllowed('GET, POST');
}
