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


  function parseSite(text) {
    var lines = splitLines(text);
    var cap = lines.length;
    var type = new Uint8Array(cap), val = new Array(cap), attrs = new Array(cap);
    var errors = [], hasAttr = false, n = 0;
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
          pushErr(errors, { line: i + 1, text: lines[i], msg: 'include: is a source-tree directive and has no .dat representation' });
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
    return {
      kind: 'geosite', n: n,
      type: n * 2 < cap ? type.slice(0, n) : type.subarray(0, n), val: val.slice(0, n),
      attrs: hasAttr ? attrs.slice(0, n) : null,
      errors: errors
    };
  }

  function siteLine(cat, i) {
    var t = cat.type[i];
    var s = (GeoDat.SITE_TYPE[t] || ('type' + t)) + ':' + cat.val[i];
    var at = cat.attrs ? cat.attrs[i] : null;
    if (at) for (var k = 0; k < at.length; k++) s += ' @' + at[k].k + (at[k].v === true ? '' : '=' + at[k].v);
    return s;
  }


  function parseIp(text) {
    var lines = splitLines(text);
    var cap = lines.length;
    var ips = new Uint8Array(cap * 16), pfx = new Uint8Array(cap), fam = new Uint8Array(cap);
    var errors = [], n = 0;
    for (var i = 0; i < lines.length; i++) {
      var raw = stripComment(lines[i]);
      if (!raw) continue;
      raw = raw.split(/[\s,;]+/)[0];
      if (!raw) continue;
      var r = Cidr.parse(raw, ips, n * 16);
      if (!r) {
        if (errors.length < 5000) pushErr(errors, { line: i + 1, text: lines[i], msg: 'not an IP or CIDR' });
        continue;
      }
      pfx[n] = r.prefix;
      fam[n] = r.fam;
      n++;
    }
    var tight = n * 2 < cap;
    return {
      kind: 'geoip', n: n,
      ips: tight ? ips.slice(0, n * 16) : ips.subarray(0, n * 16),
      pfx: tight ? pfx.slice(0, n) : pfx.subarray(0, n),
      fam: tight ? fam.slice(0, n) : fam.subarray(0, n),
      errors: errors
    };
  }

  function ipLine(cat, i) { return Cidr.fmt(cat.ips, cat.pfx, cat.fam, i, cat.raw); }


  function line(cat, i) { return cat.kind === 'geoip' ? ipLine(cat, i) : siteLine(cat, i); }

  function parse(kind, text) { return kind === 'geoip' ? parseIp(text) : parseSite(text); }

  function toText(cat, idx) {
    var out = [], n = idx ? idx.length : cat.n;
    for (var i = 0; i < n; i++) out.push(line(cat, idx ? idx[i] : i));
    return out.join('\n');
  }

  function sniffText(text) {
    var lines = splitLines(text), ip = 0, site = 0, tmp = new Uint8Array(16), checked = 0;
    for (var i = 0; i < lines.length && checked < 40; i++) {
      var raw = stripComment(lines[i]);
      if (!raw) continue;
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
