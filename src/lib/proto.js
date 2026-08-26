var Proto = (function () {
  'use strict';

  var TD = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  var TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var HAS_ENCODE_INTO = !!(TE && TE.encodeInto);


  function Reader(b, s, e) {
    this.b = b;
    this.p = s === undefined ? 0 : s;
    this.e = e === undefined ? b.length : e;
  }

  Reader.prototype.eof = function () { return this.p >= this.e; };

  Reader.prototype.varint = function () {
    var b = this.b, c = b[this.p++];
    if (c < 0x80) return c;
    var v = c & 0x7f, mul = 128;
    do {
      c = b[this.p++];
      v += (c & 0x7f) * mul;
      mul *= 128;
    } while (c >= 0x80);
    return v;
  };

  Reader.prototype.skip = function (w) {
    switch (w) {
      case 0: { var b = this.b; while (b[this.p++] >= 0x80) {} break; }
      case 1: this.p += 8; break;
      case 2: { var n2 = this.varint(); this.p += n2; break; }
      case 5: this.p += 4; break;
      default: throw new Error('unsupported wire type ' + w);
    }
  };

  var fromCharCode = String.fromCharCode;
  function str(b, s, e) {
    var n = e - s;
    if (n <= 0) return '';
    if (n <= 64) {
      var i = s, ascii = true;
      for (; i < e; i++) { if (b[i] > 127) { ascii = false; break; } }
      if (ascii) {
        switch (n) {
          case 1: return fromCharCode(b[s]);
          case 2: return fromCharCode(b[s], b[s + 1]);
          case 3: return fromCharCode(b[s], b[s + 1], b[s + 2]);
          case 4: return fromCharCode(b[s], b[s + 1], b[s + 2], b[s + 3]);
          default: return fromCharCode.apply(null, b.subarray(s, e));
        }
      }
    }
    return TD.decode(b.subarray(s, e));
  }


  function utf8Len(s) {
    var l = 0, i = 0, n = s.length, c;
    for (; i < n; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) l += 1;
      else if (c < 0x800) l += 2;
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < n && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { l += 4; i++; }
      else l += 3;
    }
    return l;
  }

  function varintLen(v) {
    var n = 1;
    while (v >= 128) { v = Math.floor(v / 128); n++; }
    return n;
  }

  function Writer(cap) {
    this.b = new Uint8Array(cap || 65536);
    this.n = 0;
  }

  Writer.prototype.need = function (k) {
    var b = this.b;
    if (this.n + k <= b.length) return;
    var cap = b.length * 2;
    while (cap < this.n + k) cap *= 2;
    var nb = new Uint8Array(cap);
    nb.set(b.subarray(0, this.n));
    this.b = nb;
  };

  Writer.prototype.reset = function () { this.n = 0; return this; };

  Writer.prototype.byte = function (v) { this.need(1); this.b[this.n++] = v; };

  Writer.prototype.varint = function (v) {
    this.need(10);
    var b = this.b, n = this.n;
    while (v >= 128) { b[n++] = (v % 128) + 128; v = Math.floor(v / 128); }
    b[n++] = v;
    this.n = n;
  };

  Writer.prototype.tag = function (f, w) { this.varint(f * 8 + w); };

  Writer.prototype.raw = function (u8) {
    this.need(u8.length);
    this.b.set(u8, this.n);
    this.n += u8.length;
  };

  Writer.prototype.bytesField = function (f, src, off, len) {
    this.tag(f, 2);
    this.varint(len);
    this.need(len);
    this.b.set(src.subarray(off, off + len), this.n);
    this.n += len;
  };

  Writer.prototype.strField = function (f, s) {
    var l = utf8Len(s);
    this.tag(f, 2);
    this.varint(l);
    this.need(l);
    if (HAS_ENCODE_INTO) {
      TE.encodeInto(s, this.b.subarray(this.n, this.n + l));
    } else {
      this.b.set(TE ? TE.encode(s) : asciiBytes(s), this.n);
    }
    this.n += l;
  };

  Writer.prototype.varintField = function (f, v) { this.tag(f, 0); this.varint(v); };

  Writer.prototype.subField = function (f, w) {
    this.tag(f, 2);
    this.varint(w.n);
    this.raw(w.b.subarray(0, w.n));
  };

  Writer.prototype.take = function () { return this.b.subarray(0, this.n); };

  function asciiBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
    return out;
  }

  return {
    Reader: Reader,
    Writer: Writer,
    str: str,
    varintLen: varintLen
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Proto;
