var TextFmt = (function () {
  'use strict';

  function splitLines(text) {
    return text.split(/\r\n|\r|\n/);
  }

  function pushErr(list, e) { if (list.length < 5000) list.push(e); }

  function stripComment(line) {
    var h = line.indexOf('#');
    if (h >= 0) line = line.slice(0, h);
    var s = line.indexOf('//');
    if (s >= 0) line = line.slice(0, s);
    return line.trim();
  }


  function includeOf(name, at, resolve) {
    if (!name) return 'include: names no category';
    if (!resolve) return 'include: needs the category it names, and there is none to resolve it against here';
    var cat = resolve(name);
    if (typeof cat === 'string') return cat;
    if (!cat) return 'no category "' + name + '" to include';
    if (cat.reverse) return cat.name + ' is reverse-match: its entries are the addresses it does not match, so including them would invert it';
    var want = [], not = [], i, k;
    if (at) for (k = 0; k < at.length; k++) {
      if (at[k].k.charAt(0) === '-') { if (at[k].k.length > 1) not.push(at[k].k.slice(1)); }
      else want.push(at[k].k);
    }
    var idx = [];
    for (i = 0; i < cat.n; i++) {
      var a = cat.attrs ? cat.attrs[i] : null, keep = true;
      for (k = 0; k < want.length && keep; k++) keep = hasKey(a, want[k]);
      for (k = 0; k < not.length && keep; k++) keep = !hasKey(a, not[k]);
      if (keep) idx.push(i);
    }
    return { cat: cat, idx: idx };
  }

  function hasKey(at, key) {
    if (at) for (var i = 0; i < at.length; i++) if (at[i].k === key) return true;
    return false;
  }

  function weave(n, incs, own, inc) {
    var o = 0, src = 0;
    for (var q = 0; q <= incs.length; q++) {
      var stop = q < incs.length ? incs[q].at : n;
      for (; src < stop; src++) own(src, o++);
      if (q === incs.length) break;
      for (var r = 0; r < incs[q].idx.length; r++) inc(incs[q].cat, incs[q].idx[r], o++);
    }
    return o;
  }

  function woven(n, incs) {
    for (var q = 0; q < incs.length; q++) n += incs[q].idx.length;
    return n;
  }

  function summary(incs) {
    return incs ? incs.map(function (x) { return { line: x.line, name: x.cat.name, n: x.idx.length }; }) : [];
  }

  function parseSite(text, resolve) {
    var lines = splitLines(text);
    var cap = lines.length;
    var type = new Uint8Array(cap), val = new Array(cap), attrs = new Array(cap);
    var errors = [], hasAttr = false, n = 0, incs = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = stripComment(lines[i]);
      if (!raw) continue;
      var parts = raw.split(/\s+/);
      var head = parts[0], at = null;
      for (var k = 1; k < parts.length; k++) {
        var p = parts[k];
        if (p.charAt(0) !== '@') { pushErr(errors, { line: i + 1, text: lines[i], msg: 'unexpected token "' + p + '"' }); at = null; head = ''; break; }
        var body = p.slice(1), eq = body.indexOf('=');
        if (!body) continue;
        if (eq > 0) {
          var num = parseInt(body.slice(eq + 1), 10);
          (at || (at = [])).push({ k: body.slice(0, eq), v: isNaN(num) ? true : num });
        } else (at || (at = [])).push({ k: body, v: true });
      }
      if (!head) continue;
      var colon = head.indexOf(':'), t = 2, v = head;
      if (colon > 0) {
        var pre = head.slice(0, colon).toLowerCase();
        var numType = /^type(\d{1,3})$/.exec(pre);
        if (Object.prototype.hasOwnProperty.call(GeoDat.SITE_PREFIX, pre)) {
          t = GeoDat.SITE_PREFIX[pre];
          v = head.slice(colon + 1);
        } else if (numType && +numType[1] < 256) {
          t = +numType[1];
          v = head.slice(colon + 1);
        } else if (pre === 'include') {
          var inc = includeOf(head.slice(colon + 1), at, resolve);
          if (typeof inc === 'string') pushErr(errors, { line: i + 1, text: lines[i], msg: inc });
          else (incs || (incs = [])).push({ at: n, line: i + 1, cat: inc.cat, idx: inc.idx });
          continue;
        } else if (pre === 'geosite' || pre === 'ext') {
          pushErr(errors, { line: i + 1, text: lines[i], msg: 'reference directives cannot be stored in a .dat category' });
          continue;
        }
      }
      if (!v) { pushErr(errors, { line: i + 1, text: lines[i], msg: 'empty value' }); continue; }
      if (t === 1) {
        try { new RegExp(v); } catch (e) { pushErr(errors, { line: i + 1, text: lines[i], msg: 'invalid regexp: ' + e.message }); continue; }
      }
      type[n] = t; val[n] = v; attrs[n] = at;
      if (at) hasAttr = true;
      n++;
    }
    if (incs) {
      var total = woven(n, incs);
      var t2 = new Uint8Array(total), v2 = new Array(total), a2 = new Array(total);
      weave(n, incs, function (s, o) { t2[o] = type[s]; v2[o] = val[s]; a2[o] = attrs[s]; }, function (c, s, o) {
        t2[o] = c.type[s]; v2[o] = c.val[s];
        a2[o] = c.attrs ? c.attrs[s] : null;
        if (a2[o]) hasAttr = true;
      });
      type = t2; val = v2; attrs = a2; n = cap = total;
    }
    return {
      kind: 'geosite', n: n,
      type: n * 2 < cap ? type.slice(0, n) : type.subarray(0, n), val: val.slice(0, n),
      attrs: hasAttr ? attrs.slice(0, n) : null,
      errors: errors, included: summary(incs)
    };
  }

  function siteLine(cat, i) {
    var t = cat.type[i];
    var s = (GeoDat.SITE_TYPE[t] || ('type' + t)) + ':' + cat.val[i];
    var at = cat.attrs ? cat.attrs[i] : null;
    if (at) for (var k = 0; k < at.length; k++) s += ' @' + at[k].k + (at[k].v === true ? '' : '=' + at[k].v);
    return s;
  }


  function parseIp(text, resolve) {
    var lines = splitLines(text);
    var cap = lines.length;
    var ips = new Uint8Array(cap * 16), pfx = new Uint8Array(cap), fam = new Uint8Array(cap);
    var errors = [], n = 0, incs = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = stripComment(lines[i]);
      if (!raw) continue;
      if (/^include:/i.test(raw)) {
        var parts = raw.split(/\s+/);
        var inc = parts.length === 1 ? includeOf(parts[0].slice(8), null, resolve)
          : parts[1].charAt(0) === '@' ? 'geoip entries carry no @attributes to filter on'
            : 'unexpected token "' + parts[1] + '"';
        if (typeof inc === 'string') pushErr(errors, { line: i + 1, text: lines[i], msg: inc });
        else (incs || (incs = [])).push({ at: n, line: i + 1, cat: inc.cat, idx: inc.idx });
        continue;
      }
      raw = raw.split(/[\s,;]+/)[0];
      if (!raw) continue;
      var r = Cidr.parse(raw, ips, n * 16);
      if (!r) {
        pushErr(errors, { line: i + 1, text: lines[i], msg: 'not an IP or CIDR' });
        continue;
      }
      pfx[n] = r.prefix;
      fam[n] = r.fam;
      n++;
    }
    var keep = null, bad = 0;
    if (incs) {
      var total = woven(n, incs);
      var ips2 = new Uint8Array(total * 16), pfx2 = new Uint8Array(total), fam2 = new Uint8Array(total);
      weave(n, incs, function (s, o) {
        ips2.set(ips.subarray(s * 16, s * 16 + 16), o * 16); pfx2[o] = pfx[s]; fam2[o] = fam[s];
      }, function (c, s, o) {
        ips2.set(c.ips.subarray(s * 16, s * 16 + 16), o * 16); pfx2[o] = c.pfx[s]; fam2[o] = c.fam[s];
        if (c.raw && c.raw.has(s)) (keep || (keep = new Map())).set(o, c.raw.get(s));
        if (!Cidr.validAt(pfx2, fam2, o)) bad++;
      });
      ips = ips2; pfx = pfx2; fam = fam2; n = cap = total;
    }
    var tight = n * 2 < cap;
    return {
      kind: 'geoip', n: n,
      ips: tight ? ips.slice(0, n * 16) : ips.subarray(0, n * 16),
      pfx: tight ? pfx.slice(0, n) : pfx.subarray(0, n),
      fam: tight ? fam.slice(0, n) : fam.subarray(0, n),
      raw: keep, bad: bad,
      errors: errors, included: summary(incs)
    };
  }

  function ipLine(cat, i) { return Cidr.fmt(cat.ips, cat.pfx, cat.fam, i, cat.raw); }


  function line(cat, i) { return cat.kind === 'geoip' ? ipLine(cat, i) : siteLine(cat, i); }

  function parse(kind, text, resolve) { return kind === 'geoip' ? parseIp(text, resolve) : parseSite(text, resolve); }

  function toText(cat, idx) {
    var out = [], n = idx ? idx.length : cat.n;
    for (var i = 0; i < n; i++) out.push(line(cat, idx ? idx[i] : i));
    return out.join('\n');
  }

  function sniffText(text) {
    var lines = splitLines(text), ip = 0, site = 0, tmp = new Uint8Array(16), checked = 0;
    for (var i = 0; i < lines.length && checked < 40; i++) {
      var raw = stripComment(lines[i]);
      if (!raw || /^include:/i.test(raw)) continue;
      checked++;
      var first = raw.split(/\s+/)[0];
      if (Cidr.parse(first, tmp, 0)) ip++; else site++;
    }
    if (!checked) return null;
    return ip >= site ? 'geoip' : 'geosite';
  }

  return {
    parse: parse, parseIp: parseIp,
    line: line, siteLine: siteLine,
    toText: toText, sniffText: sniffText
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TextFmt;
