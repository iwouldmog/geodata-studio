const path = require('path');
const files = ['proto', 'cidr', 'geodat', 'textfmt', 'model', 'diff', 'jobs'];
for (const f of files) {
  const p = path.join(__dirname, '..', 'src', 'lib', f + '.js');
  try {
    const m = require(p);
    global[{ proto: 'Proto', cidr: 'Cidr', geodat: 'GeoDat', textfmt: 'TextFmt', model: 'Model', diff: 'Diff', jobs: 'Jobs' }[f]] = m;
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND' || !e.message.includes(f + '.js')) throw e;
  }
}
module.exports = global;
