var VList = (function () {
  'use strict';

  var MAXPX = 4000000;
  var OVER = 4;

  function VList(el, opts) {
    this.el = el;
    this.rh = opts.rowHeight || 24;
    this.createRow = opts.createRow;
    this.renderRow = opts.renderRow;
    this.count = 0;
    this.pool = [];
    this.poolSize = 0;
    this.pass = 0;
    this.spacerH = -1;

    el.classList.add('vlist');
    this.spacer = document.createElement('div');
    this.spacer.className = 'vl-spacer';
    this.viewport = document.createElement('div');
    this.viewport.className = 'vl-viewport';
    el.appendChild(this.spacer);
    el.appendChild(this.viewport);

    var self = this;
    this.tick = function () { self.frame = 0; self.draw(); };
    this.onScroll = function () { if (!self.frame) self.frame = requestAnimationFrame(self.tick); };
    el.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll);
  }

  VList.prototype.setCount = function (n, keepScroll) {
    this.count = n;
    if (!keepScroll) this.el.scrollTop = 0;
    this.invalidate();
  };

  VList.prototype.invalidate = function () {
    for (var i = 0; i < this.pool.length; i++) this.pool[i]._i = -1;
    this.draw();
  };

  VList.prototype.draw = function () {
    var n = this.count, rh = this.rh, el = this.el;
    var clientH = el.clientHeight || 1;
    var totalPx = n * rh;
    var H = totalPx > MAXPX ? MAXPX : totalPx;
    if (this.spacerH !== H) { this.spacer.style.height = H + 'px'; this.spacerH = H; }

    var scrollTop = el.scrollTop;
    var virtualTop = scrollTop;
    if (H !== totalPx) {
      var dr = H - clientH, dv = totalPx - clientH;
      virtualTop = dr > 0 ? scrollTop * (dv / dr) : 0;
    }

    var visible = Math.ceil(clientH / rh) + OVER * 2 + 1;
    if (this.poolSize < visible) {
      while (this.pool.length < visible) {
        var row = this.createRow();
        row._i = -1;
        row.style.height = rh + 'px';
        this.viewport.appendChild(row);
        this.pool.push(row);
      }
      this.poolSize = visible;
      for (var q = 0; q < this.pool.length; q++) this.pool[q]._i = -1;
    }

    var first = Math.floor(virtualTop / rh) - OVER;
    if (first < 0) first = 0;
    var last = first + visible - 1;
    if (last > n - 1) last = n - 1;
    var base = Math.round(scrollTop - (virtualTop - first * rh));

    var pass = ++this.pass;
    for (var i = first; i <= last; i++) {
      var slot = this.pool[i % this.poolSize];
      if (slot._i !== i) {
        this.renderRow(slot, i);
        slot._i = i;
      }
      var y = base + (i - first) * rh;
      if (slot._y !== y) { slot.style.transform = 'translateY(' + y + 'px)'; slot._y = y; }
      if (slot._hidden) { slot.style.display = ''; slot._hidden = false; }
      slot._pass = pass;
    }
    for (var k = 0; k < this.pool.length; k++) {
      var p = this.pool[k];
      if (p._pass !== pass && !p._hidden) { p.style.display = 'none'; p._hidden = true; p._i = -1; }
    }
  };

  VList.prototype.scrollToRow = function (i) {
    var totalPx = this.count * this.rh;
    var H = totalPx > MAXPX ? MAXPX : totalPx;
    var clientH = this.el.clientHeight || 1;
    var target = i * this.rh;
    if (H !== totalPx) {
      var dv = totalPx - clientH;
      target = dv > 0 ? (target * (H - clientH)) / dv : 0;
    }
    this.el.scrollTop = Math.max(0, target - clientH / 3);
    this.draw();
  };

  VList.prototype.rowOf = function (node) {
    while (node && node !== this.el) {
      if (node.classList && node.classList.contains('row')) return node._i;
      node = node.parentNode;
    }
    return -1;
  };

  return VList;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VList;
