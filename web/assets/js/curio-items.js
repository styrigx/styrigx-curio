/* assets/js/curio-items.js —— 奇趣「设备」「游戏」两个页签（浏览器 IIFE；node 测试时导出纯函数）。
 *
 * 设备：卡片（照片 / 类型图标、名字、类型 · 系统版本、用了多少天），筛选条 全部 / 在用 / 已退役。
 *   点卡片 → 详情（参数、配件、体验、购买 / 退役日期、使用天数、换代历史：从哪台换来、后来换成哪台）。
 *   使用天数不存，按 购买日期 → 退役日期（没退役就是今天）现算。
 * 游戏：卡片（封面、名字、平台、状态、评分），筛选条 全部 / 想玩 / 在玩 / 通关 / 搁置。详情里有版本、在哪台设备上玩、评价。
 * 管理员：右下角「设备」「游戏」新建；详情左上角编辑；编辑弹层里删除（要确认）。
 * 照片：选图 → 全屏「移动和缩放」（同主站头像裁剪：单指拖、双指 / 滚轮缩放，照片始终盖满取景框）。
 *   取景框 = 卡片显示的比例（设备 .it-media 4:3、游戏 .it-media--cover 3:4），裁好的图卡片里正好铺满、详情里完整显示。
 *   完成 → 浏览器里裁成长边 ≤1200（不放大）、转 webp（不支持就 jpeg），保存时再传；保存前点缩略图可以重新调整。
 * 访客只读、只看公开的。
 *
 * 数据：GET /api/items；写：POST /api/items {op}；照片：/api/photo?kind=device|game&id=（GET 图、POST 传、DELETE 删）。
 * 页签切换在 curio-tabs.js；确认框、提示条、弹层开关借 curio.js 的（window.SgxCurioUI）。
 */
(function(){
"use strict";
var G = typeof globalThis !== 'undefined' ? globalThis : this;

/* ================= 纯函数 ================= */
var KINDS = ['phone', 'tablet', 'laptop', 'desktop', 'watch', 'audio', 'console', 'camera', 'other'];
var STATUS = ['want', 'playing', 'done', 'shelved'];
var DAY = 86400000;

/** 'YYYY-MM-DD' → UTC 毫秒；不合格返回 NaN */
function dateMs(s){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return NaN;
  return Date.parse(s + 'T00:00:00Z');
}
/** 本地的今天，'YYYY-MM-DD' */
function todayStr(now){
  var d = now ? new Date(now) : new Date();
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
/** 用了多少天：购买当天算第 1 天，到退役日期（没退役到 today）为止；没填购买日期、或日期倒了返回 null */
function usedDays(bought, retired, today){
  var a = dateMs(bought);
  var b = dateMs(retired || today);
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round((b - a) / DAY) + 1;
}
/** 天数说成话：不到一年说天，满一年加上「约 x.y 年」 */
function daysText(n, en){
  if (n == null) return '';
  var y = n / 365.25;
  if (en) return n + (n === 1 ? ' day' : ' days') + (y >= 1 ? ' · about ' + (Math.round(y * 10) / 10) + (y >= 1.05 ? ' years' : ' year') : '');
  return n + ' 天' + (y >= 1 ? ' · 约 ' + (Math.round(y * 10) / 10) + ' 年' : '');
}
/** 设备筛选：all / active（没退役）/ retired */
function filterDevices(list, f){
  return (list || []).filter(function(d){ return f === 'active' ? !d.retired_at : f === 'retired' ? !!d.retired_at : true; });
}
/** 游戏筛选：all 或某个状态 */
function filterGames(list, f){
  return (list || []).filter(function(g){ return !f || f === 'all' || g.status === f; });
}
/** 换代历史：before = 换成了这台的那些旧设备，after = 这台换成的那台（看不到就 null） */
function lineage(devices, id){
  var byId = {};
  (devices || []).forEach(function(d){ byId[d.id] = d; });
  var me = byId[id];
  return {
    before: (devices || []).filter(function(d){ return d.replaced_by === id; }),
    after: me && me.replaced_by ? byId[me.replaced_by] || null : null,
  };
}
/** 平台联想：已有游戏里出现过的平台，按次数多到少，去重 */
function platformsOf(games){
  var n = {};
  (games || []).forEach(function(g){ var p = String(g.platform || '').trim(); if (p) n[p] = (n[p] || 0) + 1; });
  return Object.keys(n).sort(function(a, b){ return n[b] - n[a] || a.localeCompare(b); });
}
/** 缩图尺寸：长边不超过 max，等比 */
function fitSize(w, h, max){
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  var k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/* ---- 裁剪的几何（照片在舞台上：左上角 (tx,ty)、缩放 k；取景框 f = {l,t,w,h}，舞台坐标） ---- */
/** 卡片显示的比例（宽 / 高），和 CSS 里 .it-media（4/3）、.it-media--cover（3/4）一致 */
var CROP_RATIO = { device: 4 / 3, game: 3 / 4 };
/** 取景框尺寸：按比例放进舞台，左右留 24、上下给标题和按钮留 220，宽不超过 520 */
function cropFrame(stageW, stageH, ratio){
  var w = Math.max(1, Math.min(stageW - 48, 520)), h = w / ratio, mh = Math.max(1, stageH - 220);
  if (h > mh) { h = mh; w = h * ratio; }
  return { w: Math.round(w), h: Math.round(h) };
}
/** 刚好盖满取景框的缩放 */
function coverScale(nw, nh, fw, fh){ return Math.max(fw / nw, fh / nh); }
/** 夹住视图：缩放在 [盖满, 盖满 × zmax]，照片不许露出框外的空白 */
function clampView(v, nw, nh, f, zmax){
  var kMin = coverScale(nw, nh, f.w, f.h);
  var k = Math.min(Math.max(v.k, kMin), kMin * (zmax || 8));
  var tx = Math.max(Math.min(v.tx, f.l), f.l + f.w - nw * k);
  var ty = Math.max(Math.min(v.ty, f.t), f.t + f.h - nh * k);
  return { tx: tx, ty: ty, k: k };
}
/** 居中、刚好盖满的初始视图 */
function centerView(nw, nh, f){
  var k = coverScale(nw, nh, f.w, f.h);
  return { tx: f.l + (f.w - nw * k) / 2, ty: f.t + (f.h - nh * k) / 2, k: k };
}
/** 取景框里对应的原图区域 {sx, sy, sw, sh}（原图像素，落在图内） */
function cropSource(v, nw, nh, f){
  var sw = Math.min(nw, f.w / v.k), sh = Math.min(nh, f.h / v.k);
  var sx = Math.min(Math.max(0, (f.l - v.tx) / v.k), nw - sw);
  var sy = Math.min(Math.max(0, (f.t - v.ty) / v.k), nh - sh);
  return { sx: sx, sy: sy, sw: sw, sh: sh };
}
/** 输出尺寸：严格按卡片比例（取景框取整带来的零点几像素误差不进成品），长边 ≤ max，不超过原图区域（不放大） */
function cropOut(sw, sh, ratio, max){
  var L = Math.max(1, Math.round(Math.min(max, Math.max(sw, sh))));
  return ratio >= 1 ? { w: L, h: Math.max(1, Math.round(L / ratio)) } : { w: Math.max(1, Math.round(L * ratio)), h: L };
}
/** 反过来：从原图区域摆回视图（重新调整 / 转屏时保持原来框住的部分） */
function viewFromSource(s, f){
  var k = f.w / s.sw;
  return { tx: f.l - s.sx * k, ty: f.t - s.sy * k, k: k };
}

var pure = { KINDS: KINDS, STATUS: STATUS, dateMs: dateMs, todayStr: todayStr, usedDays: usedDays, daysText: daysText, filterDevices: filterDevices, filterGames: filterGames, lineage: lineage, platformsOf: platformsOf, fitSize: fitSize,
  CROP_RATIO: CROP_RATIO, cropFrame: cropFrame, coverScale: coverScale, clampView: clampView, centerView: centerView, cropSource: cropSource, viewFromSource: viewFromSource, cropOut: cropOut };
if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }
G.SgxCurioItems = pure;

/* ================= 页面 ================= */
var doc = G.document;
if (!doc.getElementById('cu-pane-devices')) return;
var isEn = doc.documentElement.lang === 'en';
var UI = G.SgxCurioUI;
var $ = function(s){ return doc.querySelector(s); };

var T = isEn ? {
  all: 'All', active: 'In use', retired: 'Retired',
  kinds: { phone: 'Phone', tablet: 'Tablet', laptop: 'Laptop', desktop: 'Desktop', watch: 'Watch', audio: 'Audio', console: 'Console', camera: 'Camera', other: 'Other' },
  status: { want: 'Want to play', playing: 'Playing', done: 'Finished', shelved: 'On hold' },
  addDevice: 'Add a device', editDevice: 'Edit device', addGame: 'Add a game', editGame: 'Edit game',
  emptyDevAdmin: 'No devices yet. Tap "Device" to add one.', emptyGameAdmin: 'No games yet. Tap "Game" to add one.', empty: 'Nothing here yet.', noMatch: 'Nothing in this filter.',
  needName: 'Give it a name.', badDate: 'Check the dates.', failed: 'Something went wrong. Please try again.', saved: 'Saved.', deleted: 'Deleted.',
  photoFail: 'Saved, but the photo didn\'t upload.', notImage: 'That isn\'t a photo we can use.', tooLarge: 'The photo is too large.',
  delDevice: 'Delete this device?', delGame: 'Delete this game?', del: 'Delete', none: 'None', priv: 'Only you can see this',
  used: 'In use for', usedFor: 'Used for', bought: 'Bought', retiredOn: 'Retired', os: 'System', specs: 'Specs', acc: 'Accessories', notes: 'How it\'s been',
  from: 'Replaced', to: 'Replaced by', platform: 'Platform', on: 'Played on', edition: 'Version', rating: 'Rating', review: 'Thoughts', stars: function(n){ return n + ' out of 5'; },
  crop: 'Move and scale', cancel: 'Cancel', done: 'Done', adjust: 'Adjust photo'
} : {
  all: '全部', active: '在用', retired: '已退役',
  kinds: { phone: '手机', tablet: '平板', laptop: '笔记本', desktop: '台式机', watch: '手表', audio: '耳机音箱', console: '游戏机', camera: '相机', other: '其他' },
  status: { want: '想玩', playing: '在玩', done: '通关', shelved: '搁置' },
  addDevice: '添加设备', editDevice: '编辑设备', addGame: '添加游戏', editGame: '编辑游戏',
  emptyDevAdmin: '还没有设备。点「设备」添加第一台。', emptyGameAdmin: '还没有游戏。点「游戏」添加。', empty: '这里还空着。', noMatch: '这个筛选下没有。',
  needName: '起个名字。', badDate: '日期不对，检查一下。', failed: '出了点问题，请再试一次。', saved: '已保存', deleted: '已删除',
  photoFail: '已保存，但照片没传上去。', notImage: '这张图用不了。', tooLarge: '照片太大了。',
  delDevice: '确定删除这台设备吗？', delGame: '确定删除这个游戏吗？', del: '删除', none: '无', priv: '仅自己可见',
  used: '已经用了', usedFor: '用了', bought: '购买', retiredOn: '退役', os: '系统', specs: '参数', acc: '配件', notes: '体验',
  from: '换下了', to: '换成了', platform: '平台', on: '在哪台上玩', edition: '版本', rating: '评分', review: '评价', stars: function(n){ return n + ' 星'; },
  crop: '移动和缩放', cancel: '取消', done: '完成', adjust: '调整照片'
};

/* 类型图标（没有照片时显示） */
var KIND_IC = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M11 18h2"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  watch: '<rect x="7" y="7" width="10" height="10" rx="3"/><path d="M9 7l1-4h4l1 4M9 17l1 4h4l1-4"/>',
  audio: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  console: '<path d="M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-.6.8A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4z"/><path d="M8 11v2M7 12h2"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  other: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6"/>',
  game: '<path d="M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-.6.8A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4z"/><path d="M8 11v2M7 12h2M15.5 11.5h.01M17.5 12.5h.01"/>'
};
function icon(k, size){ return '<svg viewBox="0 0 24 24" width="' + (size || 28) + '" height="' + (size || 28) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (KIND_IC[k] || KIND_IC.other) + '</svg>'; }
var LOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function starSvg(n){ return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/></svg>'; }
var STAR = starSvg(16);

var devices = [], games = [], admin = false, loaded = false;
var dvFilter = 'all', gmFilter = 'all';
var ver = {}; /* 照片缓存破坏：换过照片的条目带 ?v= */

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function photoUrl(kind, id){ return '/api/photo?kind=' + kind + '&id=' + id + (ver[kind + id] ? '&v=' + ver[kind + id] : ''); }
function toast(m){ if (UI) UI.toast(m); }
function open(id){ if (UI) UI.openOverlay(id); }
function close(id){ if (UI) UI.closeOverlay(id); }
function getJSON(url){
  var f = G.sgxLockSync ? G.sgxLockSync.apiFetch : function(u, o){ return fetch(u, o); };
  return f(url, { credentials: 'same-origin', cache: 'no-store' }).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
}
function send(method, url, body, type){
  return fetch(url, {
    method: method, credentials: 'same-origin', redirect: 'manual',
    headers: body === undefined ? {} : { 'Content-Type': type || 'application/json' },
    body: body === undefined ? undefined : type ? body : JSON.stringify(body),
  }).then(function(r){
    if (r.type === 'opaqueredirect' || r.status === 401) { G.location.reload(); throw Object.assign(new Error('locked'), { sgxLocked: true }); }
    return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { code: j.error }); return j; });
  });
}
function op(body){ return send('POST', '/api/items', body).then(function(j){ devices = j.devices || []; games = j.games || []; render(); return j; }); }
function errText(e){
  var c = e && e.code || '';
  if (c === 'bad-name' || c === 'bad-title') return T.needName;
  if (/^bad-(bought|retired)-at$/.test(c)) return T.badDate;
  if (c === 'not-image') return T.notImage;
  if (c === 'too-large') return T.tooLarge;
  return T.failed;
}
function findDev(id){ return devices.filter(function(d){ return d.id === id; })[0] || null; }
function findGame(id){ return games.filter(function(g){ return g.id === id; })[0] || null; }

/* ---------- 画 ---------- */
function chips(el, opts, cur){
  el.innerHTML = opts.map(function(o){ return '<button type="button" role="tab" class="cu-chip" aria-selected="' + (o[0] === cur) + '" data-f="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('');
}
function devCard(d){
  var days = usedDays(d.bought_at, d.retired_at, todayStr());
  var sub = [T.kinds[d.kind] || T.kinds.other, d.os].filter(Boolean).join(' · ');
  return '<button type="button" class="it-card' + (d.retired_at ? ' is-retired' : '') + '" data-dev="' + d.id + '">'
    + '<span class="it-media">' + (d.photo ? '<img src="' + photoUrl('device', d.id) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '') + '<span class="it-media-ic">' + icon(d.kind) + '</span></span>'
    + '<span class="it-body"><span class="it-name">' + esc(d.name) + (admin && d.private ? '<span class="cu-lock-inline" title="' + esc(T.priv) + '">' + LOCK + '</span>' : '') + '</span>'
    + '<span class="it-sub">' + esc(sub) + '</span>'
    + (days != null ? '<span class="it-meta">' + esc((d.retired_at ? T.usedFor : T.used) + ' ' + daysText(days, isEn)) + '</span>' : '')
    + (d.retired_at ? '<span class="it-badge">' + esc(T.retired) + '</span>' : '')
    + '</span></button>';
}
function stars(n){
  if (!n) return '';
  var s = '';
  for (var i = 1; i <= 5; i++) s += '<span class="it-star' + (i <= n ? ' on' : '') + '">' + STAR + '</span>';
  return '<span class="it-stars-ro" role="img" aria-label="' + esc(T.stars(n)) + '">' + s + '</span>';
}
function gameCard(g){
  var dev = g.device_id ? findDev(g.device_id) : null;
  var sub = [g.platform, dev && dev.name].filter(Boolean).join(' · ');
  return '<button type="button" class="it-card it-card--game" data-game="' + g.id + '">'
    + '<span class="it-media it-media--cover">' + (g.cover ? '<img src="' + photoUrl('game', g.id) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '') + '<span class="it-media-ic">' + icon('game') + '</span></span>'
    + '<span class="it-body"><span class="it-name">' + esc(g.title) + (admin && g.private ? '<span class="cu-lock-inline" title="' + esc(T.priv) + '">' + LOCK + '</span>' : '') + '</span>'
    + (sub ? '<span class="it-sub">' + esc(sub) + '</span>' : '')
    + '<span class="it-row"><span class="it-status it-status--' + esc(g.status) + '">' + esc(T.status[g.status] || '') + '</span>' + stars(g.rating) + '</span>'
    + '</span></button>';
}
function render(){
  chips($('#dv-chips'), [['all', T.all], ['active', T.active], ['retired', T.retired]], dvFilter);
  chips($('#gm-chips'), [['all', T.all]].concat(STATUS.map(function(s){ return [s, T.status[s]]; })), gmFilter);
  var ds = filterDevices(devices, dvFilter);
  $('#dv-list').innerHTML = ds.map(devCard).join('');
  var gs = filterGames(games, gmFilter);
  $('#gm-list').innerHTML = gs.map(gameCard).join('');
  var de = $('#dv-empty'), ge = $('#gm-empty');
  de.textContent = devices.length ? T.noMatch : admin ? T.emptyDevAdmin : T.empty;
  ge.textContent = games.length ? T.noMatch : admin ? T.emptyGameAdmin : T.empty;
  de.classList.toggle('hidden', !loaded || ds.length > 0);
  ge.classList.toggle('hidden', !loaded || gs.length > 0);
}
$('#dv-chips').addEventListener('click', function(e){ var b = e.target.closest('[data-f]'); if (b) { dvFilter = b.dataset.f; render(); } });
$('#gm-chips').addEventListener('click', function(e){ var b = e.target.closest('[data-f]'); if (b) { gmFilter = b.dataset.f; render(); } });

/* ---------- 详情 ---------- */
var viewing = null; /* {kind, id} */
function para(label, v){ return v ? '<div class="it-dl"><div class="it-dt">' + esc(label) + '</div><div class="it-dd">' + esc(v).replace(/\n/g, '<br>') + '</div></div>' : ''; }
function devLink(d){ return d ? '<button type="button" class="it-link" data-dev="' + d.id + '">' + esc(d.name) + '</button>' : ''; }
function viewDevice(d){
  viewing = { kind: 'device', id: d.id };
  var days = usedDays(d.bought_at, d.retired_at, todayStr());
  var lin = lineage(devices, d.id);
  var html = '<div class="it-hero">' + (d.photo ? '<img src="' + photoUrl('device', d.id) + '" alt="">' : '<span class="it-media-ic">' + icon(d.kind, 48) + '</span>') + '</div>'
    + '<p class="it-hero-sub">' + esc([T.kinds[d.kind] || T.kinds.other, d.retired_at ? T.retired : T.active].join(' · ')) + '</p>'
    + (days != null ? '<p class="it-days">' + esc((d.retired_at ? T.usedFor : T.used) + ' ' + daysText(days, isEn)) + '</p>' : '')
    + para(T.bought, d.bought_at) + para(T.retiredOn, d.retired_at) + para(T.os, d.os)
    + para(T.specs, d.specs) + para(T.acc, d.accessories) + para(T.notes, d.notes);
  if (lin.before.length) html += '<div class="it-dl"><div class="it-dt">' + esc(T.from) + '</div><div class="it-dd">' + lin.before.map(devLink).join('、') + '</div></div>';
  if (lin.after) html += '<div class="it-dl"><div class="it-dt">' + esc(T.to) + '</div><div class="it-dd">' + devLink(lin.after) + '</div></div>';
  var played = games.filter(function(g){ return g.device_id === d.id; });
  if (played.length) html += '<div class="it-dl"><div class="it-dt">' + esc(isEn ? 'Games' : '游戏') + '</div><div class="it-dd">' + played.map(function(g){ return '<button type="button" class="it-link" data-game="' + g.id + '">' + esc(g.title) + '</button>'; }).join('、') + '</div></div>';
  showView(d.name, html);
}
function viewGame(g){
  viewing = { kind: 'game', id: g.id };
  var dev = g.device_id ? findDev(g.device_id) : null;
  var html = '<div class="it-hero it-hero--cover">' + (g.cover ? '<img src="' + photoUrl('game', g.id) + '" alt="">' : '<span class="it-media-ic">' + icon('game', 48) + '</span>') + '</div>'
    + '<p class="it-hero-sub"><span class="it-status it-status--' + esc(g.status) + '">' + esc(T.status[g.status] || '') + '</span> ' + stars(g.rating) + '</p>'
    + para(T.platform, g.platform)
    + (dev ? '<div class="it-dl"><div class="it-dt">' + esc(T.on) + '</div><div class="it-dd">' + devLink(dev) + '</div></div>' : '')
    + para(T.edition, g.edition) + para(T.review, g.review);
  showView(g.title, html);
}
function showView(title, html){
  $('#it-view-title').textContent = title;
  $('#it-view-body').innerHTML = html;
  $('#it-view-body').scrollTop = 0;
  $('#it-view-edit').classList.toggle('hidden', !admin);
  open('it-view-wrap');
}
$('#it-view-body').addEventListener('click', function(e){
  var a = e.target.closest('[data-dev],[data-game]');
  if (!a) return;
  if (a.dataset.dev) { var d = findDev(Number(a.dataset.dev)); if (d) viewDevice(d); }
  else { var g = findGame(Number(a.dataset.game)); if (g) viewGame(g); }
});
$('#it-view-edit').addEventListener('click', function(){
  if (!viewing) return;
  close('it-view-wrap');
  if (viewing.kind === 'device') openDevEdit(findDev(viewing.id)); else openGameEdit(findGame(viewing.id));
});
$('#dv-list').addEventListener('click', function(e){ var b = e.target.closest('[data-dev]'); var d = b && findDev(Number(b.dataset.dev)); if (d) viewDevice(d); });
$('#gm-list').addEventListener('click', function(e){ var b = e.target.closest('[data-game]'); var g = b && findGame(Number(b.dataset.game)); if (g) viewGame(g); });

/* ---------- 照片：选图 → 移动和缩放 → 裁成长边 ≤1200 → webp（不支持就 jpeg） ---------- */
var CROP_OUT = 1200, ZOOM_MAX = 8;
function encode(c){
  return new Promise(function(resolve, reject){
    c.toBlob(function(b){
      if (b && b.type === 'image/webp') return resolve(b);
      c.toBlob(function(j){ j ? resolve(j) : reject(Object.assign(new Error('encode'), { code: 'not-image' })); }, 'image/jpeg', 0.85);
    }, 'image/webp', 0.85);
  });
}
/* 全屏裁剪弹层（同主站头像的 .sgx-avc）：<dialog> 在最上层，盖过编辑弹层；取消 / Esc / 系统返回 = 什么都不改 */
var crop = (function(){
  var dlg = null, stage, pic, frame, doneBtn;
  var nw = 0, nh = 0, ratio = 1, f = { l: 0, t: 0, w: 0, h: 0 }, v = { tx: 0, ty: 0, k: 1 };
  var pts = {}, nPts = 0, url = '', cb = null, busy = false;
  function layout(){
    var w = stage.clientWidth, h = stage.clientHeight, fr = cropFrame(w, h, ratio);
    f = { l: Math.round((w - fr.w) / 2), t: Math.round((h - fr.h) / 2 - 20), w: fr.w, h: fr.h };
    frame.style.left = f.l + 'px'; frame.style.top = f.t + 'px'; frame.style.width = f.w + 'px'; frame.style.height = f.h + 'px';
  }
  function paint(){ v = clampView(v, nw, nh, f, ZOOM_MAX); pic.style.transform = 'translate(' + v.tx + 'px,' + v.ty + 'px) scale(' + v.k + ')'; }
  function zoomAt(k2, px, py){
    var kMin = coverScale(nw, nh, f.w, f.h), kk = Math.min(Math.max(k2, kMin), kMin * ZOOM_MAX);
    v = { tx: px - (px - v.tx) * kk / v.k, ty: py - (py - v.ty) * kk / v.k, k: kk };
    paint();
  }
  function pinch(){
    var a = Object.keys(pts).map(function(id){ return pts[id]; });
    return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) };
  }
  function shut(){
    if (dlg.open) dlg.close();
    pts = {}; nPts = 0; cb = null; busy = false;
    pic.removeAttribute('src');
    if (url) { URL.revokeObjectURL(url); url = ''; }
  }
  function local(e){ var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function build(){
    dlg = doc.createElement('dialog');
    dlg.className = 'cu-crop';
    dlg.setAttribute('aria-labelledby', 'cu-crop-title');
    dlg.innerHTML = '<div class="cu-crop-stage"><img class="cu-crop-img" alt="" draggable="false"><div class="cu-crop-frame"></div></div>'
      + '<div id="cu-crop-title" class="cu-crop-title">' + esc(T.crop) + '</div>'
      + '<div class="cu-crop-bar"><button type="button" class="cu-crop-btn" data-crop-cancel>' + esc(T.cancel) + '</button>'
      + '<button type="button" class="cu-crop-btn primary" data-crop-done>' + esc(T.done) + '</button></div>';
    doc.body.appendChild(dlg);
    stage = dlg.querySelector('.cu-crop-stage'); pic = dlg.querySelector('.cu-crop-img'); frame = dlg.querySelector('.cu-crop-frame');
    doneBtn = dlg.querySelector('[data-crop-done]');
    dlg.querySelector('[data-crop-cancel]').addEventListener('click', shut);
    doneBtn.addEventListener('click', done);
    /* Esc / 系统返回 = 取消；Esc 不再冒泡到 curio.js，免得把下面的编辑弹层也关了 */
    dlg.addEventListener('cancel', function(e){ e.preventDefault(); shut(); });
    dlg.addEventListener('keydown', function(e){ if (e.key === 'Escape') e.stopPropagation(); });
    stage.addEventListener('pointerdown', function(e){
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      if (!pts[e.pointerId]) nPts++;
      pts[e.pointerId] = local(e);
    });
    stage.addEventListener('pointermove', function(e){
      var p = pts[e.pointerId];
      if (!p) return;
      var q = local(e);
      if (nPts === 1) { v = { tx: v.tx + q.x - p.x, ty: v.ty + q.y - p.y, k: v.k }; p.x = q.x; p.y = q.y; paint(); return; }
      if (nPts === 2) {
        var a = pinch(); p.x = q.x; p.y = q.y; var b = pinch();
        v = { tx: v.tx + b.x - a.x, ty: v.ty + b.y - a.y, k: v.k };
        if (a.d > 0) zoomAt(v.k * b.d / a.d, b.x, b.y); else paint();
      }
    });
    function up(e){ if (pts[e.pointerId]) { delete pts[e.pointerId]; nPts--; } }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', function(e){ e.preventDefault(); var q = local(e); zoomAt(v.k * Math.exp(-e.deltaY * 0.0015), q.x, q.y); }, { passive: false });
    G.addEventListener('resize', function(){
      if (!dlg.open || !nw) return;
      var s = cropSource(v, nw, nh, f);
      layout(); v = viewFromSource(s, f); paint();
    });
  }
  function done(){
    if (busy || !nw) return;
    busy = true; doneBtn.disabled = true;
    var s = cropSource(v, nw, nh, f), o = cropOut(s.sw, s.sh, ratio, CROP_OUT);
    var c = doc.createElement('canvas'); c.width = o.w; c.height = o.h;
    var g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(pic, s.sx, s.sy, s.sw, s.sh, 0, 0, o.w, o.h);
    var fn = cb;
    encode(c).then(function(b){ shut(); if (fn) fn(b, s); }, function(e){ shut(); toast(errText(e)); });
  }
  /** 打开：file = 原图；kind 定比例；src = 上次框住的原图区域（重新调整时带上）；onDone(blob, src) */
  function openCrop(file, kind, src, onDone){
    if (!dlg) build();
    if (url) URL.revokeObjectURL(url);
    ratio = CROP_RATIO[kind] || 1; cb = onDone; busy = false; nw = nh = 0; pts = {}; nPts = 0;
    doneBtn.disabled = true;
    url = URL.createObjectURL(file);
    pic.onload = function(){
      nw = pic.naturalWidth; nh = pic.naturalHeight;
      if (!nw || !nh) { shut(); toast(T.notImage); return; }
      pic.style.width = nw + 'px'; pic.style.height = nh + 'px';
      if (!dlg.open) dlg.showModal();
      layout();
      v = src ? viewFromSource(src, f) : centerView(nw, nh, f);
      paint();
      doneBtn.disabled = false;
    };
    pic.onerror = function(){ shut(); toast(T.notImage); };
    pic.src = url;
  }
  return { open: openCrop };
})();
var ADJ = '<span class="it-photo-adj" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg></span>';
/** 一个编辑弹层的照片状态：pending = 裁好的 Blob，drop = 要去掉；file / src = 原图和框住的区域（保存前可重新调整） */
function photoBox(prefix, kind){
  var st = { pending: null, drop: false, had: false, prevUrl: '', file: null, src: null };
  var prev = $('#' + prefix + '-photo-prev'), input = $('#' + prefix + '-photo'), del = $('#' + prefix + '-photo-del');
  function show(src){
    if (st.prevUrl) { URL.revokeObjectURL(st.prevUrl); st.prevUrl = ''; }
    var adj = !!(src && st.pending && st.file);
    prev.innerHTML = src ? '<img src="' + esc(src) + '" alt="">' + (adj ? ADJ : '') : icon(kind === 'game' ? 'game' : 'other', 32);
    prev.disabled = !adj;
    if (adj) { prev.setAttribute('aria-label', T.adjust); prev.removeAttribute('aria-hidden'); }
    else { prev.removeAttribute('aria-label'); prev.setAttribute('aria-hidden', 'true'); }
    del.classList.toggle('hidden', !src);
  }
  function cropped(file){
    return function(b, src){
      st.pending = b; st.drop = false; st.file = file; st.src = src;
      var u = URL.createObjectURL(b);
      show(u); st.prevUrl = u;
    };
  }
  input.addEventListener('change', function(){
    var f = input.files && input.files[0];
    input.value = '';
    if (f) crop.open(f, kind, null, cropped(f));
  });
  /* 刚选的图还没保存：点缩略图回到裁剪，接着上次框住的位置调 */
  prev.addEventListener('click', function(){ if (st.pending && st.file) crop.open(st.file, kind, st.src, cropped(st.file)); });
  del.addEventListener('click', function(){ st.pending = null; st.file = null; st.src = null; st.drop = st.had; show(''); });
  return {
    reset: function(item, has){ st.pending = null; st.file = null; st.src = null; st.drop = false; st.had = !!has; show(has ? photoUrl(kind, item.id) : ''); },
    /** 保存后跑：有新图就传，有「去掉」就删；返回 Promise<是否出错> */
    commit: function(id){
      var p = st.pending ? send('POST', '/api/photo?kind=' + kind + '&id=' + id, st.pending, st.pending.type)
        : st.drop ? send('DELETE', '/api/photo?kind=' + kind + '&id=' + id) : null;
      if (!p) return Promise.resolve(false);
      var has = !!st.pending;
      return p.then(function(){
        ver[kind + id] = Date.now();
        /* 本地列表跟上：第一次传图 / 去掉照片后卡片立刻换，不用等刷新（列表是保存时 op 回的，那时照片还没传） */
        var it = kind === 'game' ? findGame(id) : findDev(id);
        if (it) it[kind === 'game' ? 'cover' : 'photo'] = has;
        return false;
      }, function(e){ if (e.sgxLocked) throw e; return true; });
    }
  };
}

/* ---------- 设备：编辑 ---------- */
var dvEditing = null, dvKind = 'phone';
var dvPhoto = photoBox('dv', 'device');
function renderKinds(){
  $('#dv-kind').innerHTML = KINDS.map(function(k){ return '<button type="button" role="radio" class="cu-chip cu-chip-sm" aria-checked="' + (dvKind === k) + '" data-k="' + k + '">' + esc(T.kinds[k]) + '</button>'; }).join('');
}
$('#dv-kind').addEventListener('click', function(e){ var b = e.target.closest('[data-k]'); if (b) { dvKind = b.dataset.k; renderKinds(); } });
function deviceOptions(sel, cur, exclude){
  sel.innerHTML = '<option value="0">' + esc(T.none) + '</option>' + devices.filter(function(d){ return d.id !== exclude; }).map(function(d){
    return '<option value="' + d.id + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.name) + '</option>';
  }).join('');
}
function syncRetire(){ $('#dv-retire-wrap').classList.toggle('hidden', !$('#dv-retired').checked); }
$('#dv-retired').addEventListener('change', function(){
  if (this.checked && !$('#dv-retired-at').value) $('#dv-retired-at').value = todayStr();
  syncRetire();
});
function dvErr(m){ var el = $('#dv-err'); el.textContent = m || ''; el.classList.toggle('hidden', !m); }
function openDevEdit(d){
  dvEditing = d || null;
  $('#dv-edit-title').textContent = d ? T.editDevice : T.addDevice;
  dvKind = d ? d.kind : 'phone';
  renderKinds();
  $('#dv-name').value = d ? d.name : '';
  $('#dv-bought').value = d ? d.bought_at : '';
  $('#dv-os').value = d ? d.os : '';
  $('#dv-specs').value = d ? d.specs : '';
  $('#dv-acc').value = d ? d.accessories : '';
  $('#dv-notes').value = d ? d.notes : '';
  $('#dv-retired').checked = !!(d && d.retired_at);
  $('#dv-retired-at').value = d ? d.retired_at : '';
  deviceOptions($('#dv-replaced'), d ? d.replaced_by : 0, d ? d.id : 0);
  syncRetire();
  $('#dv-private').checked = !!(d && d.private);
  $('#dv-del').classList.toggle('hidden', !d);
  dvPhoto.reset(d, d && d.photo);
  dvErr('');
  open('dv-edit-wrap');
  if (!d) setTimeout(function(){ $('#dv-name').focus(); }, 50);
}
$('#dv-fab').addEventListener('click', function(){ openDevEdit(null); });
$('#dv-save').addEventListener('click', function(){
  var name = $('#dv-name').value.trim();
  if (!name) { dvErr(T.needName); return; }
  var retired = $('#dv-retired').checked;
  var body = {
    name: name, kind: dvKind, bought_at: $('#dv-bought').value, os: $('#dv-os').value, specs: $('#dv-specs').value,
    accessories: $('#dv-acc').value, notes: $('#dv-notes').value, private: $('#dv-private').checked,
    retired_at: retired ? $('#dv-retired-at').value : '', replaced_by: retired ? Number($('#dv-replaced').value) || 0 : 0,
  };
  if (retired && !body.retired_at) { dvErr(T.badDate); return; }
  if (body.bought_at && body.retired_at && body.retired_at < body.bought_at) { dvErr(T.badDate); return; }
  if (dvEditing) { body.op = 'device.edit'; body.id = dvEditing.id; } else body.op = 'device.add';
  var btn = $('#dv-save'); btn.disabled = true;
  op(body).then(function(j){
    var id = dvEditing ? dvEditing.id : j.id;
    return dvPhoto.commit(id).then(function(bad){ if (!bad) return; toast(T.photoFail); throw { quiet: true }; }).then(function(){ render(); close('dv-edit-wrap'); toast(T.saved); });
  }).catch(function(e){ if (e && e.quiet) { render(); close('dv-edit-wrap'); return; } if (!e.sgxLocked) dvErr(errText(e)); }).then(function(){ btn.disabled = false; });
});
$('#dv-del').addEventListener('click', function(){
  if (!dvEditing || !UI) return;
  var id = dvEditing.id;
  UI.ask(T.delDevice, T.del, function(){ op({ op: 'device.del', id: id }).then(function(){ close('dv-edit-wrap'); toast(T.deleted); }).catch(function(e){ if (!e.sgxLocked) toast(errText(e)); }); });
});

/* ---------- 游戏：编辑 ---------- */
var gmEditing = null, gmStatus = 'want', gmRating = 0;
var gmPhoto = photoBox('gm', 'game');
function renderStatus(){
  $('#gm-status').innerHTML = STATUS.map(function(s){ return '<button type="button" role="radio" class="cu-chip cu-chip-sm" aria-checked="' + (gmStatus === s) + '" data-s="' + s + '">' + esc(T.status[s]) + '</button>'; }).join('');
}
function renderRating(){
  var h = '';
  for (var i = 1; i <= 5; i++) h += '<button type="button" role="radio" class="it-star-btn' + (i <= gmRating ? ' on' : '') + '" aria-checked="' + (i === gmRating) + '" aria-label="' + esc(T.stars(i)) + '" data-r="' + i + '">' + starSvg(28) + '</button>';
  $('#gm-rating').innerHTML = h;
}
$('#gm-status').addEventListener('click', function(e){ var b = e.target.closest('[data-s]'); if (b) { gmStatus = b.dataset.s; renderStatus(); } });
/* 点同一颗星再点一次 = 清空评分 */
$('#gm-rating').addEventListener('click', function(e){ var b = e.target.closest('[data-r]'); if (!b) return; var n = Number(b.dataset.r); gmRating = n === gmRating ? 0 : n; renderRating(); });
function gmErr(m){ var el = $('#gm-err'); el.textContent = m || ''; el.classList.toggle('hidden', !m); }
function openGameEdit(g){
  gmEditing = g || null;
  $('#gm-edit-title').textContent = g ? T.editGame : T.addGame;
  gmStatus = g ? g.status : 'want'; renderStatus();
  gmRating = g ? g.rating : 0; renderRating();
  $('#gm-title').value = g ? g.title : '';
  $('#gm-platform').value = g ? g.platform : '';
  $('#gm-platforms').innerHTML = platformsOf(games).map(function(p){ return '<option value="' + esc(p) + '">'; }).join('');
  deviceOptions($('#gm-device'), g ? g.device_id : 0, 0);
  $('#gm-edition').value = g ? g.edition : '';
  $('#gm-review').value = g ? g.review : '';
  $('#gm-private').checked = !!(g && g.private);
  $('#gm-del').classList.toggle('hidden', !g);
  gmPhoto.reset(g, g && g.cover);
  gmErr('');
  open('gm-edit-wrap');
  if (!g) setTimeout(function(){ $('#gm-title').focus(); }, 50);
}
$('#gm-fab').addEventListener('click', function(){ openGameEdit(null); });
$('#gm-save').addEventListener('click', function(){
  var title = $('#gm-title').value.trim();
  if (!title) { gmErr(T.needName); return; }
  var body = {
    title: title, status: gmStatus, rating: gmRating, platform: $('#gm-platform').value, device_id: Number($('#gm-device').value) || 0,
    edition: $('#gm-edition').value, review: $('#gm-review').value, private: $('#gm-private').checked,
  };
  if (gmEditing) { body.op = 'game.edit'; body.id = gmEditing.id; } else body.op = 'game.add';
  var btn = $('#gm-save'); btn.disabled = true;
  op(body).then(function(j){
    var id = gmEditing ? gmEditing.id : j.id;
    return gmPhoto.commit(id).then(function(bad){ if (!bad) return; toast(T.photoFail); throw { quiet: true }; }).then(function(){ render(); close('gm-edit-wrap'); toast(T.saved); });
  }).catch(function(e){ if (e && e.quiet) { render(); close('gm-edit-wrap'); return; } if (!e.sgxLocked) gmErr(errText(e)); }).then(function(){ btn.disabled = false; });
});
$('#gm-del').addEventListener('click', function(){
  if (!gmEditing || !UI) return;
  var id = gmEditing.id;
  UI.ask(T.delGame, T.del, function(){ op({ op: 'game.del', id: id }).then(function(){ close('gm-edit-wrap'); toast(T.deleted); }).catch(function(e){ if (!e.sgxLocked) toast(errText(e)); }); });
});

/* ---------- 启动 ---------- */
getJSON('/api/items').then(function(j){
  admin = !!j.admin; devices = j.devices || []; games = j.games || []; loaded = true;
  $('#dv-fab').dataset.admin = admin ? '1' : '';
  $('#gm-fab').dataset.admin = admin ? '1' : '';
  doc.querySelectorAll('.it-loading').forEach(function(el){ el.classList.add('hidden'); });
  render();
  if (G.SgxCurioTabs) G.SgxCurioTabs.refresh();
}).catch(function(e){
  if (e && e.sgxLocked) return;
  doc.querySelectorAll('.it-loading').forEach(function(el){ el.textContent = T.failed; });
});
})();
