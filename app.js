/* Siliguri Puja Navigator - UI. All dynamic text is inserted with textContent / setAttribute
   (never innerHTML with data). Pure logic lives in logic.js. */
(function () {
  'use strict';
  var P = window.PujaLogic;
  var DATA_URL = 'data/puja-data.json';
  var SILIGURI = [26.7271, 88.3953];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LS_REFRESH = 'spn.lastRefresh';

  var S = {
    data: null,              // validated dataset
    load: { status: 'loading', source: '', reason: '', lastRefresh: null },
    q: '', locality: '', checkAt: null,
    layers: { pandals: true, restrictions: true, parking: true },
    user: null,              // {lat,lon} in memory only
    selected: ''
  };
  var map = null, cluster = null, restrLayer = null, parkLayer = null, userLayer = null, tiles = null;
  var pandalMarkers = {}, restrMarkers = [], parkMarkers = [];
  var deferredInstall = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null && text !== '') e.textContent = text; return e; }
  function attrs(e, a) { Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function nowMs() { return Date.now(); }
  function refMs() { return S.checkAt != null ? S.checkAt : nowMs(); }
  function sr(text) { return el('span', 'sr-only', text); }

  /* ---------- badges ---------- */
  var BADGES = {
    official: ['\u2714', 'Official'], 'admin-verified': ['\u2714', 'Admin-verified'],
    unconfirmed: ['?', 'Unconfirmed'], demo: ['\u25C6', 'Demo']
  };
  function badge(kind) {
    var b = BADGES[kind] || ['?', kind];
    var s = el('span', 'badge badge-' + kind);
    add(s, attrs(el('span', 'ic', b[0]), { 'aria-hidden': 'true' }), document.createTextNode(' ' + b[1]));
    return s;
  }
  function recBadges(r) {
    var w = el('span', 'badges');
    if (r.demo) w.appendChild(badge('demo'));
    if (r.status === 'official' || r.status === 'admin-verified' || r.status === 'unconfirmed') w.appendChild(badge(r.status));
    return w;
  }
  var STATE_ICON = { active: '\u25CF', upcoming: '\u25CB', expired: '\u25A0', cancelled: '\u2716', unconfirmed: '?' };
  function stateBadge(state, verified) {
    var s = el('span', 'state state-' + state + (verified ? '' : ' is-sample'));
    add(s, attrs(el('span', 'ic', STATE_ICON[state]), { 'aria-hidden': 'true' }), document.createTextNode(' ' + P.stateLabel(state, verified)));
    return s;
  }
  var TYPE_LABEL = { 'no-entry': 'No entry', 'vehicle-restriction': 'Vehicle restriction', 'one-way': 'One-way', 'diversion': 'Diversion', 'parking-restriction': 'Parking restriction', 'pedestrian-zone': 'Pedestrian zone', 'other': 'Other' };

  /* ---------- navigation button ---------- */
  function navButton(rec) {
    var wrap = el('div', 'nav-wrap'), url = P.mapsDirUrl(rec);
    if (url) {
      var a = attrs(el('a', 'btn btn-primary', 'Navigate with Google Maps'), { href: url, target: '_blank', rel: 'noopener noreferrer' });
      a.appendChild(sr(' (opens in a new tab)'));
      wrap.appendChild(a);
      var note = !rec.hasCoords ? 'Directions use the written address and may be approximate.' : (rec.approximateLocation ? 'Location is approximate.' : '');
      if (note) wrap.appendChild(el('p', 'muted small', note));
    } else {
      wrap.appendChild(attrs(el('button', 'btn btn-primary', 'Navigate with Google Maps'), { type: 'button', disabled: 'disabled', 'aria-disabled': 'true' }));
      wrap.appendChild(el('p', 'muted small', 'Navigation unavailable: no verified coordinates or address for this place.'));
    }
    return wrap;
  }

  function fact(label, value) {
    if (!value) return null;
    var p = el('p', 'fact'); add(p, el('span', 'fact-l', label + ': '), document.createTextNode(value)); return p;
  }
  function provenance(r) {
    var p = el('p', 'fact prov');
    if (r.demo) { p.textContent = 'Sample record – not a real source or order.'; return p; }
    var parts = [];
    if (r.source) parts.push('Source: ' + r.source);
    if (r.verifiedBy) parts.push('Verified by: ' + r.verifiedBy);
    if (isFinite(r.verifiedAtMs)) parts.push('Verified: ' + P.fmtDateTime(r.verifiedAtMs));
    if (!parts.length) parts.push('No source published.');
    p.textContent = parts.join(' · ');
    if (r.sourceUrl) {
      p.appendChild(document.createTextNode(' '));
      var a = attrs(el('a', '', 'Source link'), { href: r.sourceUrl, target: '_blank', rel: 'noopener noreferrer' });
      a.appendChild(sr(' (opens in a new tab)')); p.appendChild(a);
    }
    return p;
  }

  /* ---------- filtering ---------- */
  function filtered() {
    var d = S.data; if (!d) return { pandals: [], parking: [], restrictions: [] };
    var q = S.q, loc = S.locality;
    return {
      pandals: d.pandals.filter(function (p) { return (!loc || p.locality === loc) && P.matches(q, P.pandalFields(p)); }),
      parking: d.parking.filter(function (p) { return (!loc || p.locality === loc) && P.matches(q, P.parkingFields(p)); }),
      restrictions: d.restrictions.filter(function (r) { return P.matches(q, P.restrictionFields(r)); })
    };
  }
  function withDistance(list) {
    if (!S.user) return list.map(function (p) { return { p: p, km: null }; });
    return list.map(function (p) { return { p: p, km: p.hasCoords ? P.distanceKm(S.user.lat, S.user.lon, p.lat, p.lon) : null }; });
  }
  function fmtKm(km) { return km < 1 ? Math.round(km * 1000 / 10) * 10 + ' m' : km.toFixed(1) + ' km'; }

  /* ---------- pandal cards ---------- */
  function pandalCard(p, km, compact) {
    var li = attrs(el('li', 'card pandal-card' + (p.demo ? ' is-demo' : '')), { 'data-id': p.id });
    if (S.selected === p.id) li.classList.add('is-selected');
    var head = el('div', 'card-head');
    add(head, el('h3', '', p.name), recBadges(p));
    li.appendChild(head);
    var loc = [p.locality, p.address].filter(Boolean).join(' · ');
    if (loc) li.appendChild(el('p', 'muted', loc));
    if (km != null) li.appendChild(el('p', 'dist', fmtKm(km) + ' away (straight-line distance, not road distance)'));
    if (!compact) { var t = fact('Timings', p.timings); if (t) li.appendChild(t); }
    var actions = el('div', 'actions');
    if (p.hasCoords) actions.appendChild(attrs(el('button', 'btn btn-ghost', 'Show on map'), { type: 'button', 'data-action': 'show', 'data-id': p.id, 'aria-label': 'Show ' + p.name + ' on map' }));
    else actions.appendChild(el('span', 'muted small', 'Not drawn on map (no verified coordinates).'));
    li.appendChild(actions);
    li.appendChild(navButton(p));
    if (!compact) {
      var det = attrs(el('details', 'more'), { id: 'det-' + p.id });
      det.appendChild(el('summary', '', 'More details'));
      add(det, p.description ? el('p', '', p.description) : null, fact('Entrance', p.entrance), fact('Nearest parking', p.nearestParking), fact('Accessibility', p.accessibility));
      var rel = (p.restrictionIds || []).map(function (id) { return S.data.restrictions.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
      if (rel.length) {
        var rp = el('div', 'fact'); rp.appendChild(el('span', 'fact-l', 'Related notices:'));
        var ul = el('ul', 'plain');
        rel.forEach(function (r) { var ev = P.evaluateRestriction(r, refMs()); var x = el('li'); add(x, document.createTextNode(r.name + ' – '), stateBadge(ev.state, r.verified)); ul.appendChild(x); });
        rp.appendChild(ul); det.appendChild(rp);
      }
      if (p.approximateLocation) det.appendChild(el('p', 'fact', 'Location is approximate.'));
      det.appendChild(provenance(p));
      if (p.imageUrl) det.appendChild(attrs(el('img', 'thumb'), { src: p.imageUrl, alt: 'Photo of ' + p.name, loading: 'lazy', referrerpolicy: 'no-referrer', width: '320', height: '180' }));
      li.appendChild(det);
    }
    return li;
  }

  function dataEmptyMessage() {
    return S.load.status === 'loading' ? 'Loading…' : 'Data unavailable – nothing to show.';
  }

  function renderPandals(f) {
    var ul = $('#pandal-list'), empty = $('#pandal-empty'); clear(ul);
    var rows = withDistance(f.pandals);
    if (S.user) rows.sort(function (a, b) { return (a.km == null) - (b.km == null) || (a.km || 0) - (b.km || 0) || a.p.name.localeCompare(b.p.name); });
    else rows.sort(function (a, b) { return a.p.name.localeCompare(b.p.name); });
    rows.forEach(function (r) { ul.appendChild(pandalCard(r.p, r.km, false)); });
    $('#pandal-count').textContent = S.data ? '(' + rows.length + (rows.length !== S.data.pandals.length ? ' of ' + S.data.pandals.length : '') + ')' : '';
    empty.hidden = rows.length > 0 || !S.data;
    if (!S.data) { empty.hidden = false; empty.textContent = dataEmptyMessage(); }
    else if (!rows.length) { clear(empty); add(empty, document.createTextNode('No pandals match your search. Try fewer words or '), attrs(el('button', 'linklike', 'clear all filters'), { type: 'button', 'data-action': 'clear-filters' }), document.createTextNode('.')); }
  }

  function renderNearby(f) {
    var list = $('#nearby-list'); clear(list);
    $('#nearby-clear').hidden = !S.user;
    $('#nearby-intro').hidden = !!S.user;
    if (!S.user) { list.hidden = true; return; }
    var rows = withDistance(f.pandals).filter(function (r) { return r.km != null; }).sort(function (a, b) { return a.km - b.km; }).slice(0, 5);
    list.hidden = false;
    if (!rows.length) { list.appendChild(el('li', 'empty', 'No mapped pandals to measure from your location.')); return; }
    rows.forEach(function (r) { list.appendChild(pandalCard(r.p, r.km, true)); });
  }

  function renderParking(f) {
    var ul = $('#parking-list'); clear(ul);
    f.parking.forEach(function (p) {
      var li = attrs(el('li', 'card' + (p.demo ? ' is-demo' : '')), { 'data-id': p.id });
      add(li, add(el('div', 'card-head'), el('h3', '', p.name), recBadges(p)));
      var loc = [p.locality, p.address].filter(Boolean).join(' · '); if (loc) li.appendChild(el('p', 'muted', loc));
      add(li, fact('Capacity', p.capacity != null ? String(p.capacity) : ''), fact('Vehicles', (p.vehicleTypes || []).join(', ')), fact('Notes', p.notes), provenance(p));
      var actions = el('div', 'actions');
      if (p.hasCoords) actions.appendChild(attrs(el('button', 'btn btn-ghost', 'Show on map'), { type: 'button', 'data-action': 'show-parking', 'data-id': p.id, 'aria-label': 'Show ' + p.name + ' on map' }));
      li.appendChild(actions); li.appendChild(navButton(p));
      ul.appendChild(li);
    });
    $('#parking-count').textContent = S.data ? '(' + f.parking.length + ')' : '';
    var e = $('#parking-empty'); e.hidden = f.parking.length > 0; e.textContent = S.data ? 'No parking records match your search.' : dataEmptyMessage();
  }

  /* ---------- restrictions ---------- */
  function restrictionCard(r, ev) {
    var li = attrs(el('li', 'card restr-card state-card-' + ev.state + (r.verified ? '' : ' is-sample')), { 'data-id': r.id });
    add(li, add(el('div', 'card-head'), el('h4', 'h3like', r.name), recBadges(r)));
    var line = el('p', 'badges');
    add(line, el('span', 'badge badge-type', TYPE_LABEL[r.type] || r.type), stateBadge(ev.state, r.verified));
    li.appendChild(line);
    if (!r.verified) li.appendChild(el('p', 'sample-note', r.demo ? 'Sample data – not a real order. Do not rely on it.' : 'Unverified – do not rely on it.'));
    var det = '';
    if (ev.state === 'active' && ev.windowEnd) det = 'Current window ends ' + P.fmtDateTime(ev.windowEnd) + '.';
    else if (ev.state === 'upcoming' && ev.windowStart) det = 'Next window: ' + P.fmtDateTime(ev.windowStart) + ' to ' + P.fmtDateTime(ev.windowEnd) + '.';
    else if (ev.state === 'expired' && ev.windowEnd) det = 'Last window ended ' + P.fmtDateTime(ev.windowEnd) + '.';
    if (det) li.appendChild(el('p', 'fact', det));
    li.appendChild(fact('Published schedule', P.describeSchedule(r)));
    add(li, fact('Where', r.locationText), fact('Roads', (r.roads || []).join(', ')), r.description ? el('p', '', r.description) : null,
      fact('Vehicles', (r.vehicleTypes || []).join(', ')), fact('Pedestrians', r.pedestrianAccess), fact('Alternative access', r.alternativeAccess), fact('Authority', r.authority), provenance(r));
    if (r.hasCoords) li.appendChild(add(el('div', 'actions'), attrs(el('button', 'btn btn-ghost', 'Show on map'), { type: 'button', 'data-action': 'show-restr', 'data-id': r.id, 'aria-label': 'Show ' + r.name + ' on map' })));
    return li;
  }
  var ORDER = { active: 0, upcoming: 1, unconfirmed: 2, cancelled: 3, expired: 4 };
  function evaluated(f) {
    var t = refMs();
    return f.restrictions.map(function (r) { return { r: r, ev: P.evaluateRestriction(r, t) }; });
  }
  function renderRestrictions(f) {
    var rows = evaluated(f), t = refMs();
    var act = rows.filter(function (x) { return x.r.verified && x.ev.state === 'active'; });
    var up = rows.filter(function (x) { return x.r.verified && x.ev.state === 'upcoming'; });
    var other = rows.filter(function (x) { return act.indexOf(x) < 0 && up.indexOf(x) < 0; });
    function byStart(a, b) { return (a.ev.windowStart || 0) - (b.ev.windowStart || 0); }
    act.sort(byStart); up.sort(byStart);
    other.sort(function (a, b) { return ORDER[a.ev.state] - ORDER[b.ev.state] || byStart(a, b); });
    function fill(sel, list, emptyText) {
      var ul = clear($(sel)); list.forEach(function (x) { ul.appendChild(restrictionCard(x.r, x.ev)); });
      if (!list.length) ul.appendChild(el('li', 'empty', emptyText));
    }
    var none = S.data ? '' : dataEmptyMessage();
    fill('#rs-active', act, none || 'No verified restriction is scheduled for this time. This does not mean roads are unrestricted – follow police directions.');
    fill('#rs-upcoming', up, none || 'No upcoming verified restrictions in the published data.');
    fill('#rs-other', other, none || 'No sample, unverified, cancelled or ended records.');
    $('#rs-active-n').textContent = S.data ? '(' + act.length + ')' : '';
    $('#rs-upcoming-n').textContent = S.data ? '(' + up.length + ')' : '';
    $('#rs-other-n').textContent = S.data ? '(' + other.length + ')' : '';
    $('#restr-empty').hidden = !(S.data && S.data.restrictions.length && !f.restrictions.length);
    $('#check-summary').textContent = S.data ? (S.checkAt != null ? 'Showing the schedule for ' + P.fmtDateTime(t) + ' (time you selected).' : 'Showing the schedule for the current time: ' + P.fmtDateTime(t) + '.') : '';
    var cn = $('#restr-cache-note');
    cn.hidden = !(S.load.source === 'cache' && S.data);
    if (!cn.hidden) cn.textContent = 'These statuses are calculated from saved (cached) data that may be outdated or replaced. Do not treat them as current.';
  }

  function renderSummary(f) {
    var s = $('#filter-summary');
    if (!S.data) { s.textContent = ''; return; }
    var active = S.q || S.locality;
    s.textContent = active ? 'Showing ' + f.pandals.length + ' pandal(s), ' + f.parking.length + ' parking, ' + f.restrictions.length + ' notice(s).' : '';
  }

  /* ---------- banners ---------- */
  function setBanner(id, nodes) {
    var b = $('#' + id); clear(b);
    if (!nodes) { b.hidden = true; return; }
    nodes.forEach(function (n) { b.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
    b.hidden = false;
  }
  function retryBtn() { return attrs(el('button', 'btn btn-ghost btn-sm', 'Retry loading data'), { type: 'button', 'data-action': 'retry' }); }
  function renderBanners() {
    var d = S.data, L = S.load;
    // demo
    var demoOn = d && (d.meta.isDemoDataset);
    $('#bn-demo').hidden = !demoOn;
    if (demoOn && d.meta.notice) $('#bn-demo-text').textContent = d.meta.notice;
    // unavailable
    if (L.status === 'unavailable') {
      var why = L.reason === 'file' ? 'This page was opened as a local file, and browsers block loading data files that way. Serve the folder over http(s) (see README).'
        : L.reason === 'invalid' ? 'The data file is damaged or invalid (' + (L.detail || 'unknown problem') + ').'
        : 'You may be offline, or the data file could not be reached, and there is no saved copy on this device.';
      setBanner('bn-unavailable', [el('strong', '', '\u26A0 Data unavailable. '), 'Pandal and restriction information could not be loaded. ' + why + ' Do not assume any road is open or restricted – check official sources and follow the directions of traffic police. ', retryBtn()]);
    } else setBanner('bn-unavailable', null);
    // offline / cached
    if (L.status === 'ok' && L.source === 'cache') {
      setBanner('bn-offline', [el('strong', '', '\u26A0 Offline – showing saved (cached) data that may be outdated. Do not treat it as current. '),
        'Data last updated: ' + P.fmtDateTime(d.meta.lastUpdatedMs) + '. Last successful refresh on this device: ' + (L.lastRefresh ? P.fmtDateTime(L.lastRefresh) : 'unknown') + '. ', retryBtn()]);
    } else setBanner('bn-offline', null);
    // quality
    if (d && d.skipped.length) {
      var det = el('details', 'quality-details'); det.appendChild(el('summary', '', 'Show which records were skipped'));
      var ul = el('ul', 'plain'); d.skipped.forEach(function (s) { ul.appendChild(el('li', '', s.kind + ' "' + s.id + '": ' + s.reasons.join('; '))); }); det.appendChild(ul);
      setBanner('bn-quality', [el('strong', '', '\u26A0 Data-quality warning: '), d.skipped.length + ' record(s) failed validation and are not shown (for example missing source, missing verification details or invalid coordinates). ', det]);
    } else setBanner('bn-quality', null);
    // festival + freshness
    var fi = $('#festival-info');
    if (d && d.meta.festival.name) {
      var f = d.meta.festival, dates = (f.startDate && f.endDate) ? ' · ' + P.fmtDate(P.parseISTDate(f.startDate)) + ' to ' + P.fmtDate(P.parseISTDate(f.endDate)) : '';
      fi.textContent = f.name + dates + (f.note ? ' – ' + f.note : ''); fi.hidden = false;
    } else fi.hidden = true;
    var fr = clear($('#freshness'));
    if (d) {
      add(fr, el('p', '', 'Dataset ' + (d.meta.datasetVersion || '(no version)') + (d.meta.isDemoDataset ? ' (demo – sample data)' : '') + '. Data last updated: ' + P.fmtDateTime(d.meta.lastUpdatedMs) + '.'),
        el('p', '', 'Last successful data refresh on this device: ' + (L.lastRefresh ? P.fmtDateTime(L.lastRefresh) : 'unknown') + (L.source === 'cache' ? ' (currently showing saved data – may be outdated)' : '') + '.'),
        el('p', 'muted small', 'Verification badges: Official = taken from an official order or notice; Admin-verified = checked by the site maintainers against a named source; Unconfirmed = not yet checked; Demo = placeholder.'));
      $('#foot-version').textContent = 'data ' + (d.meta.datasetVersion || '');
    } else add(fr, el('p', '', L.status === 'loading' ? 'Loading data…' : 'No data loaded. Nothing here should be treated as current information.'));
  }

  /* ---------- map ---------- */
  function iconEl(cls, text, dashed) {
    var d = el('div', 'mk-in ' + cls + (dashed ? ' mk-dashed' : ''));
    if (text) d.appendChild(attrs(el('span', 'mk-t', text), { 'aria-hidden': 'true' }));
    return d;
  }
  function mkIcon(cls, text, dashed, size) {
    return L.divIcon({ className: 'mk', html: iconEl(cls, text, dashed), iconSize: [size === 24 ? 24 : 44, size === 24 ? 24 : 44], iconAnchor: [size === 24 ? 12 : 22, size === 24 ? 12 : 22], popupAnchor: [0, -20] });
  }
  function popupNode(rec, kind) {
    var n = el('div', 'popup');
    n.appendChild(el('strong', 'popup-t', rec.name));
    n.appendChild(recBadges(rec));
    if (kind === 'restr') {
      var ev = P.evaluateRestriction(rec, refMs());
      n.appendChild(stateBadge(ev.state, rec.verified));
      n.appendChild(el('p', 'small', P.describeSchedule(rec)));
      n.appendChild(el('p', 'small', 'Subject to official orders and on-ground changes. Follow traffic police directions.'));
      n.appendChild(attrs(el('button', 'btn btn-ghost btn-sm', 'Details below'), { type: 'button', 'data-action': 'goto-card', 'data-id': rec.id }));
    } else {
      if (rec.locality) n.appendChild(el('p', 'small', rec.locality));
      if (rec.demo) n.appendChild(el('p', 'small sample-note', 'Sample data – not a real place.'));
      n.appendChild(navButton(rec));
      if (kind === 'pandal') n.appendChild(attrs(el('button', 'btn btn-ghost btn-sm', 'Details below'), { type: 'button', 'data-action': 'goto-card', 'data-id': rec.id }));
    }
    return n;
  }
  function labelMarker(m, label) { m.on('add', function () { var e = m.getElement(); if (e) { e.setAttribute('aria-label', label); e.setAttribute('role', 'button'); } }); }

  function initMap() {
    if (typeof L === 'undefined' || !L.markerClusterGroup) { $('#map-fallback').hidden = false; $('#map').hidden = true; return; }
    map = L.map('map', { center: SILIGURI, zoom: 13, minZoom: 9, maxZoom: 19, zoomAnimation: !reduce, fadeAnimation: !reduce, markerZoomAnimation: !reduce });
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' });
    var errs = 0, msg = $('#tile-msg');
    tiles.on('loading', function () { errs = 0; });
    tiles.on('tileerror', function () { errs++; msg.hidden = false; });
    tiles.on('load', function () { if (!errs && navigator.onLine !== false) msg.hidden = true; });
    if (navigator.onLine === false) msg.hidden = false;
    window.addEventListener('offline', function () { msg.hidden = false; });
    window.addEventListener('online', function () { if (tiles) tiles.redraw(); });
    tiles.addTo(map);
    cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, animate: !reduce, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (c) { var n = c.getChildCount(); return L.divIcon({ className: 'mk', html: iconEl('mk-cluster', String(n)), iconSize: [44, 44], iconAnchor: [22, 22] }); } });
    restrLayer = L.layerGroup(); parkLayer = L.layerGroup(); userLayer = L.layerGroup().addTo(map);
    map.addLayer(cluster); map.addLayer(restrLayer); map.addLayer(parkLayer);
    var Locate = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var box = el('div', 'leaflet-bar leaflet-control locate-ctl');
        var b = attrs(el('button', 'locate-btn'), { type: 'button', title: 'Show my location', 'aria-label': 'Show my location on the map' });
        b.appendChild(attrs(el('span', '', '\u25CE'), { 'aria-hidden': 'true' })); box.appendChild(b);
        L.DomEvent.disableClickPropagation(box);
        b.addEventListener('click', function () { requestLocation(true); });
        return box;
      }
    });
    new Locate().addTo(map);
    map.on('popupopen', function (e) {
      var id = e.popup._spnId; if (id) markSelected(id);
    });
  }

  function markSelected(id) {
    S.selected = id;
    Array.prototype.forEach.call(document.querySelectorAll('.card.is-selected'), function (c) { c.classList.remove('is-selected'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"].card'), function (c) { c.classList.add('is-selected'); });
  }

  function rebuildMap(f, fit) {
    if (!map) return;
    cluster.clearLayers(); restrLayer.clearLayers(); parkLayer.clearLayers();
    pandalMarkers = {}; restrMarkers = []; parkMarkers = [];
    var pts = [], ms = [];
    f.pandals.forEach(function (p) {
      if (!p.hasCoords) return;
      var m = L.marker([p.lat, p.lon], { icon: mkIcon('mk-pandal', '', p.demo || p.status === 'unconfirmed'), title: p.name, alt: p.name, keyboard: true, riseOnHover: true });
      m.bindPopup(function () { return popupNode(p, 'pandal'); }, { maxWidth: 270, maxHeight: 340, autoPanPaddingTopLeft: [16, 60], autoPanPaddingBottomRight: [16, 16] });
      m.getPopup()._spnId = p.id; labelMarker(m, p.name + ' (pandal)' + (p.demo ? ', sample data' : ''));
      pandalMarkers[p.id] = m; ms.push(m); pts.push([p.lat, p.lon]);
    });
    cluster.addLayers(ms);
    evaluated(f).forEach(function (x) {
      var r = x.r;
      if (r.geometry) {
        var line = L.polyline(r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), { color: '#8c1c2c', weight: 5, opacity: 0.85, dashArray: x.ev.state === 'active' ? null : '8 8' });
        line.bindPopup(function () { return popupNode(r, 'restr'); }); line.getPopup()._spnId = r.id; restrLayer.addLayer(line);
      }
      if (!r.hasCoords) return;
      var m = L.marker([r.lat, r.lon], { icon: mkIcon('mk-restr st-' + x.ev.state, '\u2297', !r.verified, 38), title: r.name + ' – ' + P.stateLabel(x.ev.state, r.verified), alt: r.name, keyboard: true });
      m.bindPopup(function () { return popupNode(r, 'restr'); }, { maxWidth: 270 }); m.getPopup()._spnId = r.id;
      labelMarker(m, r.name + ' (restriction point, ' + P.stateLabel(x.ev.state, r.verified) + ')');
      restrLayer.addLayer(m); restrMarkers.push(m); pts.push([r.lat, r.lon]);
    });
    f.parking.forEach(function (p) {
      if (!p.hasCoords) return;
      var m = L.marker([p.lat, p.lon], { icon: mkIcon('mk-park', 'P', p.demo, 34), title: p.name, alt: p.name, keyboard: true });
      m.bindPopup(function () { return popupNode(p, 'parking'); }, { maxWidth: 270 }); m.getPopup()._spnId = p.id; labelMarker(m, p.name + ' (parking)');
      parkLayer.addLayer(m); parkMarkers.push(m); pts.push([p.lat, p.lon]);
    });
    applyLayerVisibility();
    if (fit && pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15, animate: false });
  }
  function applyLayerVisibility() {
    if (!map) return;
    [[cluster, 'pandals'], [restrLayer, 'restrictions'], [parkLayer, 'parking']].forEach(function (x) {
      var on = map.hasLayer(x[0]); if (S.layers[x[1]] && !on) map.addLayer(x[0]); else if (!S.layers[x[1]] && on) map.removeLayer(x[0]);
    });
  }

  function scrollToEl(node) { node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }
  function showOnMap(marker, layerKey, latlng) {
    if (!map || !marker) return;
    S.layers[layerKey] = true; $('#layer-' + layerKey).checked = true; applyLayerVisibility();
    scrollToEl($('#map-section'));
    var open = function () { marker.openPopup(); };
    if (layerKey === 'pandals') {
      map.setView(latlng, Math.max(map.getZoom(), 16), { animate: false });
      cluster.zoomToShowLayer(marker, open);
    } else {
      if (reduce) map.setView(latlng, Math.max(map.getZoom(), 16)); else map.flyTo(latlng, Math.max(map.getZoom(), 16), { duration: 0.8 });
      setTimeout(open, reduce ? 0 : 900);
    }
  }
  function gotoCard(id) {
    var c = document.querySelector('.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!c) return;
    markSelected(id); var d = c.querySelector('details'); if (d) d.open = true;
    scrollToEl(c); c.setAttribute('tabindex', '-1'); c.focus({ preventScroll: true });
  }

  /* ---------- geolocation (only on button press; never stored or sent) ---------- */
  function requestLocation(pan) {
    var m1 = $('#geo-msg'), m2 = $('#geo-map-msg');
    function msg(t) { m1.textContent = t; m2.textContent = t; }
    if (!navigator.geolocation) { msg('Location is not supported on this device or browser. You can still search and browse.'); return; }
    msg('Asking for your location… (your browser may show a permission prompt)');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      if (!isFinite(lat) || !isFinite(lon)) { msg('Could not read your location.'); return; }
      S.user = { lat: lat, lon: lon };
      var inArea = P.validCoords(lat, lon);
      msg(inArea ? 'Using your location on this device only. Distances are straight-line estimates.' : 'You appear to be outside the Siliguri area. Distances are straight-line estimates from where you are.');
      if (map) {
        userLayer.clearLayers();
        userLayer.addLayer(L.marker([lat, lon], { icon: mkIcon('mk-me', '', false, 24), keyboard: false, interactive: false, zIndexOffset: -100 }));
        if (pan && inArea) map.setView([lat, lon], 15, { animate: !reduce });
      }
      renderLists();
    }, function (err) {
      var t = err && err.code === 1 ? 'Location permission was not granted, so nothing was shared. You can still search and browse everything.'
        : err && err.code === 3 ? 'Finding your location took too long. Try again outdoors or search by name instead.'
        : 'Your location is not available right now. You can still search and browse.';
      msg(t);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
  }
  function forgetLocation() {
    S.user = null; if (userLayer) userLayer.clearLayers();
    $('#geo-msg').textContent = 'Your location was forgotten.'; $('#geo-map-msg').textContent = '';
    renderLists();
  }

  /* ---------- render orchestration ---------- */
  function renderLists() {
    var f = filtered();
    renderPandals(f); renderNearby(f); renderParking(f); renderRestrictions(f); renderSummary(f);
    return f;
  }
  function renderAll(fit) { var f = renderLists(); rebuildMap(f, fit); renderBanners(); }

  function fillLocalities() {
    var sel = $('#locality'), cur = S.locality, seen = {}, list = [];
    if (S.data) S.data.pandals.concat(S.data.parking).forEach(function (r) { if (r.locality && !seen[r.locality]) { seen[r.locality] = 1; list.push(r.locality); } });
    list.sort();
    while (sel.options.length > 1) sel.remove(1);
    list.forEach(function (l) { var o = el('option', '', l); o.value = l; sel.appendChild(o); });
    sel.value = list.indexOf(cur) >= 0 ? cur : ''; S.locality = sel.value;
  }

  /* ---------- data loading ---------- */
  function readLastRefresh() { try { var v = +localStorage.getItem(LS_REFRESH); return v > 0 ? v : null; } catch (e) { return null; } }
  function loadData() {
    S.load = { status: 'loading', source: '', reason: '', lastRefresh: readLastRefresh() };
    if (location.protocol === 'file:') { S.load.status = 'unavailable'; S.load.reason = 'file'; S.data = null; renderAll(false); return Promise.resolve(); }
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    return fetch(DATA_URL + '?cb=' + nowMs(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var fromCache = res.headers.get('X-Data-Source') === 'cache';
        return res.text().then(function (t) { return { text: t, fromCache: fromCache }; });
      })
      .then(function (r) {
        var raw;
        try { raw = JSON.parse(r.text); } catch (e) { S.load = { status: 'unavailable', reason: 'invalid', detail: 'not valid JSON', lastRefresh: readLastRefresh() }; S.data = null; return; }
        var v = P.validateDataset(raw);
        if (!v.ok) { S.load = { status: 'unavailable', reason: 'invalid', detail: v.fatal, lastRefresh: readLastRefresh() }; S.data = null; return; }
        if (!r.fromCache) { try { localStorage.setItem(LS_REFRESH, String(nowMs())); } catch (e) {} }
        S.data = v; S.load = { status: 'ok', source: r.fromCache ? 'cache' : 'network', lastRefresh: r.fromCache ? readLastRefresh() : nowMs() };
      })
      .catch(function () { S.data = null; S.load = { status: 'unavailable', reason: 'network', lastRefresh: readLastRefresh() }; })
      .then(function () { fillLocalities(); renderAll(true); });
  }

  /* ---------- events ---------- */
  function bind() {
    var q = $('#q');
    $('#filters').addEventListener('submit', function (e) { e.preventDefault(); });
    q.addEventListener('input', function () { S.q = q.value; var f = renderLists(); rebuildMap(f, true); });
    $('#locality').addEventListener('change', function (e) { S.locality = e.target.value; var f = renderLists(); rebuildMap(f, true); });
    function clearAll() {
      S.q = ''; S.locality = ''; S.checkAt = null; q.value = ''; $('#locality').value = ''; $('#check-at').value = '';
      S.layers = { pandals: true, restrictions: true, parking: true };
      ['pandals', 'restrictions', 'parking'].forEach(function (k) { $('#layer-' + k).checked = true; });
      renderAll(true);
    }
    $('#clear-filters').addEventListener('click', clearAll);
    ['pandals', 'restrictions', 'parking'].forEach(function (k) {
      $('#layer-' + k).addEventListener('change', function (e) { S.layers[k] = e.target.checked; applyLayerVisibility(); });
    });
    $('#check-at').addEventListener('change', function (e) {
      var v = P.fromLocalInputValue(e.target.value); S.checkAt = isFinite(v) ? v : null;
      var f = renderLists(); rebuildMap(f, false);
    });
    $('#check-now').addEventListener('click', function () { S.checkAt = null; $('#check-at').value = ''; var f = renderLists(); rebuildMap(f, false); });
    $('#nearby-btn').addEventListener('click', function () { requestLocation(false); });
    $('#nearby-clear').addEventListener('click', forgetLocation);
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-action]') : null; if (!t) return;
      var id = t.getAttribute('data-id'), a = t.getAttribute('data-action');
      if (a === 'clear-filters') clearAll();
      else if (a === 'retry') loadData();
      else if (a === 'show') { var p = S.data.pandals.filter(function (x) { return x.id === id; })[0]; if (p) showOnMap(pandalMarkers[id], 'pandals', [p.lat, p.lon]); }
      else if (a === 'show-restr') {
        var r = S.data.restrictions.filter(function (x) { return x.id === id; })[0];
        var i = r ? S.data.restrictions.indexOf(r) : -1; var mk = restrMarkers.filter(function (m) { return m.getLatLng().lat === r.lat && m.getLatLng().lng === r.lon; })[0];
        if (r && mk) showOnMap(mk, 'restrictions', [r.lat, r.lon]);
      } else if (a === 'show-parking') {
        var pk = S.data.parking.filter(function (x) { return x.id === id; })[0];
        var m2 = pk && parkMarkers.filter(function (m) { return m.getLatLng().lat === pk.lat && m.getLatLng().lng === pk.lon; })[0];
        if (m2) showOnMap(m2, 'parking', [pk.lat, pk.lon]);
      } else if (a === 'goto-card') gotoCard(id);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && map) map.closePopup(); });
    window.addEventListener('online', function () { if (S.load.status !== 'ok' || S.load.source === 'cache') loadData(); });
    // 60-second tick keeps "current time" fresh
    setInterval(function () { if (S.checkAt == null && S.data) { var f = renderLists(); rebuildMap(f, false); } }, 60000);
    // install prompt
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; $('#install-btn').hidden = false; });
    $('#install-btn').addEventListener('click', function () {
      if (!deferredInstall) return; deferredInstall.prompt();
      deferredInstall.userChoice.then(function () { deferredInstall = null; $('#install-btn').hidden = true; });
    });
    window.addEventListener('appinstalled', function () { $('#install-btn').hidden = true; });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js', { scope: './' }).then(function (reg) { reg.update(); }).catch(function () {});
    });
  }

  initMap(); bind(); registerSW(); renderAll(false); loadData();

  // Read-only helper used by automated tests (does not change behaviour).
  window.PujaApp = {
    counts: function () {
      var layerCount = function (g) { return g ? g.getLayers().length : 0; };
      return { pandalMarkers: Object.keys(pandalMarkers).length, restrictionMarkers: restrMarkers.length, parkingMarkers: parkMarkers.length,
        pandalCards: document.querySelectorAll('#pandal-list > .card').length, clusterLayers: cluster ? cluster.getLayers().length : 0 };
    },
    info: function () { return { status: S.load.status, source: S.load.source, user: !!S.user }; },
    map: function () { return map; }
  };
})();
