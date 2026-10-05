/* Siliguri Puja Guide - UI. All dynamic text is inserted with textContent / setAttribute
   (never innerHTML with data). Pure logic lives in logic.js. */
(function () {
  'use strict';
  var P = window.PujaLogic;
  var BR = window.PUJA_BRANDING || { appName: 'Siliguri Puja Guide', institutionalBranding: { enabled: false } };
  var DATA_URL = 'data/puja-data.json';
  var SILIGURI = [26.7271, 88.3953];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LS_REFRESH = 'spn.lastRefresh', LS_THEME = 'spn.theme';
  var DISCLAIMER = 'Google Maps may not reflect temporary Puja traffic restrictions, diversions or pedestrian arrangements. Follow on-ground traffic police directions and posted signs. Use only designated parking and drop-off points.';
  var AUTO_MIN_MS = 30000, MANUAL_MIN_MS = 3000, PERIODIC_MS = 5 * 60000, TICK_MS = 60000, FETCH_TIMEOUT_MS = 15000;
  var TITLES = { home: 'Home', find: 'Find a Pandal', parking: 'Parking & Walking Routes', traffic: 'Traffic Updates & Help', help: 'Help & facilities', info: 'Safety notice & information' };

  var S = {
    data: null, raw: '', renderKey: '',
    load: { status: 'loading', source: '', stale: false, reason: '', lastRefresh: null },
    q: '', locality: '', checkAt: null, user: null,
    route: '', selected: '', ptype: 'all', ftype: 'all', helpShow: false, helpPins: {}, selectedRoute: ''
  };
  var R = { inFlight: null, lastAttempt: 0, started: 0, skipped: 0, completed: 0 };
  var deferredInstall = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null && text !== '') e.textContent = text; return e; }
  function attrs(e, a) { Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function nowMs() { return Date.now(); }
  function refMs() { return S.checkAt != null ? S.checkAt : nowMs(); }
  function sr(text) { return el('span', 'sr-only', text); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- badges ---------- */
  var BADGES = { official: ['\u2714', 'Official'], 'admin-verified': ['\u2714', 'Admin-verified'], unconfirmed: ['?', 'Unconfirmed'], demo: ['\u25C6', 'Demo'] };
  function badge(kind) {
    var b = BADGES[kind] || ['?', kind], s = el('span', 'badge badge-' + kind);
    add(s, attrs(el('span', 'ic', b[0]), { 'aria-hidden': 'true' }), document.createTextNode(' ' + b[1])); return s;
  }
  function recBadges(r) {
    var w = el('span', 'badges');
    if (r.demo) w.appendChild(badge('demo'));
    if (r.status === 'official' || r.status === 'admin-verified' || r.status === 'unconfirmed') w.appendChild(badge(r.status));
    return w;
  }
  var STATE_ICON = { active: '\u25CF', upcoming: '\u25CB', expired: '\u25A0', cancelled: '\u2716', unconfirmed: '?' };
  function stateBadge(state, verified) {
    var shown = verified ? state : 'unconfirmed';
    var s = el('span', 'state state-' + shown + (verified ? '' : ' is-sample'));
    add(s, attrs(el('span', 'ic', STATE_ICON[shown]), { 'aria-hidden': 'true' }), document.createTextNode(' '), el('span', 'st-t', P.shortLabel(state, verified)));
    return s;
  }
  var TYPE_LABEL = { 'no-entry': 'No entry', 'vehicle-restriction': 'Vehicle restriction', 'one-way': 'One-way', 'diversion': 'Diversion', 'parking-restriction': 'Parking restriction', 'pedestrian-zone': 'Pedestrian zone', 'other': 'Other' };
  var FAC_LABEL = { toilet: 'Toilets', 'drinking-water': 'Drinking water', 'first-aid': 'First aid', hospital: 'Hospital', 'police-booth': 'Police assistance booth' };
  var FAC_MARK = { toilet: 'T', 'drinking-water': 'W', 'first-aid': '+', hospital: 'H', 'police-booth': 'Pb' };

  // "Approved"/"Designated" only when the record says so AND it is verified.
  function designation(rec, base) {
    var flagged = rec.kind === 'parking' ? rec.approved : rec.designated;
    if (flagged && rec.verified) return rec.kind === 'parking' ? 'Approved parking' : 'Designated ' + base;
    if (flagged) return cap(base) + ' (designation not verified)';
    return cap(base) + ' (designation not stated)';
  }
  function pointLabel(r) {
    if (r.kind === 'parking') return designation(r, 'parking');
    return designation(r, { 'drop-off': 'drop-off', 'pick-up': 'pick-up', 'pedestrian-entrance': 'pedestrian entrance', 'pedestrian-exit': 'pedestrian exit' }[r.type] || r.type);
  }

  /* ---------- small building blocks ---------- */
  function fact(label, value) { if (!value) return null; var p = el('p', 'fact'); add(p, el('span', 'fact-l', label + ': '), document.createTextNode(value)); return p; }
  function factOr(label, value, fallback) { return fact(label, value || fallback); }
  function provenance(r) {
    var p = el('p', 'fact prov');
    if (r.demo) { p.textContent = 'Sample record – not a real source or order.'; return p; }
    var parts = [];
    if (r.source) parts.push('Source: ' + r.source);
    if (r.verifiedBy) parts.push('Verified by: ' + r.verifiedBy);
    if (isFinite(r.verifiedAtMs)) parts.push('Verified: ' + P.fmtDateTime(r.verifiedAtMs));
    if (!parts.length) parts.push('No source published – treat as unverified.');
    p.textContent = parts.join(' · ');
    if (r.sourceUrl) {
      p.appendChild(document.createTextNode(' '));
      var a = attrs(el('a', '', 'Source link'), { href: r.sourceUrl, target: '_blank', rel: 'noopener noreferrer' });
      a.appendChild(sr(' (opens in a new tab)')); p.appendChild(a);
    }
    return p;
  }
  function extLink(url, label, cls) {
    var a = attrs(el('a', cls || 'btn btn-primary', label), { href: url, target: '_blank', rel: 'noopener noreferrer' });
    a.appendChild(sr(' (opens in a new tab)')); return a;
  }
  // One navigation button for any record that has coordinates and/or an address.
  function navBlock(dir, label, cls) {
    var wrap = el('div', 'nav-wrap');
    if (dir && dir.url) {
      wrap.appendChild(extLink(dir.url, label, cls));
      if (dir.note) wrap.appendChild(el('p', 'muted small', dir.note));
    } else {
      wrap.appendChild(attrs(el('button', cls || 'btn btn-primary', label), { type: 'button', disabled: 'disabled', 'aria-disabled': 'true' }));
      wrap.appendChild(el('p', 'muted small', 'Directions unavailable: no location or address has been published for this place.'));
    }
    return wrap;
  }
  function plainDir(rec) {
    var u = P.mapsDirUrl(rec); if (!u) return null;
    var coords = P.validCoords(rec.lat, rec.lon);
    return { url: u, note: coords ? (rec.approximateLocation ? 'The location is approximate.' : '') : 'Directions use the written address and may be approximate.' };
  }

  /* ---------- filtering ---------- */
  function filteredPandals() {
    if (!S.data) return [];
    return S.data.pandals.filter(function (p) { return (!S.locality || p.locality === S.locality) && P.matches(S.q, P.pandalFields(p)); });
  }
  function distOf(p) { return (S.user && p.hasCoords) ? P.distanceKm(S.user.lat, S.user.lon, p.lat, p.lon) : null; }
  function fmtKm(km) { return km < 1 ? Math.round(km * 100) * 10 + ' m' : km.toFixed(1) + ' km'; }
  function dataMsg() { return S.load.status === 'loading' ? 'Loading…' : 'Data unavailable – nothing to show.'; }

  /* ---------- maps (one lazily-created Leaflet map per screen) ---------- */
  var maps = {};
  function makeMap(name, elId) {
    var c = { name: name, elId: elId, el: $('#' + elId), map: null, failed: false, g: {} };
    c.frame = c.el.parentNode; c.msg = c.frame.nextElementSibling; c.fallback = $('[data-map-fallback]', c.frame);
    c.ensure = function () {
      if (c.map) { c.map.invalidateSize(); return c.map; }
      if (c.failed) return null;
      if (typeof L === 'undefined' || !L.markerClusterGroup) { c.failed = true; c.fallback.hidden = false; c.el.hidden = true; return null; }
      c.map = L.map(c.elId, { center: SILIGURI, zoom: 13, minZoom: 9, maxZoom: 19, zoomAnimation: !reduce, fadeAnimation: !reduce, markerZoomAnimation: !reduce });
      var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' });
      var errs = 0;
      tiles.on('loading', function () { errs = 0; });
      tiles.on('tileerror', function () { errs++; c.msg.hidden = false; });
      tiles.on('load', function () { if (!errs && navigator.onLine !== false) c.msg.hidden = true; });
      if (navigator.onLine === false) c.msg.hidden = false;
      window.addEventListener('offline', function () { c.msg.hidden = false; });
      window.addEventListener('online', function () { tiles.redraw(); });
      tiles.addTo(c.map);
      c.g.main = L.layerGroup().addTo(c.map);
      return c.map;
    };
    c.clear = function () { Object.keys(c.g).forEach(function (k) { c.g[k].clearLayers(); }); };
    maps[name] = c; return c;
  }
  function iconEl(cls, text, dashed) {
    var d = el('div', 'mk-in ' + cls + (dashed ? ' mk-dashed' : ''));
    if (text) d.appendChild(attrs(el('span', 'mk-t', text), { 'aria-hidden': 'true' })); return d;
  }
  function mkIcon(cls, text, dashed, size) {
    var s = size || 44;
    return L.divIcon({ className: 'mk', html: iconEl(cls, text, dashed), iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -20] });
  }
  function labelMarker(m, label) { m.on('add', function () { var e = m.getElement(); if (e) { e.setAttribute('aria-label', label); e.setAttribute('role', 'button'); } }); }
  function fit(c, pts, maxZoom) { if (c.map && pts.length) c.map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: maxZoom || 16, animate: false }); }
  function flyTo(c, latlng, z) {
    if (!c.map) return;
    var zoom = Math.max(c.map.getZoom(), z || 16);
    if (reduce) c.map.setView(latlng, zoom, { animate: false }); else c.map.flyTo(latlng, zoom, { duration: 0.7 });
  }
  function popupBox(title, rec, lines, extra) {
    var n = el('div', 'popup'); n.appendChild(el('strong', 'popup-t', title));
    if (rec) n.appendChild(recBadges(rec));
    (lines || []).forEach(function (l) { if (l) n.appendChild(el('p', 'small', l)); });
    if (extra) n.appendChild(extra);
    return n;
  }

  // ---- Find map: pandals (clustered), selection ring, entrances of the selected pandal, user position
  var mf = makeMap('find', 'map-find');
  function renderFindMap(doFit) {
    if (!mf.ensure()) return;
    if (!mf.g.pandals) { mf.g.pandals = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, animate: !reduce, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (cl) { return L.divIcon({ className: 'mk', html: iconEl('mk-cluster', String(cl.getChildCount())), iconSize: [44, 44], iconAnchor: [22, 22] }); } }); mf.map.addLayer(mf.g.pandals); mf.g.sel = L.layerGroup().addTo(mf.map); mf.g.user = L.layerGroup().addTo(mf.map); }
    mf.g.pandals.clearLayers(); mf.g.sel.clearLayers(); mf.markers = {};
    var ms = [], pts = [];
    filteredPandals().forEach(function (p) {
      if (!p.hasCoords) return;
      var m = L.marker([p.lat, p.lon], { icon: mkIcon('mk-pandal', '', p.demo || p.status === 'unconfirmed'), title: p.name, alt: p.name, keyboard: true, riseOnHover: true });
      m.on('click', function () { selectPandal(p.id); });
      labelMarker(m, p.name + ' (pandal)' + (p.demo ? ', sample data' : ''));
      mf.markers[p.id] = m; ms.push(m); pts.push([p.lat, p.lon]);
    });
    mf.g.pandals.addLayers(ms);
    drawSelection();
    if (doFit && pts.length && !S.selected) fit(mf, pts, 15);
  }
  function drawSelection() {
    if (!mf.map || !mf.g.sel) return;
    mf.g.sel.clearLayers();
    var p = S.selected && S.data ? byId(S.data.pandals, S.selected) : null;
    if (!p) return;
    if (p.hasCoords) mf.g.sel.addLayer(L.circleMarker([p.lat, p.lon], { radius: 26, color: '#e3c36f', weight: 4, fill: false, interactive: false }));
    p.entrances.forEach(function (e) {
      var m = L.marker([e.lat, e.lon], { icon: mkIcon('mk-entr', 'E', !e.verified, 44), title: e.name + (e.verified ? ' (verified public entrance)' : ' (entrance not verified)'), keyboard: true });
      labelMarker(m, e.name + (e.verified ? ', verified public entrance' : ', entrance not verified'));
      m.bindPopup(function () { return popupBox(e.name, null, [e.verified ? 'Verified public entrance.' : 'Entrance location not verified.', e.description]); });
      mf.g.sel.addLayer(m);
    });
  }

  // ---- Parking map: parking + access points (+ verified walking route line for the selected route)
  var mp = makeMap('parking', 'map-parking');
  function visiblePoints() {
    if (!S.data) return [];
    var t = S.ptype, d = S.data, out = [];
    if (t === 'all' || t === 'parking') out = out.concat(d.parking);
    d.accessPoints.forEach(function (a) {
      if (t === 'all' || t === a.type || (t === 'pedestrian' && /^pedestrian/.test(a.type))) out.push(a);
    });
    return out;
  }
  var POINT_MARK = { parking: 'P', 'drop-off': 'D', 'pick-up': 'U', 'pedestrian-entrance': 'E', 'pedestrian-exit': 'X' };
  function renderParkingMap(doFit) {
    if (!mp.ensure()) return;
    mp.g.main.clearLayers(); mp.markers = {}; mp.lines = 0;
    var pts = [];
    visiblePoints().forEach(function (r) {
      if (!r.hasCoords) return;
      var m = L.marker([r.lat, r.lon], { icon: mkIcon(r.kind === 'parking' ? 'mk-park' : 'mk-acc', POINT_MARK[r.kind === 'parking' ? 'parking' : r.type], r.demo, 44), title: r.name, alt: r.name, keyboard: true });
      m.bindPopup(function () { return popupBox(r.name, r, [pointLabel(r), r.locality, r.landmark], navBlock(plainDir(r), 'Directions', 'btn btn-primary')); }, { maxWidth: 270, maxHeight: 340, autoPanPaddingTopLeft: [16, 60], autoPanPaddingBottomRight: [16, 16] });
      labelMarker(m, r.name + ' (' + pointLabel(r) + ')' + (r.demo ? ', sample data' : ''));
      mp.g.main.addLayer(m); mp.markers[r.id] = m; pts.push([r.lat, r.lon]);
    });
    var route = S.selectedRoute && byId(S.data.walkingRoutes, S.selectedRoute);
    if (route) {
      var pd = byId(S.data.pandals, route.pandalId), ent = pd && route.entranceId ? byId(pd.entrances, route.entranceId) : null;
      var tgt = ent || (pd && pd.hasCoords ? pd : null);
      if (tgt) {
        var m2 = L.marker([tgt.lat, tgt.lon], { icon: mkIcon(ent ? 'mk-entr' : 'mk-pandal', ent ? 'E' : '', ent ? !ent.verified : true, 44), title: ent ? ent.name : pd.name, keyboard: true });
        labelMarker(m2, 'Walking route destination: ' + (ent ? ent.name : pd.name)); mp.g.main.addLayer(m2); pts.push([tgt.lat, tgt.lon]);
      }
      // A route line is drawn ONLY from verified waypoints - never a guessed or straight line.
      if (route.routeVerified && route.waypoints.length >= 2) {
        mp.g.main.addLayer(L.polyline(route.waypoints.map(function (w) { return [w.lat, w.lon]; }), { color: '#8c1c2c', weight: 6, opacity: 0.9 })); mp.lines = 1;
        route.waypoints.forEach(function (w) { pts.push([w.lat, w.lon]); });
      }
    }
    if (doFit && pts.length) fit(mp, pts, 17);
  }

  // ---- Traffic map: restriction points, verified road lines, diversion points
  var mt = makeMap('traffic', 'map-traffic');
  function statesKey() { return S.data ? S.data.restrictions.map(function (r) { return P.evaluateRestriction(r, refMs()).state; }).join(',') : ''; }
  function renderTrafficMap(doFit) {
    if (!mt.ensure()) return;
    mt.g.main.clearLayers(); mt.restr = 0; mt.div = 0; mt.lines = 0; mt.key = statesKey();
    if (!S.data) return;
    var pts = [];
    S.data.restrictions.forEach(function (r) {
      var ev = P.evaluateRestriction(r, refMs());
      if (r.geometry) {
        var line = L.polyline(r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), { color: '#8c1c2c', weight: 5, opacity: 0.85, dashArray: ev.state === 'active' ? null : '8 8' });
        line.bindPopup(function () { return restrPopup(r); }); mt.g.main.addLayer(line); mt.lines++;
      }
      if (!r.hasCoords) return;
      var m = L.marker([r.lat, r.lon], { icon: mkIcon('mk-restr st-' + ev.state, '\u2297', !r.verified, 44), title: r.name + ' – ' + P.shortLabel(ev.state, r.verified), alt: r.name, keyboard: true });
      m.bindPopup(function () { return restrPopup(r); }, { maxWidth: 270, maxHeight: 340, autoPanPaddingTopLeft: [16, 60], autoPanPaddingBottomRight: [16, 16] });
      labelMarker(m, r.name + ' (restriction point, ' + P.shortLabel(ev.state, r.verified) + ')');
      mt.g.main.addLayer(m); mt.restr++; pts.push([r.lat, r.lon]);
    });
    S.data.diversionPoints.forEach(function (d) {
      var m = L.marker([d.lat, d.lon], { icon: mkIcon('mk-div', '\u2192', d.demo, 44), title: d.name, alt: d.name, keyboard: true });
      m.bindPopup(function () { return popupBox(d.name, d, [d.instruction, d.landmark]); }, { maxWidth: 270, maxHeight: 340 });
      labelMarker(m, d.name + ' (diversion point)' + (d.demo ? ', sample data' : '')); mt.g.main.addLayer(m); mt.div++; pts.push([d.lat, d.lon]);
    });
    if (doFit && pts.length) fit(mt, pts, 15);
  }
  function restrPopup(r) {
    var ev = P.evaluateRestriction(r, refMs());
    var box = popupBox(r.name, r, [P.describeSchedule(r), 'Subject to official orders and on-ground changes. Follow traffic police directions.']);
    box.insertBefore(stateBadge(ev.state, r.verified), box.children[2] || null);
    return box;
  }

  // ---- Help map: only what the user asks to see
  var mh = makeMap('help', 'map-help');
  function filteredFacilities() {
    if (!S.data) return [];
    return S.data.facilities.filter(function (f) { return S.ftype === 'all' || f.type === S.ftype; });
  }
  function renderHelpMap(doFit) {
    if (!mh.ensure()) return;
    mh.g.main.clearLayers(); mh.markers = {}; mh.count = 0;
    if (!S.data) return;
    var pts = [];
    filteredFacilities().concat(S.data.facilities.filter(function (f) { return S.helpPins[f.id] && S.ftype !== 'all' && f.type !== S.ftype; })).forEach(function (f) {
      if (!f.hasCoords) return;
      if (!(S.helpShow && (S.ftype === 'all' || f.type === S.ftype)) && !S.helpPins[f.id]) return;
      var m = L.marker([f.lat, f.lon], { icon: mkIcon('mk-fac', FAC_MARK[f.type], f.demo, 44), title: f.name, alt: f.name, keyboard: true });
      m.bindPopup(function () { return popupBox(f.name, f, [FAC_LABEL[f.type], f.landmark, f.hours ? 'Hours: ' + f.hours : 'Hours: not stated'], navBlock(plainDir(f), 'Directions', 'btn btn-primary')); }, { maxWidth: 270, maxHeight: 340, autoPanPaddingTopLeft: [16, 60], autoPanPaddingBottomRight: [16, 16] });
      labelMarker(m, f.name + ' (' + FAC_LABEL[f.type] + ')' + (f.demo ? ', sample data' : ''));
      mh.g.main.addLayer(m); mh.markers[f.id] = m; mh.count++; pts.push([f.lat, f.lon]);
    });
    if (doFit && pts.length) fit(mh, pts, 16);
    $('#help-clear-map').hidden = !(Object.keys(S.helpPins).length);
  }

  function renderMapFor(route, doFit) {
    if (route === 'find') renderFindMap(doFit); else if (route === 'parking') renderParkingMap(doFit);
    else if (route === 'traffic') renderTrafficMap(doFit); else if (route === 'help') renderHelpMap(doFit);
  }

  /* ---------- FIND A PANDAL ---------- */
  function renderFind() {
    var ul = clear($('#pandal-list')), empty = $('#pandal-empty'), rows = filteredPandals().map(function (p) { return { p: p, km: distOf(p) }; });
    if (S.user) rows.sort(function (a, b) { return (a.km == null) - (b.km == null) || (a.km || 0) - (b.km || 0) || a.p.name.localeCompare(b.p.name); });
    else rows.sort(function (a, b) { return a.p.name.localeCompare(b.p.name); });
    rows.forEach(function (r) {
      var p = r.p, li = el('li'), b = attrs(el('button', 'result' + (p.demo ? ' is-demo' : '') + (S.selected === p.id ? ' is-selected' : '')), { type: 'button', 'data-action': 'select', 'data-id': p.id });
      if (S.selected === p.id) b.setAttribute('aria-current', 'true');
      b.appendChild(el('span', 'r-name', p.name));
      var sub = [p.locality, p.landmark].filter(Boolean).join(' · '); if (sub) b.appendChild(el('span', 'r-sub', sub));
      if (p.demo) b.appendChild(add(el('span', 'badges'), badge('demo')));
      if (r.km != null) b.appendChild(el('span', 'r-dist', fmtKm(r.km) + ' away (straight line)'));
      li.appendChild(b); ul.appendChild(li);
    });
    $('#pandal-count').textContent = S.data ? '(' + rows.length + (rows.length !== S.data.pandals.length ? ' of ' + S.data.pandals.length : '') + ')' : '';
    clear(empty);
    if (!S.data) { empty.hidden = false; empty.textContent = dataMsg(); }
    else if (!S.data.pandals.length) { empty.hidden = false; empty.textContent = 'No pandals have been published yet.'; }
    else if (!rows.length) {
      empty.hidden = false;
      add(empty, document.createTextNode('No pandals match your search. Try fewer words or '), attrs(el('button', 'linklike', 'clear the search'), { type: 'button', 'data-action': 'clear-filters' }), document.createTextNode('.'));
    } else empty.hidden = true;
    var f = S.q || S.locality;
    $('#filter-summary').textContent = S.data && f ? 'Showing ' + rows.length + ' of ' + S.data.pandals.length + ' pandals.' : '';
    renderDetail();
  }

  function renderDetail() {
    var box = clear($('#pandal-detail'));
    if (!S.selected) { box.hidden = true; return; }
    box.hidden = false;
    var p = S.data ? byId(S.data.pandals, S.selected) : null;
    if (!p) {
      add(box, el('p', '', S.data ? 'That pandal is not in the current data.' : 'Data unavailable – cannot show this pandal.'), attrs(el('button', 'btn btn-ghost', 'Back to the list'), { type: 'button', 'data-action': 'close-detail' }));
      return;
    }
    var head = el('div', 'card-head');
    add(head, el('h3', '', p.name), attrs(el('button', 'btn btn-ghost btn-sm', 'Close'), { type: 'button', 'data-action': 'close-detail', 'aria-label': 'Close details for ' + p.name }));
    box.appendChild(head); box.appendChild(recBadges(p));
    add(box, fact('Area', p.locality), fact('Landmark', p.landmark), fact('Address', p.address));
    // public entrance, stated carefully
    var ve = P.verifiedEntrance(p);
    if (ve) add(box, fact('Public entrance', 'Verified – ' + ve.name + (ve.description ? '. ' + ve.description : '')));
    else if (p.entrances.length) add(box, fact('Public entrance', 'Not verified. A sample or unconfirmed entrance point is shown on the map.'));
    else add(box, fact('Public entrance', 'Not published.'));
    add(box, fact('Entrance note', p.entrance), fact('Timings', p.timings));
    if (p.approximateLocation) box.appendChild(el('p', 'fact', 'Map location is approximate.'));
    if (p.demo) box.appendChild(el('p', 'sample-note', 'Sample data – not a real pandal.'));
    var dir = P.directionsFor(p);
    box.appendChild(navBlock(dir, 'Directions', 'btn btn-primary'));
    var actions = el('div', 'actions');
    if (p.hasCoords) actions.appendChild(attrs(el('button', 'btn btn-ghost', 'Show on map'), { type: 'button', 'data-action': 'show', 'data-id': p.id }));
    else box.appendChild(el('p', 'muted small', 'Not drawn on the map: no coordinates published.'));
    box.appendChild(actions);
    var rel = (p.restrictionIds || []).map(function (id) { return byId(S.data.restrictions, id); }).filter(Boolean);
    if (rel.length) {
      var rp = el('div', 'fact'); rp.appendChild(el('span', 'fact-l', 'Traffic notices linked to this pandal:'));
      var ul = el('ul', 'plain');
      rel.forEach(function (r) { var ev = P.evaluateRestriction(r, refMs()), x = el('li'); add(x, document.createTextNode(r.name + ' – '), stateBadge(ev.state, r.verified)); ul.appendChild(x); });
      add(rp, ul, el('a', 'textlink', 'See Traffic Updates')); rp.lastChild.setAttribute('href', '#/traffic'); box.appendChild(rp);
    }
    var det = el('details', 'more'); det.appendChild(el('summary', '', 'More details'));
    add(det, p.description ? el('p', '', p.description) : null, fact('Nearest parking', p.nearestParking), fact('Accessibility', p.accessibility), provenance(p));
    if (p.imageUrl) det.appendChild(attrs(el('img', 'thumb'), { src: p.imageUrl, alt: 'Photo of ' + p.name, loading: 'lazy', referrerpolicy: 'no-referrer', width: '320', height: '180' }));
    box.appendChild(det);
  }

  function selectPandal(id) { location.hash = '#/find/' + encodeURIComponent(id); }
  function focusSelectedOnMap() {
    var p = S.selected && S.data ? byId(S.data.pandals, S.selected) : null;
    if (!p || !p.hasCoords || !mf.map) return;
    flyTo(mf, [p.lat, p.lon], 16); drawSelection();
  }

  /* ---------- PARKING & WALKING ---------- */
  function pointCard(r) {
    var li = attrs(el('li', 'card' + (r.demo ? ' is-demo' : '')), { 'data-id': r.id });
    add(li, add(el('div', 'card-head'), el('h4', 'h3like', r.name), recBadges(r)));
    li.appendChild(el('p', 'fact-l', pointLabel(r)));
    var loc = [r.locality, r.landmark, r.address].filter(Boolean).join(' · '); if (loc) li.appendChild(el('p', 'muted', loc));
    add(li, factOr('Hours', r.hours, 'not stated'), fact('Vehicles', (r.vehicleTypes || []).join(', ')), fact('Capacity', r.capacity != null ? String(r.capacity) : ''), fact('Notes', r.notes), provenance(r));
    var actions = el('div', 'actions');
    if (r.hasCoords) actions.appendChild(attrs(el('button', 'btn btn-ghost', 'Show on map'), { type: 'button', 'data-action': 'show-point', 'data-id': r.id, 'aria-label': 'Show ' + r.name + ' on map' }));
    li.appendChild(actions); li.appendChild(navBlock(plainDir(r), 'Directions', 'btn btn-primary'));
    return li;
  }
  function routeCard(rt) {
    var from = byId(S.data.accessPoints, rt.fromId) || byId(S.data.parking, rt.fromId), pd = byId(S.data.pandals, rt.pandalId), ent = pd && rt.entranceId ? byId(pd.entrances, rt.entranceId) : null;
    var li = attrs(el('li', 'card' + (rt.demo ? ' is-demo' : '') + (S.selectedRoute === rt.id ? ' is-selected' : '')), { 'data-id': rt.id });
    add(li, add(el('div', 'card-head'), el('h4', 'h3like', rt.name), recBadges(rt)));
    li.appendChild(fact('From', from ? from.name + ' (' + pointLabel(from) + ')' : ''));
    li.appendChild(fact('To', pd ? pd.name + (ent ? ' – ' + ent.name + (ent.verified ? '' : ' (entrance not verified)') : ' (entrance not specified)') : ''));
    var v = el('p', 'badges');
    v.appendChild(rt.routeVerified ? el('span', 'badge badge-official', '\u2714 Walking route verified') : el('span', 'badge badge-no', '? Walking route not verified'));
    li.appendChild(v);
    if (rt.routeVerified) li.appendChild(el('p', 'fact-l', 'Walking distance about ' + rt.distanceM + ' m · about ' + rt.timeMin + ' min on foot'));
    else li.appendChild(el('p', 'fact', 'Walking distance and time: not available (route not verified).'));
    if (rt.instructions.length) {
      li.appendChild(el('p', 'fact-l', rt.routeVerified ? 'Instructions' : 'Unverified instructions – do not rely on these'));
      var ol = el('ol', 'steps'); rt.instructions.forEach(function (s) { ol.appendChild(el('li', '', s)); }); li.appendChild(ol);
    } else li.appendChild(el('p', 'fact', 'Walking instructions: not published.'));
    li.appendChild(el('p', 'muted small', rt.routeVerified && rt.waypoints.length >= 2 ? 'The route line can be shown on the map.' : (rt.waypoints.length ? 'Route line not drawn: the route is not verified.' : 'No route line published.')));
    var actions = el('div', 'actions');
    actions.appendChild(attrs(el('button', 'btn btn-ghost', S.selectedRoute === rt.id ? 'Hide on map' : 'Show on map'), { type: 'button', 'data-action': 'show-route', 'data-id': rt.id, 'aria-label': (S.selectedRoute === rt.id ? 'Hide ' : 'Show ') + rt.name + ' on map' }));
    li.appendChild(actions);
    if (pd) { li.appendChild(navBlock(P.directionsFor(pd), 'Directions to ' + pd.name, 'btn btn-primary')); li.appendChild(el('p', 'muted small', 'External navigation may not know local Puja restrictions.')); }
    li.appendChild(provenance(rt));
    return li;
  }
  function renderParking() {
    var d = S.data, pl = clear($('#point-list')), rl = clear($('#route-list'));
    var pts = visiblePoints();
    pts.forEach(function (r) { pl.appendChild(pointCard(r)); });
    if (!pts.length) pl.appendChild(el('li', 'empty', d ? 'No points of this kind have been published yet.' : dataMsg()));
    $('#points-count').textContent = d ? '(' + pts.length + ')' : '';
    var rts = d ? d.walkingRoutes : [];
    rts.forEach(function (rt) { rl.appendChild(routeCard(rt)); });
    if (!rts.length) rl.appendChild(el('li', 'empty', d ? 'No walking routes have been published yet.' : dataMsg()));
    $('#routes-count').textContent = d ? '(' + rts.length + ')' : '';
  }

  /* ---------- TRAFFIC ---------- */
  function restrictionCard(r, ev) {
    var li = attrs(el('li', 'card restr-card' + (r.verified ? '' : ' is-sample')), { 'data-id': r.id });
    add(li, add(el('div', 'card-head'), el('h4', 'h3like', r.name), recBadges(r)));
    var line = el('p', 'badges');
    add(line, stateBadge(ev.state, r.verified), el('span', 'badge badge-type', TYPE_LABEL[r.type] || r.type));
    li.appendChild(line);
    li.appendChild(el('p', 'state-detail', P.stateLabel(ev.state, r.verified)));
    if (!r.verified) li.appendChild(el('p', 'sample-note', r.demo ? 'Sample data – not a real order. Do not rely on it.' : 'Unverified – do not rely on it.'));
    var det = '';
    if (ev.state === 'active' && ev.windowEnd) det = 'Current window ends ' + P.fmtDateTime(ev.windowEnd) + '.';
    else if (ev.state === 'upcoming' && ev.windowStart) det = 'Next window: ' + P.fmtDateTime(ev.windowStart) + ' to ' + P.fmtDateTime(ev.windowEnd) + '.';
    else if (ev.state === 'expired' && ev.windowEnd) det = 'Last window ended ' + P.fmtDateTime(ev.windowEnd) + '.';
    if (det) li.appendChild(el('p', 'fact', det));
    add(li, factOr('Road / stretch', r.roadStretch || (r.roads || []).join(', ') || r.locationText, 'not stated'), fact('Where', r.roadStretch ? r.locationText : ''),
      factOr('Direction', r.direction, 'not stated'), factOr('Vehicles affected', (r.vehicleTypes || []).join(', '), 'not stated'),
      fact('Published schedule (IST)', P.describeSchedule(r)));
    if (r.description) li.appendChild(el('p', '', r.description));
    // pedestrian access only when the record is verified
    li.appendChild(fact('Pedestrian access', r.verified ? (r.pedestrianAccess || 'not stated') : 'not verified'));
    add(li, fact('Alternative access', r.verified ? r.alternativeAccess : ''), fact('Authority', r.authority));
    var dps = S.data.diversionPoints.filter(function (d) { return d.restrictionId === r.id; }).sort(function (a, b) { return a.order - b.order; });
    var dv = el('div', 'fact'); dv.appendChild(el('span', 'fact-l', 'Diversion points:'));
    if (dps.length) {
      var ol = el('ol', 'steps');
      dps.forEach(function (d) {
        var x = el('li'); add(x, el('strong', '', d.name), document.createTextNode(': ' + d.instruction + (d.landmark ? ' (' + d.landmark + ')' : '')));
        if (d.demo) x.appendChild(document.createTextNode(' [sample]'));
        ol.appendChild(x);
      });
      dv.appendChild(ol);
    } else dv.appendChild(document.createTextNode(' none published for this notice.'));
    li.appendChild(dv);
    li.appendChild(provenance(r));
    return li;
  }
  var ORDER = { active: 0, upcoming: 1, unconfirmed: 2, cancelled: 3, expired: 4 };
  function renderTraffic() {
    var t = refMs(), rows = (S.data ? S.data.restrictions : []).map(function (r) { return { r: r, ev: P.evaluateRestriction(r, t) }; });
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
    var none = S.data ? '' : dataMsg();
    fill('#rs-active', act, none || 'No verified restriction is scheduled for this time. This does not mean roads are unrestricted – follow police directions.');
    fill('#rs-upcoming', up, none || 'No upcoming verified restrictions in the published data.');
    fill('#rs-other', other, none || 'No sample, unverified, cancelled or ended records.');
    $('#rs-active-n').textContent = S.data ? '(' + act.length + ')' : '';
    $('#rs-upcoming-n').textContent = S.data ? '(' + up.length + ')' : '';
    $('#rs-other-n').textContent = S.data ? '(' + other.length + ')' : '';
    $('#check-summary').textContent = S.data ? (S.checkAt != null ? 'Showing the published schedule for ' + P.fmtDateTime(t) + ' (time you selected).' : 'Showing the published schedule for the current time: ' + P.fmtDateTime(t) + '.') : '';
    var cn = $('#restr-cache-note'), old = S.load.source === 'cache' || S.load.stale;
    cn.hidden = !(old && S.data);
    if (!cn.hidden) cn.textContent = 'These statuses are calculated from saved data that may be outdated or replaced. Do not treat them as current.';
  }

  /* ---------- HELP & FACILITIES ---------- */
  function facilityCard(f) {
    var li = attrs(el('li', 'card' + (f.demo ? ' is-demo' : '')), { 'data-id': f.id });
    add(li, add(el('div', 'card-head'), el('h4', 'h3like', f.name), recBadges(f)));
    li.appendChild(add(el('p', 'badges'), el('span', 'badge badge-type', FAC_LABEL[f.type] || f.type)));
    var loc = [f.landmark, f.address].filter(Boolean).join(' · '); li.appendChild(el('p', 'muted', loc || 'Location text: not stated'));
    li.appendChild(fact('Hours', f.hours || 'not stated'));
    if (isFinite(f.availableFromMs)) li.appendChild(fact('Available (IST)', P.fmtDateTime(f.availableFromMs) + ' to ' + P.fmtDateTime(f.availableToMs)));
    if (f.type === 'hospital') {
      li.appendChild(fact('Emergency department', f.emergencyCapable ? 'confirmed by the source below' : 'not verified – in an emergency dial 112'));
      if (f.phone) { var p = el('p', 'fact'); add(p, el('span', 'fact-l', 'Phone: '), attrs(el('a', 'textlink', f.phone), { href: 'tel:' + f.phone.replace(/[^0-9+]/g, '') })); li.appendChild(p); }
    }
    li.appendChild(provenance(f));
    var actions = el('div', 'actions');
    if (f.hasCoords) actions.appendChild(attrs(el('button', 'btn btn-ghost', S.helpPins[f.id] ? 'Hide from map' : 'Show on map'), { type: 'button', 'data-action': 'show-fac', 'data-id': f.id, 'aria-label': (S.helpPins[f.id] ? 'Hide ' : 'Show ') + f.name + ' on map' }));
    li.appendChild(actions); li.appendChild(navBlock(plainDir(f), 'Directions', 'btn btn-primary'));
    return li;
  }
  function renderHelp() {
    var ul = clear($('#fac-list')), list = filteredFacilities();
    list.forEach(function (f) { ul.appendChild(facilityCard(f)); });
    if (!list.length) ul.appendChild(el('li', 'empty', S.data ? (S.data.facilities.length ? 'No facilities of this kind have been published yet.' : 'No facilities have been published yet. In an emergency dial 112.') : dataMsg()));
    $('#fac-count').textContent = S.data ? '(' + list.length + ')' : '';
    $('#help-map-note').hidden = S.helpShow || Object.keys(S.helpPins).length > 0;
  }

  /* ---------- banners + freshness ---------- */
  function setBanner(id, nodes) {
    var b = $('#' + id); clear(b);
    if (!nodes) { b.hidden = true; return; }
    nodes.forEach(function (n) { b.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
    b.hidden = false;
  }
  function retryBtn() { return attrs(el('button', 'btn btn-ghost btn-sm', 'Retry loading data'), { type: 'button', 'data-action': 'refresh' }); }
  function renderBanners() {
    var d = S.data, L0 = S.load;
    var demoOn = d && d.meta.isDemoDataset;
    $('#bn-demo').hidden = !demoOn;
    if (L0.status === 'unavailable') {
      var why = L0.reason === 'file' ? 'This page was opened as a local file, and browsers block loading data files that way. Please open the app from its web address.'
        : L0.reason === 'invalid' ? 'The data file is damaged or invalid (' + (L0.detail || 'unknown problem') + ').'
        : 'You may be offline, or the data file could not be reached, and there is no saved copy on this device.';
      setBanner('bn-unavailable', [el('strong', '', '\u26A0 Data unavailable. '), 'Pandal and restriction information could not be loaded. ' + why + ' Road status is unknown – check official sources and follow the directions of traffic police. ', retryBtn()]);
    } else setBanner('bn-unavailable', null);
    if (L0.status === 'ok' && (L0.source === 'cache' || L0.stale)) {
      var head = L0.source === 'cache' ? '\u26A0 Offline – showing saved (cached) data that may be outdated. Do not treat it as current. '
        : '\u26A0 Could not refresh – showing the last data received, which may be outdated. Do not treat it as current. ';
      setBanner('bn-offline', [el('strong', '', head), 'Data last updated: ' + P.fmtDateTime(d.meta.lastUpdatedMs) + '. Last successful refresh on this device: ' + (L0.lastRefresh ? P.fmtDateTime(L0.lastRefresh) : 'unknown') + '. ', retryBtn()]);
    } else setBanner('bn-offline', null);
    if (d && d.skipped.length) {
      var det = el('details', 'quality-details'); det.appendChild(el('summary', '', 'Show which records were skipped'));
      var ul = el('ul', 'plain'); d.skipped.forEach(function (s) { ul.appendChild(el('li', '', s.kind + ' "' + s.id + '": ' + s.reasons.join('; '))); }); det.appendChild(ul);
      setBanner('bn-quality', [el('strong', '', '\u26A0 Data-quality warning: '), d.skipped.length + ' record(s) failed validation and are not shown (for example missing source, missing verification details, invalid coordinates or a broken reference). ', det]);
    } else setBanner('bn-quality', null);
    renderFreshness();
  }
  function renderFreshness() {
    var fr = P.freshness(S.load, nowMs());
    $$('[data-fresh]').forEach(function (n) { n.textContent = fr.text; n.className = 'fresh-line lvl-' + fr.level; });
    $$('[data-fresh-sub]').forEach(function (n) { n.textContent = fr.level === 'ok' ? 'Tap Refresh for the latest information.' : ''; });
    var box = clear($('#freshness')), d = S.data;
    if (d) {
      add(box, el('p', '', 'Dataset ' + (d.meta.datasetVersion || '(no version)') + (d.meta.isDemoDataset ? ' (demo – sample data)' : '') + '. Data last updated by the maintainers: ' + P.fmtDateTime(d.meta.lastUpdatedMs) + '.'),
        el('p', '', 'Last successful refresh on this device: ' + (S.load.lastRefresh ? P.fmtDateTime(S.load.lastRefresh) : 'unknown') + '.'),
        el('p', S.load.source === 'cache' || S.load.stale ? 'sample-note' : 'muted small', S.load.source === 'cache' ? 'Showing saved data from this device – it may be outdated.' : S.load.stale ? 'The last refresh failed – the data shown may be outdated.' : 'Data is re-checked when you open the app, when you return to it, and about every 5 minutes while you keep the app on screen.'));
    } else add(box, el('p', '', S.load.status === 'loading' ? 'Loading data…' : 'No data loaded. Nothing here should be treated as current information.'));
    $$('[data-action="refresh"]').forEach(function (b) {
      var busy = !!R.inFlight; b.setAttribute('aria-busy', busy ? 'true' : 'false');
      var lb = b.querySelector('.lbl') || b;
      if (!b.dataset.label) b.dataset.label = lb.textContent;
      lb.textContent = busy ? 'Refreshing…' : b.dataset.label;
    });
  }

  /* ---------- location (only on a tap; never stored or sent) ---------- */
  function requestLocation() {
    var m = $('#geo-msg');
    if (!navigator.geolocation) { m.textContent = 'Location is not supported on this device or browser. You can still search and browse.'; return; }
    m.textContent = 'Asking for your location… (your phone may show a permission prompt)';
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      if (!isFinite(lat) || !isFinite(lon)) { m.textContent = 'Could not read your location.'; return; }
      S.user = { lat: lat, lon: lon };
      m.textContent = P.validCoords(lat, lon) ? 'Sorted by straight-line distance from you. Used on this device only.' : 'You appear to be outside the Siliguri area. Distances are straight-line estimates from where you are.';
      if (mf.map && mf.g.user) { mf.g.user.clearLayers(); mf.g.user.addLayer(L.marker([lat, lon], { icon: mkIcon('mk-me', '', false, 24), keyboard: false, interactive: false, zIndexOffset: -100 })); }
      $('#nearby-clear').hidden = false; renderFind();
    }, function (err) {
      m.textContent = err && err.code === 1 ? 'Location permission was not granted, so nothing was shared. You can still search and browse everything.'
        : err && err.code === 3 ? 'Finding your location took too long. Search by name or area instead.'
        : 'Your location is not available right now. You can still search and browse.';
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
  }
  function forgetLocation() {
    S.user = null; if (mf.g.user) mf.g.user.clearLayers();
    $('#geo-msg').textContent = 'Your location was forgotten.'; $('#nearby-clear').hidden = true; renderFind();
  }

  /* ---------- data loading + refresh ---------- */
  function readLast() { try { var v = +localStorage.getItem(LS_REFRESH); return v > 0 ? v : null; } catch (e) { return null; } }
  function writeLast(v) { try { localStorage.setItem(LS_REFRESH, String(v)); } catch (e) {} }
  function fetchData() {
    if (location.protocol === 'file:') return Promise.resolve({ kind: 'file' });
    var ctl = ('AbortController' in window) ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS) : 0;
    return fetch(DATA_URL + '?cb=' + nowMs(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var fromCache = res.headers.get('X-Data-Source') === 'cache';
        return res.text().then(function (t) { clearTimeout(timer); return { kind: 'ok', text: t, fromCache: fromCache }; });
      })
      .catch(function () { clearTimeout(timer); return { kind: 'network' }; });
  }
  // Records the result. A failed refresh never throws away data we already have.
  function applyResult(r) {
    var had = !!S.data;
    if (r.kind === 'file') { S.data = null; S.raw = ''; S.load = { status: 'unavailable', reason: 'file', lastRefresh: readLast() }; return; }
    if (r.kind === 'network') {
      if (had) { S.load = { status: 'ok', source: S.load.source, stale: true, lastRefresh: S.load.lastRefresh || readLast() }; }
      else { S.load = { status: 'unavailable', reason: 'network', lastRefresh: readLast() }; }
      return;
    }
    var raw, detail = '';
    try { raw = JSON.parse(r.text); } catch (e) { detail = 'not valid JSON'; }
    var v = raw !== undefined ? P.validateDataset(raw) : null;
    if (v && !v.ok) detail = v.fatal;
    if (!v || !v.ok) {
      if (had) S.load = { status: 'ok', source: S.load.source, stale: true, lastRefresh: S.load.lastRefresh || readLast() };
      else { S.data = null; S.raw = ''; S.load = { status: 'unavailable', reason: 'invalid', detail: detail, lastRefresh: readLast() }; }
      return;
    }
    // Only a real network success updates the "last successful refresh" time (never a cached copy).
    var now = nowMs();
    if (!r.fromCache) writeLast(now);
    S.data = v; S.raw = r.text;
    S.load = { status: 'ok', source: r.fromCache ? 'cache' : 'network', stale: false, lastRefresh: r.fromCache ? readLast() : now };
  }
  function refresh(reason) {
    reason = reason || 'manual';
    if (R.inFlight) { R.skipped++; return R.inFlight; }
    var t = nowMs(), min = reason === 'open' ? 0 : reason === 'manual' ? MANUAL_MIN_MS : reason === 'online' ? 5000 : AUTO_MIN_MS;
    if (R.lastAttempt && t - R.lastAttempt < min) { R.skipped++; return Promise.resolve(); }
    R.lastAttempt = t; R.started++;
    R.inFlight = fetchData().then(function (r) { applyResult(r); }).catch(function () {}).then(function () {
      R.inFlight = null; R.completed++;
      var key = [S.load.status, S.load.source, S.load.stale, S.raw].join('|');
      if (key !== S.renderKey) { S.renderKey = key; renderAll(true); } else renderBanners();
    });
    renderFreshness();
    return R.inFlight;
  }

  /* ---------- routing + rendering ---------- */
  function parseHash() {
    var h = location.hash; if (h === '' || h === '#') return { name: 'home', arg: '' }; if (!/^#\//.test(h)) return null;
    var parts = h.slice(2).split('/'), name = parts[0] || 'home';
    if (!TITLES[name]) return { name: 'home', arg: '' };
    var arg = ''; try { arg = parts[1] ? decodeURIComponent(parts[1]) : ''; } catch (e) {}
    return { name: name, arg: /^[A-Za-z0-9._-]*$/.test(arg) ? arg : '' };
  }
  var firstShow = true;
  function show(r) {
    var changed = S.route !== r.name;
    S.route = r.name; S.selected = r.name === 'find' ? r.arg : '';
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== r.name; });
    document.body.dataset.view = r.name;
    var bar = $('#tabbar'); bar.hidden = r.name === 'home'; document.body.classList.toggle('has-tabbar', r.name !== 'home');
    $$('a', bar).forEach(function (a) { var on = a.dataset.tab === r.name; if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = (r.name === 'home' ? '' : TITLES[r.name] + ' – ') + BR.appName;
    if (r.name === 'find') { renderFind(); renderMapFor('find', true); if (S.selected) { focusSelectedOnMap(); } }
    else { renderMapFor(r.name, true); }
    if (r.name === 'traffic') renderTraffic();
    if (!firstShow && changed) { window.scrollTo(0, 0); var h = $('#' + { home: 'home-h', find: 'find-h', parking: 'parking-h', traffic: 'traffic-h', help: 'help-h', info: 'info-h' }[r.name]); if (h) h.focus({ preventScroll: true }); }
    if (r.name === 'info' && r.arg) { var ia = $({ safety: '#info-safety', privacy: '#info-privacy', terms: '#info-terms' }[r.arg] || '#info-h'); if (ia) { ia.setAttribute('tabindex', '-1'); ia.scrollIntoView({ behavior: 'auto', block: 'start' }); ia.focus({ preventScroll: true }); } }
    if (!firstShow && r.name === 'find' && S.selected) { var d = $('#pandal-detail'); if (!d.hidden) d.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' }); }
    firstShow = false;
  }
  function onRoute() {
    var r = parseHash();
    if (!r) { if (S.route) return; r = { name: 'home', arg: '' }; }
    show(r);
  }
  function renderAll(doFit) {
    fillLocalities(); renderFind(); renderParking(); renderTraffic(); renderHelp(); renderBanners();
    if (S.route) renderMapFor(S.route, !!doFit);
    if (S.route === 'find' && S.selected) focusSelectedOnMap();
  }
  function fillLocalities() {
    var sel = $('#locality'), cur = S.locality, seen = {}, list = [];
    if (S.data) S.data.pandals.forEach(function (r) { if (r.locality && !seen[r.locality]) { seen[r.locality] = 1; list.push(r.locality); } });
    list.sort(); while (sel.options.length > 1) sel.remove(1);
    list.forEach(function (l) { var o = el('option', '', l); o.value = l; sel.appendChild(o); });
    sel.value = list.indexOf(cur) >= 0 ? cur : ''; S.locality = sel.value;
  }

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var b = $('#theme-btn'); b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false'); (b.querySelector('.lbl') || b).textContent = t === 'dark' ? 'Day mode' : 'Night mode';
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#24060c' : '#5a0f1e');
  }
  function initTheme() {
    var t = null; try { t = localStorage.getItem(LS_THEME); } catch (e) {}
    if (t !== 'dark' && t !== 'light') t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    applyTheme(t);
  }

  /* ---------- branding (all words come from branding.js) ---------- */
  function applyBranding() {
    var t = function (sel, v) { var n = $(sel); if (n && v) n.textContent = v; };
    t('#tagline', BR.tagline); t('#descriptor', BR.descriptor); t('#festival-dates', BR.festivalDates);
    t('#foot-line', BR.officialBrandingApproved ? BR.footerApproved : BR.footerDemo);
    var ib = BR.institutionalBranding || {}, strip = $('#idstrip');
    if (!strip || !ib.enabled || !ib.logosPresent || !ib.logos || ib.logos.length < 2) return;   // never requests the files otherwise
    var imgs = [$('#logo-a'), $('#logo-b')], ok = 0, bad = false;
    function done() { if (!bad && ok === 2) strip.hidden = false; }
    imgs.forEach(function (im, i) {
      im.alt = ib.logos[i].alt;
      im.addEventListener('load', function () { if (im.naturalWidth > 0) { ok++; done(); } else bad = true; });
      im.addEventListener('error', function () { bad = true; strip.hidden = true; });
      im.src = ib.logos[i].src;
    });
    t('#id-caption', ib.caption);
  }

  /* ---------- events ---------- */
  function bind() {
    $$('[data-disclaimer]').forEach(function (n) { add(n, el('strong', '', 'Before you travel: '), document.createTextNode(DISCLAIMER)); });
    var q = $('#q');
    $('#filters').addEventListener('submit', function (e) { e.preventDefault(); });
    q.addEventListener('input', function () { S.q = q.value; renderFind(); renderFindMap(true); });
    $('#locality').addEventListener('change', function (e) { S.locality = e.target.value; renderFind(); renderFindMap(true); });
    function clearFilters() { S.q = ''; S.locality = ''; q.value = ''; $('#locality').value = ''; renderFind(); renderFindMap(true); }
    $('#clear-filters').addEventListener('click', clearFilters);
    $('#nearby-btn').addEventListener('click', requestLocation);
    $('#nearby-clear').addEventListener('click', forgetLocation);
    $$('input[name="ptype"]').forEach(function (i) { i.addEventListener('change', function () { S.ptype = i.value; renderParking(); renderParkingMap(true); }); });
    $$('input[name="ftype"]').forEach(function (i) { i.addEventListener('change', function () { S.ftype = i.value; renderHelp(); renderHelpMap(true); }); });
    $('#help-show-map').addEventListener('change', function (e) { S.helpShow = e.target.checked; renderHelp(); renderHelpMap(true); });
    $('#help-clear-map').addEventListener('click', function () { S.helpPins = {}; S.helpShow = false; $('#help-show-map').checked = false; renderHelp(); renderHelpMap(false); });
    $('#check-at').addEventListener('change', function (e) { var v = P.fromLocalInputValue(e.target.value); S.checkAt = isFinite(v) ? v : null; renderTraffic(); renderTrafficMap(false); renderDetail(); });
    $('#check-now').addEventListener('click', function () { S.checkAt = null; $('#check-at').value = ''; renderTraffic(); renderTrafficMap(false); renderDetail(); });
    $('#theme-btn').addEventListener('click', function () {
      var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; applyTheme(t); try { localStorage.setItem(LS_THEME, t); } catch (e) {}
    });
    $('#skip').addEventListener('click', function (e) { e.preventDefault(); $('#main').focus(); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-action]') : null; if (!t) return;
      var id = t.getAttribute('data-id'), a = t.getAttribute('data-action');
      if (a === 'clear-filters') clearFilters();
      else if (a === 'refresh') refresh('manual');
      else if (a === 'select') selectPandal(id);
      else if (a === 'close-detail') location.hash = '#/find';
      else if (a === 'show') focusSelectedOnMap();
      else if (a === 'show-point') { var m = mp.markers && mp.markers[id]; if (m) { $('#map-parking').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); flyTo(mp, m.getLatLng(), 17); setTimeout(function () { m.openPopup(); }, reduce ? 0 : 800); } }
      else if (a === 'show-route') { S.selectedRoute = S.selectedRoute === id ? '' : id; renderParking(); renderParkingMap(true); if (S.selectedRoute) $('#map-parking').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); }
      else if (a === 'show-fac') { if (S.helpPins[id]) delete S.helpPins[id]; else S.helpPins[id] = true; renderHelp(); renderHelpMap(false); var fm = mh.markers && mh.markers[id]; if (fm) { $('#map-help').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); flyTo(mh, fm.getLatLng(), 17); setTimeout(function () { fm.openPopup(); }, reduce ? 0 : 800); } }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') Object.keys(maps).forEach(function (k) { if (maps[k].map) maps[k].map.closePopup(); }); });
    window.addEventListener('hashchange', onRoute);
    // freshness: on return to the app, when the network returns, and every ~5 min while visible
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh('foreground'); });
    window.addEventListener('online', function () { refresh('online'); });
    setInterval(function () { if (document.visibilityState === 'visible') refresh('periodic'); }, PERIODIC_MS);
    // 1-minute tick keeps "current time" schedule states and the "x min ago" text honest
    setInterval(function () {
      if (!S.data) return; renderFreshness();
      if (S.checkAt == null) { renderTraffic(); if (S.route === 'traffic' && mt.map && mt.key !== statesKey()) renderTrafficMap(false); }
    }, TICK_MS);
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

  initTheme(); applyBranding(); bind(); registerSW(); S.load.lastRefresh = readLast(); onRoute(); renderAll(false); refresh('open');

  // Read-only helpers for automated tests (they do not change behaviour).
  window.PujaApp = {
    counts: function () {
      return { pandalMarkers: mf.markers ? Object.keys(mf.markers).length : 0, pandalCards: $$('#pandal-list > li').length,
        pointMarkers: mp.markers ? Object.keys(mp.markers).length : 0, pointCards: $$('#point-list > .card').length, routeLines: mp.lines || 0,
        restrictionMarkers: mt.restr || 0, diversionMarkers: mt.div || 0, roadLines: mt.lines || 0, facilityMarkers: mh.count || 0, facilityCards: $$('#fac-list > .card').length };
    },
    info: function () { return { status: S.load.status, source: S.load.source, stale: S.load.stale, user: !!S.user, route: S.route, selected: S.selected }; },
    refresh: function (reason) { return refresh(reason); },
    refreshStats: function () { return { started: R.started, skipped: R.skipped, completed: R.completed, inFlight: !!R.inFlight }; },
    map: function (name) { return maps[name || S.route] ? maps[name || S.route].map : null; }
  };
})();
