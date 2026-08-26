var App = (function () {
  'use strict';


  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }
  function fmtN(n) {
    if (typeof n === 'bigint') return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (!isFinite(n)) return String(n);
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function pct(a, b) { return b ? (100 - (a / b) * 100).toFixed(1) + '%' : '0%'; }


  function toast(msg, kind) {
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'err' ? 6000 : 3200);
  }

  function modal(opts) {
    var back = el('div', 'modal-back');
    var box = el('div', 'modal');
    if (opts.wide) box.classList.add('wide');
    var head = el('div', 'modal-h');
    head.appendChild(el('span', null, opts.title));
    var x = el('button', 'btn icon ghost', '×');
    head.appendChild(x);
    var body = el('div', 'modal-b');
    var foot = el('div', 'modal-f');
    box.appendChild(head); box.appendChild(body); box.appendChild(foot);
    back.appendChild(box);

    function close() { back.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { var p = opts.actions.filter(function (a) { return a.primary; })[0]; if (p) p.run(close, body); }
    }
    (opts.actions || []).forEach(function (a) {
      var b = el('button', 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), a.label);
      b.onclick = function () { a.run(close, body); };
      foot.appendChild(b);
      a.el = b;
    });
    x.onclick = close;
    back.onclick = function (e) { if (e.target === back) close(); };
    document.addEventListener('keydown', onKey, true);
    $('#modals').appendChild(back);
    if (opts.build) opts.build(body, close);
    var first = body.querySelector('input,textarea,select');
    if (first) setTimeout(function () { first.focus(); if (first.select) first.select(); }, 30);
    return { close: close, body: body };
  }

  function menu(anchor, items) {
    closeMenu();
    var m = el('div', 'menu');
    items.forEach(function (it) {
      if (it === '-') { m.appendChild(el('div', 'menu-sep')); return; }
      var b = el('button', 'menu-item' + (it.danger ? ' danger' : ''), it.label);
      if (it.hint) b.appendChild(el('span', 'menu-hint', it.hint));
      if (it.disabled) b.disabled = true;
      b.onclick = function () { closeMenu(); it.run(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 4, left = r.left;
    m.style.left = Math.min(left, window.innerWidth - m.offsetWidth - 8) + 'px';
    if (top + m.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 4);
    m.style.top = top + 'px';
    openMenuEl = m;
    setTimeout(function () { document.addEventListener('mousedown', onDocDown, true); }, 0);
  }
  var openMenuEl = null;
  function onDocDown(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
  function closeMenu() {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; document.removeEventListener('mousedown', onDocDown, true); }
  }

  var busyN = 0;
  function busy(msg) {
    busyN++;
    var b = $('#busy');
    $('#busy-msg').textContent = msg || 'Working...';
    b.hidden = false;
    var done = false;
    return {
      set: function (m) { $('#busy-msg').textContent = m; },
      end: function () { if (done) return; done = true; if (--busyN <= 0) { busyN = 0; $('#busy').hidden = true; } }
    };
  }


  var worker = null, workerReady = false, jobSeq = 0, pending = new Map();

  function startWorker() {
    try {
      var src = document.getElementById('worker-src');
      if (!src || !window.Worker) return;
      var b64 = src.textContent.trim();
      var bin = atob(b64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var blob = new Blob([arr], { type: 'text/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.job === 'ping') { workerReady = true; workerLabel(); return; }
        var p = pending.get(m.id);
        if (!p) return;
        if (m.progress !== undefined) { if (p.onProgress) p.onProgress(m.progress); return; }
        pending.delete(m.id);
        if (m.ok) p.resolve(m.res); else p.reject(new Error(m.err));
      };
      worker.onerror = function () {
        workerReady = false;
        workerLabel();
        pending.forEach(function (p) { try { p.resolve(Jobs.run(p.job, p.payload)); } catch (err) { p.reject(err); } });
        pending.clear();
      };
      worker.postMessage({ id: 0, job: 'ping' });
    } catch (e) { worker = null; }
  }

  function workerLabel() {
    var e = document.getElementById('status-right');
    if (e) e.textContent = worker && workerReady ? 'worker: on' : 'worker: off (inline)';
  }

  function runJob(job, payload, opts) {
    opts = opts || {};
    if (worker && workerReady) {
      var id = ++jobSeq;
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject, job: job, payload: payload, onProgress: opts.onProgress });
        worker.postMessage({ id: id, job: job, payload: payload }, opts.transfer || []);
      });
    }
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(Jobs.run(job, payload, opts.onProgress)); } catch (e) { reject(e); }
      }, 12);
    });
  }


  var uidSeq = 0, fileSeq = 0;
  var state = {
    files: [],
    activeId: null,
    tab: 'browse',
    query: '',
    typeFilter: -1,
    famFilter: 0,
    hideEmpty: true,
    focusUid: null,
    cmp: { a: null, b: null, mode: 'exact', rows: null, openName: null, detail: null, side: 'both' }
  };
  var uiState = new Map();
  var list = null, cmpList = null;

  function activeFile() {
    for (var i = 0; i < state.files.length; i++) if (state.files[i].id === state.activeId) return state.files[i];
    return null;
  }
  function fileById(id) {
    for (var i = 0; i < state.files.length; i++) if (state.files[i].id === id) return state.files[i];
    return null;
  }
  function setActive(f) {
    var prev = activeFile();
    if (prev && prev.kind !== f.kind) {
      state.typeFilter = -1;
      state.famFilter = 0;
      var tf = $('#f-type');
      if (tf) tf.dataset.kind = '';
    }
    state.activeId = f.id;
    state.focusUid = null;
  }

  function ui(cat) {
    var u = uiState.get(cat.uid);
    if (!u) { u = { open: false, sel: null }; uiState.set(cat.uid, u); }
    return u;
  }
  function selOf(cat) {
    var u = ui(cat);
    if (!u.sel) u.sel = new Set();
    return u.sel;
  }
  function selCount() {
    var f = activeFile(), t = 0;
    if (!f) return 0;
    for (var i = 0; i < f.cats.length; i++) { var u = uiState.get(f.cats[i].uid); if (u && u.sel) t += u.sel.size; }
    return t;
  }
  function clearSel() {
    uiState.forEach(function (u) { if (u.sel) u.sel.clear(); });
  }
  function catSelected() {
    var f = activeFile(), out = [];
    if (!f) return out;
    for (var i = 0; i < f.cats.length; i++) { var u = uiState.get(f.cats[i].uid); if (u && u.catSel) out.push(i); }
    return out;
  }

  function addFile(name, kind, cats, size) {
    cats.forEach(function (c) { c.uid = ++uidSeq; });
    var f = { id: ++fileSeq, name: name, kind: kind, cats: cats, dirty: false, undo: [], redo: [], size: size || 0 };
    state.files.push(f);
    setActive(f);
    renderFiles(); refreshList(); renderCmpPickers();
    return f;
  }


  function pushUndo(f, label) {
    f.undo.push({ cats: f.cats.slice(), label: label });
    if (f.undo.length > 60) f.undo.shift();
    f.redo.length = 0;
  }
  function undo() {
    var f = activeFile();
    if (!f || !f.undo.length) return;
    var s = f.undo.pop();
    f.redo.push({ cats: f.cats.slice(), label: s.label });
    f.cats = s.cats;
    f.dirty = true;
    clearSel();
    afterChange('Undid ' + s.label);
  }
  function redo() {
    var f = activeFile();
    if (!f || !f.redo.length) return;
    var s = f.redo.pop();
    f.undo.push({ cats: f.cats.slice(), label: s.label });
    f.cats = s.cats;
    clearSel();
    afterChange('Redid ' + s.label);
  }
  function replaceCat(f, i, cat) {
    cat.uid = f.cats[i].uid;
    f.cats[i] = cat;
  }
  function afterChange(msg) {
    var f = activeFile();
    if (f) f.dirty = true;
    invalidateCmp();
    renderFiles(); refreshList(); renderInfo();
    if (msg) toast(msg);
  }
  function invalidateCmp() { state.cmp.rows = null; state.cmp.detail = null; }


  function filterSpec() {
    var f = activeFile();
    var q = state.query.trim();
    var spec = { active: false, q: q.toLowerCase(), re: null, type: state.typeFilter, fam: state.famFilter, prefix: -1, range: null, octets: null, v6q: null };
    if (state.typeFilter !== -1 || state.famFilter) spec.active = true;
    if (!q) { spec.sig = sig(spec); return spec; }
    spec.active = true;

    if (q.length > 2 && q.charAt(0) === '/' && q.charAt(q.length - 1) === '/') {
      try { spec.re = new RegExp(q.slice(1, -1), 'i'); spec.q = ''; } catch (e) { spec.re = null; }
    }
    if (f && f.kind === 'geoip' && !spec.re) {
      if (/^\/\d{1,3}$/.test(q)) { spec.prefix = parseInt(q.slice(1), 10); spec.q = ''; }
      else if (q.indexOf('/') > 0) {
        var tmp = new Uint8Array(16), r = Cidr.parse(q, tmp, 0);
        if (r) { spec.range = Cidr.entryRange(tmp, [r.prefix], [r.fam], 0); spec.q = ''; }
      } else if (/^[0-9.]+$/.test(q)) {
        spec.octets = q.split('.');
      } else if (q.indexOf(':') >= 0 || /^[0-9a-f]+$/i.test(q)) {
        spec.v6q = q.toLowerCase();
      }
    }
    spec.sig = sig(spec);
    return spec;
  }
  function sig(s) {
    return [s.active, s.q, s.re ? s.re.source : '', s.type, s.fam, s.prefix,
      s.range ? s.range.fam + ':' + s.range.s + '-' + s.range.e : '', s.octets ? s.octets.join('.') : '', s.v6q].join('|');
  }

  function applyFilter(f, spec) {
    if (!f) return;
    for (var c = 0; c < f.cats.length; c++) {
      var cat = f.cats[c];
      if (cat._fsig === spec.sig) continue;
      cat._fsig = spec.sig;
      if (!spec.active) { cat._f = null; continue; }
      cat._f = cat.kind === 'geoip' ? filterIp(cat, spec) : filterSite(cat, spec);
    }
  }

  function filterSite(cat, spec) {
    var out = [], n = cat.n, q = spec.q, re = spec.re, tf = spec.type, val = cat.val, type = cat.type, attrs = cat.attrs;
    for (var i = 0; i < n; i++) {
      if (tf >= 0 && type[i] !== tf) continue;
      if (tf === -2 && !(attrs && attrs[i])) continue;
      var v = val[i];
      if (re) { if (!re.test(v)) continue; }
      else if (q && v.toLowerCase().indexOf(q) < 0) continue;
      out.push(i);
    }
    return Int32Array.from(out);
  }

  function filterIp(cat, spec) {
    var out = [], n = cat.n, ips = cat.ips, pfx = cat.pfx, fam = cat.fam;
    var oct = spec.octets, i, o;
    for (i = 0; i < n; i++) {
      if (spec.fam === -3) { if (Cidr.validAt(pfx, fam, i)) continue; }
      else if (spec.fam && (fam[i] !== spec.fam || !Cidr.validAt(pfx, fam, i))) continue;
      if (spec.prefix >= 0 && pfx[i] !== spec.prefix) continue;
      o = i * 16;
      if (spec.range) {
        var r = Cidr.entryRange(ips, pfx, fam, i);
        if (!r || r.fam !== spec.range.fam) continue;
        if (r.e < spec.range.s || r.s > spec.range.e) continue;
      } else if (oct) {
        if (fam[i] !== 4 || !matchOctets(ips, o, oct)) continue;
      } else if (spec.v6q) {
        if (fam[i] !== 6 || Cidr.v6Str(ips, o).indexOf(spec.v6q) < 0) continue;
      } else if (spec.re) {
        if (!spec.re.test(Cidr.fmt(ips, pfx, fam, i, cat.raw))) continue;
      } else if (spec.q) {
        if (Cidr.fmt(ips, pfx, fam, i, cat.raw).indexOf(spec.q) < 0) continue;
      }
      out.push(i);
    }
    return Int32Array.from(out);
  }

  function matchOctets(b, o, parts) {
    var np = parts.length;
    for (var k = 0; k < np; k++) {
      var p = parts[k];
      if (p === '') { if (k === np - 1) return true; return false; }
      if (k > 3) return false;
      var v = b[o + k];
      if (k === np - 1) {
        var s = '' + v;
        if (s.length < p.length || s.slice(0, p.length) !== p) return false;
      } else if (('' + v) !== p) return false;
    }
    return true;
  }

  function visCount(cat) { return cat._f ? cat._f.length : cat.n; }


  var rows = { cats: [], off: [], total: 0 };

  function rebuildRows() {
    var f = activeFile();
    rows.cats = []; rows.off = []; rows.total = 0;
    if (!f) return;
    var spec = filterSpec();
    applyFilter(f, spec);
    var total = 0;
    for (var i = 0; i < f.cats.length; i++) {
      var cat = f.cats[i], open = ui(cat).open;
      var vis = visCount(cat);
      if (spec.active && state.hideEmpty && vis === 0) continue;
      rows.cats.push(cat);
      rows.off.push(total);
      total += 1 + (open ? vis : 0);
    }
    rows.total = total;
  }

  function rowAt(i) {
    var off = rows.off, lo = 0, hi = off.length - 1, k = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (off[mid] <= i) { k = mid; lo = mid + 1; } else hi = mid - 1;
    }
    var cat = rows.cats[k], d = i - off[k];
    if (d === 0) return { cat: cat, ci: k, e: -1 };
    var j = d - 1;
    return { cat: cat, ci: k, e: cat._f ? cat._f[j] : j };
  }


  var TYPE_SHORT = ['kw', 're', 'dom', 'full'];
  function typeShort(t) { return TYPE_SHORT[t] || ('t' + t); }
  function typeCls(t) { return t < 4 ? 't' + t : 'tbad'; }

  function createRow() {
    var d = el('div', 'row');
    d.innerHTML =
      '<span class="chk"></span>' +
      '<span class="tw"></span>' +
      '<span class="bdg"></span>' +
      '<span class="txt"></span>' +
      '<span class="sub"></span>' +
      '<span class="acts">' +
      '<button class="ab a-add" title="Add entries">+</button>' +
      '<button class="ab a-opt" title="Optimize this category">⚡</button>' +
      '<button class="ab a-menu" title="Category actions">⋯</button>' +
      '<button class="ab a-del" title="Delete entry">×</button>' +
      '</span>';
    return d;
  }

  function quickStats(cat) {
    if (cat._qs) return cat._qs;
    var s;
    if (cat.kind === 'geoip') {
      var v4 = 0, v6 = 0, bad = 0;
      for (var i = 0; i < cat.n; i++) {
        if (!Cidr.validAt(cat.pfx, cat.fam, i)) bad++;
        else if (cat.fam[i] === 4) v4++;
        else v6++;
      }
      s = { v4: v4, v6: v6, bad: bad };
    } else {
      var t = [0, 0, 0, 0], at = 0, other = 0;
      for (var j = 0; j < cat.n; j++) {
        var ty = cat.type[j];
        if (ty < 4) t[ty]++; else other++;
        if (cat.attrs && cat.attrs[j]) at++;
      }
      s = { kw: t[0], re: t[1], dom: t[2], full: t[3], attr: at, other: other };
    }
    cat._qs = s;
    return s;
  }

  function renderRow(node, i) {
    var r = rowAt(i);
    if (!r.cat) return;
    var cat = r.cat, u = ui(cat);
    var chk = node.children[0], tw = node.children[1], bdg = node.children[2],
      txt = node.children[3], sub = node.children[4];
    node.dataset.i = i;
    if (r.e < 0) {
      node.className = 'row cat' + (u.open ? ' open' : '') + (u.catSel ? ' csel' : '') + (state.focusUid === cat.uid ? ' focus' : '');
      chk.className = 'chk' + (u.catSel ? ' on' : '');
      tw.textContent = u.open ? '▾' : '▸';
      var qs = quickStats(cat);
      bdg.className = 'bdg cat-bdg';
      bdg.textContent = '';
      txt.textContent = cat.name;
      var vis = visCount(cat);
      var s = (vis !== cat.n ? fmtN(vis) + ' of ' + fmtN(cat.n) : fmtN(cat.n)) + (cat.kind === 'geoip' ? ' CIDRs' : ' rules');
      if (cat.kind === 'geoip') {
        s += '  ·  v4 ' + fmtN(qs.v4) + (qs.v6 ? ' · v6 ' + fmtN(qs.v6) : '');
        if (qs.bad) s += ' · ' + fmtN(qs.bad) + ' invalid';
        if (cat.reverse) s += '  ·  reverse-match';
      } else {
        var bits = [];
        if (qs.dom) bits.push('dom ' + fmtN(qs.dom));
        if (qs.full) bits.push('full ' + fmtN(qs.full));
        if (qs.kw) bits.push('kw ' + fmtN(qs.kw));
        if (qs.re) bits.push('re ' + fmtN(qs.re));
        if (qs.attr) bits.push('attr ' + fmtN(qs.attr));
        if (qs.other) bits.push(fmtN(qs.other) + ' unknown type');
        if (bits.length) s += '  ·  ' + bits.join(' · ');
      }
      sub.textContent = s;
    } else {
      var sel = u.sel && u.sel.has(r.e);
      node.className = 'row ent' + (sel ? ' sel' : '');
      chk.className = 'chk' + (sel ? ' on' : '');
      tw.textContent = '';
      if (cat.kind === 'geoip') {
        var fam = cat.fam[r.e], p = cat.pfx[r.e];
        var okv = Cidr.validAt(cat.pfx, cat.fam, r.e);
        bdg.className = 'bdg ' + (!okv ? 'tbad' : fam === 6 ? 'tv6' : 'tv4');
        bdg.textContent = !okv ? 'bad' : fam === 6 ? 'v6' : 'v4';
        txt.textContent = Cidr.fmt(cat.ips, cat.pfx, cat.fam, r.e, cat.raw);
        sub.textContent = !okv
          ? (fam ? 'prefix /' + p + ' is out of range for IPv' + fam + ' — xray ignores this entry'
                 : 'ip is not 4 or 16 bytes — xray ignores this entry')
          : fam === 4
            ? (p === 32 ? 'host' : fmtN(Math.pow(2, 32 - p)) + ' addrs')
            : (p === 128 ? 'host' : '2^' + (128 - p) + ' addrs');
      } else {
        var t = cat.type[r.e];
        bdg.className = 'bdg ' + typeCls(t);
        bdg.textContent = typeShort(t);
        txt.textContent = cat.val[r.e];
        var at = cat.attrs ? cat.attrs[r.e] : null;
        sub.textContent = at ? at.map(function (a) { return '@' + a.k + (a.v === true ? '' : '=' + a.v); }).join(' ') : '';
      }
    }
  }

  function refreshList() {
    rebuildRows();
    if (!list) return;
    list.count = rows.total;
    list.invalidate();
    renderBars();
  }


  function renderFiles() {
    var box = $('#files');
    box.innerHTML = '';
    if (!state.files.length) {
      box.appendChild(el('div', 'empty', 'No files loaded.'));
      $('#file-count').textContent = '';
    } else {
      $('#file-count').textContent = state.files.length;
    }
    state.files.forEach(function (f) {
      var d = el('div', 'file' + (f.id === state.activeId ? ' on' : ''));
      var top = el('div', 'file-top');
      top.appendChild(el('span', 'file-kind ' + f.kind, f.kind === 'geoip' ? 'IP' : 'SITE'));
      top.appendChild(el('span', 'file-name', f.name + (f.dirty ? ' •' : '')));
      var x = el('button', 'ab', '×');
      x.title = 'Close file';
      x.onclick = function (e) {
        e.stopPropagation();
        if (f.dirty && !confirm('Close "' + f.name + '"? Unsaved edits are lost.')) return;
        state.files = state.files.filter(function (o) { return o !== f; });
        if (state.activeId === f.id) state.activeId = state.files.length ? state.files[0].id : null;
        invalidateCmp();
        renderFiles(); refreshList(); renderCmpPickers(); renderInfo();
      };
      top.appendChild(x);
      d.appendChild(top);
      var n = GeoDat.countEntries(f.cats);
      d.appendChild(el('div', 'file-sub', fmtN(f.cats.length) + ' categories · ' + fmtN(n) + ' entries'));
      d.onclick = function () {
        if (state.activeId === f.id) return;
        setActive(f);
        renderFiles(); refreshList(); renderInfo();
      };
      box.appendChild(d);
    });
  }

  function renderBars() {
    var f = activeFile();
    var has = !!f;
    $('#pane-browse').classList.toggle('no-file', !has);
    var n = selCount(), cs = catSelected();
    var sb = $('#selbar');
    sb.hidden = !(n || cs.length);
    if (!sb.hidden) {
      $('#sel-info').textContent =
        (n ? fmtN(n) + ' entr' + (n === 1 ? 'y' : 'ies') : '') +
        (n && cs.length ? '  ·  ' : '') +
        (cs.length ? fmtN(cs.length) + ' categor' + (cs.length === 1 ? 'y' : 'ies') : '') + ' selected';
      $('#sel-merge').disabled = cs.length < 2;
      $('#sel-del-e').disabled = !n;
      $('#sel-move').disabled = !n;
      $('#sel-copy').disabled = !n;
      $('#sel-del-c').disabled = !cs.length;
    }
    var total = f ? GeoDat.countEntries(f.cats) : 0;
    var shown = 0;
    for (var i = 0; i < rows.cats.length; i++) shown += visCount(rows.cats[i]);
    $('#status-left').textContent = f
      ? f.name + '  ·  ' + fmtN(f.cats.length) + ' categories  ·  ' + fmtN(total) + ' entries' +
      (state.query || state.typeFilter !== -1 || state.famFilter ? '  ·  ' + fmtN(shown) + ' match filter' : '')
      : 'Import a geoip.dat / geosite.dat file to begin.';
    workerLabel();
    $('#btn-undo').disabled = !(f && f.undo.length);
    $('#btn-redo').disabled = !(f && f.redo.length);
    $('#btn-undo').title = f && f.undo.length ? 'Undo ' + f.undo[f.undo.length - 1].label : 'Undo';
    var tf = $('#f-type');
    if (f && tf.dataset.kind !== f.kind) {
      tf.dataset.kind = f.kind;
      tf.innerHTML = '';
      var opts = f.kind === 'geoip'
        ? [['-1', 'All families'], ['4', 'IPv4 only'], ['6', 'IPv6 only'], ['-3', 'invalid only']]
        : [['-1', 'All types'], ['3', 'full:'], ['2', 'domain:'], ['0', 'keyword:'], ['1', 'regexp:'], ['-2', 'has @attribute']];
      opts.forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; tf.appendChild(op); });
      tf.value = '-1';
    }
  }

  function renderInfo() {
    var box = $('#info');
    box.innerHTML = '';
    var f = activeFile();
    if (!f || state.focusUid == null) { box.appendChild(el('div', 'empty', 'Select a category to see details.')); return; }
    var cat = null;
    for (var i = 0; i < f.cats.length; i++) if (f.cats[i].uid === state.focusUid) cat = f.cats[i];
    if (!cat) { box.appendChild(el('div', 'empty', 'Select a category to see details.')); return; }

    box.appendChild(el('div', 'info-name', cat.name));
    var tbl = el('div', 'info-t');
    function row(k, v, cls) {
      tbl.appendChild(el('div', 'info-k', k));
      tbl.appendChild(el('div', 'info-v' + (cls ? ' ' + cls : ''), v));
    }
    var qs = quickStats(cat);
    row('entries', fmtN(cat.n));
    if (cat.kind === 'geoip') {
      row('IPv4', fmtN(qs.v4));
      row('IPv6', fmtN(qs.v6));
      if (qs.bad) row('invalid', fmtN(qs.bad) + ' (xray ignores)', 'warn');
      if (cat.reverse) row('reverse', 'yes', 'warn');
      var cache = cat._st;
      if (cache) {
        row('merged ranges', fmtN(cache.ranges4 + cache.ranges6));
        row('optimal CIDRs', fmtN(cache.optimal) + (cache.optimal < cat.n ? '  (-' + pct(cache.optimal, cat.n) + ')' : ''), cache.optimal < cat.n ? 'good' : '');
        row('IPv4 space', fmtN(cache.addrs4) + ' addrs');
      } else {
        row('analysis', 'computing...');
        var uidAt = cat.uid, nAt = cat.n;
        runJob('stats', { cat: strip(cat) }).then(function (res) {
          cat._st = res.stats;
          if (state.focusUid === uidAt && cat.n === nAt) renderInfo();
        }).catch(function () {});
      }
    } else {
      row('domain:', fmtN(qs.dom));
      row('full:', fmtN(qs.full));
      row('keyword:', fmtN(qs.kw));
      row('regexp:', fmtN(qs.re));
      row('with @attrs', fmtN(qs.attr));
      if (qs.other) row('unknown type', fmtN(qs.other), 'warn');
    }
    box.appendChild(tbl);
    var acts = el('div', 'info-acts');
    var b1 = el('button', 'btn sm', 'Optimize');
    b1.onclick = function () { optimizeCats([cat]); };
    var b2 = el('button', 'btn sm', 'Add entries');
    b2.onclick = function () { addEntriesModal(cat); };
    var b3 = el('button', 'btn sm', 'Export .txt');
    b3.onclick = function () { exportCatText(cat); };
    acts.appendChild(b1); acts.appendChild(b2); acts.appendChild(b3);
    box.appendChild(acts);
  }

  function strip(cat) {
    return cat.kind === 'geoip'
      ? { kind: 'geoip', name: cat.name, n: cat.n, ips: cat.ips, pfx: cat.pfx, fam: cat.fam, reverse: cat.reverse, raw: cat.raw || null, bad: cat.bad || 0 }
      : { kind: 'geosite', name: cat.name, n: cat.n, type: cat.type, val: cat.val, attrs: cat.attrs };
  }


  var lastClickRow = -1;

  function onListClick(e) {
    if (e.shiftKey) { var g = window.getSelection(); if (g) g.removeAllRanges(); }
    var node = e.target;
    while (node && node !== list.el && !(node.classList && node.classList.contains('row'))) node = node.parentNode;
    if (!node || node === list.el) return;
    var i = parseInt(node.dataset.i, 10);
    var r = rowAt(i);
    if (!r.cat) return;
    var f = activeFile();
    var btn = e.target.classList && e.target.classList.contains('ab') ? e.target : null;

    if (r.e < 0) {
      var u = ui(r.cat);
      if (btn) {
        if (btn.classList.contains('a-add')) return addEntriesModal(r.cat);
        if (btn.classList.contains('a-opt')) return optimizeCats([r.cat]);
        if (btn.classList.contains('a-menu')) return catMenu(btn, r.cat);
      }
      state.focusUid = r.cat.uid;
      if (e.target.classList.contains('chk')) {
        u.catSel = !u.catSel;
      } else {
        u.open = !u.open;
        if (u.open && r.cat.n > 500000 && !u.warned) { u.warned = true; }
      }
      refreshList(); renderInfo();
      return;
    }

    if (btn && btn.classList.contains('a-del')) {
      var s = new Set([r.e]);
      applyEdit(f, r.cat, 'delete 1 entry', function (cat) { return Model.removeIndices(cat, s); });
      return;
    }
    var sel = selOf(r.cat);
    state.focusUid = r.cat.uid;
    if (e.shiftKey && lastClickRow >= 0) {
      var a = Math.min(lastClickRow, i), b = Math.max(lastClickRow, i);
      for (var k = a; k <= b; k++) {
        var rr = rowAt(k);
        if (rr.e >= 0 && rr.cat === r.cat) sel.add(rr.e);
      }
    } else if (e.metaKey || e.ctrlKey || e.target.classList.contains('chk')) {
      if (sel.has(r.e)) sel.delete(r.e); else sel.add(r.e);
      lastClickRow = i;
    } else {
      var only = sel.size === 1 && sel.has(r.e);
      clearSel();
      if (!only) sel.add(r.e);
      lastClickRow = i;
    }
    refreshList(); renderInfo();
  }

  function catMenu(anchor, cat) {
    var f = activeFile();
    var idx = f.cats.indexOf(cat);
    var others = state.files.filter(function (o) { return o !== f && o.kind === f.kind; });
    menu(anchor, [
      { label: 'Add entries...', run: function () { addEntriesModal(cat); } },
      { label: 'Optimize', hint: cat.kind === 'geoip' ? 'merge CIDRs' : 'dedupe + fold', run: function () { optimizeCats([cat]); } },
      { label: 'Sort entries', run: function () { sortCat(cat); } },
      '-',
      { label: 'Rename...', run: function () { renameCat(cat); } },
      { label: 'Duplicate', run: function () { duplicateCat(cat); } },
      {
        label: 'Copy to file...', disabled: !others.length, run: function () { copyCatToFile(cat, others); }
      },
      { label: 'Export as .txt', run: function () { exportCatText(cat); } },
      '-',
      { label: 'Select all entries', run: function () { var s = selOf(cat); var f2 = cat._f; if (f2) { for (var i = 0; i < f2.length; i++) s.add(f2[i]); } else { for (var j = 0; j < cat.n; j++) s.add(j); } ui(cat).open = true; refreshList(); } },
      { label: 'Clear entries', danger: true, run: function () { applyEdit(f, cat, 'clear ' + cat.name, function (c) { return Model.emptyCat(c.kind, c.name); }); } },
      {
        label: 'Delete category', danger: true, run: function () {
          pushUndo(f, 'delete category ' + cat.name);
          f.cats.splice(idx, 1);
          if (state.focusUid === cat.uid) state.focusUid = null;
          afterChange('Deleted ' + cat.name);
        }
      }
    ]);
  }


  function applyEdit(f, cat, label, fn) {
    var i = f.cats.indexOf(cat);
    if (i < 0) return;
    pushUndo(f, label);
    replaceCat(f, i, fn(cat));
    clearSelFor(cat);
    afterChange();
  }
  function clearSelFor(cat) {
    var u = uiState.get(cat.uid);
    if (u && u.sel) u.sel.clear();
  }

  function deleteSelectedEntries() {
    var f = activeFile();
    if (!f) return;
    var total = selCount();
    if (!total) return;
    pushUndo(f, 'delete ' + fmtN(total) + ' entries');
    for (var i = 0; i < f.cats.length; i++) {
      var cat = f.cats[i], u = uiState.get(cat.uid);
      if (!u || !u.sel || !u.sel.size) continue;
      replaceCat(f, i, Model.removeIndices(cat, u.sel));
      u.sel.clear();
    }
    afterChange('Deleted ' + fmtN(total) + ' entries');
  }

  function selectedChunks() {
    var f = activeFile(), out = [];
    for (var i = 0; i < f.cats.length; i++) {
      var cat = f.cats[i], u = uiState.get(cat.uid);
      if (!u || !u.sel || !u.sel.size) continue;
      var idx = Array.from(u.sel).sort(function (a, b) { return a - b; });
      out.push({ cat: cat, idx: idx, chunk: Model.pick(cat, idx) });
    }
    return out;
  }

  function moveOrCopySelected(move) {
    var f = activeFile();
    var chunks = selectedChunks();
    if (!chunks.length) return;
    var total = chunks.reduce(function (a, c) { return a + c.idx.length; }, 0);
    modal({
      title: (move ? 'Move ' : 'Copy ') + fmtN(total) + ' entries',
      build: function (b) {
        b.appendChild(el('label', 'lbl', 'Destination category'));
        var sel = el('select', 'inp');
        var opt = el('option', null, '+ New category...');
        opt.value = '__new__';
        sel.appendChild(opt);
        f.cats.forEach(function (c, i) { var o = el('option', null, c.name + '  (' + fmtN(c.n) + ')'); o.value = i; sel.appendChild(o); });
        b.appendChild(sel);
        var nameWrap = el('div', 'sub-field');
        nameWrap.appendChild(el('label', 'lbl', 'New category name'));
        var nm = el('input', 'inp');
        nm.value = Model.uniqueName(f.cats, 'NEW');
        nameWrap.appendChild(nm);
        b.appendChild(nameWrap);
        sel.onchange = function () { nameWrap.style.display = sel.value === '__new__' ? '' : 'none'; };
        b._sel = sel; b._nm = nm;
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: move ? 'Move' : 'Copy', primary: true, run: function (close, body) {
            var sel = body._sel, nm = body._nm;
            pushUndo(f, (move ? 'move ' : 'copy ') + fmtN(total) + ' entries');
            var merged = Model.concat(chunks.map(function (c) { return c.chunk; }), 'X', f.kind);
            if (move) {
              chunks.forEach(function (c) {
                var ci = f.cats.indexOf(c.cat);
                if (ci >= 0) replaceCat(f, ci, Model.removeIndices(c.cat, new Set(c.idx)));
              });
            }
            if (sel.value === '__new__') {
              var cat = Model.withName(merged, Model.uniqueName(f.cats, nm.value.trim() || 'NEW'));
              cat.uid = ++uidSeq;
              f.cats.push(cat);
            } else {
              var ti = parseInt(sel.value, 10);
              replaceCat(f, ti, Model.append(f.cats[ti], merged));
            }
            clearSel();
            afterChange((move ? 'Moved ' : 'Copied ') + fmtN(total) + ' entries');
            close();
          }
        }
      ]
    });
  }

  function optimizeCats(cats, opts) {
    var f = activeFile();
    if (!cats.length) return;
    var kind = f.kind;
    if (kind === 'geosite' && !opts) return optimizeSiteModal(cats);
    var bs = busy('Optimizing ' + (cats.length > 1 ? cats.length + ' categories' : cats[0].name) + '...');
    var before = 0, after = 0, invalid = 0;
    var jobs = cats.map(function (cat) {
      return runJob('optimize', { cat: strip(cat), opts: opts || {} }).then(function (res) {
        return { cat: cat, res: res };
      });
    });
    Promise.all(jobs).then(function (list2) {
      pushUndo(f, 'optimize ' + (cats.length > 1 ? cats.length + ' categories' : cats[0].name));
      list2.forEach(function (r) {
        var i = f.cats.indexOf(r.cat);
        if (i < 0) return;
        before += r.res.before; after += r.res.after; invalid += r.res.invalid || 0;
        replaceCat(f, i, r.res.cat);
      });
      clearSel();
      bs.end();
      var note = invalid ? '  ·  ' + fmtN(invalid) + ' invalid entr' + (invalid === 1 ? 'y' : 'ies') + ' kept as-is' : '';
      afterChange((before === after
        ? 'Already optimal (' + fmtN(before) + ' entries)'
        : 'Optimized: ' + fmtN(before) + ' → ' + fmtN(after) + '  (-' + pct(after, before) + ')') + note);
    }).catch(function (e) { bs.end(); toast('Optimize failed: ' + e.message, 'err'); });
  }

  function optimizeSiteModal(cats) {
    modal({
      title: 'Optimize ' + (cats.length > 1 ? cats.length + ' categories' : cats[0].name),
      build: function (b) {
        b.appendChild(el('p', 'note', 'Deduplicates identical rules and removes rules already covered by a broader one. Entries carrying @attributes are never folded away.'));
        b.appendChild(check('opt-fold', 'Fold subdomains into their domain: rule', true));
        b.appendChild(check('opt-kw', 'Also fold anything matched by a keyword: rule', false));
        b.appendChild(check('opt-sort', 'Sort alphabetically', false));
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: 'Optimize', primary: true, run: function (close, body) {
            close();
            optimizeCats(cats, {
              fold: $('#opt-fold', body).checked,
              foldKeyword: $('#opt-kw', body).checked,
              sort: $('#opt-sort', body).checked
            });
          }
        }
      ]
    });
  }

  function check(id, label, on) {
    var w = el('label', 'chk-line');
    var c = el('input');
    c.type = 'checkbox'; c.id = id; c.checked = !!on;
    w.appendChild(c);
    w.appendChild(el('span', null, label));
    return w;
  }

  function sortCat(cat) {
    var f = activeFile();
    if (cat.kind === 'geoip') {
      runJob('sort', { cat: strip(cat), how: 'ip' }).then(function (r) {
        applyEdit(f, cat, 'sort ' + cat.name, function () { return r.cat; });
      });
      return;
    }
    modal({
      title: 'Sort ' + cat.name,
      build: function (b) {
        b.appendChild(el('label', 'lbl', 'Order'));
        var s = el('select', 'inp');
        [['value', 'Alphabetical by value'], ['host', 'By reversed host (groups by TLD/domain)'], ['type', 'By rule type, then value']]
          .forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; s.appendChild(op); });
        b.appendChild(s);
        b._s = s;
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: 'Sort', primary: true, run: function (close, body) {
            var how = body._s.value;
            close();
            runJob('sort', { cat: strip(cat), how: how }).then(function (r) {
              applyEdit(f, cat, 'sort ' + cat.name, function () { return r.cat; });
            });
          }
        }
      ]
    });
  }

  function renameCat(cat) {
    var f = activeFile();
    modal({
      title: 'Rename category',
      build: function (b) {
        b.appendChild(el('label', 'lbl', 'Name'));
        var i = el('input', 'inp');
        i.value = cat.name;
        b.appendChild(i);
        b._i = i;
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: 'Rename', primary: true, run: function (close, body) {
            var v = body._i.value.trim();
            if (!v) return;
            close();
            applyEdit(f, cat, 'rename ' + cat.name, function (c) { return Model.withName(c, v); });
          }
        }
      ]
    });
  }

  function duplicateCat(cat) {
    var f = activeFile();
    pushUndo(f, 'duplicate ' + cat.name);
    var copy = Model.shallow(cat);
    copy.name = Model.uniqueName(f.cats, cat.name + '-COPY');
    copy.uid = ++uidSeq;
    f.cats.splice(f.cats.indexOf(cat) + 1, 0, copy);
    afterChange('Duplicated ' + cat.name);
  }

  function copyCatToFile(cat, others) {
    modal({
      title: 'Copy "' + cat.name + '" to another file',
      build: function (b) {
        b.appendChild(el('label', 'lbl', 'Target file'));
        var s = el('select', 'inp');
        others.forEach(function (o, i) { var op = el('option', null, o.name); op.value = i; s.appendChild(op); });
        b.appendChild(s);
        b.appendChild(check('cp-merge', 'Merge into an existing category with the same name', true));
        b._s = s;
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: 'Copy', primary: true, run: function (close, body) {
            var target = others[parseInt(body._s.value, 10)];
            var merge = $('#cp-merge', body).checked;
            var existing = -1;
            if (merge) for (var i = 0; i < target.cats.length; i++) if (target.cats[i].name.toUpperCase() === cat.name.toUpperCase()) { existing = i; break; }
            if (existing >= 0 && Model.reverseClash([target.cats[existing], cat])) {
              toast('Cannot merge into ' + target.cats[existing].name + ': one side is reverse-match and the other is not', 'err');
              return;
            }
            pushUndo(target, 'copy in ' + cat.name);
            if (existing >= 0) {
              var m = Model.append(target.cats[existing], cat);
              m.uid = target.cats[existing].uid;
              target.cats[existing] = m;
            } else {
              var c2 = Model.shallow(cat);
              c2.name = Model.uniqueName(target.cats, cat.name);
              c2.uid = ++uidSeq;
              target.cats.push(c2);
            }
            target.dirty = true;
            close();
            invalidateCmp(); renderFiles(); refreshList();
            toast('Copied ' + cat.name + ' to ' + target.name);
          }
        }
      ]
    });
  }

  function mergeSelectedCats() {
    var f = activeFile();
    var idx = catSelected();
    if (idx.length < 2) return;
    if (Model.reverseClash(idx.map(function (i) { return f.cats[i]; }))) {
      toast('Cannot merge: the selection mixes reverse-match categories with normal ones — their union has no single-category form', 'err');
      return;
    }
    var names = idx.map(function (i) { return f.cats[i].name; });
    modal({
      title: 'Merge ' + idx.length + ' categories',
      build: function (b) {
        b.appendChild(el('p', 'note', names.join(', ')));
        b.appendChild(el('label', 'lbl', 'Merged category name'));
        var i = el('input', 'inp');
        i.value = Model.uniqueName(f.cats, names[0] + '-MERGED');
        b.appendChild(i);
        b.appendChild(check('mg-del', 'Remove the source categories', true));
        if (f.kind === 'geosite') {
          b.appendChild(check('mg-fold', 'Fold subdomains covered by a domain: rule', true));
          b.appendChild(check('mg-kw', 'Also fold keyword-covered rules', false));
        } else {
          b.appendChild(el('p', 'note', 'CIDRs are deduplicated and adjacent/contained blocks are merged into the largest possible ones.'));
        }
        b._i = i;
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: 'Merge', primary: true, run: function (close, body) {
            var name = body._i.value.trim() || 'MERGED';
            var del = $('#mg-del', body).checked;
            var opts = f.kind === 'geosite'
              ? { fold: $('#mg-fold', body).checked, foldKeyword: $('#mg-kw', body).checked }
              : {};
            close();
            var bs = busy('Merging ' + idx.length + ' categories...');
            runJob('merge', { cats: idx.map(function (i) { return strip(f.cats[i]); }), name: name, opts: opts }).then(function (res) {
              if (res.reverseClash) { bs.end(); toast('Merge aborted: the sources disagree on reverse-match', 'err'); return; }
              pushUndo(f, 'merge ' + idx.length + ' categories');
              var at = idx[0];
              res.cat.uid = ++uidSeq;
              if (del) {
                for (var k = idx.length - 1; k >= 0; k--) f.cats.splice(idx[k], 1);
                f.cats.splice(Math.min(at, f.cats.length), 0, res.cat);
              } else {
                f.cats.push(res.cat);
              }
              uiState.forEach(function (u) { u.catSel = false; });
              clearSel();
              state.focusUid = res.cat.uid;
              bs.end();
              afterChange('Merged into ' + res.cat.name + ': ' + fmtN(res.before) + ' → ' + fmtN(res.after) + ' entries');
            }).catch(function (e) { bs.end(); toast('Merge failed: ' + e.message, 'err'); });
          }
        }
      ]
    });
  }

  function deleteSelectedCats() {
    var f = activeFile();
    var idx = catSelected();
    if (!idx.length) return;
    if (!confirm('Delete ' + idx.length + ' categor' + (idx.length === 1 ? 'y' : 'ies') + '?')) return;
    pushUndo(f, 'delete ' + idx.length + ' categories');
    for (var k = idx.length - 1; k >= 0; k--) f.cats.splice(idx[k], 1);
    uiState.forEach(function (u) { u.catSel = false; });
    state.focusUid = null;
    afterChange('Deleted ' + idx.length + ' categories');
  }


  function addEntriesModal(cat) {
    var f = activeFile();
    entryTextModal({
      title: 'Add entries to ' + cat.name,
      kind: f.kind,
      submit: 'Add',
      onOk: function (chunk, opts) {
        var bs = busy('Adding ' + fmtN(chunk.n) + ' entries...');
        runJob('append', { cat: strip(cat), chunk: chunk, opts: opts }).then(function (res) {
          var i = f.cats.indexOf(cat);
          if (i < 0) { bs.end(); toast(cat.name + ' is gone — nothing added', 'err'); return; }
          pushUndo(f, 'add ' + fmtN(chunk.n) + ' entries');
          replaceCat(f, i, res.cat);
          ui(f.cats[i]).open = true;
          bs.end();
          afterChange('Added ' + fmtN(chunk.n) + ' entries (' + fmtN(res.after) + ' total)');
        }).catch(function (e) { bs.end(); toast(e.message, 'err'); });
      }
    });
  }

  function newCategoryModal() {
    var f = activeFile();
    if (!f) return;
    entryTextModal({
      title: 'New category in ' + f.name,
      kind: f.kind,
      submit: 'Create',
      withName: Model.uniqueName(f.cats, 'NEW'),
      onOk: function (chunk, opts, name) {
        var cat = Model.withName(chunk, Model.uniqueName(f.cats, name || 'NEW'));
        cat.kind = f.kind;
        if (opts.optimize) cat = Model.optimize(cat, opts).cat;
        cat.uid = ++uidSeq;
        pushUndo(f, 'new category ' + cat.name);
        f.cats.push(cat);
        state.focusUid = cat.uid;
        ui(cat).open = true;
        afterChange('Created ' + cat.name + ' with ' + fmtN(cat.n) + ' entries');
      }
    });
  }

  function entryTextModal(o) {
    modal({
      wide: true,
      title: o.title,
      build: function (b) {
        var nm = null;
        if (o.withName != null) {
          b.appendChild(el('label', 'lbl', 'Category name'));
          nm = el('input', 'inp');
          nm.value = o.withName;
          b.appendChild(nm);
        }
        b.appendChild(el('label', 'lbl', o.kind === 'geoip'
          ? 'CIDRs or IPs, one per line'
          : 'Rules, one per line (full: / domain: / keyword: / regexp:, bare value = domain:)'));
        var ta = el('textarea', 'inp mono');
        ta.rows = 12;
        ta.placeholder = o.kind === 'geoip'
          ? '1.0.0.0/24\n8.8.8.8\n2001:db8::/32'
          : 'example.com\nfull:www.example.com @ads\nkeyword:tracker\nregexp:^ads[0-9]+\\.';
        b.appendChild(ta);
        var stat = el('div', 'parse-stat');
        b.appendChild(stat);
        b.appendChild(check('ae-opt', o.kind === 'geoip' ? 'Optimize (merge CIDRs) after adding' : 'Deduplicate after adding', true));
        var t = null;
        ta.oninput = function () {
          clearTimeout(t);
          t = setTimeout(function () {
            var res = TextFmt.parse(o.kind, ta.value);
            stat.innerHTML = '';
            stat.appendChild(el('span', 'good', fmtN(res.n) + ' valid'));
            if (res.errors.length) {
              stat.appendChild(el('span', 'bad', fmtN(res.errors.length) + ' rejected'));
              var d = el('div', 'errs');
              res.errors.slice(0, 6).forEach(function (e2) {
                d.appendChild(el('div', null, 'line ' + e2.line + ': ' + e2.msg + '  —  ' + e2.text.trim().slice(0, 60)));
              });
              if (res.errors.length > 6) d.appendChild(el('div', null, '...and ' + (res.errors.length - 6) + ' more'));
              stat.appendChild(d);
            }
            b._res = res;
          }, 180);
        };
        b._ta = ta; b._nm = nm;
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: o.submit, primary: true, run: function (close, body) {
            var res = TextFmt.parse(o.kind, body._ta.value);
            if (!res.n) { toast('Nothing valid to add', 'err'); return; }
            var opts = { optimize: $('#ae-opt', body).checked, fold: false };
            close();
            o.onOk(res, opts, body._nm ? body._nm.value.trim() : null);
          }
        }
      ]
    });
  }


  function fileByName(name) {
    for (var i = 0; i < state.files.length; i++) if (state.files[i].name === name) return state.files[i];
    return null;
  }

  function loadBytes(name, bytes) {
    for (var i = state.files.length - 1; i >= 0; i--) {
      if (state.files[i].name === name) state.files.splice(i, 1);
    }
    var f = new File([bytes], name, { type: 'application/octet-stream' });
    return handleFiles([f]).then(function () { return fileByName(name); });
  }

  function bytesOf(f) {
    f = f || activeFile();
    if (!f) return Promise.reject(new Error('no file is open'));
    var cats = f.cats.map(strip);
    if (!cats.length) return Promise.reject(new Error(f.name + ' has no categories left'));
    return runJob('write', { kind: f.kind, cats: cats }).then(function (res) { return res.buf; });
  }

  function markSaved(f) { if (f) { f.dirty = false; renderFiles(); } }


  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    var bs = busy('Reading ' + files.length + ' file(s)...');
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return file.arrayBuffer().then(function (buf) {
          bs.set('Parsing ' + file.name + '...');
          var isText = /\.(txt|list|csv|conf)$/i.test(file.name);
          if (isText) return importText(file, buf);
          return runJob('parse', { buf: buf, name: file.name }, {
            transfer: [buf],
            onProgress: function (p) { bs.set('Parsing ' + file.name + ' ' + Math.round(p * 100) + '%'); }
          }).then(function (res) {
            addFile(file.name, res.kind, res.cats, file.size);
            var badN = res.cats.reduce(function (a, c) { return a + (c.bad || 0); }, 0);
            toast('Loaded ' + file.name + ': ' + fmtN(res.cats.length) + ' categories, ' + fmtN(GeoDat.countEntries(res.cats)) + ' entries');
            if (badN) toast(fmtN(badN) + ' entr' + (badN === 1 ? 'y' : 'ies') + ' in ' + file.name + ' are not routable and are ignored by xray — filter "invalid only" to see them', 'warn');
          }).catch(function (e) {
            toast(file.name + ': ' + e.message, 'err');
          });
        });
      });
    });
    return chain.then(function () { bs.end(); renderCmpPickers(); });
  }

  function importText(file, buf) {
    var text = new TextDecoder().decode(new Uint8Array(buf));
    var kind = TextFmt.sniffText(text) || 'geosite';
    var res = TextFmt.parse(kind, text);
    var base = file.name.replace(/\.[^.]+$/, '').toUpperCase();
    var f = activeFile();
    if (f && f.kind === kind) {
      pushUndo(f, 'import ' + file.name);
      var cat = Model.withName(res, Model.uniqueName(f.cats, base));
      cat.uid = ++uidSeq;
      f.cats.push(cat);
      afterChange('Imported ' + file.name + ' as category ' + cat.name + ' (' + fmtN(res.n) + ' entries)');
    } else {
      var cat2 = Model.withName(res, base);
      addFile(file.name, kind, [cat2], file.size);
      toast('Imported ' + file.name + ' as a new ' + kind + ' file');
    }
    if (res.errors.length) {
      toast(fmtN(res.errors.length) + ' line' + (res.errors.length === 1 ? '' : 's') + ' in ' + file.name +
        ' rejected — first: ' + res.errors[0].msg, 'warn');
    }
    return Promise.resolve();
  }

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
  }

  function exportDat(catsOverride, nameOverride) {
    var f = activeFile();
    if (!f) return;
    var cats = (catsOverride || f.cats).map(strip);
    if (!cats.length) { toast('Nothing to export', 'err'); return; }
    var bs = busy('Building ' + (f.kind === 'geoip' ? 'geoip.dat' : 'geosite.dat') + '...');
    runJob('write', { kind: f.kind, cats: cats }).then(function (res) {
      var buf = res.buf;
      bs.end();
      var name = nameOverride || (f.name.match(/\.dat$/i) ? f.name : f.name + '.dat');
      download(name, new Blob([buf], { type: 'application/octet-stream' }));
      f.dirty = false;
      renderFiles();
      toast('Exported ' + name + ' (' + fmtBytes(buf.length) + ', ' + fmtN(GeoDat.countEntries(cats)) + ' entries)');
    }).catch(function (e) { bs.end(); toast('Export failed: ' + e.message, 'err'); });
  }

  function exportCatText(cat) {
    var txt = TextFmt.toText(cat);
    download(cat.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') + '.txt', new Blob([txt], { type: 'text/plain' }));
  }

  function exportAllText() {
    var f = activeFile();
    if (!f) return;
    var parts = f.cats.map(function (c) { return '# ' + c.name + ' (' + c.n + ')\n' + TextFmt.toText(c); });
    download(f.name.replace(/\.[^.]+$/, '') + '.txt', new Blob([parts.join('\n\n')], { type: 'text/plain' }));
  }

  function exportMenu(anchor) {
    var f = activeFile();
    if (!f) return;
    var cs = catSelected();
    menu(anchor, [
      { label: 'Export .dat', hint: f.kind, run: function () { exportDat(); } },
      { label: 'Export selected categories as .dat', disabled: !cs.length, run: function () { exportDat(cs.map(function (i) { return f.cats[i]; }), 'subset-' + f.name.replace(/\.dat$/i, '') + '.dat'); } },
      '-',
      { label: 'Export all categories as .txt', run: exportAllText },
      { label: 'Export focused category as .txt', disabled: state.focusUid == null, run: function () { var c = f.cats.filter(function (x) { return x.uid === state.focusUid; })[0]; if (c) exportCatText(c); } }
    ]);
  }

  function newFileModal() {
    modal({
      title: 'New file',
      build: function (b) {
        b.appendChild(el('label', 'lbl', 'Kind'));
        var s = el('select', 'inp');
        var o1 = el('option', null, 'geoip  (CIDR lists)'); o1.value = 'geoip';
        var o2 = el('option', null, 'geosite  (domain rules)'); o2.value = 'geosite';
        s.appendChild(o1); s.appendChild(o2);
        b.appendChild(s);
        b.appendChild(el('label', 'lbl', 'File name'));
        var i = el('input', 'inp');
        i.value = 'geoip.dat';
        b.appendChild(i);
        s.onchange = function () { i.value = s.value + '.dat'; };
        b._s = s; b._i = i;
      },
      actions: [
        { label: 'Cancel', run: function (c) { c(); } },
        {
          label: 'Create', primary: true, run: function (close, body) {
            var kind = body._s.value, name = body._i.value.trim() || (kind + '.dat');
            close();
            addFile(name, kind, [], 0);
            toast('Created empty ' + kind + ' file');
          }
        }
      ]
    });
  }


  function renderCmpPickers() {
    var a = $('#cmp-a'), b = $('#cmp-b');
    var prevA = state.cmp.a, prevB = state.cmp.b;
    [a, b].forEach(function (sel) {
      sel.innerHTML = '';
      state.files.forEach(function (f) {
        var o = el('option', null, f.name + '  [' + f.kind + ']');
        o.value = f.id;
        sel.appendChild(o);
      });
    });
    if (state.files.length) {
      a.value = prevA && fileById(prevA) ? prevA : state.files[0].id;
      var other = state.files.filter(function (f) { return String(f.id) !== a.value; })[0];
      b.value = prevB && fileById(prevB) ? prevB : (other ? other.id : state.files[0].id);
      state.cmp.a = parseInt(a.value, 10);
      state.cmp.b = parseInt(b.value, 10);
    }
    var f = fileById(state.cmp.a);
    $('#cmp-mode').disabled = !f || f.kind !== 'geoip';
    if (f && f.kind !== 'geoip') { $('#cmp-mode').value = 'exact'; state.cmp.mode = 'exact'; }
  }

  function runCompare(reopenName) {
    var A = fileById(state.cmp.a), B = fileById(state.cmp.b);
    if (!A || !B) { toast('Load two files first', 'err'); return; }
    if (A === B) { toast('Pick two different files', 'err'); return; }
    if (A.kind !== B.kind) { toast('Cannot compare ' + A.kind + ' with ' + B.kind, 'err'); return; }
    var bs = busy('Comparing ' + A.name + ' with ' + B.name + '...');
    runJob('fileDiff', { a: A.cats.map(strip), b: B.cats.map(strip), mode: state.cmp.mode }).then(function (res) {
      bs.end();
      state.cmp.rows = res.rows;
      state.cmp.detail = null;
      state.cmp.openName = null;
      renderCmpTable();
      var dup = res.rows.filter(function (r) { return r.dupA || r.dupB; });
      if (dup.length) {
        toast(dup.length + ' category name' + (dup.length === 1 ? ' is' : 's are') + ' used more than once — like xray, only the first copy of each is compared', 'warn');
      }
      if (reopenName) openCmpDetail(reopenName);
    }).catch(function (e) { bs.end(); toast('Compare failed: ' + e.message, 'err'); });
  }

  function renderCmpTable() {
    var box = $('#cmp-cats');
    box.innerHTML = '';
    var rowsD = state.cmp.rows;
    if (!rowsD) { box.appendChild(el('div', 'empty', 'Pick two files and press Compare.')); return; }
    var onlyDiff = $('#cmp-only-diff').checked;
    var A = fileById(state.cmp.a), B = fileById(state.cmp.b);
    var head = el('div', 'cmp-row head');
    ['Category', A.name, B.name, 'only A', 'only B', ''].forEach(function (h, i) {
      head.appendChild(el('span', 'c' + i, h));
    });
    box.appendChild(head);
    var shown = 0, changed = 0, added = 0, removed = 0;
    rowsD.forEach(function (r) {
      if (r.status !== 'same') changed++;
      if (r.status === 'added') added++;
      if (r.status === 'removed') removed++;
      if (onlyDiff && r.status === 'same') return;
      if (shown++ > 3000) return;
      var d = el('div', 'cmp-row ' + r.status + (state.cmp.openName === r.name ? ' on' : ''));
      d.appendChild(el('span', 'c0', r.name));
      d.appendChild(el('span', 'c1', r.na < 0 ? '—' : fmtN(r.na)));
      d.appendChild(el('span', 'c2', r.nb < 0 ? '—' : fmtN(r.nb)));
      d.appendChild(el('span', 'c3 del', r.onlyA ? '-' + fmtN(r.onlyA) : ''));
      d.appendChild(el('span', 'c4 add', r.onlyB ? '+' + fmtN(r.onlyB) : ''));
      var tag = el('span', 'c5 tag', r.status === 'same' ? 'identical' : r.status);
      if (r.reverseChanged) { tag.textContent = 'reverse'; tag.title = 'the same ranges, but reverse_match differs — the category means the opposite on one side'; }
      else if (r.dupA || r.dupB) tag.title = 'this name appears more than once; only the first copy is compared';
      d.appendChild(tag);
      d.onclick = function () { openCmpDetail(r.name); };
      box.appendChild(d);
    });
    if (shown > 3000) box.appendChild(el('div', 'empty', 'Showing the first 3000 rows.'));
    $('#cmp-summary').textContent = rowsD.length + ' categories · ' + changed + ' differ · ' +
      added + ' only in B · ' + removed + ' only in A';
  }

  function findCat(f, name) {
    for (var i = 0; i < f.cats.length; i++) if (f.cats[i].name.toUpperCase() === name.toUpperCase()) return f.cats[i];
    return null;
  }

  function openCmpDetail(name) {
    var A = fileById(state.cmp.a), B = fileById(state.cmp.b);
    var ca = findCat(A, name), cb = findCat(B, name);
    state.cmp.openName = name;
    renderCmpTable();
    var bs = busy('Diffing ' + name + '...');
    runJob('catDiff', { a: ca ? strip(ca) : null, b: cb ? strip(cb) : null, mode: state.cmp.mode }).then(function (res) {
      bs.end();
      state.cmp.detail = { name: name, onlyA: res.onlyA, onlyB: res.onlyB, common: res.common, unit: res.unit, reverseChanged: res.reverseChanged };
      renderCmpDetail();
    }).catch(function (e) { bs.end(); toast(e.message, 'err'); });
  }

  function cmpDetailRows() {
    var d = state.cmp.detail;
    if (!d) return 0;
    var side = state.cmp.side;
    return (side === 'b' ? 0 : d.onlyA.n) + (side === 'a' ? 0 : d.onlyB.n);
  }

  function renderCmpDetail() {
    var d = state.cmp.detail;
    var head = $('#cmp-detail-head');
    head.innerHTML = '';
    if (!d) { $('#cmp-detail-head').appendChild(el('div', 'empty', 'Select a category above to see what changed.')); cmpList.count = 0; cmpList.invalidate(); return; }
    var A = fileById(state.cmp.a), B = fileById(state.cmp.b);
    var title = el('div', 'cmp-dh');
    title.appendChild(el('span', 'cmp-dt', d.name));
    title.appendChild(el('span', 'del', '-' + fmtN(d.onlyA.n) + ' only in A'));
    title.appendChild(el('span', 'add', '+' + fmtN(d.onlyB.n) + ' only in B'));
    title.appendChild(el('span', 'dim', fmtN(d.common) + ' shared ' + (d.unit || 'entries')));
    if (d.reverseChanged) title.appendChild(el('span', 'del', 'reverse_match differs'));
    head.appendChild(title);

    var acts = el('div', 'cmp-acts');
    function ab(label, hint, fn, disabled) {
      var b = el('button', 'btn sm', label);
      b.title = hint || '';
      b.disabled = !!disabled;
      b.onclick = fn;
      acts.appendChild(b);
    }
    var sideSel = el('select', 'inp sm');
    [['both', 'Both sides'], ['a', 'Only in A'], ['b', 'Only in B']].forEach(function (o) {
      var op = el('option', null, o[1]); op.value = o[0]; sideSel.appendChild(op);
    });
    sideSel.value = state.cmp.side;
    sideSel.onchange = function () { state.cmp.side = sideSel.value; cmpList.count = cmpDetailRows(); cmpList.setCount(cmpDetailRows()); };
    acts.appendChild(sideSel);

    var addNote = (A.kind === 'geoip' && state.cmp.mode === 'coverage')
      ? 'Append the entries that only B covers into A, then merge overlapping CIDRs'
      : 'Append the entries that only B has into A, dropping exact duplicates';
    ab('Add B-only to A', addNote, function () {
      applyDiffToA('add');
    }, !d.onlyB.n);
    ab('Remove A-only from A', 'Delete the entries A has that B does not', function () {
      applyDiffToA('remove');
    }, !d.onlyA.n);
    ab('Make A match B', 'Add B-only and remove A-only in one step', function () {
      applyDiffToA('both');
    }, !(d.onlyA.n || d.onlyB.n));
    ab('New category from diff', 'Store the difference in A as its own category', function () {
      var f = A;
      var side = state.cmp.side === 'a' ? d.onlyA : state.cmp.side === 'b' ? d.onlyB : Model.concat([d.onlyA, d.onlyB], 'X', A.kind);
      var cat = Model.withName(side, Model.uniqueName(f.cats, d.name + '-DIFF'));
      cat.uid = ++uidSeq;
      pushUndo(f, 'diff category ' + cat.name);
      f.cats.push(cat);
      setActive(f);
      f.dirty = true;
      renderFiles(); refreshList(); renderInfo();
      toast('Created ' + cat.name + ' in ' + f.name);
    });
    ab('Export diff .txt', '', function () {
      var lines = [];
      lines.push('# ' + d.name + ': ' + A.name + ' vs ' + B.name + ' (' + state.cmp.mode + ')');
      for (var i = 0; i < d.onlyA.n; i++) lines.push('-' + TextFmt.line(d.onlyA, i));
      for (var j = 0; j < d.onlyB.n; j++) lines.push('+' + TextFmt.line(d.onlyB, j));
      download(d.name.toLowerCase() + '-diff.txt', new Blob([lines.join('\n')], { type: 'text/plain' }));
    });
    head.appendChild(acts);
    cmpList.setCount(cmpDetailRows());
  }

  function applyDiffToA(what) {
    var d = state.cmp.detail;
    var A = fileById(state.cmp.a), B = fileById(state.cmp.b);
    var ca = findCat(A, d.name), cb = findCat(B, d.name);
    if (!ca && (what === 'remove' || !cb)) return;
    pushUndo(A, 'sync ' + d.name);
    if (!ca) {
      var nc = Model.shallow(cb);
      nc.uid = ++uidSeq;
      A.cats.push(nc);
    } else {
      var i = A.cats.indexOf(ca), out = ca;
      if (what === 'remove' || what === 'both') {
        if (A.kind === 'geoip' && state.cmp.mode === 'coverage') {
          var ra = Cidr.toRanges(ca.ips, ca.pfx, ca.fam, ca.n);
          var rd = Cidr.toRanges(d.onlyA.ips, d.onlyA.pfx, d.onlyA.fam, d.onlyA.n);
          var p = Cidr.fromRanges(Cidr.subtract(ra.v4, rd.v4, 1), Cidr.subtract(ra.v6, rd.v6, 1n));
          out = { kind: 'geoip', name: ca.name, n: p.n, ips: p.ips, pfx: p.pfx, fam: p.fam, reverse: ca.reverse, raw: null, bad: 0 };
          if (ra.invalid.length) {
            out = Model.withName(Model.concat([out, Model.pick(ca, ra.invalid)], ca.name, 'geoip'), ca.name);
            out.reverse = ca.reverse;
          }
        } else {
          var kill = new Set();
          for (var k = 0; k < d.onlyA.n; k++) kill.add(Model.key(d.onlyA, k));
          var keep = [];
          for (var j = 0; j < out.n; j++) if (!kill.has(Model.key(out, j))) keep.push(j);
          out = Model.pick(out, keep);
        }
      }
      if (what === 'add' || what === 'both') {
        out = Model.append(out, d.onlyB);
        out = (A.kind === 'geoip' && state.cmp.mode === 'coverage')
          ? Model.optimize(out, { fold: false }).cat
          : Model.dedupe(out);
      }
      A.cats[i] = out;
      A.cats[i].uid = ca.uid;
    }
    A.dirty = true;
    invalidateCmp();
    renderFiles();
    if (state.activeId === A.id) refreshList();
    toast('Updated ' + d.name + ' in ' + A.name + ' — undo available in Browse');
    runCompare(d.name);
  }

  function createCmpRow() {
    var d = el('div', 'row diff');
    d.innerHTML = '<span class="mark"></span><span class="bdg"></span><span class="txt"></span><span class="sub"></span>';
    return d;
  }

  function renderCmpRow(node, i) {
    var d = state.cmp.detail;
    if (!d) return;
    var side = state.cmp.side;
    var aN = side === 'b' ? 0 : d.onlyA.n;
    var isA = i < aN;
    var cat = isA ? d.onlyA : d.onlyB;
    var idx = isA ? i : i - aN;
    node.className = 'row diff ' + (isA ? 'da' : 'db');
    node.children[0].textContent = isA ? '−' : '+';
    if (cat.kind === 'geoip') {
      var okd = Cidr.validAt(cat.pfx, cat.fam, idx);
      node.children[1].className = 'bdg ' + (!okd ? 'tbad' : cat.fam[idx] === 6 ? 'tv6' : 'tv4');
      node.children[1].textContent = !okd ? 'bad' : cat.fam[idx] === 6 ? 'v6' : 'v4';
      node.children[2].textContent = Cidr.fmt(cat.ips, cat.pfx, cat.fam, idx, cat.raw);
      var p = cat.pfx[idx];
      node.children[3].textContent = cat.fam[idx] === 4
        ? (p === 32 ? 'host' : fmtN(Math.pow(2, 32 - p)) + ' addrs') : '';
    } else {
      var t = cat.type[idx];
      node.children[1].className = 'bdg ' + typeCls(t);
      node.children[1].textContent = typeShort(t);
      node.children[2].textContent = cat.val[idx];
      var at = cat.attrs ? cat.attrs[idx] : null;
      node.children[3].textContent = at ? at.map(function (a) { return '@' + a.k; }).join(' ') : '';
    }
  }


  function setTab(t) {
    state.tab = t;
    $('#pane-browse').hidden = t !== 'browse';
    $('#pane-compare').hidden = t !== 'compare';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-on', b.dataset.tab === t);
    });
    if (t === 'compare') { renderCmpPickers(); if (!state.cmp.rows) renderCmpTable(); if (cmpList) cmpList.draw(); }
    else if (list) list.draw();
  }

  function init() {
    startWorker();

    list = new VList($('#list'), { rowHeight: 24, createRow: createRow, renderRow: renderRow });
    $('#list').addEventListener('click', onListClick);
    cmpList = new VList($('#cmp-list'), { rowHeight: 24, createRow: createCmpRow, renderRow: renderCmpRow });

    $('#file-input').addEventListener('change', function (e) { handleFiles(e.target.files); e.target.value = ''; });
    $('#btn-import').onclick = function () { $('#file-input').click(); };
    $('#btn-new').onclick = newFileModal;
    $('#btn-undo').onclick = undo;
    $('#btn-redo').onclick = redo;
    $('#btn-newcat').onclick = newCategoryModal;
    $('#btn-merge').onclick = mergeSelectedCats;
    $('#btn-optimize').onclick = function () {
      var f = activeFile();
      if (!f) return;
      var cs = catSelected();
      optimizeCats(cs.length ? cs.map(function (i) { return f.cats[i]; }) : f.cats.slice());
    };
    $('#btn-export').onclick = function () { exportMenu($('#btn-export')); };
    $('#btn-expand').onclick = function () {
      var f = activeFile(); if (!f) return;
      f.cats.forEach(function (c) { ui(c).open = true; });
      refreshList();
    };
    $('#btn-collapse').onclick = function () {
      var f = activeFile(); if (!f) return;
      f.cats.forEach(function (c) { ui(c).open = false; });
      refreshList();
    };

    var qt = null;
    $('#q').addEventListener('input', function (e) {
      clearTimeout(qt);
      var v = e.target.value;
      qt = setTimeout(function () {
        state.query = v;
        var t0 = performance.now();
        refreshList();
        var dt = performance.now() - t0;
        if (dt > 200) $('#status-right').textContent = 'filter ' + dt.toFixed(0) + 'ms';
      }, v.length < 3 ? 220 : 120);
    });
    $('#q').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.target.value = ''; state.query = ''; refreshList(); } });
    $('#f-type').addEventListener('change', function (e) {
      var f = activeFile();
      var v = parseInt(e.target.value, 10);
      if (f && f.kind === 'geoip') { state.famFilter = v > 0 ? v : (v === -3 ? -3 : 0); state.typeFilter = -1; }
      else { state.typeFilter = v; state.famFilter = 0; }
      refreshList();
    });
    $('#hide-empty').addEventListener('change', function (e) { state.hideEmpty = e.target.checked; refreshList(); });

    $('#sel-del-e').onclick = deleteSelectedEntries;
    $('#sel-copy').onclick = function () { moveOrCopySelected(false); };
    $('#sel-move').onclick = function () { moveOrCopySelected(true); };
    $('#sel-merge').onclick = mergeSelectedCats;
    $('#sel-del-c').onclick = deleteSelectedCats;
    $('#sel-clear').onclick = function () {
      clearSel();
      uiState.forEach(function (u) { u.catSel = false; });
      refreshList();
    };

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.onclick = function () { setTab(b.dataset.tab); };
    });
    $('#cmp-a').onchange = function () { state.cmp.a = parseInt(this.value, 10); state.cmp.rows = null; renderCmpPickers(); renderCmpTable(); };
    $('#cmp-b').onchange = function () { state.cmp.b = parseInt(this.value, 10); state.cmp.rows = null; renderCmpTable(); };
    $('#cmp-mode').onchange = function () { state.cmp.mode = this.value; state.cmp.rows = null; renderCmpTable(); };
    $('#cmp-run').onclick = function () { runCompare(); };
    $('#cmp-only-diff').onchange = renderCmpTable;
    $('#cmp-swap').onclick = function () {
      var t = state.cmp.a; state.cmp.a = state.cmp.b; state.cmp.b = t;
      $('#cmp-a').value = state.cmp.a; $('#cmp-b').value = state.cmp.b;
      state.cmp.rows = null; state.cmp.detail = null;
      renderCmpTable(); renderCmpDetail();
    };

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (typing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selCount()) { e.preventDefault(); deleteSelectedEntries(); }
      } else if (e.key === 'Escape') {
        clearSel();
        uiState.forEach(function (u) { u.catSel = false; });
        refreshList();
      }
    });

    var dropTarget = document.body;
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropTarget.addEventListener(ev, function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropTarget.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'drop' || e.target === document.body) document.body.classList.remove('dragging');
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      });
    });

    window.addEventListener('beforeunload', function (e) {
      if (state.files.some(function (f) { return f.dirty; })) { e.preventDefault(); e.returnValue = ''; }
    });

    renderFiles(); renderInfo(); refreshList(); setTab('browse');
  }

  return {
    init: init, state: state, runJob: runJob, refresh: refreshList, importFiles: handleFiles,
    loadBytes: loadBytes, bytesOf: bytesOf, fileByName: fileByName, markSaved: markSaved,
    activeFile: activeFile, toast: toast, busy: busy, modal: modal, fmtN: fmtN, fmtBytes: fmtBytes,
    _ui: uiState, _rows: rows, _active: activeFile
  };
})();
