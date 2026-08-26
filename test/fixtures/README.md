Fixtures for the node tests and for browser testing.

**None of the `.dat` files are tracked** — `.gitignore` covers `*.dat`, so nobody's
routing data ends up in the repo by accident. Every test skips whatever is absent
and the suite passes on a clean checkout; drop real files in here to make the
coverage meaningful.

- `geoip.dat`, `geoip-2.dat`, `geosite.dat`, `geosite-2.dat` — small real files. `ops.test.js`
  uses these four by name; `roundtrip.test.js` checks every `.dat` in this directory. Swap in
  your own; both also accept paths as arguments.
- `corrupt-geoip.dat` — hand-built file mixing well-formed CIDRs with entries xray refuses
  (5-byte ip, /64 on an IPv4 address, one network spelled twice). Used to check that such
  entries are surfaced rather than silently dropped or silently merged.
- `big-*.dat` — large synthetic files (~16 MB) for scale testing. Not stored here; run
  `node test/make-fixtures.js` to regenerate them.
