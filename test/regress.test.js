require('./_load.js');
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { console.log('FAIL: ' + m); fails++; } };
const sec = (s) => console.log('\n== ' + s + ' ==');


function site(lines) {
  const r = TextFmt.parse('geosite', lines.join('\n'));
  r.name = 'S';
  return r;
}
const lines = (c) => Array.from({ length: c.n }, (_, i) => TextFmt.siteLine(c, i));

function ip(list) {
  const r = TextFmt.parse('geoip', list.join('\n'));
  r.name = 'X'; r.kind = 'geoip'; r.reverse = false; r.raw = null; r.bad = 0;
  return r;
}
const cidrs = (c) => Array.from({ length: c.n }, (_, i) => Cidr.fmt(c.ips, c.pfx, c.fam, i, c.raw));

function withRaw(entries) {
  const n = entries.length;
  const ips = new Uint8Array(n * 16), pfx = new Uint8Array(n), fam = new Uint8Array(n);
  let raw = null, bad = 0;
  entries.forEach(([bytes, p, f], i) => {
    if (f === 0) { (raw || (raw = new Map())).set(i, Uint8Array.from(bytes)); }
    else ips.set(bytes, i * 16);
    pfx[i] = p; fam[i] = f;
  });
  for (let i = 0; i < n; i++) if (!Cidr.validAt(pfx, fam, i)) bad++;
  return { kind: 'geoip', name: 'B', n, ips, pfx, fam, reverse: false, raw, bad };
}


sec('geosite fold never widens a rule');

let c = Model.foldSite(site(['full:a.example.com', 'full:b.example.com']), {});
ok(c.n === 2 && lines(c).join() === 'full:a.example.com,full:b.example.com',
  'two full: siblings are NOT promoted to domain:example.com');

c = Model.foldSite(site(['full:a.example.com', 'full:b.example.com', 'full:c.example.com']), { foldKeyword: true });
ok(c.n === 3, 'no amount of siblings invents a parent rule');

c = Model.foldSite(site(['domain:example.com', 'full:a.example.com', 'full:example.com', 'domain:b.example.com']), {});
ok(lines(c).join() === 'domain:example.com', 'a real domain: parent does subsume its children and itself');

c = Model.foldSite(site(['domain:example.com', 'full:notexample.com', 'full:myexample.com', 'full:example.com.evil.com']), {});
ok(c.n === 4, 'suffix match only: prefix/infix look-alikes survive');

c = Model.foldSite(site(['domain:example.com', 'full:a.example.com @ads']), {});
ok(c.n === 2, 'an @attribute entry is never folded away');

c = Model.foldSite(site(['domain:example.com @ads', 'full:a.example.com']), {});
ok(c.n === 2, 'an @attribute entry never folds others');

c = Model.foldSite(site(['keyword:ads', 'domain:ads.example.com', 'regexp:^ads[0-9]+\\.']), { foldKeyword: true });
ok(lines(c).join() === 'keyword:ads,regexp:^ads[0-9]+\\.', 'keyword folds a containing rule but never a regexp');

c = Model.foldSite(site(['keyword:ads', 'domain:ads.example.com']), {});
ok(c.n === 2, 'keyword folding stays off unless asked for');

c = Model.foldSite(site(['domain:EXAMPLE.com', 'full:a.example.com']), {});
ok(c.n === 2, 'a rule that differs only in case does not fold anything');
c = Model.foldSite(site(['domain:example.com', 'full:a.example.com']), {});
ok(c.n === 1, '...but an exactly matching parent still does');

c = Model.foldSite(site(['keyword:ads', 'type7:ads.example.com']), { foldKeyword: true });
ok(c.n === 2, 'a Domain.Type this build does not know is opaque and is kept');


sec('geosite dedupe keys');

let s = { kind: 'geosite', name: 'S', n: 2, type: Uint8Array.from([2, 2]), val: ['a@b=1', 'a'], attrs: [null, [{ k: 'b', v: 1 }]] };
ok(Model.dedupe(s).n === 2, 'a value containing "@k=v" does not collide with an attribute');

s = { kind: 'geosite', name: 'S', n: 2, type: Uint8Array.from([2, 2]), val: ['a b', 'a'], attrs: null };
ok(Model.dedupe(s).n === 2, 'a value containing a space keeps its own key');


sec('unroutable geoip entries keep their identity');

c = withRaw([[[1, 2, 3], 24, 0], [[9, 9, 9], 24, 0], [[7, 7, 7, 7, 7], 24, 0]]);
ok(new Set([0, 1, 2].map((i) => Model.ipKey(c, i))).size === 3, 'three different malformed ips get three keys');
ok(Model.dedupe(c).n === 3, 'dedupe does not collapse them');
ok(Model.optimize(c).cat.n === 3, 'optimize carries all three through');

const dOnly = Diff.catDiff(c, withRaw([[[1, 2, 3], 24, 0]]), 'exact');
ok(dOnly.onlyA.n === 2 && dOnly.common === 1, 'exact diff tells them apart');


sec('.dat writer framing');

const long = new Array(200).fill(0).map((_, k) => k & 255);
const framed = withRaw([[long, 24, 0], [[1, 2, 3, 4], 32, 4], [[5, 6, 7, 8], 32, 4]]);
let back = null, err = null;
try { back = GeoDat.parseGeoIP(GeoDat.write('geoip', [framed]))[0]; } catch (e) { err = e; }
ok(!err, 'a preserved ip of 128+ bytes does not corrupt the stream: ' + (err && err.message));
ok(back && back.n === 3, 'all three entries survive');
ok(back && back.raw && back.raw.get(0).length === 200, 'the long ip comes back whole');
ok(back && cidrs(back).slice(1).join() === '1.2.3.4/32,5.6.7.8/32', 'the entries after it are still readable');

const attr = { kind: 'geosite', name: 'S', n: 1, type: Uint8Array.from([3]), val: ['a.com'], attrs: [[{ k: 'ads', v: false }]] };
const attrBack = GeoDat.parseGeoSite(GeoDat.write('geosite', [attr]))[0];
ok(attrBack.attrs[0][0].v === false, 'an attribute set to false does not reload as true');

const numAttr = { kind: 'geosite', name: 'S', n: 1, type: Uint8Array.from([3]), val: ['a.com'], attrs: [[{ k: 'w', v: 0 }]] };
ok(GeoDat.parseGeoSite(GeoDat.write('geosite', [numAttr]))[0].attrs[0][0].v === 0, 'an int attribute of 0 survives');


sec('unknown Domain.Type');

const odd = { kind: 'geosite', name: 'S', n: 1, type: Uint8Array.from([7]), val: ['a.com'], attrs: null };
ok(Model.stats(odd).unknown === 1, 'stats counts it instead of dropping it');
ok(TextFmt.siteLine(odd, 0) === 'type7:a.com', 'text export names the type instead of printing "undefined"');
const oddBack = TextFmt.parse('geosite', TextFmt.siteLine(odd, 0));
ok(oddBack.type[0] === 7 && oddBack.val[0] === 'a.com', 'and it imports back unchanged');


sec('reverse_match is not silently inverted');

const rev = Object.assign(ip(['10.0.0.0/8']), { name: 'R', reverse: true });
const norm = Object.assign(ip(['8.8.8.8/32']), { name: 'N', reverse: false });
ok(Model.reverseClash([rev, norm]) === true, 'a mixed selection is reported as a clash');
ok(Model.reverseClash([rev, Object.assign(ip(['1.1.1.1/32']), { reverse: true })]) === false, 'a uniform selection is not');
const merged = Model.mergeCats([rev, norm], [0, 1], 'M', {});
ok(merged.reverseClash === true, 'mergeCats reports it to the caller');
ok(merged.cat.reverse === true, 'and does not OR the flag onto a fresh value');
ok(Model.append(rev, ip(['1.2.3.4/32'])).reverse === true, 'appending into a reverse category keeps the target flag');

const ra = Object.assign(ip(['10.0.0.0/8']), { name: 'X', reverse: true });
const rb = Object.assign(ip(['10.0.0.0/8']), { name: 'X', reverse: false });
ok(Diff.fileDiff({ cats: [ra] }, { cats: [rb] }, 'exact')[0].status === 'changed', 'exact diff notices a reverse_match flip');
ok(Diff.fileDiff({ cats: [ra] }, { cats: [rb] }, 'coverage')[0].status === 'changed', 'coverage diff notices it too');
ok(Diff.catDiff(ra, rb, 'exact').reverseChanged === true, 'the detail reports it');


sec('duplicate category names');

const A = { cats: [Object.assign(ip(['1.0.0.0/24']), { name: 'DUP' }), Object.assign(ip(['2.0.0.0/24']), { name: 'dup' })] };
const B = { cats: [Object.assign(ip(['1.0.0.0/24']), { name: 'DUP' })] };
const row = Diff.fileDiff(A, B, 'exact')[0];
ok(row.dupA === 2, 'the shadowed copy is counted, not ignored');
ok(row.onlyA === 0 && row.status === 'same',
  'the row describes the first copy — the same one a name lookup resolves to');


sec('applying a diff back onto A');

function syncExact(ca, cb) {
  const d = Diff.catDiff(ca, cb, 'exact');
  const kill = new Set();
  for (let k = 0; k < d.onlyA.n; k++) kill.add(Model.key(d.onlyA, k));
  const keep = [];
  for (let j = 0; j < ca.n; j++) if (!kill.has(Model.key(ca, j))) keep.push(j);
  return Model.dedupe(Model.append(Model.pick(ca, keep), d.onlyB));
}
const srcA = ip(['1.0.0.0/24', '1.0.1.0/24', '9.9.9.9/32']);
const srcB = ip(['1.0.0.0/24', '1.0.1.0/24', '8.8.8.8/32']);
const synced = syncExact(srcA, srcB);
const resid = Diff.catDiff(synced, srcB, 'exact');
ok(resid.onlyA.n === 0 && resid.onlyB.n === 0,
  '"Make A match B" in exact mode leaves no residual diff (was ' + resid.onlyA.n + '/' + resid.onlyB.n + ')');

const mixed = withRaw([[[10, 0, 0, 0], 8, 4], [[1, 2, 3], 24, 0], [[192, 168, 0, 0], 40, 4]]);
const rr = Cidr.toRanges(mixed.ips, mixed.pfx, mixed.fam, mixed.n);
let rebuilt = Cidr.fromRanges(Cidr.subtract(rr.v4, [], 1), Cidr.subtract(rr.v6, [], 1n));
let carried = { kind: 'geoip', name: 'B', n: rebuilt.n, ips: rebuilt.ips, pfx: rebuilt.pfx, fam: rebuilt.fam, reverse: false, raw: null, bad: 0 };
carried = Model.concat([carried, Model.pick(mixed, rr.invalid)], 'B', 'geoip');
ok(carried.n === 3 && carried.bad === 2, 'invalid entries are carried across a coverage-mode rewrite');
ok(carried.raw && carried.raw.get(1) && carried.raw.get(1).length === 3, 'and keep their original bytes');


sec('geoip optimize is coverage-exact');

const agg = Model.optimize(ip(['1.0.0.0/24', '1.0.1.0/24', '1.0.0.128/25', '2001:db8::/33', '2001:db8:8000::/33'])).cat;
ok(cidrs(agg).join() === '1.0.0.0/23,2001:db8::/32', 'tangential and contained blocks collapse');
const before = Cidr.toRanges(...[ip(['1.0.0.0/24', '1.0.1.0/24'])].flatMap((x) => [x.ips, x.pfx, x.fam, x.n]));
const after = Cidr.toRanges(agg.ips, agg.pfx, agg.fam, 1);
ok(JSON.stringify(before.v4) === JSON.stringify(after.v4), 'covered address space is unchanged');

console.log(fails === 0 ? '\nregress: all ' + checks + ' checks passed' : '\nregress: ' + fails + ' of ' + checks + ' FAILED');
process.exit(fails ? 1 : 0);
