# GeoData Studio

A browser-based viewer, editor and differ for V2Ray/Xray **`geoip.dat`** and **`geosite.dat`**
routing databases.

### → [iwouldmog.github.io](https://iwouldmog.github.io/)

Drop your `.dat` files on the page and start. **Nothing is uploaded.** There is no
backend and no third party involved: every byte you open is parsed by JavaScript
in your own tab. After the page itself loads it issues exactly one request — a
same-origin probe for a local editing bridge (see *Pipeline mode*), which 404s
and is ignored — and it never contacts anything else, least of all with your
data. Check the network panel, or save the page and pull the ethernet cable.
Loading a 300,000-entry category is a local operation.

It is a **single self-contained HTML file** (~240 KB, no dependencies, no CDN,
no analytics). Save the page and it keeps working offline, or build it yourself:

```bash
node build.js && open dist/geodata-studio.html
```

## Running

| how | worker | notes |
| --- | --- | --- |
| the hosted page | on | nothing to install; still entirely client-side |
| double-click `dist/geodata-studio.html` | usually off | Chrome blocks Blob workers on `file://`, so heavy jobs run inline: everything works, the UI just freezes for a moment on very large operations |
| serve it — `python3 -m http.server 8765` then open `http://localhost:8765/dist/geodata-studio.html` | on | heavy jobs run off the main thread; the UI stays responsive |

The status bar bottom-right says which mode is active.

## Pipeline mode

Served by the `tools/studio.mjs` bridge in a companion build repo, the toolbar
grows a pipeline bar — load what the build last published, edit it, stage the
edits as overlays, publish. The bar is dormant otherwise: the page probes for
the bridge once on load and stays hidden when nothing answers, so opening the
file directly behaves exactly as before.

```bash
node tools/studio.mjs      # in the build repo, not this one
```

Edits are captured as overlays rather than a saved `.dat`, so the next scheduled
rebuild reproduces them instead of overwriting them, and staging refuses to
publish anything that breaks the build's guarantees.

## What it does

**Import.** Drop or pick any number of `.dat` files; each becomes its own tab-less "file" in
the sidebar. Kind (geoip vs geosite) is detected from the protobuf wire shape, not the
filename. `.txt` / `.list` files import as a single category, into the active file if the
kinds match, otherwise as a new file.

**Browse.** Categories collapse and expand; the entry list is virtualized, so a category with
400 000+ CIDRs opens instantly and scrolls at frame rate (only ~30 rows exist in the DOM at
any time). Filtering 460 000 entries takes 5–35 ms.

**Filter box.**

| you type | it means |
| --- | --- |
| `google` | substring of the value (geosite) or of the CIDR text (geoip) |
| `/^ads[0-9]+\./` | JavaScript regex |
| `91.108.` | IPv4 prefix match — fast path, no string building |
| `1.2.3.0/24` | every CIDR that overlaps that block, in either direction |
| `/24` | every CIDR whose prefix length is exactly 24 |
| `2a03:` | IPv6 substring |

Plus a dropdown for `full:` / `domain:` / `keyword:` / `regexp:` / `has @attribute`
(geosite) or IPv4 / IPv6 (geoip).

**Optimize.**

- *geoip* — converts every CIDR to a range, merges overlapping **and tangential** ranges,
  then re-splits into the minimal set of aligned CIDR blocks. `1.0.0.0/24 + 1.0.1.0/24`
  becomes `1.0.0.0/23`; anything contained in a larger block disappears. Coverage is
  provably identical (verified against brute-force bitmaps in `test/cidr.test.js`).
  A synthetic 460 900-CIDR file collapses to 24 521 entries.
- *geosite* — deduplicates identical rules, and optionally folds any rule already covered by
  a broader `domain:` rule (and, if asked, by a `keyword:` rule). Entries carrying
  `@attributes` are never folded away, and never fold others, so attribute-filtered lookups
  (`geosite:x@ads`) keep working.

  Folding only ever **deletes a rule another rule in the same category already subsumes**;
  it never widens one. `full:a.example.com` + `full:b.example.com` stay as they are — they
  do *not* become `domain:example.com`, which would start matching `c.example.com` and
  `example.com` itself, hosts nobody listed. A rule only disappears when a `domain:` parent
  (or, opt-in, a `keyword:`) that is actually present matches a strict superset of it.
  Comparison is case-sensitive, like xray: the router lowercases the queried domain but not
  the rule, so `domain:EXAMPLE.com` matches nothing and is not allowed to swallow a working
  `full:a.example.com`. `regexp:` rules, and rules with a `Domain.Type` this build does not
  know, are opaque — never folded, and never used to fold.

**Edit.** Add entries by pasting a list (with per-line validation and error reporting),
delete single entries or a multi-select (click, ⌘/ctrl-click, shift-click for ranges),
create categories, rename, duplicate, clear, delete, sort, copy a category to another loaded
file, and move/copy selected entries into another category. Every mutation is one labeled
undo step (⌘Z / ⌘⇧Z), scoped per file.

**Merge.** Select two or more categories, hit *Merge*: they are concatenated, deduplicated
and optimized in one step — for geoip that means tangential CIDRs across the sources collapse
into single larger blocks. Mixing a `reverse_match` category with a normal one is refused:
"everything except A" unioned with "B" has no single-category form, and merging anyway would
silently re-read one side's entries as exclusions.

**Compare.** Pick two files of the same kind and get a per-category table (only in A, only in
B, changed, identical) plus a drill-down diff list. Two modes:

- **Exact entries** — set difference over entries. Answers *which lines changed*.
- **IP coverage** (geoip) — compares the address space each side actually covers, so
  `10.0.0.0/8` on one side and 256 `/16`s on the other compare as equal. Answers *which
  addresses changed*.

A category whose `reverse_match` differs between the two sides is reported as changed even
when both hold the same ranges. If a file uses one category name twice, only the first copy
is compared — the same one xray resolves to — and the count of shadowed copies is reported.

From the diff you can *Add B-only to A*, *Remove A-only from A*, *Make A match B*, spin the
difference off into its own category, or export it as a `+`/`-` text file. All of it lands in
file A's undo stack. In **exact** mode these operate on entries and nothing else, so
*Make A match B* leaves no residual diff; in **coverage** mode the result is rebuilt from
address ranges and re-aggregated, with entries xray cannot route on carried across untouched
(they took no part in the coverage math, so they are not "differences").

**Export.** Whole file as `.dat`, selected categories as a subset `.dat`, any category as
`.txt`, or everything as one annotated `.txt`.

## Format notes

Schema follows `xray-core/common/geodata/geodat.proto`:

```proto
message CIDR    { bytes ip = 1; uint32 prefix = 2; }
message GeoIP   { string code = 1; repeated CIDR cidr = 2; bool reverse_match = 3; }
message Domain  { Type type = 1; string value = 2; repeated Attribute attribute = 3; }
message GeoSite { string code = 1; repeated Domain domain = 2; }
```

- `Domain.Type`: `0 = keyword` (substring), `1 = regexp`, `2 = domain` (suffix),
  `3 = full`. A bare line in the text format means `domain:`.
- `reverse_match` on a geoip category is preserved through load → edit → save.
- Domain attributes (`@ads`, `@cn`, int-valued ones too) are preserved.
- Unknown fields from other forks (for example v2fly's `resource_hash`) are skipped on read
  and not written back. A `Domain.Type` value this build has no name for is preserved,
  badged with its number, excluded from folding, and written to `.txt` as `type<N>:value`,
  which imports back unchanged.
- Entries xray cannot route on — an `ip` that is not 4 or 16 bytes, or a prefix wider than the
  address — are kept, badged `bad`, counted in the category header and info panel, excluded
  from all coverage math (exactly as xray excludes them), and written back unchanged. The
  family filter has an *invalid only* option for finding them.
- `1.2.3.4/24` and `1.2.3.0/24` are the same rule: xray masks host bits via
  `netipx.AddPrefix`, so the tool deduplicates and diffs them as equal. Entries whose `ip`
  was not 4 or 16 bytes keep their original bytes as their identity, so two different
  malformed entries never dedupe into one.
- Re-exporting an unedited file is **byte-identical** to the input; verified on real
  geoip/geosite files by `test/roundtrip.test.js`.

## Keyboard

| key | action |
| --- | --- |
| ⌘/ctrl F | focus the filter box |
| ⌘/ctrl Z, ⌘/ctrl ⇧ Z | undo / redo (per file) |
| Delete / Backspace | delete selected entries |
| Escape | clear selection, close dialog, clear the filter box |
| click / ⌘-click / shift-click | select, toggle, range-select entries |

## Layout

```
src/lib/proto.js     minimal protobuf reader/writer (ASCII fast path for strings)
src/lib/cidr.js      IP parse/format, range algebra, CIDR aggregation
src/lib/geodat.js    geoip.dat / geosite.dat codec + kind sniffing
src/lib/textfmt.js   text <-> category, v2fly domain-list syntax
src/lib/model.js     immutable category edits: pick, concat, dedupe, fold, optimize, sort
src/lib/diff.js      file and category diffs, exact and coverage
src/lib/jobs.js      job table shared by the worker and the inline fallback
src/ui/vlist.js      fixed-height virtual list (handles >4M px of virtual scroll)
src/ui/app.js        application
src/ui/pipeline.js   pipeline bar - dormant unless geodata-build's bridge is serving the page
build.js             inlines everything into dist/geodata-studio.html
```

Categories are stored column-wise in typed arrays rather than as objects:

```js
geoip   { name, n, ips: Uint8Array(n*16), pfx: Uint8Array(n), fam: Uint8Array(n), reverse }
geosite { name, n, type: Uint8Array(n), val: string[], attrs: (Attr[]|null)[] | null }
```

That keeps a 300 000-entry category around 5 MB instead of ~40 MB, makes filtering a tight
loop over primitives, and makes undo cheap: edits return new categories, so an undo step is
just the previous array of category references.

## Tests

```bash
for t in test/*.test.js; do node "$t" || break; done   # the suite CI runs

node test/cidr-deep.test.js                # 113 checks: CIDR layer vs an independent BigInt model
node test/regress.test.js                  # 41 checks: fold/dedupe/diff/codec regressions
node test/cidr.test.js                     # aggregation/subtract/intersect vs brute-force bitmaps
node test/ops.test.js                      # optimize, diff, merge, text round trips
node test/roundtrip.test.js [file.dat...]  # parse -> write byte-identity; defaults to test/fixtures/
```

`ops` and `roundtrip` need real `.dat` files. Those are gitignored, so on a clean
checkout both say what they are missing and pass; drop files into `test/fixtures/`
to give them something to check.

Not part of the suite — they measure or generate rather than assert, so they carry
no `.test.js` suffix and CI does not run them:

```bash
node test/perf.bench.js                    # 400k CIDR / 300k domain benchmarks
node test/make-fixtures.js                 # writes synthetic fixtures into test/fixtures/
```

Measured on local machine (node, single category):

| operation | 400 000 CIDRs | 300 000 domains |
| --- | --- | --- |
| parse `.dat` | 13 ms | 73 ms |
| write `.dat` | 42 ms | 128 ms |
| optimize | 177 ms | 236 ms |
| sort | 151 ms | 232 ms |
| exact diff vs. itself | 41 ms | 269 ms |
| coverage diff | 205 ms | — |

## License

[MIT](LICENSE) — use it, fork it, host your own copy.
