/* assets/js/curio.js —— 奇趣首页逻辑（浏览器 IIFE；node 测试时导出纯函数）。
 *
 * - 分类筛选条（全部 + 每个分类，hash #c/<分类 id>，只用 replaceState）；顶栏长条里的搜索框即时筛选名字 / 简介 / 网址（不分大小写）。
 * - 按分类分组的格子：图标（/api/icon?id=，R2 缓存；取不到显示首字母方块）、名字、简介；私密的带小锁（只有主人看得到私密的）。
 *   点格子在新标签页打开网址。
 * - 主人：右下角「收藏」新建；长按格子（或键盘 Enter 以外的 E 键）编辑；分类条右边「⋯」：管理分类 / 导入浏览器书签 / 导出书签。
 *   编辑弹层：网址（「自动填写」抓标题、简介、图标）、名字、英文名和英文简介、简介、分类（可就地新建）、自定义图标、仅自己可见、上移 / 下移、删除。
 * - 中英文：名字、简介各两份，当前语言那份为空时显示另一份。
 *
 * 数据：GET /api/links；写：POST /api/links {op}、POST /api/import（原文）；GET /api/preview；导出是 /api/export 的下载链接。
 * 读请求走 sgxLockSync.apiFetch（401 = 锁定 → 刷新去锁屏）。纯函数导出给 tests/web/curio.test.mjs。
 */
(function(){
"use strict";
var G = typeof globalThis !== 'undefined' ? globalThis : this;

/* ================= 纯函数 ================= */

/** 双语字段取当前语言，空就用另一种 */
function pick(pair, en){
  if (!pair) return '';
  return (en ? (pair.en || pair.zh) : (pair.zh || pair.en)) || '';
}

/** 网址的域名（去 www.），坏网址返回原文 */
function hostOf(url){
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return String(url || ''); }
}

/** 首字母方块里的字：名字第一个字（字母大写），没有就用域名 */
function initial(name, url){
  var s = String(name || '').trim() || hostOf(url);
  var ch = Array.from(s)[0] || '?';
  return ch.toUpperCase();
}

/** 首字母方块的色相（同一个域名永远同一个颜色） */
function hue(url){
  var s = hostOf(url), h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** hash → 选中的分类 id（0 = 全部） */
function parseHash(hash){
  var m = /^#c\/(\d+)$/.exec(String(hash || ''));
  return m ? Number(m[1]) : 0;
}
function catHash(id){ return id ? '#c/' + id : ''; }

/**
 * 筛选：cat 为 0 是全部；q 按空白切成多个词，每个词都要出现在名字（两种语言）、简介（两种语言）或网址里。
 * 返回新的分类数组（不改原数组）。有搜索词时只留有命中的分类；没有搜索词时空分类也保留（主人要能看到、往里加；访客拿到的本来就没有空分类）。
 */
function filterCats(cats, q, cat){
  var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  var out = [];
  (cats || []).forEach(function(c){
    if (cat && c.id !== cat) return;
    var links = (c.links || []).filter(function(l){
      if (!words.length) return true;
      var hay = [l.name && l.name.zh, l.name && l.name.en, l.desc && l.desc.zh, l.desc && l.desc.en, l.url].join(' ').toLowerCase();
      return words.every(function(w){ return hay.indexOf(w) >= 0; });
    });
    if (links.length || !words.length) out.push({ id: c.id, name: c.name, private: c.private, links: links });
  });
  return out;
}

/** 数一共多少条 */
function countLinks(cats){
  return (cats || []).reduce(function(n, c){ return n + (c.links || []).length; }, 0);
}

/** 把 id 在列表里往前 / 往后挪一位，返回新的 id 数组；挪不动返回 null */
function moveId(ids, id, dir){
  var i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  var out = ids.slice();
  out[i] = ids[j]; out[j] = id;
  return out;
}

/** 输入的网址补协议：没写 http(s):// 的当 https；空返回 '' */
function normalizeUrl(s){
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    var u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) { return ''; }
}

/** 导入结果的一句话 */
function importSummary(r, en){
  if (en) return 'Added ' + r.added + (r.added === 1 ? ' link' : ' links') + (r.cats_added ? ', ' + r.cats_added + ' new ' + (r.cats_added === 1 ? 'category' : 'categories') : '') + (r.skipped ? '; ' + r.skipped + ' already here' : '') + '.';
  return '新增 ' + r.added + ' 条' + (r.cats_added ? '、' + r.cats_added + ' 个分类' : '') + (r.skipped ? '，' + r.skipped + ' 条已经有了' : '') + '。';
}

var pure = { pick: pick, hostOf: hostOf, initial: initial, hue: hue, parseHash: parseHash, catHash: catHash, filterCats: filterCats, countLinks: countLinks, moveId: moveId, normalizeUrl: normalizeUrl, importSummary: importSummary };
if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }
G.SgxCurio = pure;

/* ================= 页面 ================= */
var doc = G.document;
var isEn = doc.documentElement.lang === 'en';
var T = isEn ? {
  all: 'All', add: 'Keep a link', edit: 'Edit', saved: 'Saved.', deleted: 'Deleted.', failed: 'Something went wrong. Please try again.',
  needUrl: 'Enter a valid web address.', needName: 'Give it a name.', needCat: 'Pick a category.', dup: 'You already kept this one.',
  priv: 'Only you can see this', emptyOwner: 'Nothing kept yet. Tap "Keep" or import your browser bookmarks.', emptyVisitor: 'Nothing here yet.',
  noMatch: 'Nothing matches.', filling: 'Fetching…', fillFail: 'Couldn\'t read that page. Fill it in yourself.',
  delLink: 'Delete this link?', delCat: 'Delete this category?', notEmpty: 'Empty the category first.', del: 'Delete',
  importing: 'Importing…', notBookmarks: 'That isn\'t a bookmarks file.', emptyFile: 'No links in that file.', tooLarge: 'The file is too large.',
  limit: 'That would go over the limit.', backup: 'Couldn\'t back up the file, so nothing was imported.', count: function(n){ return n + (n === 1 ? ' link' : ' links'); },
  makePrivate: 'Only me', makePublic: 'Visible to visitors', up: 'Move up', down: 'Move down'
} : {
  all: '全部', add: '收藏', edit: '编辑', saved: '已保存', deleted: '已删除', failed: '出了点问题，请再试一次。',
  needUrl: '填一个有效的网址。', needName: '起个名字。', needCat: '选一个分类。', dup: '这个网址已经收藏过了。',
  priv: '仅自己可见', emptyOwner: '还没有收藏。点「收藏」，或者导入浏览器书签。', emptyVisitor: '这里还空着。',
  noMatch: '没有找到。', filling: '正在读取…', fillFail: '读不到这个网页，手动填一下吧。',
  delLink: '确定删除这条收藏吗？', delCat: '确定删除这个分类吗？', notEmpty: '先把分类清空。', del: '删除',
  importing: '正在导入…', notBookmarks: '这不是书签文件。', emptyFile: '文件里没有网址。', tooLarge: '文件太大了。',
  limit: '超出上限了。', backup: '备份原文件失败，所以没有导入。', count: function(n){ return n + ' 条'; },
  makePrivate: '仅自己可见', makePublic: '访客可见', up: '上移', down: '下移'
};

var $ = function(s){ return doc.querySelector(s); };
var cats = [];
var owner = false;
var loaded = false;
var cat = 0;
var query = '';
var editing = null; /* 正在编辑的收藏（null = 新建） */
var editCat = 0;
var toastTimer = null;

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function getJSON(url){
  var f = G.sgxLockSync ? G.sgxLockSync.apiFetch : function(u, o){ return fetch(u, o); };
  return f(url, { credentials: 'same-origin', cache: 'no-store' }).then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function send(url, body, type){
  return fetch(url, {
    method: 'POST', credentials: 'same-origin', redirect: 'manual',
    headers: { 'Content-Type': type || 'application/json' },
    body: type ? body : JSON.stringify(body),
  }).then(function(r){
    if (r.type === 'opaqueredirect' || r.status === 401) { G.location.reload(); throw Object.assign(new Error('locked'), { sgxLocked: true }); }
    return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { code: j.error }); return j; });
  });
}
function op(body){ return send('/api/links', body).then(function(j){ cats = j.cats || []; render(); return j; }); }
function toast(msg){
  var el = $('#bk-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.add('hidden'); }, 2400);
}
function errText(e){
  var c = e && e.code;
  return c === 'duplicate' ? T.dup : c === 'not-empty' ? T.notEmpty : c === 'bad-url' ? T.needUrl : c === 'bad-name' ? T.needName
    : c === 'not-bookmarks' ? T.notBookmarks : c === 'empty' ? T.emptyFile : c === 'too-large' ? T.tooLarge : c === 'limit' ? T.limit : c === 'backup' ? T.backup : T.failed;
}

/** 长按（≈550ms，手指不挪）触发 fn；触发后吞掉随后的那次点击（不打开网址） */
function onLongPress(root, sel, fn){
  var timer = 0, x0 = 0, y0 = 0, fired = false;
  root.addEventListener('pointerdown', function(e){
    var el = e.target.closest && e.target.closest(sel);
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    fired = false; x0 = e.clientX; y0 = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(function(){ fired = true; fn(el); }, 550);
  });
  root.addEventListener('pointermove', function(e){ if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) clearTimeout(timer); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(t){ root.addEventListener(t, function(){ clearTimeout(timer); }); });
  root.addEventListener('contextmenu', function(e){ if (owner && e.target.closest && e.target.closest(sel)) e.preventDefault(); });
  root.addEventListener('click', function(e){ if (fired) { fired = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

/* ---------- 弹层 ---------- */
function openOverlay(id){ var el = doc.getElementById(id); if (!el) return; el.classList.add('open'); doc.body.style.overflow = 'hidden'; }
function closeOverlay(id){
  var el = doc.getElementById(id); if (!el) return;
  el.classList.remove('open');
  if (!doc.querySelector('.bk-overlay.open')) doc.body.style.overflow = '';
}
doc.querySelectorAll('[data-close]').forEach(function(b){ b.addEventListener('click', function(){ closeOverlay(b.dataset.close + '-wrap'); }); });
doc.addEventListener('keydown', function(e){
  if (e.key !== 'Escape') return;
  var open = doc.querySelectorAll('.bk-overlay.open');
  if (open.length) closeOverlay(open[open.length - 1].id);
});
var confirmFn = null;
function ask(msg, okLabel, fn){
  $('#confirm-msg').textContent = msg;
  $('#confirm-ok').textContent = okLabel;
  confirmFn = fn;
  openOverlay('confirm-wrap');
}
$('#confirm-cancel').addEventListener('click', function(){ confirmFn = null; closeOverlay('confirm-wrap'); });
$('#confirm-ok').addEventListener('click', function(){ var f = confirmFn; confirmFn = null; closeOverlay('confirm-wrap'); if (f) f(); });

/* ---------- 画 ---------- */
var LOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function findLink(id){
  for (var i = 0; i < cats.length; i++) for (var j = 0; j < cats[i].links.length; j++) if (cats[i].links[j].id === id) return { cat: cats[i], link: cats[i].links[j] };
  return null;
}
function tileHTML(l, c){
  var name = pick(l.name, isEn) || hostOf(l.url);
  var desc = pick(l.desc, isEn) || hostOf(l.url);
  var locked = owner && (l.private || c.private);
  return '<a class="cu-tile" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" data-id="' + l.id + '" title="' + esc(desc + ' · ' + l.url) + '">'
    + '<span class="cu-ic" style="--cu-h:' + hue(l.url) + '"><span class="cu-ic-letter" aria-hidden="true">' + esc(initial(name, l.url)) + '</span>'
    + '<img src="/api/icon?id=' + l.id + '" alt="" width="48" height="48" loading="lazy" decoding="async" onerror="this.remove()"></span>'
    + '<span class="cu-name">' + esc(name) + '</span>'
    + (locked ? '<span class="cu-lock" role="img" aria-label="' + esc(T.priv) + '" title="' + esc(T.priv) + '">' + LOCK + '</span>' : '')
    + '</a>';
}
function renderChips(){
  var html = '<button type="button" role="tab" class="cu-chip" aria-selected="' + (cat === 0) + '" data-cat="0">' + esc(T.all) + '</button>';
  cats.forEach(function(c){
    if (!owner && !c.links.length) return;
    html += '<button type="button" role="tab" class="cu-chip" aria-selected="' + (cat === c.id) + '" data-cat="' + c.id + '">'
      + (owner && c.private ? '<span class="cu-chip-lock">' + LOCK + '</span>' : '') + esc(pick(c.name, isEn)) + '</button>';
  });
  $('#cu-chips').innerHTML = html;
  var sel = $('#cu-chips [aria-selected="true"]');
  if (sel && sel.scrollIntoView && cat) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function render(){
  if (cat && !cats.some(function(c){ return c.id === cat; })) cat = 0;
  renderChips();
  var shown = filterCats(cats, query, cat);
  var list = $('#cu-list');
  list.innerHTML = shown.map(function(c){
    return '<section class="cu-sec" data-cat="' + c.id + '"><h2 class="cu-sec-h"><span>' + esc(pick(c.name, isEn)) + '</span>'
      + (owner && c.private ? '<span class="cu-lock-inline" title="' + esc(T.priv) + '">' + LOCK + '</span>' : '')
      + '<span class="cu-sec-n">' + esc(T.count(c.links.length)) + '</span></h2>'
      + '<div class="cu-grid">' + c.links.map(function(l){ return tileHTML(l, c); }).join('') + '</div></section>';
  }).join('');
  var empty = $('#cu-empty');
  var none = loaded && !countLinks(shown);
  empty.textContent = query ? T.noMatch : owner ? T.emptyOwner : T.emptyVisitor;
  empty.classList.toggle('hidden', !none);
}

/* ---------- 筛选 ---------- */
$('#cu-chips').addEventListener('click', function(e){
  var b = e.target.closest('[data-cat]');
  if (!b) return;
  cat = Number(b.dataset.cat) || 0;
  try { G.history.replaceState(null, '', G.location.pathname + G.location.search + catHash(cat)); } catch (err) {}
  render();
  G.scrollTo({ top: 0, behavior: 'auto' });
});
var qInput = $('#cu-q');
if (qInput) {
  qInput.addEventListener('input', function(){
    query = qInput.value;
    $('#cu-q-clear').classList.toggle('hidden', !query);
    render();
  });
  qInput.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); qInput.blur(); } });
  $('#cu-q-clear').addEventListener('click', function(){ qInput.value = ''; query = ''; $('#cu-q-clear').classList.add('hidden'); render(); qInput.focus(); });
}

/* ---------- 编辑 ---------- */
function setErr(msg){ var el = $('#edit-err'); el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }
function renderCatPicker(){
  $('#f-cats').innerHTML = cats.map(function(c){
    return '<button type="button" role="radio" class="cu-chip cu-chip-sm" aria-checked="' + (editCat === c.id) + '" data-cat="' + c.id + '">' + esc(pick(c.name, isEn)) + '</button>';
  }).join('');
}
$('#f-cats').addEventListener('click', function(e){
  var b = e.target.closest('[data-cat]');
  if (!b) return;
  editCat = Number(b.dataset.cat);
  renderCatPicker();
});
function openEdit(link, inCat){
  editing = link;
  var en2 = isEn ? 'zh' : 'en', en1 = isEn ? 'en' : 'zh';
  $('#edit-title').textContent = link ? T.edit : T.add;
  $('#f-url').value = link ? link.url : '';
  $('#f-name').value = link ? (link.name[en1] || '') : '';
  $('#f-desc').value = link ? (link.desc[en1] || '') : '';
  $('#f-name2').value = link ? (link.name[en2] || '') : '';
  $('#f-desc2').value = link ? (link.desc[en2] || '') : '';
  var hasSecond = !!(link && (link.name[en2] || link.desc[en2]));
  $('#f-en-wrap').classList.toggle('hidden', !hasSecond);
  $('#f-en-toggle').classList.toggle('hidden', hasSecond);
  $('#f-icon').value = link ? (link.icon || '') : '';
  $('#f-icon-wrap').classList.toggle('hidden', !(link && link.icon));
  $('#f-icon-toggle').classList.toggle('hidden', !!(link && link.icon));
  $('#f-private').checked = !!(link && link.private);
  editCat = inCat || cat || (cats[0] && cats[0].id) || 0;
  $('#f-cat-name').value = '';
  renderCatPicker();
  $('#f-move').classList.toggle('hidden', !link);
  $('#edit-del').classList.toggle('hidden', !link);
  setErr('');
  openOverlay('edit-wrap');
  if (!link) setTimeout(function(){ $('#f-url').focus(); }, 50);
}
$('#f-en-toggle').addEventListener('click', function(){ $('#f-en-wrap').classList.remove('hidden'); $('#f-en-toggle').classList.add('hidden'); $('#f-name2').focus(); });
$('#f-icon-toggle').addEventListener('click', function(){ $('#f-icon-wrap').classList.remove('hidden'); $('#f-icon-toggle').classList.add('hidden'); $('#f-icon').focus(); });
$('#f-fill').addEventListener('click', function(){
  var url = normalizeUrl($('#f-url').value);
  if (!url) { setErr(T.needUrl); return; }
  $('#f-url').value = url;
  var btn = $('#f-fill');
  btn.disabled = true; btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = T.filling;
  setErr('');
  fetch('/api/preview?url=' + encodeURIComponent(url), { credentials: 'same-origin', redirect: 'manual' }).then(function(r){ return r.json(); }).then(function(j){
    if (!j.ok) { setErr(T.fillFail); return; }
    if (!$('#f-name').value && j.title) $('#f-name').value = j.title;
    if (!$('#f-desc').value && j.desc) $('#f-desc').value = j.desc;
    if (j.url && j.url !== url) $('#f-url').value = j.url;
  }).catch(function(){ setErr(T.fillFail); }).then(function(){ btn.disabled = false; btn.textContent = btn.dataset.label; });
});
$('#f-cat-add').addEventListener('click', function(){
  var name = $('#f-cat-name').value.trim();
  if (!name) return;
  var before = cats.map(function(c){ return c.id; });
  op({ op: 'cat.add', name: isEn ? { zh: '', en: name } : { zh: name, en: '' } }).then(function(){
    var nc = cats.filter(function(c){ return before.indexOf(c.id) < 0; })[0];
    if (nc) editCat = nc.id;
    $('#f-cat-name').value = '';
    renderCatPicker();
  }).catch(function(e){ if (!e.sgxLocked) setErr(errText(e)); });
});
$('#edit-save').addEventListener('click', function(){
  var url = normalizeUrl($('#f-url').value);
  if (!url) { setErr(T.needUrl); return; }
  var a = $('#f-name').value.trim(), b = $('#f-name2').value.trim();
  if (!a && !b) { setErr(T.needName); return; }
  if (!editCat) { setErr(T.needCat); return; }
  var name = isEn ? { en: a, zh: b } : { zh: a, en: b };
  var desc = isEn ? { en: $('#f-desc').value.trim(), zh: $('#f-desc2').value.trim() } : { zh: $('#f-desc').value.trim(), en: $('#f-desc2').value.trim() };
  var body = { url: url, name: name, desc: desc, icon: $('#f-icon').value.trim() ? normalizeUrl($('#f-icon').value) : '', private: $('#f-private').checked };
  if (editing) { body.op = 'link.edit'; body.id = editing.id; body.cat = editCat; } else { body.op = 'link.add'; body.cat = editCat; }
  var btn = $('#edit-save');
  btn.disabled = true;
  op(body).then(function(){ closeOverlay('edit-wrap'); toast(T.saved); }).catch(function(e){ if (!e.sgxLocked) setErr(errText(e)); }).then(function(){ btn.disabled = false; });
});
$('#edit-del').addEventListener('click', function(){
  if (!editing) return;
  var id = editing.id;
  ask(T.delLink, T.del, function(){
    op({ op: 'link.del', id: id }).then(function(){ closeOverlay('edit-wrap'); toast(T.deleted); }).catch(function(e){ if (!e.sgxLocked) toast(errText(e)); });
  });
});
function moveLink(dir){
  if (!editing) return;
  var hit = findLink(editing.id);
  if (!hit) return;
  var ids = moveId(hit.cat.links.map(function(l){ return l.id; }), editing.id, dir);
  if (!ids) return;
  op({ op: 'link.order', cat: hit.cat.id, ids: ids }).catch(function(e){ if (!e.sgxLocked) toast(errText(e)); });
}
$('#f-up').addEventListener('click', function(){ moveLink(-1); });
$('#f-down').addEventListener('click', function(){ moveLink(1); });
$('#cu-fab').addEventListener('click', function(){ openEdit(null); });

/* 主人：长按格子编辑；键盘：格子上按 E 编辑 */
onLongPress($('#cu-list'), '.cu-tile', function(el){
  if (!owner) return;
  var hit = findLink(Number(el.dataset.id));
  if (hit) { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} openEdit(hit.link, hit.cat.id); }
});
$('#cu-list').addEventListener('keydown', function(e){
  if (!owner || (e.key !== 'e' && e.key !== 'E')) return;
  var el = e.target.closest && e.target.closest('.cu-tile');
  var hit = el && findLink(Number(el.dataset.id));
  if (hit) { e.preventDefault(); openEdit(hit.link, hit.cat.id); }
});

/* ---------- 菜单 / 分类 / 导入 ---------- */
$('#cu-menu-btn').addEventListener('click', function(){ openOverlay('menu-wrap'); });
$('#menu-cats').addEventListener('click', function(){ closeOverlay('menu-wrap'); renderCatsSheet(); openOverlay('cats-wrap'); });
$('#menu-import').addEventListener('click', function(){ closeOverlay('menu-wrap'); resetImport(); openOverlay('import-wrap'); });
$('#menu-export').addEventListener('click', function(){ closeOverlay('menu-wrap'); });

function renderCatsSheet(){
  var ids = cats.map(function(c){ return c.id; });
  $('#cats-list').innerHTML = cats.map(function(c, i){
    return '<div class="cu-catrow" data-id="' + c.id + '">'
      + '<input type="text" maxlength="80" value="' + esc(pick(c.name, isEn)) + '" aria-label="' + esc(pick(c.name, isEn)) + '">'
      + '<span class="cu-catrow-n">' + c.links.length + '</span>'
      + '<button type="button" class="cu-rbtn" data-act="priv" aria-pressed="' + !!c.private + '" title="' + esc(c.private ? T.makePublic : T.makePrivate) + '" aria-label="' + esc(T.makePrivate) + '">' + LOCK + '</button>'
      + '<button type="button" class="cu-rbtn" data-act="up" aria-label="' + esc(T.up) + '"' + (i === 0 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>'
      + '<button type="button" class="cu-rbtn" data-act="down" aria-label="' + esc(T.down) + '"' + (i === ids.length - 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>'
      + '<button type="button" class="cu-rbtn cu-rbtn-x" data-act="del" aria-label="' + esc(T.del) + '"' + (c.links.length ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'
      + '</div>';
  }).join('');
}
function catOp(body){ return op(body).then(renderCatsSheet).catch(function(e){ if (!e.sgxLocked) toast(errText(e)); }); }
$('#cats-list').addEventListener('click', function(e){
  var b = e.target.closest('[data-act]');
  if (!b) return;
  var id = Number(b.closest('[data-id]').dataset.id);
  var c = cats.filter(function(x){ return x.id === id; })[0];
  if (!c) return;
  var act = b.dataset.act;
  if (act === 'priv') catOp({ op: 'cat.edit', id: id, private: !c.private });
  else if (act === 'up' || act === 'down') { var ids = moveId(cats.map(function(x){ return x.id; }), id, act === 'up' ? -1 : 1); if (ids) catOp({ op: 'cat.order', ids: ids }); }
  else if (act === 'del') ask(T.delCat, T.del, function(){ catOp({ op: 'cat.del', id: id }); });
});
$('#cats-list').addEventListener('change', function(e){
  var input = e.target;
  if (input.tagName !== 'INPUT') return;
  var id = Number(input.closest('[data-id]').dataset.id);
  var c = cats.filter(function(x){ return x.id === id; })[0];
  var v = input.value.trim();
  if (!c || !v || v === pick(c.name, isEn)) { if (c) input.value = pick(c.name, isEn); return; }
  var name = { zh: c.name.zh, en: c.name.en };
  if (isEn) name.en = v; else name.zh = v;
  catOp({ op: 'cat.edit', id: id, name: name });
});
$('#cats-add').addEventListener('click', function(){
  var v = $('#cats-new').value.trim();
  if (!v) return;
  catOp({ op: 'cat.add', name: isEn ? { zh: '', en: v } : { zh: v, en: '' } }).then(function(){ $('#cats-new').value = ''; });
});

var impFile = null;
function impMsg(text, bad){ var el = $('#imp-msg'); el.textContent = text || ''; el.classList.toggle('hidden', !text); el.classList.toggle('text-m-error', !!bad); }
function resetImport(){
  impFile = null;
  $('#imp-file').value = '';
  var nameEl = $('#imp-file-name');
  nameEl.textContent = nameEl.dataset.ph || nameEl.textContent;
  nameEl.dataset.ph = nameEl.textContent;
  $('#imp-go').disabled = true;
  impMsg('');
}
$('#imp-file').addEventListener('change', function(){
  impFile = this.files && this.files[0] || null;
  var nameEl = $('#imp-file-name');
  nameEl.dataset.ph = nameEl.dataset.ph || nameEl.textContent;
  nameEl.textContent = impFile ? impFile.name : nameEl.dataset.ph;
  $('#imp-go').disabled = !impFile;
  impMsg('');
});
$('#imp-go').addEventListener('click', function(){
  if (!impFile) return;
  var btn = $('#imp-go');
  btn.disabled = true;
  impMsg(T.importing);
  impFile.text().then(function(text){
    return send('/api/import' + ($('#imp-private').checked ? '' : '?private=0'), text, 'text/html');
  }).then(function(j){
    cats = j.cats || [];
    render();
    impMsg(importSummary(j, isEn));
    impFile = null;
  }).catch(function(e){ if (!e.sgxLocked) { impMsg(errText(e), true); btn.disabled = false; } });
});

/* ---------- 启动 ---------- */
function boot(){
  cat = parseHash(G.location.hash);
  getJSON('/api/links').then(function(j){
    owner = !!j.owner;
    cats = j.cats || [];
    loaded = true;
    doc.documentElement.classList.toggle('cu-owner', owner);
    $('#cu-fab').classList.toggle('hidden', !owner);
    $('#cu-menu-btn').classList.toggle('hidden', !owner);
    $('#cu-loading').classList.add('hidden');
    render();
  }).catch(function(e){
    if (e && e.sgxLocked) return;
    $('#cu-loading').textContent = T.failed;
  });
}
boot();
})();
