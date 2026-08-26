require('./_load.js');
const ms = (label, f) => { const t = process.hrtime.bigint(); const r = f(); const d = Number(process.hrtime.bigint() - t) / 1e6; console.log(`  ${label}: ${d.toFixed(0)}ms`); return r; };
let seed = 987654321;
const rnd = (m) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m;

const N = 400000;
const ips = new Uint8Array(N * 16), pfx = new Uint8Array(N), fam = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (i % 20 === 0) {
    fam[i] = 6; pfx[i] = 32 + rnd(33);
    for (let k = 0; k < 8; k++) ips[i * 16 + k] = rnd(256);
  } else {
    fam[i] = 4; const p = 22 + rnd(11); pfx[i] = p;
    const size = Math.pow(2, 32 - p);
    const base = rnd(2147483647) * 2;
    Cidr.v4NumToBytes(base - (base % size), ips, i * 16);
  }
}
const cat = { kind: 'geoip', name: 'BIG', n: N, ips, pfx, fam, reverse: false };
console.log(`geoip category with ${N.toLocaleString()} CIDRs:`);
const bin = ms('serialize .dat', () => GeoDat.writeGeoIP([cat]));
console.log(`  file size: ${(bin.length / 1048576).toFixed(1)} MB`);
const reparsed = ms('parse .dat', () => GeoDat.parseGeoIP(bin));
console.log(`  parsed back: ${reparsed[0].n.toLocaleString()} entries`);
const opt = ms('optimize (aggregate)', () => Model.optimize(cat));
console.log(`  ${opt.before.toLocaleString()} -> ${opt.after.toLocaleString()}`);
ms('sort', () => Model.sort(cat));
ms('stats', () => Model.stats(cat));
ms('format 100k rows', () => { let s = 0; for (let i = 0; i < 100000; i++) s += Cidr.fmt(ips, pfx, fam, i).length; return s; });
const cat2 = Model.optimize(Model.append(cat, TextFmt.parseIp('9.9.9.0/24\n8.8.8.8'))).cat;
ms('exact diff 400k vs 400k', () => Diff.summarize(cat, cat2, 'exact'));
ms('coverage diff 400k vs 400k', () => Diff.summarize(cat, cat2, 'coverage'));

const M = 300000;
const type = new Uint8Array(M), val = new Array(M);
const tld = ['com', 'net', 'org', 'ru', 'io', 'co.uk'];
for (let i = 0; i < M; i++) {
  type[i] = i % 17 === 0 ? 3 : 2;
  val[i] = (i % 7 === 0 ? 'www.' : '') + 'host' + rnd(1e7).toString(36) + i.toString(36) + '.' + tld[i % 6];
}
const scat = { kind: 'geosite', name: 'SITE', n: M, type, val, attrs: null };
console.log(`\ngeosite category with ${M.toLocaleString()} domains:`);
const sbin = ms('serialize .dat', () => GeoDat.writeGeoSite([scat]));
console.log(`  file size: ${(sbin.length / 1048576).toFixed(1)} MB`);
const sre = ms('parse .dat', () => GeoDat.parseGeoSite(sbin));
console.log(`  parsed back: ${sre[0].n.toLocaleString()} entries`);
ms('dedupe', () => Model.dedupe(scat));
ms('optimize (dedupe+fold)', () => Model.optimize(scat));
ms('sort by value', () => Model.sort(scat, 'value'));
ms('substring filter', () => { const q = 'abc'; const out = []; for (let i = 0; i < M; i++) if (val[i].indexOf(q) >= 0) out.push(i); return out.length; });
ms('exact diff 300k vs 300k', () => Diff.summarize(scat, sre[0], 'exact'));
