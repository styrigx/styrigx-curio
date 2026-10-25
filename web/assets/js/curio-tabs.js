/* assets/js/curio-tabs.js —— 奇趣首页三个页签：发现 / 设备 / 游戏（顶栏分段滑块，同日刻的写法）。
 *
 * - hash：发现 = 无或 #c/<分类 id>（curio.js 管），#devices，#games。只用 replaceState，切页签不加历史。
 * - 切页签：面板 hidden + inert；滑块 --seg-pos；<html data-cu-tab>（CSS 据此只露当前页签的「收藏 / 设备 / 游戏」按钮）。
 *   每个页签记住自己的滚动位置；点当前页签回顶部。键盘 ← → Home End。左右滑（横向 ≥ 70px、明显比竖向多）也能切。
 * - 右下角按钮：发现 = #cu-fab（curio.js 按是否管理员显示），设备 = #dv-fab，游戏 = #gm-fab（curio-items.js 标 data-admin）。
 */
(function(){
"use strict";
var G = typeof globalThis !== 'undefined' ? globalThis : this;
var TABS = ['finds', 'devices', 'games'];

/** hash → 页签 */
function tabOf(hash){
  var h = String(hash || '');
  if (h === '#devices' || h.indexOf('#devices/') === 0) return 'devices';
  if (h === '#games' || h.indexOf('#games/') === 0) return 'games';
  return 'finds';
}
/** 切到某个页签时 hash 写成什么：发现保留现有的 #c/<id>，其余固定 */
function hashFor(tab, cur){
  if (tab === 'devices') return '#devices';
  if (tab === 'games') return '#games';
  return /^#c\/\d+$/.test(String(cur || '')) ? cur : '';
}
var pure = { TABS: TABS, tabOf: tabOf, hashFor: hashFor };
if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

var doc = G.document;
var seg = doc.querySelector('[data-cu-seg]');
if (!seg) return;
var btns = TABS.map(function(id){ return doc.querySelector('[data-cu-tab="' + id + '"]'); });
var tab = '';
var scrolls = {};
function reduced(){ return doc.documentElement.classList.contains('reduced-motion') || (G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function fabs(){
  var dv = doc.getElementById('dv-fab'), gm = doc.getElementById('gm-fab');
  if (dv) dv.classList.toggle('hidden', !(tab === 'devices' && dv.dataset.admin));
  if (gm) gm.classList.toggle('hidden', !(tab === 'games' && gm.dataset.admin));
}
function setTab(next, opts){
  opts = opts || {};
  var i = TABS.indexOf(next);
  if (i < 0) return;
  if (tab) scrolls[tab] = G.scrollY;
  var changed = next !== tab;
  tab = next;
  btns.forEach(function(b, j){ if (!b) return; b.setAttribute('aria-selected', j === i ? 'true' : 'false'); b.tabIndex = j === i ? 0 : -1; });
  TABS.forEach(function(id){
    var p = doc.getElementById('cu-pane-' + id);
    if (!p) return;
    if (id === next) { p.hidden = false; p.removeAttribute('inert'); } else { p.hidden = true; p.setAttribute('inert', ''); }
  });
  seg.style.setProperty('--seg-pos', String(i));
  doc.documentElement.setAttribute('data-cu-tab', next);
  fabs();
  var h = hashFor(next, G.location.hash);
  var url = G.location.pathname + G.location.search + h;
  if (url !== G.location.pathname + G.location.search + G.location.hash) { try { G.history.replaceState(G.history.state, '', url); } catch (e) {} }
  if (opts.focus && btns[i]) btns[i].focus();
  if (changed && !opts.initial) G.scrollTo({ top: scrolls[next] || 0, behavior: 'auto' });
}
btns.forEach(function(b, i){
  if (!b) return;
  b.addEventListener('click', function(){
    if (TABS[i] === tab) { G.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; }
    setTab(TABS[i]);
  });
});
seg.addEventListener('keydown', function(e){
  var i = TABS.indexOf(tab), n = -1;
  if (e.key === 'ArrowRight') n = (i + 1) % 3; else if (e.key === 'ArrowLeft') n = (i + 2) % 3;
  else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = 2;
  if (n < 0) return;
  e.preventDefault(); setTab(TABS[n], { focus: true });
});
G.addEventListener('hashchange', function(){ var t = tabOf(G.location.hash); if (t !== tab) setTab(t); });
/* 左右滑切页签（竖着滑照常滚动；分类条自己横向滚，不算） */
(function(){
  var panes = doc.getElementById('cu-panes'), x0 = 0, y0 = 0, t0 = 0, on = false;
  if (!panes) return;
  panes.addEventListener('touchstart', function(e){
    if (e.touches.length !== 1 || (e.target.closest && e.target.closest('.cu-chips'))) { on = false; return; }
    on = true; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  panes.addEventListener('touchend', function(e){
    if (!on) return; on = false;
    var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - t0 > 700) return;
    var i = TABS.indexOf(tab) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TABS.length) setTab(TABS[i]);
  }, { passive: true });
})();
G.SgxCurioTabs = { refresh: fabs, current: function(){ return tab; } };
setTab(tabOf(G.location.hash), { initial: true });
})();
