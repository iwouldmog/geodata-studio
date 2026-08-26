var Diff = (function () {
  'use strict';

  function keySet(cat) {
    var s = new Set();
    for (var i = 0; i < cat.n; i++) s.add(Model.key(cat, i));
    return s;
  }

  function countCommon(a, b) {
    var c = 0;
    var small = a.size <= b.size ? a : b, big = small === a ? b : a;
    small.forEach(function (k) { if (big.has(k)) c++; });
    return c;
  }


  function indexCats(cats) {
    var map = new Map(), dups = new Map();
    for (var i = 0; i < cats.length; i++) {
      var k = cats[i].name.toUpperCase();
      if (map.has(k)) dups.set(k, (dups.get(k) || 1) + 1);
      else map.set(k, cats[i]);
    }
    return { map: map, dups: dups };
  }

  function fileDiff(A, B, mode) {
    var names = [], seen = new Set(), i;
    var ia = indexCats(A.cats), ib = indexCats(B.cats);
    for (i = 0; i < A.cats.length; i++) { var ka = A.cats[i].name.toUpperCase(); if (!seen.has(ka)) { seen.add(ka); names.push(ka); } }
    for (i = 0; i < B.cats.length; i++) { var kb = B.cats[i].name.toUpperCase(); if (!seen.has(kb)) { seen.add(kb); names.push(kb); } }
    names.sort();

    var rows = [];
    for (i = 0; i < names.length; i++) {
      var ca = ia.map.get(names[i]) || null, cb = ib.map.get(names[i]) || null;
      var row = {
        name: (ca || cb).name,
        a: ca, b: cb,
        na: ca ? ca.n : -1,
        nb: cb ? cb.n : -1,
        onlyA: 0, onlyB: 0, common: 0,
        dupA: ia.dups.get(names[i]) || 0,
        dupB: ib.dups.get(names[i]) || 0,
        reverseChanged: false,
        status: !ca ? 'added' : !cb ? 'removed' : 'same'
      };
      if (ca && cb) {
        var d = summarize(ca, cb, mode);
        row.onlyA = d.onlyA; row.onlyB = d.onlyB; row.common = d.common;
        row.reverseChanged = ca.kind === 'geoip' && !!ca.reverse !== !!cb.reverse;
        row.status = (d.onlyA || d.onlyB || row.reverseChanged) ? 'changed' : 'same';
        row.unit = d.unit;
      } else if (ca) row.onlyA = ca.n;
      else row.onlyB = cb.n;
      rows.push(row);
    }
    return rows;
  }

  function summarize(ca, cb, mode) {
    if (mode === 'coverage' && ca.kind === 'geoip') {
      var ra = Cidr.toRanges(ca.ips, ca.pfx, ca.fam, ca.n);
      var rb = Cidr.toRanges(cb.ips, cb.pfx, cb.fam, cb.n);
      var a4 = Cidr.subtract(ra.v4, rb.v4, 1), b4 = Cidr.subtract(rb.v4, ra.v4, 1);
      var a6 = Cidr.subtract(ra.v6, rb.v6, 1n), b6 = Cidr.subtract(rb.v6, ra.v6, 1n);
      var c4 = Cidr.intersect(ra.v4, rb.v4), c6 = Cidr.intersect(ra.v6, rb.v6);
      return {
        onlyA: Cidr.countCidrs(a4, 1) + Cidr.countCidrs(a6, 1n),
        onlyB: Cidr.countCidrs(b4, 1) + Cidr.countCidrs(b6, 1n),
        common: Cidr.countCidrs(c4, 1) + Cidr.countCidrs(c6, 1n),
        unit: 'blocks'
      };
    }
    var sa = keySet(ca), sb = keySet(cb), common = countCommon(sa, sb);
    return { onlyA: sa.size - common, onlyB: sb.size - common, common: common, unit: 'entries' };
  }


  function catDiff(ca, cb, mode) {
    var kind = (ca || cb).kind;
    var nameA = (ca || cb).name;
    if (!ca) return { onlyA: Model.emptyCat(kind, nameA), onlyB: Model.shallow(cb), common: 0, unit: 'entries', reverseChanged: false };
    if (!cb) return { onlyA: Model.shallow(ca), onlyB: Model.emptyCat(kind, nameA), common: 0, unit: 'entries', reverseChanged: false };
    var revChanged = kind === 'geoip' && !!ca.reverse !== !!cb.reverse;

    if (mode === 'coverage' && kind === 'geoip') {
      var ra = Cidr.toRanges(ca.ips, ca.pfx, ca.fam, ca.n);
      var rb = Cidr.toRanges(cb.ips, cb.pfx, cb.fam, cb.n);
      var A = Cidr.fromRanges(Cidr.subtract(ra.v4, rb.v4, 1), Cidr.subtract(ra.v6, rb.v6, 1n));
      var B = Cidr.fromRanges(Cidr.subtract(rb.v4, ra.v4, 1), Cidr.subtract(rb.v6, ra.v6, 1n));
      var C = Cidr.fromRanges(Cidr.intersect(ra.v4, rb.v4), Cidr.intersect(ra.v6, rb.v6));
      return {
        onlyA: packed(A, nameA), onlyB: packed(B, nameA), commonCat: packed(C, nameA),
        common: C.n, unit: 'blocks', reverseChanged: revChanged
      };
    }

    var sa = keySet(ca), sb = keySet(cb);
    var ia = [], ib = [], seenA = new Set(), seenB = new Set(), i, k, common = 0;
    for (i = 0; i < ca.n; i++) {
      k = Model.key(ca, i);
      if (seenA.has(k)) continue;
      seenA.add(k);
      if (sb.has(k)) common++; else ia.push(i);
    }
    for (i = 0; i < cb.n; i++) {
      k = Model.key(cb, i);
      if (seenB.has(k)) continue;
      seenB.add(k);
      if (!sa.has(k)) ib.push(i);
    }
    return { onlyA: Model.pick(ca, ia), onlyB: Model.pick(cb, ib), common: common, unit: 'entries', reverseChanged: revChanged };
  }

  function packed(p, name) {
    return { kind: 'geoip', name: name, n: p.n, ips: p.ips, pfx: p.pfx, fam: p.fam, reverse: false, raw: null, bad: 0 };
  }

  return { fileDiff: fileDiff, catDiff: catDiff, summarize: summarize, keySet: keySet };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Diff;
