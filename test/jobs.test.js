require('./_load.js');


let fails = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL: ' + m); fails++; } };

const ip = (text) => Model.withName(TextFmt.parse('geoip', text), 'IPS');
const site = (text) => Model.withName(TextFmt.parse('geosite', text), 'SITES');

const ipA = ip('10.0.0.0/24\n10.0.1.0/24\n2001:db8::/33\n2001:db8:8000::/33');
const ipB = ip('10.0.0.0/23\n192.0.2.0/24');
const siteA = site('domain:example.com\nfull:a.example.com\nfull:keep.org');
const siteB = site('domain:example.com\nkeyword:ads');

const written = Jobs.run('write', { kind: 'geoip', cats: [ipA] });
ok(written.buf && written.buf.length > 0, 'write: produced no bytes');

const parsed = Jobs.run('parse', { buf: written.buf, name: 'x.dat' });
ok(parsed.kind === 'geoip', 'parse: wrong kind ' + parsed.kind);
ok(parsed.cats.length === 1, 'parse: expected 1 category, got ' + parsed.cats.length);
ok(parsed.cats[0].n === ipA.n, `parse: entry count ${parsed.cats[0].n} != ${ipA.n}`);

const sWritten = Jobs.run('write', { kind: 'geosite', cats: [siteA] });
const sParsed = Jobs.run('parse', { buf: sWritten.buf, name: 'y.dat' });
ok(sParsed.kind === 'geosite', 'parse: geosite sniffed as ' + sParsed.kind);
ok(sParsed.cats[0].n === siteA.n, 'parse: geosite entry count changed');

const opt = Jobs.run('optimize', { cat: ipA, opts: {} });
ok(opt.before === 4, 'optimize: before ' + opt.before);
ok(opt.after === 2, 'optimize: the two /24s and the two /33s should each merge, got ' + opt.after);

const sOpt = Jobs.run('optimize', { cat: siteA, opts: { fold: true } });
ok(sOpt.after === 2, 'optimize: full:a.example.com is covered by domain:example.com, got ' + sOpt.after);

const unsorted = ip('2001:db8::/32\n10.0.1.0/24\n192.0.2.0/24\n10.0.0.0/24');
const sorted = Jobs.run('sort', { cat: unsorted, how: 'value' });
ok(sorted.cat.n === unsorted.n, 'sort: changed entry count');
{
  const seq = [];
  for (let i = 0; i < sorted.cat.n; i++) seq.push(Cidr.fmt(sorted.cat.ips, sorted.cat.pfx, sorted.cat.fam, i));
  const want = '10.0.0.0/24,10.0.1.0/24,192.0.2.0/24,2001:db8::/32';
  ok(seq.join(',') === want, 'sort: got ' + seq.join(',') + ' want ' + want);
}

const merged = Jobs.run('merge', { cats: [ipA, ipB], name: 'MERGED', opts: {} });
ok(merged.cat.name === 'MERGED', 'merge: name is ' + merged.cat.name);
ok(merged.cat.n < ipA.n + ipB.n, 'merge: overlapping blocks should collapse');

const app = Jobs.run('append', { cat: siteA, chunk: siteB, opts: {} });
ok(app.cat.n === siteA.n + siteB.n, 'append without optimize should keep every entry');
const appOpt = Jobs.run('append', { cat: siteA, chunk: siteB, opts: { optimize: true, fold: true } });
ok(appOpt.after < siteA.n + siteB.n, 'append with optimize should dedupe the shared domain');

const st = Jobs.run('stats', { cat: ipA });
ok(st.stats && typeof st.stats === 'object', 'stats: returned nothing');

const fd = Jobs.run('fileDiff', { a: [ipA], b: [ipB], mode: 'exact' });
ok(Array.isArray(fd.rows) && fd.rows.length > 0, 'fileDiff: no rows');
ok(fd.rows.every((r) => typeof r.name === 'string' && 'status' in r), 'fileDiff: rows are not plain');

const cd = Jobs.run('catDiff', { a: siteA, b: siteB, mode: 'exact' });
ok(cd.onlyA && cd.onlyB, 'catDiff: missing onlyA/onlyB');
ok(cd.onlyA.n === 2 && cd.onlyB.n === 1, `catDiff: expected 2/1, got ${cd.onlyA.n}/${cd.onlyB.n}`);

const canClone = typeof structuredClone === 'function';
if (!canClone) console.log('  (structuredClone unavailable on this node — skipping the clone check)');
for (const [job, payload] of (canClone ? [
  ['write', { kind: 'geoip', cats: [ipA] }],
  ['optimize', { cat: ipA, opts: {} }],
  ['sort', { cat: ipA, how: 'value' }],
  ['merge', { cats: [ipA, ipB], name: 'M', opts: {} }],
  ['append', { cat: siteA, chunk: siteB, opts: {} }],
  ['stats', { cat: ipA }],
  ['fileDiff', { a: [ipA], b: [ipB], mode: 'exact' }],
  ['catDiff', { a: siteA, b: siteB, mode: 'exact' }]
] : [])) {
  try { structuredClone(Jobs.run(job, payload)); }
  catch (e) { ok(false, `${job}: result is not structured-cloneable — ${e.message}`); }
}

let threw = false;
try { Jobs.run('no-such-job', {}); } catch (e) { threw = /unknown job/.test(e.message); }
ok(threw, 'an unknown job should throw');

console.log(fails === 0 ? 'jobs: all tests passed' : 'jobs: ' + fails + ' FAILURES');
process.exit(fails ? 1 : 0);
