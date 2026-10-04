/* Local-only validator/preview. Uses logic.js (same rules as the app). Never uploads or saves anything. */
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
    catch (e) { out.appendChild(el('p', 'bad', 'NOT VALID JSON: ' + e.message)); out.appendChild(el('p', 'muted', 'The app would show “Data unavailable”. Fix the syntax (commas, quotes, brackets) and try again.')); return; }
    var v = P.validateDataset(raw);
    if (!v.ok) { out.appendChild(el('p', 'bad', 'FATAL: ' + v.fatal)); out.appendChild(el('p', 'muted', 'The app would show “Data unavailable”.')); return; }
    var t = P.fromLocalInputValue(at.value); if (!isFinite(t)) t = Date.now();
    out.appendChild(el('p', v.skipped.length ? 'bad' : 'ok', v.skipped.length ? v.skipped.length + ' record(s) would be SKIPPED by the app (data-quality warning).' : 'All records valid.'));
    out.appendChild(el('p', '', 'Dataset ' + v.meta.datasetVersion + ' · last updated ' + P.fmtDateTime(v.meta.lastUpdatedMs) + (v.meta.isDemoDataset ? ' · DEMO DATASET (banner shown)' : '') + ' · ' + v.pandals.length + ' pandals, ' + v.parking.length + ' parking, ' + v.restrictions.length + ' restrictions, ' + v.draftCount + ' drafts hidden.'));
    if (v.skipped.length) {
      var ul = el('ul'); v.skipped.forEach(function (s) { ul.appendChild(el('li', '', s.kind + ' "' + s.id + '": ' + s.reasons.join('; '))); });
      out.appendChild(el('h3', '', 'Skipped records')); out.appendChild(ul);
    }
    if (v.notices.length) { var un = el('ul'); v.notices.forEach(function (n) { un.appendChild(el('li', '', n)); }); out.appendChild(el('h3', '', 'Notes')); out.appendChild(un); }
    out.appendChild(el('h3', '', 'Restriction status at ' + P.fmtDateTime(t)));
    var wrap = el('div', 'tablewrap'), tb = el('table'), hd = el('tr');
    ['Name', 'Badge', 'Status', 'Schedule'].forEach(function (h) { hd.appendChild(el('th', '', h)); }); tb.appendChild(hd);
    v.restrictions.forEach(function (r) {
      var ev = P.evaluateRestriction(r, t), tr = el('tr');
      [r.name, r.badge, P.stateLabel(ev.state, r.verified), P.describeSchedule(r)].forEach(function (x) { tr.appendChild(el('td', '', x)); });
      tb.appendChild(tr);
    });
    wrap.appendChild(tb); out.appendChild(wrap);
    out.appendChild(el('h3', '', 'Pandals'));
    var pl = el('ul'); v.pandals.forEach(function (p) { pl.appendChild(el('li', '', p.name + ' [' + p.badge + ']' + (p.hasCoords ? '' : ' – not on map (no coordinates)'))); }); out.appendChild(pl);
    out.appendChild(el('p', 'banner banner-warn', 'Reminder: this preview is local. Nothing has been published.'));
  }
  $('#go').addEventListener('click', run);
  $('#now').addEventListener('click', function () { at.value = P.toLocalInputValue(Date.now()); run(); });
  $('#file').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return; var r = new FileReader();
    r.onload = function () { $('#json').value = String(r.result); run(); }; r.readAsText(f);
  });
  $('#load-pub').addEventListener('click', function () {
    if (location.protocol === 'file:') { $('#json').value = ''; var o = $('#out'); o.textContent = 'Loading published data does not work from a local file. Paste the JSON instead, or serve this folder over http.'; return; }
    fetch('data/puja-data.json?cb=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { $('#json').value = t; run(); }).catch(function () { $('#out').textContent = 'Could not load the published data.'; });
  });
})();
