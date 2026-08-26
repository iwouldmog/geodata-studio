require('./_load.js');
const fs = require('fs');
const path = require('path');
let fails = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL: ' + m); fails++; } };
const ms = (f) => { const t = Date.now(); const r = f(); return [r, Date.now() - t]; };

const load = (p) => { const b = new Uint8Array(fs.readFileSync(p)); const r = GeoDat.parse(b, p); return { kind: r.kind, cats: r.cats, name: p.split('/').pop() }; };

const fx = path.join(__dirname, 'fixtures');
const args = process.argv.slice(2);
const F = {
  ipA: args[0] || path.join(fx, 'geoip.dat'),
  ipB: args[1] || path.join(fx, 'geoip-2.dat'),
  siteA: args[2] || path.join(fx, 'geosite.dat'),
  siteB: args[3] || path.join(fx, 'geosite-2.dat')
};
for (const [k, v] of Object.entries(F)) {
  if (!fs.existsSync(v)) {
    console.log('missing fixture ' + v + '\n  put real .dat files in test/fixtures/ or pass paths as arguments');
    process.exit(0);
  }
}
const A = load(F.ipA);
const B = load(F.ipB);

for (const cat of A.cats) {
  const before = Cidr.toRanges(cat.ips, cat.pfx, cat.fam, cat.n);
  const [res, t] = ms(() => Model.optimize(cat));
  const after = Cidr.toRanges(res.cat.ips, res.cat.pfx, res.cat.fam, res.cat.n);
  ok(JSON.stringify(before.v4) === JSON.stringify(after.v4), 'v4 coverage preserved for ' + cat.name);
  ok(before.v6.length === after.v6.length && before.v6.every((v, i) => v === after.v6[i]), 'v6 coverage preserved for ' + cat.name);
  const re = Model.optimize(res.cat);
  ok(re.after === res.after, 'optimize is idempotent for ' + cat.name);
  console.log(`optimize ${cat.name}: ${res.before} -> ${res.after} (${(100 - res.after / res.before * 100).toFixed(1)}% smaller) in ${t}ms`);
}

for (const mode of ['exact', 'coverage']) {
  const [rows, t] = ms(() => Diff.fileDiff(A, B, mode));
  console.log(`\nfileDiff (${mode}) in ${t}ms`);
  for (const r of rows) console.log(`  ${r.name}: A=${r.na} B=${r.nb} onlyA=${r.onlyA} onlyB=${r.onlyB} common=${r.common} [${r.status}]`);
}
const d = Diff.catDiff(A.cats[0], B.cats[0], 'exact');
console.log('detail DIRECT: onlyA', d.onlyA.n, 'onlyB', d.onlyB.n, 'sample B-only:', Array.from({length: Math.min(3, d.onlyB.n)}, (_, i) => Cidr.fmt(d.onlyB.ips, d.onlyB.pfx, d.onlyB.fam, i)).join(' '));
ok(d.onlyA.n + d.common <= A.cats[0].n, 'diff counts sane');

const S = load(F.siteA);
const cat = S.cats.slice().sort((a, b) => b.n - a.n)[0];
const dd = Model.optimize(cat, { fold: true });
console.log(`\ngeosite optimize ${cat.name}: ${dd.before} -> ${dd.after}`);
const merged = Model.mergeCats(S.cats, [0, 1, 2], 'MERGED', { fold: true });
console.log(`merge 3 cats: ${S.cats[0].n}+${S.cats[1].n}+${S.cats[2].n} -> ${merged.after} (raw ${merged.before})`);
ok(merged.cat.n === merged.after, 'merged count matches');

const txt = TextFmt.toText(cat);
const back = TextFmt.parse('geosite', txt);
ok(back.n === cat.n, `text round trip count ${back.n} vs ${cat.n}`);
let same = true;
for (let i = 0; i < cat.n; i++) if (back.val[i] !== cat.val[i] || back.type[i] !== cat.type[i]) { same = false; console.log('  mismatch', i, cat.val[i], back.val[i]); break; }
ok(same, 'text round trip values');

const ipTxt = TextFmt.toText(A.cats[2]);
const ipBack = TextFmt.parse('geoip', ipTxt);
ok(ipBack.n === A.cats[2].n, 'ip text round trip count');
let same2 = true;
for (let i = 0; i < ipBack.n; i++) if (Cidr.fmt(ipBack.ips, ipBack.pfx, ipBack.fam, i) !== Cidr.fmt(A.cats[2].ips, A.cats[2].pfx, A.cats[2].fam, i)) { same2 = false; break; }
ok(same2, 'ip text round trip values');

const S2 = load(F.siteB);
const withAttr = S2.cats.find(c => c.attrs);
if (withAttr) {
  const buf = GeoDat.write('geosite', [withAttr]);
  const rt = GeoDat.parseGeoSite(buf)[0];
  ok(rt.n === withAttr.n, 'attr cat count');
  let aok = true;
  for (let i = 0; i < rt.n; i++) if (Model.siteKey(rt, i) !== Model.siteKey(withAttr, i)) { aok = false; console.log('  attr mismatch at', i, TextFmt.siteLine(withAttr, i), '!=', TextFmt.siteLine(rt, i)); break; }
  ok(aok, 'attributes preserved through write/parse');
  console.log('attr sample:', TextFmt.siteLine(withAttr, withAttr.attrs.findIndex(a => a)));
}

{
  const mk = (rules) => {
    const type = new Uint8Array(rules.length), val = [];
    let attrs = null;
    rules.forEach((r, i) => {
      const at = r.indexOf('@');
      const body = at > 0 ? r.slice(0, at) : r;
      const c = body.indexOf(':');
      type[i] = { keyword: 0, regexp: 1, domain: 2, full: 3 }[body.slice(0, c)];
      val[i] = body.slice(c + 1);
      if (at > 0) { if (!attrs) attrs = new Array(rules.length).fill(null); attrs[i] = [{ key: r.slice(at + 1), val: '' }]; }
    });
    return { kind: 'geosite', name: 'T', n: rules.length, type, val, attrs };
  };
  const names = (cat, idx) => idx.map((i) => ['keyword', 'regexp', 'domain', 'full'][cat.type[i]] + ':' + cat.val[i]);

  const have = mk(['domain:1c.ru', 'domain:example.com', 'full:only.this', 'keyword:ads']);
  const want = mk(['full:1c.ru', 'domain:sub.1c.ru', 'full:a.b.example.com', 'full:only.this',
                   'full:nope.org', 'domain:example.com', 'regexp:^x$', 'keyword:ads', 'keyword:adserver']);

  const miss = names(want, Model.siteMissing(have, want, {}));
  ok(miss.join('|') === 'full:nope.org|regexp:^x$|keyword:adserver', 'siteMissing: ' + miss.join(', '));

  const missK = names(want, Model.siteMissing(have, want, { foldKeyword: true }));
  ok(missK.join('|') === 'full:nope.org|regexp:^x$', 'siteMissing foldKeyword: ' + missK.join(', '));

  ok(Model.siteMissing(mk(['domain:a.example.com']), mk(['domain:example.com']), {}).length === 1,
     'siteMissing: child does not cover parent');

  ok(Model.siteMissing(mk(['domain:example.com']), mk(['full:x.example.com@ads']), {}).length === 1,
     'siteMissing: attributed rule needs an exact match');

  {
    const all = mk(['domain:example.com', 'full:example.com', 'full:a.example.com',
                    'domain:b.example.com', 'full:elsewhere.org', 'keyword:zz']);
    const folded = Model.foldSite(all, { fold: true });
    ok(folded.n < all.n, 'foldSite dropped something to check');
    ok(Model.siteMissing(folded, all, {}).length === 0,
       'siteMissing agrees with foldSite: nothing folded away is reported missing');
  }
}

console.log(fails === 0 ? '\nops: all tests passed' : '\nops: ' + fails + ' FAILURES');
process.exit(fails ? 1 : 0);
