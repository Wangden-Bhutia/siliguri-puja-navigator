/* Local-only validator/preview for schema v2. Uses logic.js. Never uploads or saves. */
(function () {
  'use strict';
  var P = window.PujaLogic;
  function $(s) { return document.querySelector(s); }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x !== undefined && x !== '') e.textContent = x; return e; }
  var at = $('#at');
  at.value = P.toLocalInputValue(Date.now());

  function run() {
    var out = $('#out'); while (out.firstChild) out.removeChild(out.firstChild);
    var raw;
    try { raw = JSON.parse($('#json').value); }
    catch (e) { out.appendChild(el('p', 'bad', 'NOT VALID JSON: ' + e.message)); out.appendChild(el('p', 'muted', 'The app would show “Data unavailable”. Fix the syntax and try again.')); return; }
    var v = P.validateDataset(raw);
    if (!v.ok) { out.appendChild(el('p', 'bad', 'FATAL: ' + v.fatal)); out.appendChild(el('p', 'muted', 'The app would show “Data unavailable”.')); return; }
    var t = P.fromLocalInputValue(at.value); if (!isFinite(t)) t = Date.now();
    var pending = v.pandals.filter(function (p) { return p.verificationStatus === 'pendingVerification'; }).length;
    var demoN = [].concat(v.parking, v.traffic, v.facilities).filter(function (r) { return r.demo; }).length;
    out.appendChild(el('p', v.errors.length ? 'bad' : 'ok',
      (v.errors.length ? v.errors.length + ' error(s). ' : 'No errors. ') +
      (v.warnings.length ? v.warnings.length + ' warning(s). ' : '') +
      (v.skipped.length ? v.skipped.length + ' record(s) skipped. ' : 'Nothing skipped. ')));
    out.appendChild(el('p', '',
      'Dataset ' + v.meta.datasetVersion + ' (schema ' + v.meta.schemaVersion + ') · last updated ' + P.fmtDateTime(v.meta.lastUpdatedMs) +
      (v.meta.isDemoDataset ? ' · DEMO DATASET' : '') +
      ' · ' + v.pandals.length + ' pandals (' + pending + ' pending verification), ' +
      v.neighbourhoods.length + ' neighbourhoods, ' + v.parking.length + ' parking/drop, ' +
      v.walkingRoutes.length + ' walks, ' + v.traffic.length + ' traffic, ' + v.facilities.length + ' facilities' +
      (demoN ? ' · ' + demoN + ' DEMO records' : '') + '.'));

    if (v.errors.length) {
      var ue = el('ul'); v.errors.forEach(function (e) { ue.appendChild(el('li', '', e.kind + ' "' + e.id + '": ' + e.message)); });
      out.appendChild(el('h3', '', 'Errors')); out.appendChild(ue);
    }
    if (v.warnings.length) {
      var uw = el('ul'); v.warnings.slice(0, 80).forEach(function (e) { uw.appendChild(el('li', '', e.kind + ' "' + e.id + '": ' + e.message)); });
      if (v.warnings.length > 80) uw.appendChild(el('li', '', '… and ' + (v.warnings.length - 80) + ' more'));
      out.appendChild(el('h3', '', 'Warnings')); out.appendChild(uw);
    }
    if (v.skipped.length) {
      var us = el('ul'); v.skipped.forEach(function (s) { us.appendChild(el('li', '', s.kind + ' "' + s.id + '": ' + s.reasons.join('; '))); });
      out.appendChild(el('h3', '', 'Skipped')); out.appendChild(us);
    }

    out.appendChild(el('h3', '', 'Neighbourhoods'));
    var nl = el('ul');
    v.neighbourhoods.forEach(function (n) { nl.appendChild(el('li', '', n.name + ' — ' + n.count + (n.count === 1 ? ' pandal' : ' pandals'))); });
    out.appendChild(nl);

    var feed = P.trafficFeed(v.traffic, t);
    out.appendChild(el('h3', '', 'Visitor traffic feed at ' + P.fmtDateTime(t)));
    out.appendChild(el('p', '', 'Active: ' + feed.active.length + ' · Upcoming: ' + feed.upcoming.length + ' (expired / reference / pending never shown to visitors)'));
    var wrap = el('div', 'tablewrap'), tb = el('table'), hd = el('tr');
    ['Name', 'Place', 'Type', 'State', 'When', 'DEMO'].forEach(function (h) { hd.appendChild(el('th', '', h)); });
    tb.appendChild(hd);
    feed.active.concat(feed.upcoming).forEach(function (x) {
      var tr = el('tr');
      [x.r.name, x.r.place || x.r.affectedRoad || '', P.RTYPE_LABEL[x.r.restrictionType] || x.r.restrictionType, x.ev.state, P.describeTrafficTime(x.r, x.ev), x.r.demo ? 'DEMO' : ''].forEach(function (cell) { tr.appendChild(el('td', '', cell)); });
      tb.appendChild(tr);
    });
    wrap.appendChild(tb); out.appendChild(wrap);

    out.appendChild(el('h3', '', 'Pandals (first 20)'));
    var pl = el('ul');
    v.pandals.slice(0, 20).forEach(function (p) {
      pl.appendChild(el('li', '', p.name + ' · ' + (p.locality || '?') + ' · ' + P.statusLabel(p) + (p.hasCoords ? '' : ' — no map coords')));
    });
    if (v.pandals.length > 20) pl.appendChild(el('li', '', '… and ' + (v.pandals.length - 20) + ' more'));
    out.appendChild(pl);
    out.appendChild(el('p', 'banner banner-warn', 'Reminder: this preview is local. Nothing has been published.'));
  }
  $('#go').addEventListener('click', run);
  $('#now').addEventListener('click', function () { at.value = P.toLocalInputValue(Date.now()); run(); });
  $('#file').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return; var r = new FileReader();
    r.onload = function () { $('#json').value = String(r.result); run(); }; r.readAsText(f);
  });
  $('#load-pub').addEventListener('click', function () {
    if (location.protocol === 'file:') { $('#json').value = ''; $('#out').textContent = 'Loading published data does not work from a local file. Paste the JSON instead, or serve this folder over http.'; return; }
    fetch('data/puja-data.json?cb=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { $('#json').value = t; run(); }).catch(function () { $('#out').textContent = 'Could not load the published data.'; });
  });
})();
