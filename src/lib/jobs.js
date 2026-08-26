var Jobs = (function () {
  'use strict';

  function run(job, p, progress) {
    switch (job) {
      case 'parse': {
        var buf = new Uint8Array(p.buf);
        var r = GeoDat.parse(buf, p.name, progress);
        return { kind: r.kind, cats: r.cats };
      }
      case 'write':
        return { buf: GeoDat.write(p.kind, p.cats) };
      case 'optimize':
        return Model.optimize(p.cat, p.opts);
      case 'sort':
        return { cat: Model.sort(p.cat, p.how) };
      case 'merge':
        return Model.mergeCats(p.cats, p.cats.map(function (_, i) { return i; }), p.name, p.opts);
      case 'append': {
        var out = Model.append(p.cat, p.chunk);
        if (p.opts && p.opts.optimize) return Model.optimize(out, p.opts);
        return { cat: out, before: p.cat.n, after: out.n };
      }
      case 'stats':
        return { stats: Model.stats(p.cat) };
      case 'fileDiff': {
        var rows = Diff.fileDiff({ cats: p.a }, { cats: p.b }, p.mode);
        return {
          rows: rows.map(function (r) {
            return {
              name: r.name, na: r.na, nb: r.nb, onlyA: r.onlyA, onlyB: r.onlyB,
              common: r.common, status: r.status, unit: r.unit,
              dupA: r.dupA, dupB: r.dupB, reverseChanged: r.reverseChanged
            };
          })
        };
      }
      case 'catDiff':
        return Diff.catDiff(p.a, p.b, p.mode);
      default:
        throw new Error('unknown job: ' + job);
    }
  }

  return { run: run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Jobs;
