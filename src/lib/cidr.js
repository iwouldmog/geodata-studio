var Cidr = (function () {
  'use strict';

  var P2 = new Array(33);
  for (var i = 0; i <= 32; i++) P2[i] = Math.pow(2, i);

  var B2 = new Array(129);
  for (var j = 0; j <= 128; j++) B2[j] = 1n << BigInt(j);

  var V4MAX = 4294967295;
  var V6MAX = B2[128] - 1n;


  function v4Num(b, o) { return b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3]; }

  function v4NumToBytes(n, out, o) {
    out[o] = (n / 16777216) & 255;
    out[o + 1] = (n >>> 16) & 255;
    out[o + 2] = (n >>> 8) & 255;
    out[o + 3] = n & 255;
  }

  function v4Str(b, o) { return b[o] + '.' + b[o + 1] + '.' + b[o + 2] + '.' + b[o + 3]; }

  function v4NumStr(n) {
    return ((n / 16777216) & 255) + '.' + ((n >>> 16) & 255) + '.' + ((n >>> 8) & 255) + '.' + (n & 255);
  }

  function v6Big(b, o) {
    var w0 = b[o] * 16777216 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
    var w1 = b[o + 4] * 16777216 + (b[o + 5] << 16) + (b[o + 6] << 8) + b[o + 7];
    var w2 = b[o + 8] * 16777216 + (b[o + 9] << 16) + (b[o + 10] << 8) + b[o + 11];
    var w3 = b[o + 12] * 16777216 + (b[o + 13] << 16) + (b[o + 14] << 8) + b[o + 15];
    return (BigInt(w0) << 96n) | (BigInt(w1) << 64n) | (BigInt(w2) << 32n) | BigInt(w3);
  }

  function v6BigToBytes(v, out, o) {
    for (var k = 15; k >= 0; k--) { out[o + k] = Number(v & 255n); v >>= 8n; }
  }

  function v6Str(b, o) {
    var g = new Array(8), k;
    for (k = 0; k < 8; k++) g[k] = (b[o + k * 2] << 8) | b[o + k * 2 + 1];
    var best = -1, bestLen = 0, cur = -1, curLen = 0;
    for (k = 0; k < 8; k++) {
      if (g[k] === 0) {
        if (cur < 0) { cur = k; curLen = 1; } else curLen++;
        if (curLen > bestLen) { best = cur; bestLen = curLen; }
      } else { cur = -1; curLen = 0; }
    }
    if (bestLen < 2) best = -1;
    var parts = [];
    for (k = 0; k < 8;) {
      if (k === best) { parts.push(''); k += bestLen; }
      else { parts.push(g[k].toString(16)); k++; }
    }
    var s = parts.join(':');
    if (parts[0] === '') s = ':' + s;
    if (parts[parts.length - 1] === '') s = s + ':';
    return s;
  }

  function validAt(pfx, fam, i) {
    var f = fam[i];
    return (f === 4 && pfx[i] <= 32) || (f === 6 && pfx[i] <= 128);
  }

  function fmt(ips, pfx, fam, i, raw) {
    var o = i * 16;
    if (fam[i] === 4) return v4Str(ips, o) + '/' + pfx[i];
    if (fam[i] === 6) return v6Str(ips, o) + '/' + pfx[i];
    var b = raw && raw.get ? raw.get(i) : null;
    if (b) {
      var h = '';
      for (var k = 0; k < b.length; k++) h += (k ? ':' : '') + HEXB[b[k]];
      return '0x' + h + '/' + pfx[i];
    }
    return '<invalid>/' + pfx[i];
  }

  var HEXB = [];
  for (var hb = 0; hb < 256; hb++) HEXB.push((hb < 16 ? '0' : '') + hb.toString(16));


  function parseV4(s, out, o) {
    var n = s.length, part = 0, digits = 0, idx = 0, c;
    for (var k = 0; k < n; k++) {
      c = s.charCodeAt(k);
      if (c >= 48 && c <= 57) {
        part = part * 10 + (c - 48);
        if (++digits > 3 || part > 255) return false;
      } else if (c === 46) {
        if (!digits || idx > 2) return false;
        out[o + idx++] = part; part = 0; digits = 0;
      } else return false;
    }
    if (!digits || idx !== 3) return false;
    out[o + 3] = part;
    return true;
  }

  var HEXRE = /^[0-9a-fA-F]{1,4}$/;

  function parseV6(s, out, o) {
    var dbl = s.indexOf('::');
    if (dbl >= 0 && s.indexOf('::', dbl + 1) >= 0) return false;
    var head = dbl < 0 ? s : s.slice(0, dbl);
    var tail = dbl < 0 ? '' : s.slice(dbl + 2);
    var hp = head === '' ? [] : head.split(':');
    var tp = tail === '' ? [] : tail.split(':');
    var g = [], tmp = new Uint8Array(4);

    function push(arr, isLast) {
      for (var k = 0; k < arr.length; k++) {
        var p = arr[k];
        if (p === '') return false;
        if (p.indexOf('.') >= 0) {
          if (!isLast || k !== arr.length - 1) return false;
          if (!parseV4(p, tmp, 0)) return false;
          g.push((tmp[0] << 8) | tmp[1], (tmp[2] << 8) | tmp[3]);
        } else {
          if (!HEXRE.test(p)) return false;
          g.push(parseInt(p, 16));
        }
      }
      return true;
    }

    var hn;
    if (!push(hp, dbl < 0)) return false;
    hn = g.length;
    if (!push(tp, true)) return false;
    var tn = g.length - hn;

    if (dbl < 0) { if (g.length !== 8) return false; }
    else if (g.length > 7) return false;

    for (var k2 = 0; k2 < 16; k2++) out[o + k2] = 0;
    for (var a = 0; a < hn; a++) { out[o + a * 2] = g[a] >> 8; out[o + a * 2 + 1] = g[a] & 255; }
    for (var b = 0; b < tn; b++) {
      var slot = 8 - tn + b;
      out[o + slot * 2] = g[hn + b] >> 8;
      out[o + slot * 2 + 1] = g[hn + b] & 255;
    }
    return true;
  }

  function parse(s, out, o) {
    s = s.trim();
    if (!s) return null;
    var slash = s.lastIndexOf('/'), pfx = -1, ip = s;
    if (slash >= 0) {
      ip = s.slice(0, slash);
      var ps = s.slice(slash + 1);
      if (!/^\d{1,3}$/.test(ps)) return null;
      pfx = parseInt(ps, 10);
    }
    for (var k = 0; k < 16; k++) out[o + k] = 0;
    if (ip.indexOf(':') >= 0) {
      if (!parseV6(ip, out, o)) return null;
      if (pfx < 0) pfx = 128;
      if (pfx > 128) return null;
      return { fam: 6, prefix: pfx };
    }
    if (!parseV4(ip, out, o)) return null;
    if (pfx < 0) pfx = 32;
    if (pfx > 32) return null;
    return { fam: 4, prefix: pfx };
  }



  function sortMerge(r, one) {
    var n = r.length / 2;
    if (n === 0) return r;
    var idx = new Uint32Array(n);
    for (var i = 0; i < n; i++) idx[i] = i;
    if (one === 1) {
      idx.sort(function (a, b) { return r[a * 2] - r[b * 2] || r[a * 2 + 1] - r[b * 2 + 1]; });
    } else {
      idx.sort(function (a, b) {
        var x = r[a * 2], y = r[b * 2];
        if (x < y) return -1; if (x > y) return 1;
        x = r[a * 2 + 1]; y = r[b * 2 + 1];
        return x < y ? -1 : x > y ? 1 : 0;
      });
    }
    var out = [], cs = r[idx[0] * 2], ce = r[idx[0] * 2 + 1];
    for (var k = 1; k < n; k++) {
      var s = r[idx[k] * 2], e = r[idx[k] * 2 + 1];
      if (s <= ce + one) { if (e > ce) ce = e; }
      else { out.push(cs, ce); cs = s; ce = e; }
    }
    out.push(cs, ce);
    return out;
  }

  function emitV4(s, e, push) {
    while (s <= e) {
      var bits = 0;
      while (bits < 32) {
        var size = P2[bits + 1];
        if (s % size !== 0 || s + size - 1 > e) break;
        bits++;
      }
      push(s, 32 - bits);
      s += P2[bits];
    }
  }

  function emitV6(s, e, push) {
    while (s <= e) {
      var bits = 0;
      while (bits < 128) {
        var size = B2[bits + 1];
        if (s % size !== 0n || s + size - 1n > e) break;
        bits++;
      }
      push(s, 128 - bits);
      s += B2[bits];
    }
  }

  function subtract(a, b, one) {
    var out = [], i = 0, j = 0, an = a.length / 2, bn = b.length / 2;
    while (i < an) {
      var s = a[i * 2], e = a[i * 2 + 1];
      while (j < bn && b[j * 2 + 1] < s) j++;
      var k = j;
      while (k < bn && b[k * 2] <= e) {
        var bs = b[k * 2], be = b[k * 2 + 1];
        if (bs > s) out.push(s, bs - one);
        if (be >= s) s = be + one;
        if (s > e) break;
        k++;
      }
      if (s <= e) out.push(s, e);
      i++;
    }
    return out;
  }

  function intersect(a, b) {
    var out = [], i = 0, j = 0, an = a.length / 2, bn = b.length / 2;
    while (i < an && j < bn) {
      var s = a[i * 2] > b[j * 2] ? a[i * 2] : b[j * 2];
      var e = a[i * 2 + 1] < b[j * 2 + 1] ? a[i * 2 + 1] : b[j * 2 + 1];
      if (s <= e) out.push(s, e);
      if (a[i * 2 + 1] < b[j * 2 + 1]) i++; else j++;
    }
    return out;
  }


  function toRanges(ips, pfx, fam, n) {
    var r4 = [], r6 = [], invalid = null;
    for (var i = 0; i < n; i++) {
      var o = i * 16, f = fam[i], p = pfx[i];
      if (f === 4 && p <= 32) {
        var size = P2[32 - p], num = v4Num(ips, o), s = num - (num % size);
        r4.push(s, s + size - 1);
      } else if (f === 6 && p <= 128) {
        var size6 = B2[128 - p], v = v6Big(ips, o), s6 = v - (v % size6);
        r6.push(s6, s6 + size6 - 1n);
      } else {
        (invalid || (invalid = [])).push(i);
      }
    }
    return { v4: sortMerge(r4, 1), v6: sortMerge(r6, 1n), invalid: invalid || EMPTY };
  }

  var EMPTY = [];

  function fromRanges(r4, r6) {
    var outIp = [], outPfx = [], outFam = [];
    var i;
    for (i = 0; i < r4.length; i += 2) {
      emitV4(r4[i], r4[i + 1], function (s, p) { outIp.push(s); outPfx.push(p); outFam.push(4); });
    }
    var v6start = outIp.length;
    for (i = 0; i < r6.length; i += 2) {
      emitV6(r6[i], r6[i + 1], function (s, p) { outIp.push(s); outPfx.push(p); outFam.push(6); });
    }
    var n = outIp.length;
    var ips = new Uint8Array(n * 16), pfx = new Uint8Array(n), fam = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      if (i < v6start) v4NumToBytes(outIp[i], ips, i * 16);
      else v6BigToBytes(outIp[i], ips, i * 16);
      pfx[i] = outPfx[i];
      fam[i] = outFam[i];
    }
    return { ips: ips, pfx: pfx, fam: fam, n: n };
  }

  function aggregate(ips, pfx, fam, n) {
    var r = toRanges(ips, pfx, fam, n);
    var out = fromRanges(r.v4, r.v6);
    out.invalid = r.invalid;
    return out;
  }

  function countCidrs(ranges, one) {
    var c = 0, i, bump = function () { c++; };
    if (one === 1) { for (i = 0; i < ranges.length; i += 2) emitV4(ranges[i], ranges[i + 1], bump); }
    else { for (i = 0; i < ranges.length; i += 2) emitV6(ranges[i], ranges[i + 1], bump); }
    return c;
  }

  function countAddrs(ranges, one) {
    var t = one === 1 ? 0 : 0n;
    for (var i = 0; i < ranges.length; i += 2) t += ranges[i + 1] - ranges[i] + one;
    return t;
  }

  function entryRange(ips, pfx, fam, i) {
    var o = i * 16, p = pfx[i];
    if (fam[i] === 4) {
      if (p > 32) return null;
      var size = P2[32 - p], num = v4Num(ips, o), s = num - (num % size);
      return { fam: 4, s: s, e: s + size - 1 };
    }
    if (fam[i] !== 6 || p > 128) return null;
    var size6 = B2[128 - p], v = v6Big(ips, o), s6 = v - (v % size6);
    return { fam: 6, s: s6, e: s6 + size6 - 1n };
  }

  function maskedHex(ips, pfx, fam, i) {
    var o = i * 16, p = pfx[i], bytes = fam[i] === 4 ? 4 : 16;
    var full = p >> 3, rem = p & 7, s = '', k, b;
    for (k = 0; k < bytes; k++) {
      if (k < full) b = ips[o + k];
      else if (k === full && rem) b = ips[o + k] & ((0xff << (8 - rem)) & 0xff);
      else b = 0;
      s += HEXB[b];
    }
    return s;
  }

  return {
    v4Num: v4Num, v4Str: v4Str, v4NumStr: v4NumStr, v4NumToBytes: v4NumToBytes,
    v6Big: v6Big, v6Str: v6Str, v6BigToBytes: v6BigToBytes,
    parse: parse, parseV4: parseV4, parseV6: parseV6, fmt: fmt,
    validAt: validAt, maskedHex: maskedHex,
    sortMerge: sortMerge, subtract: subtract, intersect: intersect,
    emitV4: emitV4, emitV6: emitV6, countCidrs: countCidrs,
    toRanges: toRanges, fromRanges: fromRanges, aggregate: aggregate,
    countAddrs: countAddrs, entryRange: entryRange,
    V4MAX: V4MAX, V6MAX: V6MAX
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cidr;
