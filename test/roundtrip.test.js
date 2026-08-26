require('./_load.js');
const fs = require('fs');
const path = require('path');


let fails = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL: ' + m); fails++; } };

const args = process.argv.slice(2);
const fx = path.join(__dirname, 'fixtures');
const files = args.length
  ? args
  : (fs.existsSync(fx) ? fs.readdirSync(fx).filter((f) => f.endsWith('.dat')).sort().map((f) => path.join(fx, f)) : []);

if (!files.length) {
  console.log('roundtrip: no .dat files to check.');
  console.log('  test/fixtures/*.dat is gitignored. Drop a real geoip.dat / geosite.dat in there,');
  console.log('  or pass paths as arguments, to give this test something to verify.');
  process.exit(0);
}

for (const f of files) {
  const name = path.basename(f);
  const buf = new Uint8Array(fs.readFileSync(f));

  const t0 = Date.now();
  const { kind, cats } = GeoDat.parse(buf, name);
  const t1 = Date.now();
  const total = GeoDat.countEntries(cats);
  const out = GeoDat.write(kind, cats);
  const t2 = Date.now();

  ok(cats.length > 0, `${name}: parsed 0 categories`);
  ok(total > 0, `${name}: parsed 0 entries`);

  let identical = out.length === buf.length;
  let firstDiff = -1;
  if (identical) {
    for (let i = 0; i < out.length; i++) if (out[i] !== buf[i]) { identical = false; firstDiff = i; break; }
  }
  ok(identical, `${name}: not byte-identical` +
    (out.length !== buf.length ? ` (${buf.length} -> ${out.length} bytes)` : ` (first difference at byte ${firstDiff})`));

  const again = GeoDat.parse(out, name);
  ok(again.kind === kind, `${name}: kind changed on re-parse: ${kind} -> ${again.kind}`);
  ok(again.cats.length === cats.length, `${name}: category count changed on re-parse`);
  if (again.cats.length === cats.length) {
    for (let c = 0; c < cats.length; c++) {
      const a = cats[c], b = again.cats[c];
      if (a.name !== b.name) { ok(false, `${name}: category ${c} renamed: ${a.name} -> ${b.name}`); break; }
      if (a.n !== b.n) { ok(false, `${name}: ${a.name} entry count changed: ${a.n} -> ${b.n}`); break; }
      let mismatch = -1;
      for (let i = 0; i < a.n; i++) if (Model.key(a, i) !== Model.key(b, i)) { mismatch = i; break; }
      if (mismatch >= 0) { ok(false, `${name}: ${a.name} entry ${mismatch} changed on re-parse`); break; }
    }
  }

  console.log(`${name}: kind=${kind} cats=${cats.length} entries=${total} ` +
    `parse=${t1 - t0}ms write=${t2 - t1}ms bytes ${buf.length}->${out.length} identical=${identical}`);

  const big = cats.slice().sort((a, b) => b.n - a.n).slice(0, 3);
  for (const c of big) {
    if (kind === 'geoip') {
      let v4 = 0, v6 = 0;
      for (let i = 0; i < c.n; i++) c.fam[i] === 4 ? v4++ : v6++;
      console.log(`   ${c.name}: ${c.n} (v4 ${v4}, v6 ${v6}) e.g. ${Cidr.fmt(c.ips, c.pfx, c.fam, 0)}`);
    } else {
      console.log(`   ${c.name}: ${c.n} e.g. ${GeoDat.SITE_TYPE[c.type[0]]}:${c.val[0]}${c.attrs && c.attrs[0] ? ' @' + c.attrs[0].map((a) => a.k) : ''}`);
    }
  }
}

console.log(fails === 0
  ? `\nroundtrip: ${files.length} file(s) round-trip byte-identically`
  : `\nroundtrip: ${fails} FAILURES`);
process.exit(fails ? 1 : 0);
