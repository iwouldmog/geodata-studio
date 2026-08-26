var GeoDat = (function () {
  'use strict';

  var Reader = Proto.Reader, Writer = Proto.Writer;

  var SITE_TYPE = ['keyword', 'regexp', 'domain', 'full'];
  var SITE_PREFIX = { keyword: 0, regexp: 1, regex: 1, domain: 2, full: 3 };


  function sniff(buf) {
    try {
      var r = new Reader(buf);
      var k = r.varint();
      if ((k >>> 3) !== 1 || (k & 7) !== 2) return null;
      var elen = r.varint(), end = r.p + elen;
      while (r.p < end) {
        var k2 = r.varint(), f = k2 >>> 3, w = k2 & 7;
        if (f === 1 && w === 2) { var sl = r.varint(); r.p += sl; continue; }
        if (f !== 2) { r.skip(w); continue; }
        if (w !== 2) return null;
        var sub = r.varint(), se = r.p + sub;
        if (r.p >= se) return null;
        var k3 = r.varint(), f3 = k3 >>> 3, w3 = k3 & 7;
        if (f3 === 1 && w3 === 2) { var l = r.varint(); return (l === 4 || l === 16) ? 'geoip' : null; }
        if (f3 === 1 && w3 === 0) return 'geosite';
        if (f3 === 2 && w3 === 2) return 'geosite';
        if (f3 === 2 && w3 === 0) return 'geoip';
        return null;
      }
      return null;
    } catch (e) { return null; }
  }


  function parseGeoIP(buf, onProgress) {
    var r = new Reader(buf), cats = [];
    while (r.p < r.e) {
      var k = r.varint(), f = k >>> 3, w = k & 7;
      if (f === 1 && w === 2) {
        var len = r.varint(), end = r.p + len;
        cats.push(parseGeoIPEntry(buf, r.p, end));
        r.p = end;
        if (onProgress && (cats.length & 31) === 0) onProgress(r.p / r.e);
      } else r.skip(w);
    }
    return cats;
  }

  function parseGeoIPEntry(buf, s, e) {
    var r = new Reader(buf, s, e), n = 0, name = '', reverse = false, k, f, w, l;
    while (r.p < r.e) {
      k = r.varint(); f = k >>> 3; w = k & 7;
      if (f === 1 && w === 2) { l = r.varint(); name = Proto.str(buf, r.p, r.p + l); r.p += l; }
      else if (f === 2 && w === 2) { var sl2 = r.varint(); r.p += sl2; n++; }
      else if (f === 3 && w === 0) { reverse = r.varint() !== 0; }
      else r.skip(w);
    }
    var ips = new Uint8Array(n * 16), pfx = new Uint8Array(n), fam = new Uint8Array(n), i = 0;
    var raw = null, bad = 0;
    r.p = s;
    while (r.p < r.e) {
      k = r.varint(); f = k >>> 3; w = k & 7;
      if (f === 2 && w === 2) {
        var clen = r.varint(), ce = r.p + clen, ipS = 0, ipLen = 0, prefix = 0;
        while (r.p < ce) {
          var k2 = r.varint(), f2 = k2 >>> 3, w2 = k2 & 7;
          if (f2 === 1 && w2 === 2) { ipLen = r.varint(); ipS = r.p; r.p += ipLen; }
          else if (f2 === 2 && w2 === 0) { prefix = r.varint(); }
          else r.skip(w2);
        }
        var o = i * 16;
        if (ipLen === 4) { fam[i] = 4; ips[o] = buf[ipS]; ips[o + 1] = buf[ipS + 1]; ips[o + 2] = buf[ipS + 2]; ips[o + 3] = buf[ipS + 3]; }
        else if (ipLen === 16) { fam[i] = 6; ips.set(buf.subarray(ipS, ipS + 16), o); }
        else {
          fam[i] = 0;
          (raw || (raw = new Map())).set(i, buf.slice(ipS, ipS + ipLen));
        }
        pfx[i] = prefix > 255 ? 255 : prefix;
        if (!Cidr.validAt(pfx, fam, i)) bad++;
        i++;
        r.p = ce;
      } else r.skip(w);
    }
    return { kind: 'geoip', name: name, n: n, ips: ips, pfx: pfx, fam: fam, reverse: reverse, raw: raw, bad: bad };
  }

  function writeGeoIP(cats) {
    var w = new Writer(1 << 21), cw = new Writer(1 << 18);
    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      cw.reset();
      cw.strField(1, cat.name);
      var ips = cat.ips, pfx = cat.pfx, fam = cat.fam, rawMap = cat.raw;
      for (var i = 0; i < cat.n; i++) {
        var src = ips, off = i * 16;
        var ipLen = fam[i] === 4 ? 4 : fam[i] === 6 ? 16 : -1;
        if (ipLen < 0) {
          var kept = rawMap ? rawMap.get(i) : null;
          if (!kept) continue;
          src = kept; off = 0; ipLen = kept.length;
        }
        var p = pfx[i];
        var body = (ipLen ? 1 + Proto.varintLen(ipLen) + ipLen : 0) +
                   (p ? 1 + Proto.varintLen(p) : 0);
        cw.tag(2, 2); cw.varint(body);
        if (ipLen) { cw.tag(1, 2); cw.varint(ipLen); cw.raw(src.subarray(off, off + ipLen)); }
        if (p) { cw.tag(2, 0); cw.varint(p); }
      }
      if (cat.reverse) { cw.tag(3, 0); cw.varint(1); }
      w.subField(1, cw);
    }
    return w.take().slice();
  }


  function parseGeoSite(buf, onProgress) {
    var r = new Reader(buf), cats = [];
    while (r.p < r.e) {
      var k = r.varint(), f = k >>> 3, w = k & 7;
      if (f === 1 && w === 2) {
        var len = r.varint(), end = r.p + len;
        cats.push(parseGeoSiteEntry(buf, r.p, end));
        r.p = end;
        if (onProgress && (cats.length & 31) === 0) onProgress(r.p / r.e);
      } else r.skip(w);
    }
    return cats;
  }

  function parseGeoSiteEntry(buf, s, e) {
    var r = new Reader(buf, s, e), n = 0, name = '', k, f, w, l;
    while (r.p < r.e) {
      k = r.varint(); f = k >>> 3; w = k & 7;
      if (f === 1 && w === 2) { l = r.varint(); name = Proto.str(buf, r.p, r.p + l); r.p += l; }
      else if (f === 2 && w === 2) { var sl2 = r.varint(); r.p += sl2; n++; }
      else r.skip(w);
    }
    var type = new Uint8Array(n), val = new Array(n), attrs = null, i = 0;
    r.p = s;
    while (r.p < r.e) {
      k = r.varint(); f = k >>> 3; w = k & 7;
      if (f === 2 && w === 2) {
        var dlen = r.varint(), de = r.p + dlen, t = 0, v = '', at = null;
        while (r.p < de) {
          var k2 = r.varint(), f2 = k2 >>> 3, w2 = k2 & 7;
          if (f2 === 1 && w2 === 0) t = r.varint();
          else if (f2 === 2 && w2 === 2) { var vl = r.varint(); v = Proto.str(buf, r.p, r.p + vl); r.p += vl; }
          else if (f2 === 3 && w2 === 2) {
            var alen = r.varint(), ae = r.p + alen, key = '', av = true;
            while (r.p < ae) {
              var k3 = r.varint(), f3 = k3 >>> 3, w3 = k3 & 7;
              if (f3 === 1 && w3 === 2) { var kl = r.varint(); key = Proto.str(buf, r.p, r.p + kl); r.p += kl; }
              else if (f3 === 2 && w3 === 0) av = r.varint() !== 0;
              else if (f3 === 3 && w3 === 0) av = r.varint();
              else r.skip(w3);
            }
            r.p = ae;
            (at || (at = [])).push({ k: key, v: av });
          } else r.skip(w2);
        }
        r.p = de;
        type[i] = t; val[i] = v;
        if (at) { if (!attrs) attrs = new Array(n).fill(null); attrs[i] = at; }
        i++;
      } else r.skip(w);
    }
    return { kind: 'geosite', name: name, n: n, type: type, val: val, attrs: attrs };
  }

  function writeGeoSite(cats) {
    var w = new Writer(1 << 21), cw = new Writer(1 << 18), dw = new Writer(1 << 12), aw = new Writer(256);
    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      cw.reset();
      cw.strField(1, cat.name);
      var type = cat.type, val = cat.val, attrs = cat.attrs;
      for (var i = 0; i < cat.n; i++) {
        dw.reset();
        if (type[i]) { dw.tag(1, 0); dw.varint(type[i]); }
        dw.strField(2, val[i]);
        var at = attrs ? attrs[i] : null;
        if (at) {
          for (var a = 0; a < at.length; a++) {
            aw.reset();
            aw.strField(1, at[a].k);
            if (typeof at[a].v === 'number') { aw.tag(3, 0); aw.varint(at[a].v); }
            else { aw.tag(2, 0); aw.varint(at[a].v ? 1 : 0); }
            dw.subField(3, aw);
          }
        }
        cw.subField(2, dw);
      }
      w.subField(1, cw);
    }
    return w.take().slice();
  }


  function parse(buf, hintName, onProgress) {
    var kind = sniff(buf);
    if (!kind) {
      var h = (hintName || '').toLowerCase();
      if (h.indexOf('geosite') >= 0 || h.indexOf('site') >= 0) kind = 'geosite';
      else if (h.indexOf('geoip') >= 0 || h.indexOf('ip') >= 0) kind = 'geoip';
      else throw new Error('not a recognizable geoip/geosite .dat file');
    }
    var cats = kind === 'geoip' ? parseGeoIP(buf, onProgress) : parseGeoSite(buf, onProgress);
    return { kind: kind, cats: cats };
  }

  function write(kind, cats) {
    return kind === 'geoip' ? writeGeoIP(cats) : writeGeoSite(cats);
  }

  function countEntries(cats) {
    var t = 0;
    for (var i = 0; i < cats.length; i++) t += cats[i].n;
    return t;
  }

  return {
    sniff: sniff, parse: parse, write: write,
    parseGeoIP: parseGeoIP, parseGeoSite: parseGeoSite,
    writeGeoIP: writeGeoIP, writeGeoSite: writeGeoSite,
    countEntries: countEntries,
    SITE_TYPE: SITE_TYPE, SITE_PREFIX: SITE_PREFIX
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeoDat;
