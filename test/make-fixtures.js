#!/usr/bin/env node
require('./_load.js');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'fixtures');
fs.mkdirSync(dir, { recursive: true });

let seed = 42;
const rnd = (m) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m;

function geoipCat(name, N) {
  const ips = new Uint8Array(N * 16), pfx = new Uint8Array(N), fam = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (i % 25 === 0) {
      fam[i] = 6; pfx[i] = 32 + rnd(33);
      for (let k = 0; k < 8; k++) ips[i * 16 + k] = rnd(256);
    } else {
      fam[i] = 4;
      const p = 20 + rnd(13);
      pfx[i] = p;
      const size = Math.pow(2, 32 - p);
      const base = rnd(2147483647) * 2;
      Cidr.v4NumToBytes(base - (base % size), ips, i * 16);
    }
  }
  return { kind: 'geoip', name, n: N, ips, pfx, fam, reverse: false };
}

function geositeCat(name, N) {
  const type = new Uint8Array(N), val = new Array(N);
  const tld = ['com', 'net', 'org', 'ru', 'io', 'co.uk'];
  for (let i = 0; i < N; i++) {
    type[i] = i % 17 === 0 ? 3 : 2;
    val[i] = (i % 7 === 0 ? 'www.' : '') + 'host' + rnd(1e7).toString(36) + i.toString(36) + '.' + tld[i % 6];
  }
  return { kind: 'geosite', name, n: N, type, val, attrs: null };
}

const write = (file, bytes) => {
  fs.writeFileSync(path.join(dir, file), Buffer.from(bytes));
  console.log('  ' + file + '  ' + (bytes.length / 1048576).toFixed(1) + ' MB');
};

console.log('writing fixtures to ' + dir);
write('big-geoip.dat', GeoDat.writeGeoIP([geoipCat('HUGE', 400000), geoipCat('MEDIUM', 60000), geoipCat('SMALL', 900)]));
write('big-geoip-b.dat', GeoDat.writeGeoIP([geoipCat('HUGE', 400000), geoipCat('MEDIUM', 60000), geoipCat('EXTRA', 5000)]));
write('big-geosite.dat', GeoDat.writeGeoSite([
  geositeCat('HUGE', 300000),
  { kind: 'geosite', name: 'TINY', n: 3, type: new Uint8Array([2, 3, 0]), val: ['example.com', 'www.a.com', 'tracker'], attrs: null }
]));
