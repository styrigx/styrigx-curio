// workers/core/src/api/preview.js
// GET /api/preview?url=<网址>  —— 添加收藏时自动填名字、简介、图标。只有主人；必须同站（同源 GET 浏览器常不带 Origin，见 _lib.js 的 isSameSite）。
// 抓取规则和安全限制见 _preview.js（只抓公网 http/https、6 秒、256 KB、最多 3 次跳转）。
// 返回 200 {ok:true, url, title, desc, icon}（url 是跳转后的最终地址）；抓不到 → 200 {ok:false, error}；网址不合格 → 400。
import { json, err, methodNotAllowed, isSameSite } from './_lib.js';
import { requireOwner } from './_auth.js';
import { cleanUrl } from './_store.js';
import { fetchPreview } from './_preview.js';

export async function onRequestGet(context) {
  if (!isSameSite(context.request)) return err('origin', 403);
  const { response } = await requireOwner(context);
  if (response) return response;
  const url = cleanUrl(new URL(context.request.url).searchParams.get('url'));
  if (!url) return err('bad-url', 400);
  return json(await fetchPreview(url));
}

export function onRequest() {
  return methodNotAllowed('GET');
}
