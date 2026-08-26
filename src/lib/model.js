var Model = (function () {
  'use strict';

  function emptyCat(kind, name) {
    return kind === 'geoip'
      ? { kind: 'geoip', name: name, n: 0, ips: new Uint8Array(0), pfx: new Uint8Array(0), fam: new Uint8Array(0), reverse: false, raw: null, bad: 0 }
      : { kind: 'geosite', name: name, n: 0, type: new Uint8Array(0), val: [], attrs: null };
  }

  function shallow(cat) {
    return cat.kind === 'geoip'
      ? { kind: 'geoip', name: cat.name, n: cat.n, ips: cat.ips, pfx: cat.pfx, fam: cat.fam, reverse: cat.reverse, raw: cat.raw || null, bad: cat.bad || 0 }
      : { kind: 'geosite', name: cat.name, n: cat.n, type: cat.type, val: cat.val, attrs: cat.attrs };
  }

  function withName(cat, name) {
    var c = shallow(cat); c.name = name; return c;
  }


  var HEX = [];
  for (var h = 0; h < 256; h++) HEX.push((h < 16 ? '0' : '') + h.toString(16));

  function ipKey(cat, i) {
    var o = i * 16, p = cat.pfx[i], f = cat.fam[i];
    if (f === 4 && p <= 32) {
      var num = Cidr.v4Num(cat.ips, o), size = POW2[32 - p];
      return (num - (num % size)) * 33 + p;
    }
    if (f === 6 && p <= 128) return Cidr.maskedHex(cat.ips, cat.pfx, cat.fam, i) + '/' + p;
    var b = cat.raw && cat.raw.get ? cat.raw.get(i) : null;
    var s = 'x', k;
    if (b) { for (k = 0; k < b.length; k++) s += HEX[b[k]]; }
    else { for (k = 0; k < 16; k++) s += HEX[cat.ips[o + k]]; }
    return s + '/' + p + '/' + f;
  }

  var POW2 = [];
  for (var pw = 0; pw <= 32; pw++) POW2.push(Math.pow(2, pw));

  function attrKey(at) {
    if (!at || !at.length) return '';
    var parts = new Array(at.length);
    for (var i = 0; i < at.length; i++) parts[i] = at[i].k + '\u0001' + at[i].v;
    parts.sort();
    return '\u0000' + parts.join('\u0000');
  }

  function siteKey(cat, i) {
    return cat.type[i] + '\u0000' + cat.val[i] + (cat.attrs ? attrKey(cat.attrs[i]) : '');
  }

  function key(cat, i) { return cat.kind === 'geoip' ? ipKey(cat, i) : siteKey(cat, i); }


  function pick(cat, idx) {
    var n = idx.length;
    if (cat.kind === 'geoip') {
      var ips = new Uint8Array(n * 16), pfx = new Uint8Array(n), fam = new Uint8Array(n);
      var raw = null, bad = 0;
      for (var i = 0; i < n; i++) {
        var si = idx[i], s = si * 16;
        ips.set(cat.ips.subarray(s, s + 16), i * 16);
        pfx[i] = cat.pfx[si];
        fam[i] = cat.fam[si];
        if (cat.raw && cat.raw.has(si)) (raw || (raw = new Map())).set(i, cat.raw.get(si));
        if (!Cidr.validAt(pfx, fam, i)) bad++;
      }
      return { kind: 'geoip', name: cat.name, n: n, ips: ips, pfx: pfx, fam: fam, reverse: cat.reverse, raw: raw, bad: bad };
    }
    var type = new Uint8Array(n), val = new Array(n), attrs = null;
    for (var j = 0; j < n; j++) {
      type[j] = cat.type[idx[j]];
      val[j] = cat.val[idx[j]];
      if (cat.attrs && cat.attrs[idx[j]]) { if (!attrs) attrs = new Array(n).fill(null); attrs[j] = cat.attrs[idx[j]]; }
    }
    return { kind: 'geosite', name: cat.name, n: n, type: type, val: val, attrs: attrs };
  }

  function removeIndices(cat, set) {
    var keep = [];
    for (var i = 0; i < cat.n; i++) if (!set.has(i)) keep.push(i);
    return pick(cat, keep);
  }

  function keepIndices(cat, idx) { return pick(cat, Array.prototype.slice.call(idx)); }


  function reverseClash(list) {
    var seen = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind !== 'geoip' || !list[i].n) continue;
      var r = list[i].reverse ? 1 : 0;
      if (seen < 0) seen = r; else if (seen !== r) return true;
    }
    return false;
  }

  function reverseOf(list) {
    for (var i = 0; i < list.length; i++) if (list[i].n) return !!list[i].reverse;
    return !!(list.length && list[0].reverse);
  }

  function concat(list, name, kind) {
    kind = kind || (list.length ? list[0].kind : 'geoip');
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].n;
    if (kind === 'geoip') {
      var ips = new Uint8Array(total * 16), pfx = new Uint8Array(total), fam = new Uint8Array(total), off = 0;
      var rev = reverseOf(list), clash = reverseClash(list);
      var raw = null, bad = 0;
      for (i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c.n) continue;
        ips.set(c.ips.subarray(0, c.n * 16), off * 16);
        pfx.set(c.pfx.subarray(0, c.n), off);
        fam.set(c.fam.subarray(0, c.n), off);
        if (c.raw) { var base = off; c.raw.forEach(function (v, k) { (raw || (raw = new Map())).set(base + k, v); }); }
        bad += c.bad || 0;
        off += c.n;
      }
      var outIp = { kind: 'geoip', name: name, n: total, ips: ips, pfx: pfx, fam: fam, reverse: rev, raw: raw, bad: bad };
      if (clash) outIp.reverseClash = true;
      return outIp;
    }
    var type = new Uint8Array(total), val = new Array(total), attrs = null, o = 0;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      for (var j = 0; j < s.n; j++) {
        type[o] = s.type[j];
        val[o] = s.val[j];
        if (s.attrs && s.attrs[j]) { if (!attrs) attrs = new Array(total).fill(null); attrs[o] = s.attrs[j]; }
        o++;
      }
    }
    return { kind: 'geosite', name: name, n: total, type: type, val: val, attrs: attrs };
  }

  function append(cat, chunk) {
    var out = concat([cat, chunk], cat.name, cat.kind);
    if (cat.kind === 'geoip') { out.reverse = cat.reverse; delete out.reverseClash; }
    return out;
  }


  function dedupe(cat) {
    var seen = new Set(), keep = [];
    for (var i = 0; i < cat.n; i++) {
      var k = key(cat, i);
      if (seen.has(k)) continue;
      seen.add(k);
      keep.push(i);
    }
    return keep.length === cat.n ? cat : pick(cat, keep);
  }

  function foldSite(cat, opts) {
    opts = opts || {};
    var domains = new Set(), keywords = [];
    var i, k;
    for (i = 0; i < cat.n; i++) {
      if (cat.attrs && cat.attrs[i]) continue;
      if (cat.type[i] === 2) domains.add(cat.val[i]);
      else if (opts.foldKeyword && cat.type[i] === 0 && cat.val[i]) keywords.push(cat.val[i]);
    }
    var keep = [];
    for (i = 0; i < cat.n; i++) {
      var v = cat.val[i], t = cat.type[i], covered = false;
      if (!(cat.attrs && cat.attrs[i]) && (t === 0 || t === 2 || t === 3)) {
        if (t === 2 || t === 3) {
          if (t === 3 && domains.has(v)) covered = true;
          for (var p = v.indexOf('.'); p > 0 && !covered; p = v.indexOf('.', p + 1)) {
            if (domains.has(v.slice(p + 1))) covered = true;
          }
        }
        if (!covered && opts.foldKeyword) {
          for (k = 0; k < keywords.length; k++) {
            if (t === 0 && v === keywords[k]) continue;
            if (v.indexOf(keywords[k]) >= 0) { covered = true; break; }
          }
        }
      }
      if (!covered) keep.push(i);
    }
    return keep.length === cat.n ? cat : pick(cat, keep);
  }

  function siteMissing(have, want, opts) {
    opts = opts || {};
    var exact = new Set(), domains = new Set(), keywords = [];
    var i, k;
    for (i = 0; i < have.n; i++) {
      exact.add(siteKey(have, i));
      if (have.attrs && have.attrs[i]) continue;
      if (have.type[i] === 2) domains.add(have.val[i].toLowerCase());
      else if (opts.foldKeyword && have.type[i] === 0) keywords.push(have.val[i].toLowerCase());
    }

    var missing = [];
    for (i = 0; i < want.n; i++) {
      if (exact.has(siteKey(want, i))) continue;
      if (want.attrs && want.attrs[i]) { missing.push(i); continue; }

      var v = want.val[i].toLowerCase(), t = want.type[i], covered = false;
      if (t === 2 || t === 3) {
        if (t === 3 && domains.has(v)) covered = true;
        for (var p = v.indexOf('.'); p > 0 && !covered; p = v.indexOf('.', p + 1)) {
          if (domains.has(v.slice(p + 1))) covered = true;
        }
      }
      if (!covered && opts.foldKeyword && t !== 1) {
        for (k = 0; k < keywords.length; k++) {
          if (keywords[k] && v.indexOf(keywords[k]) >= 0) { covered = true; break; }
        }
      }
      if (!covered) missing.push(i);
    }
    return missing;
  }

  function optimize(cat, opts) {
    opts = opts || {};
    var before = cat.n, out;
    if (cat.kind === 'geoip') {
      var agg = Cidr.aggregate(cat.ips, cat.pfx, cat.fam, cat.n);
      out = { kind: 'geoip', name: cat.name, n: agg.n, ips: agg.ips, pfx: agg.pfx, fam: agg.fam, reverse: cat.reverse, raw: null, bad: 0 };
      if (agg.invalid.length) {
        out = withName(concat([out, pick(cat, agg.invalid)], cat.name, 'geoip'), cat.name);
        out.reverse = cat.reverse;
      }
      return { cat: out, before: before, after: out.n, invalid: agg.invalid.length, reverseClash: !!cat.reverseClash };
    }
    {
      out = dedupe(cat);
      if (opts.fold !== false) out = foldSite(out, opts);
      if (opts.sort) out = sort(out, 'value');
      out = withName(out, cat.name);
    }
    return { cat: out, before: before, after: out.n, invalid: 0, reverseClash: false };
  }


  function sort(cat, how) {
    var n = cat.n, idx = new Uint32Array(n), i;
    for (i = 0; i < n; i++) idx[i] = i;
    if (cat.kind === 'geoip') {
      var ips = cat.ips, fam = cat.fam, pfx = cat.pfx;
      idx.sort(function (a, b) {
        if (fam[a] !== fam[b]) return fam[a] - fam[b];
        var oa = a * 16, ob = b * 16, len = fam[a] === 4 ? 4 : 16;
        for (var k = 0; k < len; k++) { if (ips[oa + k] !== ips[ob + k]) return ips[oa + k] - ips[ob + k]; }
        return pfx[a] - pfx[b] || a - b;
      });
    } else {
      var val = cat.val, type = cat.type;
      if (how === 'type') {
        idx.sort(function (a, b) { return type[a] - type[b] || (val[a] < val[b] ? -1 : val[a] > val[b] ? 1 : 0) || a - b; });
      } else if (how === 'host') {
        var rev = new Array(n);
        for (i = 0; i < n; i++) rev[i] = val[i].split('.').reverse().join('.');
        idx.sort(function (a, b) { return rev[a] < rev[b] ? -1 : rev[a] > rev[b] ? 1 : (type[a] - type[b]) || a - b; });
      } else {
        idx.sort(function (a, b) { return val[a] < val[b] ? -1 : val[a] > val[b] ? 1 : (type[a] - type[b]) || a - b; });
      }
    }
    return pick(cat, idx);
  }


  function stats(cat) {
    if (cat.kind === 'geoip') {
      var v4 = 0, v6 = 0, bad = 0;
      for (var i = 0; i < cat.n; i++) {
        if (!Cidr.validAt(cat.pfx, cat.fam, i)) bad++;
        else if (cat.fam[i] === 4) v4++;
        else v6++;
      }
      var r = Cidr.toRanges(cat.ips, cat.pfx, cat.fam, cat.n);
      var opt = Cidr.fromRanges(r.v4, r.v6);
      return {
        v4: v4, v6: v6, bad: bad,
        ranges4: r.v4.length / 2, ranges6: r.v6.length / 2,
        addrs4: Cidr.countAddrs(r.v4, 1),
        optimal: opt.n
      };
    }
    var t = [0, 0, 0, 0], withAttr = 0, unknown = 0;
    for (var j = 0; j < cat.n; j++) {
      var ty = cat.type[j];
      if (ty < 4) t[ty]++; else unknown++;
      if (cat.attrs && cat.attrs[j]) withAttr++;
    }
    return { keyword: t[0], regexp: t[1], domain: t[2], full: t[3], withAttr: withAttr, unknown: unknown };
  }


  function uniqueName(cats, base) {
    var names = new Set(cats.map(function (c) { return c.name.toUpperCase(); }));
    if (!names.has(base.toUpperCase())) return base;
    for (var i = 2; ; i++) if (!names.has((base + '-' + i).toUpperCase())) return base + '-' + i;
  }

  function mergeCats(cats, indices, name, opts) {
    var src = indices.map(function (i) { return cats[i]; });
    var merged = concat(src, name, src[0].kind);
    var res = optimize(merged, opts);
    res.reverseClash = !!merged.reverseClash;
    return res;
  }

  return {
    emptyCat: emptyCat, shallow: shallow, withName: withName,
    key: key, ipKey: ipKey, siteKey: siteKey,
    pick: pick, removeIndices: removeIndices,
    concat: concat, append: append, reverseClash: reverseClash,
    dedupe: dedupe, foldSite: foldSite, siteMissing: siteMissing, optimize: optimize,
    sort: sort, stats: stats, uniqueName: uniqueName, mergeCats: mergeCats
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Model;
