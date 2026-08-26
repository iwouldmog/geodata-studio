const C = require('../src/lib/cidr.js');
let fails = 0;
function ok(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

const b = new Uint8Array(16);
const cases = [
  ['1.2.3.0/24', 4, 24, '1.2.3.0/24'],
  ['8.8.8.8', 4, 32, '8.8.8.8/32'],
  ['0.0.0.0/0', 4, 0, '0.0.0.0/0'],
  ['2001:db8::/32', 6, 32, '2001:db8::/32'],
  ['::1', 6, 128, '::1/128'],
  ['::/0', 6, 0, '::/0'],
  ['fe80::1%x', null, 0, ''],
  ['2001:0db8:0000:0000:0000:ff00:0042:8329/64', 6, 64, '2001:db8::ff00:42:8329/64'],
  ['::ffff:1.2.3.4', 6, 128, '::ffff:102:304/128'],
  ['256.1.1.1', null, 0, ''],
  ['1.2.3', null, 0, ''],
  ['1.2.3.4/33', null, 0, ''],
];
for (const [s, fam, pfx, out] of cases) {
  const r = C.parse(s, b, 0);
  if (fam === null) { ok(r === null, 'should reject ' + s); continue; }
  ok(r && r.fam === fam && r.prefix === pfx, 'parse ' + s + ' => ' + JSON.stringify(r));
  if (r) {
    const ips = new Uint8Array(16); ips.set(b);
    const got = C.fmt(ips, [r.prefix], [r.fam], 0);
    ok(got === out, 'fmt ' + s + ' => ' + got + ' want ' + out);
  }
}

function pack(list) {
  const n = list.length;
  const ips = new Uint8Array(n * 16), pfx = new Uint8Array(n), fam = new Uint8Array(n);
  list.forEach((s, i) => { const r = C.parse(s, ips, i * 16); pfx[i] = r.prefix; fam[i] = r.fam; });
  return { ips, pfx, fam, n };
}
function coverage(set) {
  const base = 10 * 16777216, bm = new Uint8Array(1 << 20);
  for (let i = 0; i < set.n; i++) {
    const r = C.entryRange(set.ips, set.pfx, set.fam, i);
    for (let a = r.s; a <= r.e; a++) bm[a - base] = 1;
  }
  return bm;
}
let seed = 12345;
const rnd = (m) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m;

for (let trial = 0; trial < 200; trial++) {
  const list = [];
  for (let k = 0; k < 40; k++) {
    const pfx = 12 + rnd(21);
    const size = Math.pow(2, 32 - pfx);
    const base = 10 * 16777216 + rnd(1 << 20);
    const s = base - (base % size);
    list.push(C.v4NumStr(s) + '/' + pfx);
  }
  const set = pack(list);
  const agg = C.aggregate(set.ips, set.pfx, set.fam, set.n);
  const a = coverage(set), c = coverage(agg);
  let same = a.length === c.length;
  if (same) for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) { same = false; break; }
  ok(same, 'aggregate preserves coverage (trial ' + trial + ')');
  ok(agg.n <= set.n, 'aggregate never grows');
  const rs = [];
  for (let i = 0; i < agg.n; i++) { const r = C.entryRange(agg.ips, agg.pfx, agg.fam, i); rs.push(r); }
  for (let i = 1; i < rs.length; i++) {
    ok(rs[i].s > rs[i - 1].e + 1 || !isMergeable(rs[i - 1], rs[i]), 'minimal at ' + i);
  }
}
function isMergeable(x, y) {
  if (y.s !== x.e + 1) return false;
  const size = x.e - x.s + 1;
  return (y.e - y.s + 1) === size && x.s % (size * 2) === 0;
}

function aggStr(list) {
  const s = pack(list), a = C.aggregate(s.ips, s.pfx, s.fam, s.n);
  return Array.from({ length: a.n }, (_, i) => C.fmt(a.ips, a.pfx, a.fam, i)).join(' ');
}
ok(aggStr(['1.0.0.0/24', '1.0.1.0/24']) === '1.0.0.0/23', 'adjacent merge: ' + aggStr(['1.0.0.0/24', '1.0.1.0/24']));
ok(aggStr(['1.0.1.0/24', '1.0.2.0/24']) === '1.0.1.0/24 1.0.2.0/24', 'non-aligned stays split');
ok(aggStr(['1.0.0.0/8', '1.2.3.4/32']) === '1.0.0.0/8', 'subsumed dropped');
ok(aggStr(['1.0.0.0/24', '1.0.0.0/24']) === '1.0.0.0/24', 'dedupe');
ok(aggStr(['1.0.0.0/25', '1.0.0.128/25', '1.0.1.0/24']) === '1.0.0.0/23', 'multi-level merge');
ok(aggStr(['2001:db8::/33', '2001:db8:8000::/33']) === '2001:db8::/32', 'v6 merge');
ok(aggStr(['0.0.0.0/1', '128.0.0.0/1']) === '0.0.0.0/0', 'full space merge');
ok(aggStr(['::/1', '8000::/1']) === '::/0', 'v6 full space');
ok(aggStr(['1.0.0.1/32', '1.0.0.2/32', '1.0.0.3/32']) === '1.0.0.1/32 1.0.0.2/31', 'host merge');

for (let trial = 0; trial < 100; trial++) {
  const mk = () => {
    const l = [];
    for (let k = 0; k < 15; k++) {
      const pfx = 14 + rnd(19), size = Math.pow(2, 32 - pfx);
      const base = 10 * 16777216 + rnd(1 << 20);
      l.push(C.v4NumStr(base - (base % size)) + '/' + pfx);
    }
    return pack(l);
  };
  const A = mk(), B = mk();
  const ra = C.toRanges(A.ips, A.pfx, A.fam, A.n).v4;
  const rb = C.toRanges(B.ips, B.pfx, B.fam, B.n).v4;
  const d = C.subtract(ra, rb, 1);
  const packDiff = C.fromRanges(d, []);
  const bmA = coverage(A), bmB = coverage(B), bmD = coverage(packDiff);
  let good = true;
  for (let i = 0; i < bmA.length; i++) {
    const want = bmA[i] && !bmB[i] ? 1 : 0;
    if (bmD[i] !== want) { good = false; break; }
  }
  ok(good, 'subtract matches bitmap (trial ' + trial + ')');
  const it = C.intersect(ra, rb);
  const packInt = C.fromRanges(it, []);
  const bmI = coverage(packInt);
  let good2 = true;
  for (let i = 0; i < bmA.length; i++) {
    const want = bmA[i] && bmB[i] ? 1 : 0;
    if (bmI[i] !== want) { good2 = false; break; }
  }
  ok(good2, 'intersect matches bitmap (trial ' + trial + ')');
}

console.log(fails === 0 ? 'cidr: all tests passed' : 'cidr: ' + fails + ' FAILURES');
process.exit(fails ? 1 : 0);
