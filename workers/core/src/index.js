/**
 * @fileoverview styrigx-curio-core：奇趣接口 Worker（路由 curio.styrigx.com/api/*，见 wrangler.toml）。
 *
 * 数据接口都在这里，D1（D1_FINDS / D1_DEVICES / D1_GAMES，同一个库）和 R2（R2_PHOTOS：图标缓存、导入原文备份、设备照片）只绑在本 Worker 上；Pages 只放静态文件。
 * 本 Worker 不持任何钥匙：会话交给主站鉴权网关验（服务绑定 AUTH，见 src/api/_auth.js）。
 *
 * 请求顺序：
 *   1. 所有 /api/*：先问网关会话（admin、visitor 都可）；无效 → 401 JSON（不 302，fetch 不跟跳转）。没有公开接口。
 *      角色放进 context.data.role，handler 用 sessionRole(context) 直接取，每个请求只问网关一次。
 *   2. 按路由表交给 src/api/<路径>.js；写操作自己再要求 admin（读 context.data.role）+ 同源
 * /api/lock-session-check 由网关的更精确路由直接回答，到不了这里；万一到了，同样问网关。
 * 不在路由表里的路径 → 404；方法不支持 → 405。
 *
 * 全站搜索：改内容的写接口成功后 ctx.waitUntil 重建 KV site:curio；Cron 每小时兜底（scheduled），见 src/search-index.js。
 */
import { API_ROUTES } from './routes.js';
import { verifySession } from './api/_auth.js';
import { rebuildSearchIndex, isContentMutation } from './search-index.js';
import { sweepPhotos, isSweepHour } from './photo-sweep.js';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const NO_STORE = 'private, no-store';

/** /api/links/ 与 /api/links 等价（Pages 也这样匹配） */
export function routeKey(pathname) {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** 按 Pages 规则挑处理函数：onRequest<Method> 优先，其次 onRequest */
export function pickHandler(mod, method) {
  if (!mod) return null;
  const m = String(method || 'GET').toUpperCase();
  if (!METHODS.includes(m)) return null;
  const name = 'onRequest' + m.charAt(0) + m.slice(1).toLowerCase();
  if (typeof mod[name] === 'function') return mod[name];
  if (typeof mod.onRequest === 'function') return mod.onRequest;
  return null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
  });
}

/** 公开接口（不验会话）：奇趣没有 */
export function isPublic() {
  return false;
}

/** 找处理模块：{ mod, params, functionPath } 或 null */
export function resolve(pathname) {
  const key = routeKey(pathname);
  const mod = API_ROUTES.get(key);
  return mod ? { mod, params: {}, functionPath: key } : null;
}

function makeContext(request, env, ctx, params, functionPath, role) {
  return {
    request,
    env,
    params,
    data: role ? { role } : {},
    functionPath,
    waitUntil: (p) => { if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); },
    passThroughOnException: () => {},
    next: async () => json(404, { ok: false, error: 'not-found' }),
  };
}

/* 接口直接由本 Worker 回答，不经过网关，网关加的 HSTS 到不了这里：自己补（值同主站网关，1 年、不带 includeSubDomains） */
const HSTS = 'max-age=31536000';

/**
 * 响应打上 X-Curio-Runtime: worker，部署后能从外部确认接口真的走了本 Worker（不含敏感信息）；
 * 统一补 X-Content-Type-Options: nosniff 和 Strict-Transport-Security。
 */
function tag(res) {
  const out = new Response(res.body, res);
  out.headers.set('X-Curio-Runtime', 'worker');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Strict-Transport-Security', HSTS);
  return out;
}

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return json(404, { ok: false, error: 'not-found' });

  if (routeKey(path) === '/api/lock-session-check') {
    const role = await verifySession(request, env);
    return role ? json(200, { ok: true }) : json(401, { ok: false });
  }

  let role = null;
  if (!isPublic(path)) {
    role = await verifySession(request, env);
    if (!role) return json(401, { ok: false, error: 'unauthorized' });
  }

  const hit = resolve(path);
  if (!hit) return json(404, { ok: false, error: 'not-found' });
  const handler = pickHandler(hit.mod, request.method);
  if (!handler) return json(405, { ok: false, error: 'method' });
  const res = await handler(makeContext(request, env, ctx, hit.params, hit.functionPath, role));
  if (res && isContentMutation(hit.functionPath, request.method, res.status) && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(rebuildSearchIndex(env));
  }
  return res;
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, any>} env
   * @param {{ waitUntil(p: Promise<any>): void }} ctx
   */
  async fetch(request, env, ctx) {
    try {
      return tag(await handle(request, env, ctx));
    } catch (e) {
      console.error('[curio-core] unhandled: ' + (e && e.name ? e.name : 'error'));
      return tag(json(500, { ok: false, error: 'internal' }));
    }
  },

  /**
   * Cron（wrangler.toml [triggers]）：每小时兜底重建全站搜索索引（内容没变不写 KV）；每天一次（UTC 19 点那轮）顺带清扫没人引用的照片（src/photo-sweep.js）。出错只打日志。
   * @param {any} controller
   * @param {Record<string, any>} env
   * @param {{ waitUntil(p: Promise<any>): void }} ctx
   */
  async scheduled(controller, env, ctx) {
    const at = controller && controller.scheduledTime ? Number(controller.scheduledTime) : Date.now();
    /* 兜底重建：内容和 KV 里那份一样就不写（省账号共享的 KV 写额度） */
    const jobs = [rebuildSearchIndex(env, Date.now(), { skipUnchanged: true })];
    if (isSweepHour(at)) jobs.push(sweepPhotos(env, at).catch(() => {}));
    const p = Promise.all(jobs);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
    await p;
  },
};
