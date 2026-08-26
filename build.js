#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const LIBS = [
  'src/lib/proto.js',
  'src/lib/cidr.js',
  'src/lib/geodat.js',
  'src/lib/textfmt.js',
  'src/lib/model.js',
  'src/lib/diff.js',
  'src/lib/jobs.js'
];
const UI = ['src/ui/vlist.js', 'src/ui/app.js', 'src/ui/pipeline.js'];

const WORKER_GLUE = `
/* --- worker glue --- */
self.onmessage = function (e) {
  var m = e.data;
  if (m.job === 'ping') { self.postMessage({ job: 'ping' }); return; }
  try {
    var res = Jobs.run(m.job, m.payload, function (p) { self.postMessage({ id: m.id, progress: p }); });
    self.postMessage({ id: m.id, ok: true, res: res });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, err: (err && err.message) || String(err) });
  }
};
`;

const libSrc = LIBS.map(read).join('\n');
const pageSrc = libSrc + '\n' + UI.map(read).join('\n');
const workerSrc = libSrc + WORKER_GLUE;

for (const [name, src] of [['page', pageSrc], ['worker', workerSrc]]) {
  if (/<\/script/i.test(src)) throw new Error(name + ' source contains a </script sequence');
}

/* These look like comments and are not: String.replace on a missing one is a
   silent no-op that ships an empty page. */
const template = read('src/index.html');
const SLOTS = [
  ['/*<!--STYLES-->*/', () => read('src/styles.css')],
  ['/*<!--WORKER-->*/', () => Buffer.from(workerSrc, 'utf8').toString('base64')],
  ['/*<!--SCRIPTS-->*/', () => pageSrc]
];
for (const [slot] of SLOTS) {
  if (!template.includes(slot)) throw new Error('src/index.html is missing the ' + slot + ' slot');
}
const html = SLOTS.reduce((acc, [slot, fill]) => acc.replace(slot, fill), template);

const out = path.join(root, 'dist', 'geodata-studio.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);

if (html.length < 100000) throw new Error('built page is only ' + html.length + ' bytes - a slot filled with nothing?');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('built ' + path.relative(process.cwd(), out) + '  ' + kb(html.length) +
  '  (page js ' + kb(pageSrc.length) + ', worker ' + kb(workerSrc.length) + ')');
