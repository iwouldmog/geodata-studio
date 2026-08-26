require('./_load.js');

let fails = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { console.log('  FAIL: ' + m); fails++; } }
function section(n) { console.log('\n== ' + n + ' =='); }

let seed = 20260825;
const rnd = (m) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m;


const REF = {
  range(bytes, off, prefix, fam) {
    const bits = fam === 4 ? 32 : 128;
    let v = 0n;
    for (let i = 0; i < bits / 8; i++) v = (v << 8n) | BigInt(bytes[off + i]);
    const size = 1n << BigInt(bits - prefix);
    const s = (v / size) * size;
    return [s, s + size - 1n];
  },
  merge(rs) {
    const a = rs.slice().sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    const out = [];
    for (const r of a) {
      if (out.length && r[0] <= out[out.length - 1][1] + 1n) {
        if (r[1] > out[out.length - 1][1]) out[out.length - 1][1] = r[1];
      } else out.push([r[0], r[1]]);
    }
    return out;
  },
  subtract(A, B) {
    const out = [];
    for (const [s0, e0] of A) {
      let cuts = [[s0, e0]];
      for (const [bs, be] of B) {
        const next = [];
        for (const [s, e] of cuts) {
          if (be < s || bs > e) { next.push([s, e]); continue; }
          if (bs > s) next.push([s, bs - 1n]);
          if (be < e) next.push([be + 1n, e]);
        }
        cuts = next;
      }
      out.push(...cuts);
    }
    return REF.merge(out);
  },
  intersect(A, B) {
    const out = [];
    for (const [as, ae] of A) for (const [bs, be] of B) {
      const s = as > bs ? as : bs, e = ae < be ? ae : be;
      if (s <= e) out.push([s, e]);
    }
    return REF.merge(out);
  },
  toCidrs(s, e, bits) {
    const out = [];
    let cur = s;
    while (cur <= e) {
      let n = 0n;
      if (cur === 0n) n = BigInt(bits);
      else { let t = cur; while (t % 2n === 0n) { n++; t /= 2n; } }
      let size = 1n << n;
      while (size > 0n && cur + size - 1n > e) { n -= 1n; size = 1n << n; }
      out.push([cur, BigInt(bits) - n]);
      cur += size;
    }
    return out;
  }
};

function packFromStrings(list) {
  const n = list.length;
  const ips = new Uint8Array(n * 16), pfx = new Uint8Array(n), fam = new Uint8Array(n);
  list.forEach((s, i) => {
    const r = Cidr.parse(s, ips, i * 16);
    if (!r) throw new Error('bad fixture cidr: ' + s);
    pfx[i] = r.prefix; fam[i] = r.fam;
  });
  return { ips, pfx, fam, n };
}
function toStrings(p) {
  return Array.from({ length: p.n }, (_, i) => Cidr.fmt(p.ips, p.pfx, p.fam, i));
}
function refRangesOf(p) {
  const v4 = [], v6 = [];
  for (let i = 0; i < p.n; i++) {
    const r = REF.range(p.ips, i * 16, p.pfx[i], p.fam[i]);
    (p.fam[i] === 4 ? v4 : v6).push(r);
  }
  return { v4: REF.merge(v4), v6: REF.merge(v6) };
}
const eqR = (a, b) => a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
const flatToPairs = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 2) o.push([BigInt(flat[i]), BigInt(flat[i + 1])]); return o; };

section('address round trips');
{
  const buf = new Uint8Array(16), out = new Uint8Array(16);
  let bad = 0;
  for (let t = 0; t < 40000; t++) {
    const v6 = t % 2 === 0;
    const len = v6 ? 16 : 4;
    for (let i = 0; i < 16; i++) buf[i] = 0;
    const zeroBias = t % 3;
    for (let i = 0; i < len; i++) buf[i] = zeroBias && rnd(3) ? 0 : rnd(256);
    const prefix = v6 ? rnd(129) : rnd(33);
    const str = Cidr.fmt(buf, [prefix], [v6 ? 6 : 4], 0);
    const back = Cidr.parse(str, out, 0);
    if (!back || back.prefix !== prefix || back.fam !== (v6 ? 6 : 4)) { bad++; if (bad < 4) console.log('  round trip parse failed: ' + str); continue; }
    for (let i = 0; i < 16; i++) if (out[i] !== buf[i]) { bad++; if (bad < 4) console.log('  round trip bytes differ: ' + str); break; }
  }
  ok(bad === 0, bad + ' round-trip failures');
}

section('RFC 5952 formatting (exhaustive over zero patterns)');
{
  function refV6Str(groups) {
    let best = -1, bestLen = 1, i = 0;
    while (i < 8) {
      if (groups[i] !== 0) { i++; continue; }
      let j = i;
      while (j < 8 && groups[j] === 0) j++;
      if (j - i > bestLen) { bestLen = j - i; best = i; }
      i = j;
    }
    if (best < 0) return groups.map(g => g.toString(16)).join(':');
    const head = groups.slice(0, best).map(g => g.toString(16)).join(':');
    const tail = groups.slice(best + bestLen).map(g => g.toString(16)).join(':');
    return head + '::' + tail;
  }
  const b = new Uint8Array(16);
  let bad = 0;
  for (let mask = 0; mask < 256; mask++) {
    for (let rep = 0; rep < 4; rep++) {
      const g = [];
      for (let k = 0; k < 8; k++) g.push((mask >> k) & 1 ? 0 : 1 + rnd(0xffff));
      for (let k = 0; k < 8; k++) { b[k * 2] = g[k] >> 8; b[k * 2 + 1] = g[k] & 255; }
      const got = Cidr.v6Str(b, 0), want = refV6Str(g);
      if (got !== want) { bad++; if (bad < 6) console.log('  mask ' + mask + ': got ' + got + ' want ' + want); }
    }
  }
  ok(bad === 0, bad + ' formatting mismatches vs RFC 5952 reference');
  const cases = [
    [[0, 0, 0, 0, 0, 0, 0, 0], '::'],
    [[0, 0, 0, 0, 0, 0, 0, 1], '::1'],
    [[0x2001, 0xdb8, 0, 0, 0, 0, 0, 1], '2001:db8::1'],
    [[0x2001, 0, 0, 1, 0, 0, 0, 1], '2001:0:0:1::1'],
    [[0x2001, 0, 1, 2, 0, 1, 0, 1], '2001:0:1:2:0:1:0:1'],
    [[0x2001, 0, 1, 0, 0, 1, 0, 1], '2001:0:1::1:0:1'],
    [[0xfe80, 0, 0, 0, 0, 0, 0, 0], 'fe80::'],
    [[0, 0, 0, 0, 0, 0, 0x102, 0x304], '::1.2.3.4 or ::102:304']
  ];
  for (const [g, want] of cases) {
    for (let k = 0; k < 8; k++) { b[k * 2] = g[k] >> 8; b[k * 2 + 1] = g[k] & 255; }
    const got = Cidr.v6Str(b, 0);
    ok(want.includes(got), 'v6Str ' + JSON.stringify(g) + ' -> ' + got + ' (want ' + want + ')');
  }
}

section('parser validation');
{
  const buf = new Uint8Array(16);
  const accept = [
    ['0.0.0.0/0', 4, 0], ['255.255.255.255/32', 4, 32], ['1.2.3.4', 4, 32],
    ['10.0.0.0/8', 4, 8], ['192.168.000.001', 4, 32],
    ['::', 6, 128], ['::/0', 6, 0], ['::1', 6, 128], ['1::', 6, 128],
    ['1:2:3:4:5:6:7:8', 6, 128], ['1:2:3:4:5:6:7:8/128', 6, 128],
    ['2001:db8::/32', 6, 32], ['::ffff:1.2.3.4', 6, 128],
    ['64:ff9b::1.2.3.4/96', 6, 96], ['FE80::1', 6, 128],
    ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128', 6, 128]
  ];
  for (const [s, fam, pfx] of accept) {
    const r = Cidr.parse(s, buf, 0);
    ok(r && r.fam === fam && r.prefix === pfx, 'should accept ' + s + ' got ' + JSON.stringify(r));
  }
  const reject = [
    '', ' ', '1.2.3', '1.2.3.4.5', '1.2.3.', '.1.2.3', '1..2.3', '256.1.1.1', '1.2.3.400',
    '1.2.3.4/33', '1.2.3.4/-1', '1.2.3.4/', '1.2.3.4/abc', '1.2.3.4/0024', '1.2.3.4//8',
    '1.2.3.4:80', 'hello', '1.2.3.4 5.6.7.8',
    ':::', '1::2::3', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:', ':1:2:3:4:5:6:7:8',
    '12345::', 'gggg::1', '::1/129', 'fe80::1%eth0', '1:2:3:4:5:6:7:8/129',
    '1::2:3:4:5:6:7:8', '::1.2.3', '1.2.3.4::', '::ffff:1.2.3.4:5', '1.2.3.4::5'
  ];
  for (const s of reject) {
    const r = Cidr.parse(s, buf, 0);
    ok(r === null, 'should reject ' + JSON.stringify(s) + ' got ' + JSON.stringify(r));
  }
}

section('IPv4 aggregation vs reference');
{
  let bad = 0;
  for (let trial = 0; trial < 600; trial++) {
    const list = [];
    const count = 1 + rnd(30);
    for (let k = 0; k < count; k++) {
      const pfx = 20 + rnd(13);
      const size = Math.pow(2, 32 - pfx);
      const base = 10 * 16777216 + rnd(4096);
      list.push(Cidr.v4NumStr(base - (base % size)) + '/' + pfx);
    }
    if (trial % 50 === 0) { list.push('0.0.0.0/0'); }
    if (trial % 37 === 0) { list.push('255.255.255.254/31', '255.255.255.255/32'); }
    const p = packFromStrings(list);
    const got = Cidr.aggregate(p.ips, p.pfx, p.fam, p.n);
    const wantRanges = refRangesOf(p).v4;
    const gotRanges = refRangesOf(got).v4;
    if (!eqR(gotRanges, wantRanges)) { bad++; if (bad < 3) console.log('  coverage changed, trial ' + trial); continue; }
    const wantCidrs = wantRanges.flatMap(([s, e]) => REF.toCidrs(s, e, 32));
    if (wantCidrs.length !== got.n) { bad++; if (bad < 3) console.log('  not minimal: ' + got.n + ' vs ' + wantCidrs.length); continue; }
    for (let i = 0; i < got.n; i++) {
      const [s, pl] = wantCidrs[i];
      if (BigInt(Cidr.v4Num(got.ips, i * 16)) !== s || BigInt(got.pfx[i]) !== pl) {
        bad++; if (bad < 3) console.log('  block ' + i + ' differs at trial ' + trial);
        break;
      }
    }
    const again = Cidr.aggregate(got.ips, got.pfx, got.fam, got.n);
    if (again.n !== got.n) { bad++; console.log('  not idempotent'); }
  }
  ok(bad === 0, bad + ' aggregation mismatches');
}

section('IPv6 aggregation vs reference');
{
  let bad = 0;
  const b = new Uint8Array(16);
  for (let trial = 0; trial < 300; trial++) {
    const list = [];
    for (let k = 0; k < 1 + rnd(25); k++) {
      const pfx = 112 + rnd(17);
      for (let i = 0; i < 16; i++) b[i] = 0;
      b[0] = 0x20; b[1] = 0x01; b[2] = 0x0d; b[3] = 0xb8;
      b[14] = rnd(256); b[15] = rnd(256);
      const size = 1n << BigInt(128 - pfx);
      let v = 0n;
      for (let i = 0; i < 16; i++) v = (v << 8n) | BigInt(b[i]);
      v = (v / size) * size;
      const bb = new Uint8Array(16);
      for (let i = 15; i >= 0; i--) { bb[i] = Number(v & 255n); v >>= 8n; }
      list.push(Cidr.v6Str(bb, 0) + '/' + pfx);
    }
    if (trial % 40 === 0) list.push('::/0');
    if (trial % 31 === 0) list.push('ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe/127');
    const p = packFromStrings(list);
    const got = Cidr.aggregate(p.ips, p.pfx, p.fam, p.n);
    const wantRanges = refRangesOf(p).v6;
    const gotRanges = refRangesOf(got).v6;
    if (!eqR(gotRanges, wantRanges)) { bad++; if (bad < 3) console.log('  v6 coverage changed at trial ' + trial); continue; }
    const wantCidrs = wantRanges.flatMap(([s, e]) => REF.toCidrs(s, e, 128));
    if (wantCidrs.length !== got.n) { bad++; if (bad < 3) console.log('  v6 not minimal: ' + got.n + ' vs ' + wantCidrs.length); }
  }
  ok(bad === 0, bad + ' v6 aggregation mismatches');
}

section('family isolation and ordering');
{
  const p = packFromStrings(['2001:db8::/33', '1.0.0.0/24', '2001:db8:8000::/33', '1.0.1.0/24', '::/0']);
  const got = Cidr.aggregate(p.ips, p.pfx, p.fam, p.n);
  const s = toStrings(got);
  ok(JSON.stringify(s) === JSON.stringify(['1.0.0.0/23', '::/0']), 'mixed aggregate: ' + JSON.stringify(s));
  const p2 = packFromStrings(['9.9.9.9/32', '::1', '1.1.1.1/32', 'ffff::/16']);
  const g2 = toStrings(Cidr.aggregate(p2.ips, p2.pfx, p2.fam, p2.n));
  ok(JSON.stringify(g2) === JSON.stringify(['1.1.1.1/32', '9.9.9.9/32', '::1/128', 'ffff::/16']), 'ordering: ' + JSON.stringify(g2));
}

section('host-bit normalisation');
{
  const p = packFromStrings(['1.2.3.4/24', '10.20.30.40/8', '2001:db8::dead:beef/32']);
  const s = toStrings(Cidr.aggregate(p.ips, p.pfx, p.fam, p.n));
  ok(JSON.stringify(s) === JSON.stringify(['1.2.3.0/24', '10.0.0.0/8', '2001:db8::/32']), 'normalised: ' + JSON.stringify(s));
  const a = packFromStrings(['1.2.3.4/24']);
  const bb = packFromStrings(['1.2.3.0/24']);
  const ca = { kind: 'geoip', name: 'A', n: a.n, ips: a.ips, pfx: a.pfx, fam: a.fam, reverse: false };
  const cb = { kind: 'geoip', name: 'A', n: bb.n, ips: bb.ips, pfx: bb.pfx, fam: bb.fam, reverse: false };
  ok(Model.ipKey(ca, 0) === Model.ipKey(cb, 0), 'ipKey must ignore masked-off host bits');
  const d = Diff.summarize(ca, cb, 'exact');
  ok(d.onlyA === 0 && d.onlyB === 0, 'exact diff of the same network spelled two ways: ' + JSON.stringify(d));
  const merged = Model.concat([ca, cb], 'M', 'geoip');
  ok(Model.dedupe(merged).n === 1, 'dedupe of the same network spelled two ways');
}

section('set algebra vs reference');
{
  const mk4 = () => {
    const l = [];
    for (let k = 0; k < 1 + rnd(14); k++) {
      const pfx = 20 + rnd(13), size = Math.pow(2, 32 - pfx);
      const base = 10 * 16777216 + rnd(4096);
      l.push(Cidr.v4NumStr(base - (base % size)) + '/' + pfx);
    }
    return packFromStrings(l);
  };
  let bad = 0;
  for (let t = 0; t < 400; t++) {
    const A = mk4(), B = mk4();
    const ra = Cidr.toRanges(A.ips, A.pfx, A.fam, A.n).v4;
    const rb = Cidr.toRanges(B.ips, B.pfx, B.fam, B.n).v4;
    const RA = refRangesOf(A).v4, RB = refRangesOf(B).v4;
    if (!eqR(flatToPairs(ra), RA)) { bad++; console.log('  toRanges mismatch'); continue; }
    if (!eqR(flatToPairs(Cidr.subtract(ra, rb, 1)), REF.subtract(RA, RB))) { bad++; if (bad < 3) console.log('  subtract mismatch t=' + t); }
    if (!eqR(flatToPairs(Cidr.intersect(ra, rb)), REF.intersect(RA, RB))) { bad++; if (bad < 3) console.log('  intersect mismatch t=' + t); }
    const diff = Cidr.subtract(ra, rb, 1), inter = Cidr.intersect(ra, rb);
    const union = Cidr.sortMerge(diff.concat(inter), 1);
    if (!eqR(flatToPairs(union), RA)) { bad++; if (bad < 3) console.log('  (A\\B) u (A^B) != A  t=' + t); }
    if (Cidr.subtract(ra, ra, 1).length !== 0) { bad++; console.log('  A\\A not empty'); }
    if (!eqR(flatToPairs(Cidr.subtract(ra, [], 1)), RA)) { bad++; console.log('  A\\empty != A'); }
    if (Cidr.subtract([], rb, 1).length !== 0) { bad++; console.log('  empty\\B not empty'); }
    if (Cidr.intersect(ra, Cidr.subtract(ra, rb, 1).length ? Cidr.subtract(rb, ra, 1) : []).length !== 0) { bad++; console.log('  A ^ (B\\A) not empty'); }
  }
  ok(bad === 0, bad + ' v4 set-algebra mismatches');

  bad = 0;
  const mk6 = () => {
    const l = [];
    for (let k = 0; k < 1 + rnd(10); k++) {
      const pfx = 112 + rnd(17);
      const bb = new Uint8Array(16);
      bb[0] = 0x20; bb[1] = 0x01; bb[2] = 0x0d; bb[3] = 0xb8;
      bb[14] = rnd(256); bb[15] = rnd(256);
      let v = 0n;
      for (let i = 0; i < 16; i++) v = (v << 8n) | BigInt(bb[i]);
      const size = 1n << BigInt(128 - pfx);
      v = (v / size) * size;
      for (let i = 15; i >= 0; i--) { bb[i] = Number(v & 255n); v >>= 8n; }
      l.push(Cidr.v6Str(bb, 0) + '/' + pfx);
    }
    return packFromStrings(l);
  };
  for (let t = 0; t < 200; t++) {
    const A = mk6(), B = mk6();
    const ra = Cidr.toRanges(A.ips, A.pfx, A.fam, A.n).v6;
    const rb = Cidr.toRanges(B.ips, B.pfx, B.fam, B.n).v6;
    const RA = refRangesOf(A).v6, RB = refRangesOf(B).v6;
    if (!eqR(flatToPairs(Cidr.subtract(ra, rb, 1n)), REF.subtract(RA, RB))) { bad++; if (bad < 3) console.log('  v6 subtract mismatch t=' + t); }
    if (!eqR(flatToPairs(Cidr.intersect(ra, rb)), REF.intersect(RA, RB))) { bad++; if (bad < 3) console.log('  v6 intersect mismatch t=' + t); }
  }
  ok(bad === 0, bad + ' v6 set-algebra mismatches');
}

section('boundaries');
{
  const cases = [
    [['0.0.0.0/1', '128.0.0.0/1'], ['0.0.0.0/0']],
    [['0.0.0.0/0', '1.2.3.4/32'], ['0.0.0.0/0']],
    [['255.255.255.255/32'], ['255.255.255.255/32']],
    [['255.255.255.254/31', '255.255.255.255/32'], ['255.255.255.254/31']],
    [['255.255.255.252/30', '0.0.0.0/30'], ['0.0.0.0/30', '255.255.255.252/30']],
    [['0.0.0.0/32', '0.0.0.1/32'], ['0.0.0.0/31']],
    [['::/1', '8000::/1'], ['::/0']],
    [['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128'], ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128']],
    [['ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe/127', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128'],
      ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe/127']],
    [['::/128', '::1/128'], ['::/127']],
    [['1.0.0.1/32', '1.0.0.2/32', '1.0.0.3/32'], ['1.0.0.1/32', '1.0.0.2/31']],
    [['1.0.0.0/24', '1.0.1.0/24', '1.0.2.0/24', '1.0.3.0/24'], ['1.0.0.0/22']],
    [['1.0.1.0/24', '1.0.2.0/24'], ['1.0.1.0/24', '1.0.2.0/24']]
  ];
  for (const [inp, want] of cases) {
    const p = packFromStrings(inp);
    const got = toStrings(Cidr.aggregate(p.ips, p.pfx, p.fam, p.n));
    ok(JSON.stringify(got) === JSON.stringify(want), JSON.stringify(inp) + ' -> ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
  }
  const all = packFromStrings(['0.0.0.0/0']);
  const one = packFromStrings(['10.0.0.0/8']);
  const ra = Cidr.toRanges(all.ips, all.pfx, all.fam, all.n).v4;
  const rb = Cidr.toRanges(one.ips, one.pfx, one.fam, one.n).v4;
  ok(Cidr.countAddrs(ra, 1) === 4294967296, 'full v4 space counts 2^32, got ' + Cidr.countAddrs(ra, 1));
  const rest = Cidr.subtract(ra, rb, 1);
  ok(Cidr.countAddrs(rest, 1) === 4294967296 - 16777216, 'full minus /8: ' + Cidr.countAddrs(rest, 1));
  ok(Cidr.countCidrs(rest, 1) === 8, '0.0.0.0/0 minus 10/8 needs 8 blocks, got ' + Cidr.countCidrs(rest, 1));
  const restPacked = Cidr.fromRanges(rest, []);
  ok(toStrings(restPacked).join(' ') ===
    '0.0.0.0/5 8.0.0.0/7 11.0.0.0/8 12.0.0.0/6 16.0.0.0/4 32.0.0.0/3 64.0.0.0/2 128.0.0.0/1',
    'complement blocks: ' + toStrings(restPacked).join(' '));
  const rv6 = Cidr.toRanges(packFromStrings(['::/0']).ips, packFromStrings(['::/0']).pfx, packFromStrings(['::/0']).fam, 1).v6;
  ok(Cidr.countAddrs(rv6, 1n) === (1n << 128n), 'full v6 space count');
}

section('entryRange');
{
  let bad = 0;
  const b = new Uint8Array(16);
  for (let t = 0; t < 3000; t++) {
    const v6 = t % 2 === 0;
    for (let i = 0; i < 16; i++) b[i] = v6 ? rnd(256) : 0;
    if (!v6) for (let i = 0; i < 4; i++) b[i] = rnd(256);
    const prefix = v6 ? rnd(129) : rnd(33);
    const got = Cidr.entryRange(b, [prefix], [v6 ? 6 : 4], 0);
    const want = REF.range(b, 0, prefix, v6 ? 6 : 4);
    if (BigInt(got.s) !== want[0] || BigInt(got.e) !== want[1]) {
      bad++; if (bad < 4) console.log('  entryRange differs for prefix ' + prefix + ' v6=' + v6);
    }
  }
  ok(bad === 0, bad + ' entryRange mismatches');
}

section('malformed entries');
{
  const w = new Proto.Writer();
  const cw = new Proto.Writer();
  cw.strField(1, 'BROKEN');
  const body = new Proto.Writer();
  body.bytesField(1, new Uint8Array([1, 2, 3, 4, 5]), 0, 5);
  body.varintField(2, 24);
  cw.subField(2, body);
  const good = new Proto.Writer();
  good.bytesField(1, new Uint8Array([9, 9, 9, 0]), 0, 4);
  good.varintField(2, 24);
  cw.subField(2, good);
  w.subField(1, cw);
  const bytes = w.take().slice();
  const cats = GeoDat.parseGeoIP(bytes);
  ok(cats[0].n === 2, 'both entries are kept on parse, got ' + cats[0].n);
  ok(cats[0].bad === 1, 'the malformed entry is counted (cat.bad), got ' + cats[0].bad);
  ok(Model.stats(cats[0]).bad === 1, 'stats reports it');
  ok(Cidr.validAt(cats[0].pfx, cats[0].fam, 0) === false, 'validAt flags the malformed entry');
  ok(Cidr.entryRange(cats[0].ips, cats[0].pfx, cats[0].fam, 0) === null, 'entryRange refuses it');
  ok(Cidr.toRanges(cats[0].ips, cats[0].pfx, cats[0].fam, 2).v4.length === 2, 'only the good entry contributes coverage');
  const opt = Model.optimize(cats[0], {});
  ok(opt.invalid === 1, 'optimize reports what it could not represent, got ' + opt.invalid);
  ok(opt.cat.n === 2, 'optimize keeps BOTH entries (nothing is silently deleted), got ' + opt.cat.n);
  ok(opt.cat.bad === 1, 'the kept invalid entry is still flagged');
  const out = GeoDat.writeGeoIP([cats[0]]);
  ok(out.length === bytes.length && out.every((b, i) => b === bytes[i]), 'malformed entries round-trip byte-identically');
  const re = GeoDat.parseGeoIP(out)[0];
  ok(re.n === 2 && re.bad === 1 && re.raw.get(0).length === 5, 'reparsed with its original 5-byte ip intact');
  const kept = Model.pick(cats[0], [1, 0]);
  ok(kept.raw && kept.raw.has(1) && !kept.raw.has(0), 'pick() remaps the raw map to the new indices');
  ok(Cidr.fmt(kept.ips, kept.pfx, kept.fam, 1, kept.raw) === '0x01:02:03:04:05/24',
    'invalid entries display their real bytes: ' + Cidr.fmt(kept.ips, kept.pfx, kept.fam, 1, kept.raw));
}

section('out-of-range prefix');
{
  const w = new Proto.Writer(), cw = new Proto.Writer();
  cw.strField(1, 'ODD');
  const body = new Proto.Writer();
  body.bytesField(1, new Uint8Array([10, 0, 0, 0]), 0, 4);
  body.varintField(2, 64);
  cw.subField(2, body);
  w.subField(1, cw);
  const raw = w.take().slice();
  const cat = GeoDat.parseGeoIP(raw)[0];
  ok(cat.pfx[0] === 64, 'the stored prefix is preserved verbatim, got ' + cat.pfx[0]);
  ok(cat.bad === 1, 'it is counted as not routable, got ' + cat.bad);
  ok(Cidr.validAt(cat.pfx, cat.fam, 0) === false, 'validAt rejects /64 on IPv4');
  ok(Cidr.entryRange(cat.ips, cat.pfx, cat.fam, 0) === null, 'it contributes no range');
  ok(Cidr.toRanges(cat.ips, cat.pfx, cat.fam, 1).v4.length === 0, 'and no coverage at all');
  ok(Cidr.fmt(cat.ips, cat.pfx, cat.fam, 0) === '10.0.0.0/64', 'display shows what the file holds');
  const out2 = GeoDat.writeGeoIP([cat]);
  ok(out2.length === raw.length && out2.every((b, i) => b === raw[i]), 'and it round-trips unchanged');
}

section('large randomised optimize');
{
  const N = 60000;
  const ips = new Uint8Array(N * 16), pfx = new Uint8Array(N), fam = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (i % 7 === 0) {
      fam[i] = 6; pfx[i] = rnd(129);
      for (let k = 0; k < 16; k++) ips[i * 16 + k] = rnd(256);
    } else {
      fam[i] = 4; pfx[i] = rnd(33);
      for (let k = 0; k < 4; k++) ips[i * 16 + k] = rnd(256);
    }
  }
  const before = { ips, pfx, fam, n: N };
  const got = Cidr.aggregate(ips, pfx, fam, N);
  const rb = refRangesOf(before), rg = refRangesOf(got);
  ok(eqR(rb.v4, rg.v4), 'v4 coverage preserved on 60k random');
  ok(eqR(rb.v6, rg.v6), 'v6 coverage preserved on 60k random');
  const wantN = rb.v4.flatMap(([s, e]) => REF.toCidrs(s, e, 32)).length +
                rb.v6.flatMap(([s, e]) => REF.toCidrs(s, e, 128)).length;
  ok(got.n === wantN, 'minimal block count: got ' + got.n + ' want ' + wantN);
  const again = Cidr.aggregate(got.ips, got.pfx, got.fam, got.n);
  ok(again.n === got.n, 'idempotent on 60k random');
}

console.log('\n' + (fails === 0 ? 'ALL ' + checks + ' CHECKS PASSED' : fails + ' of ' + checks + ' CHECKS FAILED'));
process.exit(fails ? 1 : 0);
