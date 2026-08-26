var Pipeline = (function () {
  var FILES = [{ kind: 'geoip', name: 'geoip.dat' }, { kind: 'geosite', name: 'geosite.dat' }];
  var bar, label, btnLoad, btnStage, btnPublish;
  var info = null, staged = null;

  function $(s) { return document.querySelector(s); }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }

  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {  }
        if (!r.ok || (j && j.error)) throw new Error((j && j.error) || t.slice(0, 300) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function busy(on) {
    bar.classList.toggle('is-busy', !!on);
    [btnLoad, btnStage, btnPublish].forEach(function (b) { b.disabled = !!on; });
  }

  function setInfo(j) {
    info = j;
    var bits = [j.branch + ' @ ' + j.head.slice(0, 7)];
    if (j.pending && j.pending.length) bits.push(j.pending.length + ' file(s) staged');
    else bits.push('clean');
    if (j.builtAt) bits.push('built ' + j.builtAt.replace('T', ' ').slice(0, 16));
    label.textContent = bits.join('  ·  ');
    label.title = (j.repo || '') + '\n' + (j.pending || []).join('\n');
    bar.classList.toggle('is-dirty', !!(j.pending && j.pending.length));
    btnPublish.disabled = !(j.pending && j.pending.length);
  }

  function refresh() { return api('api/state').then(setInfo); }


  function loadLatest() {
    busy(true);
    var got = 0;
    var chain = FILES.reduce(function (p, f) {
      return p.then(function () {
        return fetch('api/file/' + f.kind).then(function (r) {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(f.name + ': HTTP ' + r.status);
          return r.arrayBuffer().then(function (buf) { got++; return App.loadBytes(f.name, buf); });
        });
      });
    }, Promise.resolve());

    return chain.then(refresh).then(function () {
      if (!got) App.toast('The pipeline has not published anything yet — run node build.mjs first', 'warn');
    }).catch(function (e) { App.toast('Load failed: ' + e.message, 'err'); })
      .then(function () { busy(false); });
  }


  function openPipelineFiles() {
    return FILES.map(function (f) { return { kind: f.kind, name: f.name, file: App.fileByName(f.name) }; })
      .filter(function (f) { return f.file; });
  }

  function stage() {
    var open = openPipelineFiles();
    if (!open.length) { App.toast('Load the pipeline files first, then edit them', 'err'); return; }

    var edited = open.filter(function (f) { return f.file.dirty; });
    if (!edited.length) { App.toast('No unsaved edits — nothing to stage', 'warn'); return; }

    busy(true);
    var results = [];
    var chain = edited.reduce(function (p, f) {
      return p.then(function () {
        return App.bytesOf(f.file).then(function (bytes) {
          return api('api/stage?kind=' + f.kind, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: bytes
          }).then(function (res) { results.push(res); App.markSaved(f.file); });
        });
      });
    }, Promise.resolve());

    chain.then(refresh).then(function () {
      busy(false);
      staged = results;
      showStageReport(results);
    }).catch(function (e) {
      busy(false);
      App.toast('Stage failed: ' + e.message, 'err');
    });
  }

  function showStageReport(results) {
    var anyBad = results.some(function (r) { return !r.ok; });
    var overlays = results.reduce(function (a, r) { return a.concat(r.overlays || []); }, []);

    App.modal({
      title: anyBad ? 'Staged — but the build does not pass' : 'Staged',
      wide: true,
      build: function (body) {
        var sum = el('div', 'pl-sum');
        results.forEach(function (r) {
          var s = el('span', null, null);
          s.appendChild(el('b', null, r.kind));
          s.appendChild(document.createTextNode('  ' + r.categories + ' categories, ' + App.fmtN(r.entries) + ' entries'));
          sum.appendChild(s);
        });
        var v = el('span', anyBad ? 'pl-bad' : 'pl-ok', anyBad ? '✗ asserts fail' : '✓ asserts pass');
        sum.appendChild(v);
        body.appendChild(sum);

        if (!overlays.length) {
          body.appendChild(el('p', 'dim', 'Your edits matched what the recipe already produces, so no overlay was needed.'));
        } else {
          var p = el('p', 'dim', 'Captured into ' + overlays.length + ' overlay file(s). These are applied on every rebuild, so the edits survive.');
          body.appendChild(p);
        }

        var rep = el('div', 'pl-report');
        var pre = el('pre', null, results.map(function (r) { return r.log; }).join('\n'));
        rep.appendChild(pre);
        body.appendChild(rep);
      },
      actions: anyBad
        ? [{ label: 'Revert overlays', danger: true, run: function (close) { close(); revert(); } },
           { label: 'Close', run: function (close) { close(); } }]
        : [{ label: 'Revert overlays', danger: true, run: function (close) { close(); revert(); } },
           { label: 'Close', run: function (close) { close(); } },
           { label: 'Publish...', primary: true, run: function (close) { close(); publish(); } }]
    });
  }

  function revert() {
    busy(true);
    api('api/revert', { method: 'POST' })
      .then(function (r) { App.toast('Reverted ' + r.reverted + ' file(s) to the last commit'); })
      .then(refresh)
      .catch(function (e) { App.toast('Revert failed: ' + e.message, 'err'); })
      .then(function () { busy(false); });
  }


  function publish() {
    api('api/state').then(function (j) {
      setInfo(j);
      if (!j.pending || !j.pending.length) { App.toast('Nothing staged to publish', 'warn'); return; }

      App.modal({
        title: 'Publish to the pipeline',
        wide: true,
        build: function (body) {
          body.appendChild(el('p', 'dim',
            'Commits and pushes the staged overlays. CI rebuilds from the recipe plus these overlays, ' +
            're-runs the asserts, and publishes to the mirror. Nothing is published if an assert fails.'));

          var rep = el('div', 'pl-report');
          rep.appendChild(el('pre', null, j.pending.join('\n') + (j.diffstat ? '\n\n' + j.diffstat : '')));
          body.appendChild(rep);

          body.appendChild(el('label', 'lbl', 'Commit message'));
          var inp = el('input', 'inp full');
          inp.id = 'pl-msg';
          inp.value = 'geodata: hand edits from GeoData Studio';
          body.appendChild(inp);
        },
        actions: [
          { label: 'Cancel', run: function (close) { close(); } },
          {
            label: 'Commit and push', primary: true,
            run: function (close, body) {
              var msg = (body.querySelector('#pl-msg') || {}).value || '';
              close();
              busy(true);
              api('api/publish', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ message: msg })
              }).then(function (r) {
                App.toast('Pushed ' + r.commit.slice(0, 7) + ' — CI will rebuild and publish');
              }).then(refresh)
                .catch(function (e) { App.toast('Publish failed: ' + e.message, 'err'); })
                .then(function () { busy(false); });
            }
          }
        ]
      });
    }).catch(function (e) { App.toast(e.message, 'err'); });
  }


  function init() {
    bar = $('#pipeline');
    if (!bar) return;
    label = $('#pipe-label');
    btnLoad = $('#pipe-load');
    btnStage = $('#pipe-stage');
    btnPublish = $('#pipe-publish');

    api('api/state').then(function (j) {
      bar.hidden = false;
      setInfo(j);
      btnLoad.onclick = loadLatest;
      btnStage.onclick = stage;
      btnPublish.onclick = publish;
      if (j.autoload !== false) loadLatest();
    }).catch(function () {  });
  }

  return { init: init, refresh: refresh, load: loadLatest, stage: stage, publish: publish };
})();
