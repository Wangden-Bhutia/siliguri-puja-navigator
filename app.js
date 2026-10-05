/* Siliguri Puja Guide — visitor UI (schema v2). All dynamic text uses textContent / setAttribute. */
(function () {
  'use strict';
  var P = window.PujaLogic;
  var BR = window.PUJA_BRANDING || { appName: 'Siliguri Puja Guide', institutionalBranding: { enabled: false } };
  var DATA_URL = 'data/puja-data.json';
  var SILIGURI = [26.7271, 88.3953];
  var LS_REFRESH = 'spn.lastRefresh', LS_THEME = 'spn.theme';
  var AUTO_MIN_MS = 30000, MANUAL_MIN_MS = 3000, PERIODIC_MS = 5 * 60000, FETCH_TIMEOUT_MS = 15000;
  var OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  var S = {
    data: null, raw: '', renderKey: '',
    load: { status: 'loading', source: '', stale: false, reason: '', lastRefresh: null },
    q: '', route: 'home', nhoodId: '', pandalId: '', parkingSub: 'parking',
    facType: '', infoPage: '', checkAt: null, pendingNav: null
  };
  var R = { inFlight: null, lastAttempt: 0, started: 0, skipped: 0, completed: 0 };
  var maps = {};
  var deferredInstall = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null && text !== '') e.textContent = text; return e; }
  function attrs(e, a) { Object.keys(a).forEach(function (k) { if (a[k] === null || a[k] === undefined) e.removeAttribute(k); else e.setAttribute(k, a[k]); }); return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function nowMs() { return Date.now(); }
  function refMs() { return S.checkAt != null ? S.checkAt : nowMs(); }
  function byId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- branding / theme ---------- */
  function applyBranding() {
    var name = BR.appName || 'Siliguri Puja Guide';
    $('#brand-name').textContent = name;
    $('#brand-tag').textContent = BR.tagline || '';
    $('#brand-descriptor').textContent = BR.descriptor || '';
    $('#brand-dates').textContent = '';
    add($('#brand-dates'), attrs(el('span', '', '\uD83D\uDCC5'), { 'aria-hidden': 'true' }), document.createTextNode(' ' + (BR.festivalDates || '')));
    $('#foot-line').textContent = BR.officialBrandingApproved ? BR.footerApproved : BR.footerDemo;
    var strip = $('#idstrip'), logos = $('#idstrip-logos'), cap = $('#idstrip-cap');
    var ib = BR.institutionalBranding || {};
    clear(logos);
    if (ib.enabled && ib.logosPresent && ib.logos && ib.logos.length) {
      strip.hidden = false;
      cap.textContent = ib.caption || '';
      (ib.names || []).forEach(function () {});
      ib.logos.forEach(function (L) {
        var img = attrs(el('img'), { src: L.src, alt: L.alt || '', width: '120', height: '40', loading: 'lazy' });
        logos.appendChild(img);
      });
      if (ib.names && ib.names.length) {
        cap.textContent = (ib.caption || '') + ' ' + ib.names.join(' & ');
      }
    } else {
      strip.hidden = true;
    }
  }
  function initTheme() {
    var t = 'light';
    try { t = localStorage.getItem(LS_THEME) || t; } catch (e) {}
    if (t !== 'dark' && t !== 'light') t = 'light';
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
    var btn = $('#theme-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
      btn.title = t === 'dark' ? 'Day mode' : 'Night mode';
      var lbl = $('.theme-lbl', btn); if (lbl) lbl.textContent = t === 'dark' ? 'Day mode' : 'Night mode';
    }
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var next = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(LS_THEME, next); } catch (e) {}
    // Freeze transitions for the swap frame so nothing can interpolate through an intermediate/light colour.
    var root = document.documentElement;
    root.classList.add('theme-switching');
    initTheme();
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove('theme-switching'); }); });
  }

  /* ---------- status badges ---------- */
  function statusBadge(rec) {
    var label = P.statusLabel(rec);
    var cls = 'badge ';
    if (rec.demo) cls += 'badge-demo';
    else if (rec.verificationStatus === 'approved') cls += 'badge-approved';
    else if (rec.verificationStatus === 'fieldVerified') cls += 'badge-field';
    else if (rec.verificationStatus === 'expired') cls += 'badge-expired';
    else if (rec.verificationStatus === 'reference') cls += 'badge-reference';
    else cls += 'badge-pending';
    return el('span', cls, label);
  }
  function pendingNote() {
    return el('p', 'meta', 'Location pending 2026 field verification');
  }

  /* ---------- maps ---------- */
  function ensureMap(id) {
    var node = $('#' + id);
    if (!node) return null;
    if (maps[id] && maps[id].map) {
      setTimeout(function () { maps[id].map.invalidateSize(); }, 50);
      return maps[id];
    }
    var map = L.map(node, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(OSM, { maxZoom: 19, attribution: OSM_ATTR }).addTo(map);
    map.setView(SILIGURI, 12);
    var layer = L.layerGroup().addTo(map);
    maps[id] = { map: map, layer: layer };
    setTimeout(function () { map.invalidateSize(); }, 80);
    return maps[id];
  }
  function clearMap(id) {
    var m = maps[id]; if (!m) return;
    m.layer.clearLayers();
  }
  function divIcon(cls, letter) {
    return L.divIcon({ className: '', html: '<div class="mk ' + cls + '">' + letter + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
  }
  function addMarker(mapId, lat, lon, cls, letter, title) {
    var m = ensureMap(mapId); if (!m || !P.validCoords(lat, lon)) return null;
    var mk = L.marker([lat, lon], { icon: divIcon(cls, letter), title: title || '' });
    m.layer.addLayer(mk);
    return mk;
  }
  function fitLayer(mapId, pad) {
    var m = maps[mapId]; if (!m) return;
    var layers = m.layer.getLayers();
    if (!layers.length) { m.map.setView(SILIGURI, 12); return; }
    var g = L.featureGroup(layers);
    try { m.map.fitBounds(g.getBounds().pad(pad || 0.25), { maxZoom: 15 }); } catch (e) { m.map.setView(SILIGURI, 12); }
  }

  /* ---------- directions via nav-sheet ---------- */
  function openNav(rec, label) {
    var url = P.mapsDirUrl(rec);
    if (!url) return;
    S.pendingNav = { url: url, label: label || 'Open Google Maps' };
    var go = $('#nav-go');
    go.setAttribute('href', url);
    go.textContent = 'Open Google Maps';
    var sheet = $('#nav-sheet');
    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', '');
  }
  function closeSheet(id) {
    var s = $(id); if (!s) return;
    if (s.open && s.close) s.close(); else s.removeAttribute('open');
  }

  /* ---------- SOS ---------- */
  function renderSos() {
    var list = clear($('#sos-list'));
    var help = (S.data && S.data.help) || { emergencyNumber: '112', contacts: [] };
    var em = el('li');
    add(em, add(el('div'), el('div', 'sos-label', '112'), el('div', 'sos-sub', 'Emergency')));
    add(em, attrs(el('a', 'btn btn-call', 'Call'), { href: 'tel:' + (help.emergencyNumber || '112') }));
    list.appendChild(em);

    (help.contacts || []).forEach(function (c) {
      var li = el('li');
      var left = el('div');
      add(left, el('div', 'sos-label', c.name));
      if (c.phone) {
        add(left, el('div', 'sos-sub', c.phone));
        add(li, left, attrs(el('a', 'btn btn-call', 'Call'), { href: 'tel:' + c.phone.replace(/\s+/g, '') }));
      } else {
        add(left, el('div', 'sos-sub', 'Number to be confirmed for 2026'));
        add(li, left);
      }
      list.appendChild(li);
    });

    var pab = el('li');
    add(pab, add(el('div'), el('div', 'sos-label', 'Police Assistance Booths'), el('div', 'sos-sub', 'Find nearby booths')));
    add(pab, attrs(el('a', 'btn', 'Find'), { href: '#/facilities/pab' }));
    list.appendChild(pab);

    var hosp = el('li');
    add(hosp, add(el('div'), el('div', 'sos-label', 'Hospitals'), el('div', 'sos-sub', 'Find hospitals')));
    add(hosp, attrs(el('a', 'btn', 'Find'), { href: '#/facilities/hospital' }));
    list.appendChild(hosp);
  }
  function openSos() {
    renderSos();
    var fab = $('#sos-fab'); fab.setAttribute('aria-expanded', 'true');
    var sheet = $('#sos-sheet');
    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', '');
  }
  function onSosClose() { $('#sos-fab').setAttribute('aria-expanded', 'false'); }

  /* ---------- banners / freshness ---------- */
  function renderBanners() {
    var box = clear($('#status-banners'));
    var d = S.data, L0 = S.load;
    if (L0.status === 'loading') {
      box.appendChild(el('div', 'banner', 'Loading data\u2026'));
      return;
    }
    if (L0.status === 'unavailable') {
      var b = el('div', 'banner banner-err');
      add(b, el('strong', '', 'Data unavailable. '), document.createTextNode(L0.detail || 'Could not load the guide data.'));
      var retry = attrs(el('button', 'btn btn-sm', 'Retry'), { type: 'button' });
      retry.addEventListener('click', function () { refresh('manual'); });
      b.appendChild(retry);
      box.appendChild(b);
      return;
    }
    if (d && d.meta && (d.meta.isDemoDataset || d.meta.containsDemoRecords)) {
      var db = el('div', 'banner banner-demo');
      add(db, el('strong', '', 'Demo / reference data. '), document.createTextNode('Pandal locations are pending 2026 field verification. DEMO parking and traffic cards are samples — not actual 2026 Police orders.'));
      box.appendChild(db);
    }
    if (L0.source === 'cache' || L0.stale) {
      var ob = el('div', 'banner banner-warn');
      add(ob, el('strong', '', 'Data may be outdated. '), document.createTextNode('Showing the last copy saved on this device. '));
      var r2 = attrs(el('button', 'btn btn-sm', 'Refresh'), { type: 'button' });
      r2.addEventListener('click', function () { refresh('manual'); });
      ob.appendChild(r2);
      box.appendChild(ob);
    }
  }
  function renderFreshness() {
    var node = $('#home-fresh');
    if (!node) return;
    var f = P.freshness(S.load, nowMs());
    node.textContent = f.text;
    node.setAttribute('data-level', f.level);
    node.title = f.detail || '';
  }

  /* ---------- cards ---------- */
  function pandalCard(p, opts) {
    opts = opts || {};
    var li = el('li', 'pandal-card');
    li.dataset.id = p.id;
    add(li, el('p', 'pc-name', p.name));
    add(li, el('p', 'pc-loc', p.locality || 'Other areas'));
    var row = el('p', 'badge-row');
    row.appendChild(statusBadge(p));
    if (!p.demo && p.verificationStatus === 'pendingVerification') row.appendChild(el('span', 'sr-only', 'Location pending 2026 field verification'));
    li.appendChild(row);
    var acts = el('div', 'pc-actions');
    if (opts.showView !== false) {
      acts.appendChild(attrs(el('a', 'btn btn-sm', 'View'), { href: '#/p/' + encodeURIComponent(p.id) }));
    }
    if (p.hasCoords) {
      var dir = attrs(el('button', 'btn btn-sm btn-primary', 'Directions'), { type: 'button' });
      dir.addEventListener('click', function () { openNav(p, p.name); });
      acts.appendChild(dir);
    }
    li.appendChild(acts);
    return li;
  }

  /* ---------- HOME ---------- */
  function renderHome() {
    renderFreshness();
  }

  /* ---------- PANDALS (neighbourhood browse + search) ---------- */
  function renderPandals() {
    var q = S.q.trim();
    var nhoodList = $('#nhood-list');
    var searchList = $('#pandal-search-list');
    var sum = $('#filter-summary');
    clear(nhoodList); clear(searchList);
    if (!S.data) {
      sum.textContent = '';
      nhoodList.hidden = false; searchList.hidden = true;
      return;
    }
    if (q) {
      nhoodList.hidden = true; searchList.hidden = false;
      var hits = S.data.pandals.filter(function (p) { return P.matches(q, P.pandalFields(p)); });
      sum.textContent = hits.length + (hits.length === 1 ? ' pandal' : ' pandals') + ' matching \u201c' + q + '\u201d';
      hits.forEach(function (p) { searchList.appendChild(pandalCard(p)); });
      if (!hits.length) searchList.appendChild(el('li', 'empty', 'No pandals match that name.'));
      return;
    }
    nhoodList.hidden = false; searchList.hidden = true;
    var nhoods = S.data.neighbourhoods || [];
    sum.textContent = nhoods.length + ' neighbourhoods · ' + S.data.pandals.length + ' pandals';
    nhoods.forEach(function (n) {
      var a = attrs(el('a', 'nhood-item'), { href: '#/n/' + encodeURIComponent(n.id) });
      add(a, el('div', 'nh-name', n.name), el('div', 'nh-count', n.count + (n.count === 1 ? ' pandal' : ' pandals')));
      var li = el('li'); li.appendChild(a); nhoodList.appendChild(li);
    });
  }

  /* ---------- NEIGHBOURHOOD ---------- */
  function renderNhood() {
    var n = S.data && byId(S.data.neighbourhoods, S.nhoodId);
    $('#nhood-title').textContent = n ? n.name : 'Neighbourhood';
    $('#nhood-count').textContent = n ? (n.count + (n.count === 1 ? ' pandal' : ' pandals')) : '';
    var list = clear($('#nhood-pandal-list'));
    clearMap('map-nhood');
    if (!n || !S.data) return;
    var pandals = n.pandalIds.map(function (id) { return byId(S.data.pandals, id); }).filter(Boolean);
    pandals.forEach(function (p) {
      list.appendChild(pandalCard(p));
      if (p.hasCoords) addMarker('map-nhood', p.lat, p.lon, 'mk-pandal', 'P', p.name);
    });
    fitLayer('map-nhood');
  }

  /* ---------- PANDAL DETAIL ---------- */
  function renderPandal() {
    var p = S.data && byId(S.data.pandals, S.pandalId);
    $('#pandal-title').textContent = p ? p.name : 'Pandal';
    $('#pandal-locality').textContent = p ? (p.locality || '') : '';
    var st = clear($('#pandal-status'));
    if (p) {
      st.appendChild(statusBadge(p));
      if (!p.demo && (p.verificationStatus === 'pendingVerification' || p.verificationStatus === 'reference')) {
        st.appendChild(el('span', 'meta small', ' · Location pending 2026 field verification'));
      }
    }
    var back = $('#pandal-back');
    if (p && p.locality) {
      back.setAttribute('href', '#/n/' + encodeURIComponent(P.slug(p.locality)));
      back.textContent = '\u2190 ' + p.locality;
    } else {
      back.setAttribute('href', '#/pandals');
      back.textContent = '\u2190 Pandals';
    }

    clearMap('map-pandal');
    var acts = clear($('#pandal-actions'));
    if (p && p.hasCoords) {
      addMarker('map-pandal', p.lat, p.lon, 'mk-pandal', 'P', p.name);
      fitLayer('map-pandal', 0.4);
      var dir = attrs(el('button', 'btn btn-primary', 'Directions'), { type: 'button' });
      dir.addEventListener('click', function () { openNav(p, p.name); });
      acts.appendChild(dir);
    } else if (p) {
      acts.appendChild(el('p', 'meta', 'Map location pending 2026 field verification.'));
    }

    // Get there
    var parkBox = clear($('#pandal-parking'));
    if (p && S.data) {
      var parks = P.parkingForPandal(S.data.parking, p.id);
      if (!parks.length) {
        parkBox.appendChild(el('p', 'empty', 'Parking and walking routes pending 2026 field verification.'));
      } else {
        parks.forEach(function (k) {
          var card = el('div', 'info-card');
          add(card, el('h3', '', k.name));
          card.appendChild(statusBadge(k));
          if (k.demo) card.appendChild(el('p', 'meta', 'Sample scenario — not real parking.'));
          var walk = P.walkFor(k, p.id, S.data.walkingRoutes);
          if (walk.distanceM != null) card.appendChild(el('p', '', 'Walking distance: about ' + walk.distanceM + ' m'));
          if (walk.timeMin != null) card.appendChild(el('p', '', 'Walking time: about ' + walk.timeMin + ' min'));
          if (walk.steps && walk.steps.length) {
            var ul = el('ul'); walk.steps.forEach(function (s) { ul.appendChild(el('li', '', s)); });
            card.appendChild(ul);
          }
          if (k.limitations) card.appendChild(el('p', 'meta', k.limitations));
          if (k.hasCoords) {
            var d2 = attrs(el('button', 'btn btn-sm btn-primary', 'Directions to parking'), { type: 'button' });
            d2.addEventListener('click', function () { openNav(k, k.name); });
            card.appendChild(d2);
            addMarker('map-pandal', k.lat, k.lon, 'mk-park', 'P', k.name);
          }
          parkBox.appendChild(card);
        });
        fitLayer('map-pandal');
      }
    }

    // Traffic (visitor feed only; only show if related or say none)
    var tBox = clear($('#pandal-traffic'));
    if (p && S.data) {
      var feed = P.trafficFeed(S.data.traffic, refMs());
      var related = [].concat(feed.active, feed.upcoming).filter(function (x) {
        return (x.r.relatedPandalIds || []).indexOf(p.id) >= 0;
      });
      if (!related.length) {
        tBox.appendChild(el('p', 'empty', 'No published restriction for this area.'));
      } else {
        related.forEach(function (x) { tBox.appendChild(trafficCard(x)); });
      }
    }

    // Nearby help
    var hBox = clear($('#pandal-help'));
    if (S.data) {
      var pabs = S.data.facilities.filter(function (f) { return f.type === 'police-booth'; });
      if (!pabs.length) {
        hBox.appendChild(el('p', 'empty', 'Police Assistance Booth locations pending 2026 field verification.'));
      } else {
        pabs.slice(0, 2).forEach(function (f) {
          var c = el('div', 'info-card');
          add(c, el('h3', '', f.name));
          c.appendChild(statusBadge(f));
          if (f.demo) c.appendChild(el('p', 'meta', 'DEMO sample location.'));
          if (f.hasCoords) {
            var b = attrs(el('button', 'btn btn-sm', 'Directions'), { type: 'button' });
            b.addEventListener('click', function () { openNav(f, f.name); });
            c.appendChild(b);
          }
          hBox.appendChild(c);
        });
      }
    }
  }

  function trafficCard(item) {
    var r = item.r, ev = item.ev;
    var card = el('li', 'info-card');
    card.dataset.id = r.id;
    var place = r.place || r.affectedRoad || r.name;
    add(card, el('h3', '', place));
    card.appendChild(statusBadge(r));
    var typeLabel = P.RTYPE_LABEL[r.restrictionType] || r.restrictionType || 'Restriction';
    card.appendChild(el('p', '', typeLabel));
    var when = P.describeTrafficTime(r, ev);
    if (when) card.appendChild(el('p', 'meta', when));
    if (r.visitorAction) card.appendChild(el('p', '', r.visitorAction));
    if (r.demo) card.appendChild(el('p', 'meta', 'Sample scenario — not an actual 2026 traffic order.'));
    if (r.mapGeometry || r.hasCoords) {
      var btn = attrs(el('button', 'btn btn-sm', 'View map'), { type: 'button' });
      btn.addEventListener('click', function () { showTrafficOnMap(r); });
      card.appendChild(btn);
    }
    return card;
  }

  function showTrafficOnMap(r) {
    var box = $('#map-traffic');
    box.hidden = false;
    clearMap('map-traffic');
    ensureMap('map-traffic');
    if (r.mapGeometry && r.mapGeometry.type === 'Point') {
      var c = r.mapGeometry.coordinates;
      addMarker('map-traffic', c[1], c[0], 'mk-traf', 'T', r.place || r.name);
    } else if (r.mapGeometry && r.mapGeometry.type === 'LineString') {
      var latlngs = r.mapGeometry.coordinates.map(function (c) { return [c[1], c[0]]; });
      var m = maps['map-traffic'];
      var line = L.polyline(latlngs, { color: '#8c1c2c', weight: 4 });
      m.layer.addLayer(line);
    } else if (r.hasCoords) {
      addMarker('map-traffic', r.lat, r.lon, 'mk-traf', 'T', r.place || r.name);
    }
    fitLayer('map-traffic');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- PARKING & TRAFFIC ---------- */
  function setParkingSub(sub) {
    S.parkingSub = sub === 'traffic' ? 'traffic' : 'parking';
    $('#sub-parking').setAttribute('aria-selected', S.parkingSub === 'parking' ? 'true' : 'false');
    $('#sub-traffic').setAttribute('aria-selected', S.parkingSub === 'traffic' ? 'true' : 'false');
    $('#panel-parking').hidden = S.parkingSub !== 'parking';
    $('#panel-traffic').hidden = S.parkingSub !== 'traffic';
    if (S.parkingSub === 'parking') renderParkingPanel();
    else renderTrafficPanel();
  }

  function renderParkingPanel() {
    var list = clear($('#parking-list'));
    var empty = $('#parking-empty');
    clearMap('map-parking');
    if (!S.data || !S.data.parking.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    S.data.parking.forEach(function (k) {
      var card = el('li', 'info-card');
      card.dataset.id = k.id;
      add(card, el('h3', '', k.name));
      card.appendChild(statusBadge(k));
      if (k.demo) card.appendChild(el('p', 'meta', 'Sample scenario — not real parking.'));
      var served = (k.servedPandalIds || []).map(function (id) {
        var p = byId(S.data.pandals, id); return p ? p.name : id;
      });
      if (served.length) card.appendChild(el('p', '', 'Serves: ' + served.join(', ')));
      if (k.walkingDistance != null) card.appendChild(el('p', '', 'Walking distance: about ' + k.walkingDistance + ' m'));
      if (k.walkingTime != null) card.appendChild(el('p', '', 'Walking time: about ' + k.walkingTime + ' min'));
      if (k.walkingRoute && k.walkingRoute.length) {
        var ul = el('ul'); k.walkingRoute.forEach(function (s) { ul.appendChild(el('li', '', s)); });
        card.appendChild(ul);
      }
      if (k.limitations) card.appendChild(el('p', 'meta', k.limitations));
      if (k.hasCoords) {
        addMarker('map-parking', k.lat, k.lon, 'mk-park', 'P', k.name);
        var d = attrs(el('button', 'btn btn-sm btn-primary', 'Directions'), { type: 'button' });
        d.addEventListener('click', function () { openNav(k, k.name); });
        card.appendChild(d);
      }
      list.appendChild(card);
    });
    fitLayer('map-parking');
  }

  function syncTimeInputs() {
    var t = refMs();
    var parts = P.istParts(t);
    var d = $('#t-date'), tm = $('#t-time');
    if (d && !d.value) d.value = parts.y + '-' + pad(parts.mo) + '-' + pad(parts.d);
    if (tm && !tm.value) tm.value = pad(parts.h) + ':' + pad(parts.mi);
  }
  function readCheckAt() {
    var d = $('#t-date'), tm = $('#t-time');
    if (!d || !tm) return nowMs();
    var ms = P.fromDateTimeInputs(d.value, tm.value);
    return isFinite(ms) ? ms : nowMs();
  }
  function renderTrafficPanel() {
    syncTimeInputs();
    S.checkAt = readCheckAt();
    var active = clear($('#traffic-active'));
    var upcoming = clear($('#traffic-upcoming'));
    var ae = $('#traffic-active-empty'), ue = $('#traffic-upcoming-empty');
    if (!S.data) { ae.hidden = false; ue.hidden = false; return; }
    var feed = P.trafficFeed(S.data.traffic, S.checkAt);
    ae.hidden = feed.active.length > 0;
    ue.hidden = feed.upcoming.length > 0;
    feed.active.forEach(function (x) { active.appendChild(trafficCard(x)); });
    feed.upcoming.forEach(function (x) { upcoming.appendChild(trafficCard(x)); });
  }

  /* ---------- FACILITIES ---------- */
  function renderFacilities() {
    var type = S.facType === 'hospital' ? 'hospital' : 'police-booth';
    $('#fac-title').textContent = type === 'hospital' ? 'Hospitals' : 'Police Assistance Booths';
    $('#fac-lede').textContent = type === 'hospital'
      ? 'Hospital locations for emergencies. Confirm details on the ground.'
      : 'Police Assistance Booths. Confirm locations on the ground.';
    var list = clear($('#fac-list'));
    var empty = $('#fac-empty');
    clearMap('map-facilities');
    if (!S.data) { empty.hidden = false; return; }
    var items = S.data.facilities.filter(function (f) { return f.type === type; });
    empty.hidden = items.length > 0;
    items.forEach(function (f) {
      var card = el('li', 'info-card');
      add(card, el('h3', '', f.name));
      card.appendChild(statusBadge(f));
      if (f.demo) card.appendChild(el('p', 'meta', 'DEMO sample location — not a verified 2026 booth/hospital listing.'));
      if (f.landmark) card.appendChild(el('p', 'meta', f.landmark));
      if (f.hasCoords) {
        addMarker('map-facilities', f.lat, f.lon, 'mk-fac', type === 'hospital' ? 'H' : 'Pb', f.name);
        var d = attrs(el('button', 'btn btn-sm btn-primary', 'Directions'), { type: 'button' });
        d.addEventListener('click', function () { openNav(f, f.name); });
        card.appendChild(d);
      }
      list.appendChild(card);
    });
    fitLayer('map-facilities');
  }

  /* ---------- INFO ---------- */
  var INFO = {
    safety: {
      title: 'Safety notice',
      body: [
        'This guide helps visitors find pandals, parking and published traffic information for Durga Puja in Siliguri.',
        'Traffic restrictions can change on the ground. Follow traffic police directions and posted signs.',
        'Google Maps may not reflect temporary Puja traffic restrictions or pedestrian arrangements.',
        'Pandal coordinates in this build are an independent 2026 geographic reference pending field verification. DEMO records are samples only.',
        'In an emergency dial 112.'
      ]
    },
    privacy: {
      title: 'Privacy policy',
      body: [
        'Siliguri Puja Guide does not require an account and does not collect personal profiles.',
        'The app may store a last-refresh timestamp and your day/night preference on this device only.',
        'Map tiles are requested from OpenStreetMap. Directions open in Google Maps only after you confirm.',
        'No precise location is required to browse the guide.'
      ]
    },
    terms: {
      title: 'Terms of use',
      body: [
        'This is a visitor information utility. Until formally authorised it is published as a demo / reference build.',
        'Do not treat unverified or DEMO records as Police-approved operational orders.',
        'Always follow on-ground Police directions. The publishers accept no liability for travel decisions made from this guide.',
        'Data sources and field verification status are maintained for operators; visitor screens show only what is needed to travel safely.'
      ]
    }
  };
  function renderInfo() {
    var page = INFO[S.infoPage] || INFO.safety;
    $('#info-title').textContent = page.title;
    var body = clear($('#info-body'));
    page.body.forEach(function (para) { body.appendChild(el('p', '', para)); });
  }

  /* ---------- routing ---------- */
  function parseHash() {
    var h = location.hash;
    if (!h || h === '#' || h === '#/') return { name: 'home' };
    if (!/^#\//.test(h)) return { name: 'home' };
    var parts = h.slice(2).split('/');
    var a = parts[0] || 'home', b = '', c = '';
    try { b = parts[1] ? decodeURIComponent(parts[1]) : ''; } catch (e) { b = ''; }
    try { c = parts[2] ? decodeURIComponent(parts[2]) : ''; } catch (e2) { c = ''; }
    function safe(s) { return /^[A-Za-z0-9._-]*$/.test(s) ? s : ''; }
    b = safe(b); c = safe(c);
    if (a === 'pandals') return { name: 'pandals' };
    if (a === 'n' && b) return { name: 'nhood', id: b };
    if (a === 'p' && b) return { name: 'pandal', id: b };
    if (a === 'parking' && b === 'traffic') return { name: 'parking', sub: 'traffic' };
    if (a === 'parking' || a === 'traffic') return { name: 'parking', sub: a === 'traffic' ? 'traffic' : 'parking' };
    if (a === 'facilities' && (b === 'pab' || b === 'hospital')) return { name: 'facilities', type: b };
    if (a === 'info' && (b === 'safety' || b === 'privacy' || b === 'terms')) return { name: 'info', page: b };
    if (a === 'home' || a === '') return { name: 'home' };
    return { name: 'home' };
  }

  function showChrome(on) {
    $('#tabbar').hidden = !on;
    $('#sos-fab').hidden = !on;
    document.body.classList.toggle('has-chrome', on);
  }

  function show(r) {
    S.route = r.name;
    S.nhoodId = r.id || '';
    S.pandalId = r.id || '';
    if (r.name === 'nhood') { S.nhoodId = r.id; S.pandalId = ''; }
    if (r.name === 'pandal') { S.pandalId = r.id; S.nhoodId = ''; }
    if (r.name === 'parking') S.parkingSub = r.sub || 'parking';
    if (r.name === 'facilities') S.facType = r.type || 'pab';
    if (r.name === 'info') S.infoPage = r.page || 'safety';

    var viewMap = { home: 'home', pandals: 'pandals', nhood: 'nhood', pandal: 'pandal', parking: 'parking', facilities: 'facilities', info: 'info' };
    var view = viewMap[r.name] || 'home';
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== view; });
    document.body.dataset.view = view;

    var tab = 'home';
    if (view === 'pandals' || view === 'nhood' || view === 'pandal') tab = 'pandals';
    else if (view === 'parking') tab = 'parking';
    $$('#tabbar a').forEach(function (a) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    document.title = (view === 'home' ? '' : ($('#' + ({
      pandals: 'view-pandals', nhood: 'nhood-title', pandal: 'pandal-title', parking: 'view-parking',
      facilities: 'fac-title', info: 'info-title'
    }[view] || '') + ' h1') && '') ) + BR.appName;
    if (view === 'home') document.title = BR.appName;
    else if (view === 'pandals') document.title = 'Pandals – ' + BR.appName;
    else if (view === 'nhood') document.title = (r.id || 'Neighbourhood') + ' – ' + BR.appName;
    else if (view === 'pandal') document.title = 'Pandal – ' + BR.appName;
    else if (view === 'parking') document.title = 'Parking & Traffic – ' + BR.appName;
    else if (view === 'facilities') document.title = 'Help – ' + BR.appName;
    else if (view === 'info') document.title = 'Information – ' + BR.appName;

    closeSheet('#sos-sheet');
    onSosClose();

    if (view === 'home') renderHome();
    if (view === 'pandals') renderPandals();
    if (view === 'nhood') renderNhood();
    if (view === 'pandal') renderPandal();
    if (view === 'parking') setParkingSub(S.parkingSub);
    if (view === 'facilities') renderFacilities();
    if (view === 'info') renderInfo();

    window.scrollTo(0, 0);
  }

  function onRoute() { show(parseHash()); }

  function renderAll() {
    renderBanners();
    renderFreshness();
    renderSos();
    if (S.route === 'home') renderHome();
    else if (S.route === 'pandals') renderPandals();
    else if (S.route === 'nhood') renderNhood();
    else if (S.route === 'pandal') renderPandal();
    else if (S.route === 'parking') setParkingSub(S.parkingSub);
    else if (S.route === 'facilities') renderFacilities();
    else if (S.route === 'info') renderInfo();
  }

  /* ---------- data load ---------- */
  function readLast() { try { var v = +localStorage.getItem(LS_REFRESH); return v > 0 ? v : null; } catch (e) { return null; } }
  function writeLast(v) { try { localStorage.setItem(LS_REFRESH, String(v)); } catch (e) {} }
  function fetchData() {
    if (location.protocol === 'file:') return Promise.resolve({ kind: 'file' });
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS) : 0;
    return fetch(DATA_URL + '?cb=' + nowMs(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var fromCache = res.headers.get('X-Data-Source') === 'cache';
        return res.text().then(function (t) { clearTimeout(timer); return { kind: 'ok', text: t, fromCache: fromCache }; });
      })
      .catch(function () { clearTimeout(timer); return { kind: 'network' }; });
  }
  function applyResult(r) {
    var had = !!S.data;
    if (r.kind === 'file') { S.data = null; S.raw = ''; S.load = { status: 'unavailable', reason: 'file', lastRefresh: readLast() }; return; }
    if (r.kind === 'network') {
      if (had) S.load = { status: 'ok', source: S.load.source, stale: true, lastRefresh: S.load.lastRefresh || readLast() };
      else S.load = { status: 'unavailable', reason: 'network', lastRefresh: readLast() };
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
      showChrome(true);
      var key = [S.load.status, S.load.source, S.load.stale, S.raw].join('|');
      if (key !== S.renderKey) { S.renderKey = key; renderAll(); } else { renderBanners(); renderFreshness(); }
    });
    renderFreshness();
    return R.inFlight;
  }

  /* ---------- bind ---------- */
  function bind() {
    window.addEventListener('hashchange', onRoute);
    $('#theme-btn').addEventListener('click', toggleTheme);
    $('#sos-fab').addEventListener('click', function () {
      var sheet = $('#sos-sheet');
      if (sheet.open) { closeSheet('#sos-sheet'); onSosClose(); }
      else openSos();
    });
    $('#sos-sheet').addEventListener('close', onSosClose);
    ['#sos-sheet', '#nav-sheet'].forEach(function (id) {
      $(id).addEventListener('click', function (e) { if (e.target === e.currentTarget) closeSheet(id); });
    });
    $('#nav-go').addEventListener('click', function () { closeSheet('#nav-sheet'); });

    var q = $('#q');
    if (q) {
      q.addEventListener('input', function () { S.q = q.value; renderPandals(); });
      q.addEventListener('search', function () { S.q = q.value; renderPandals(); });
    }
    $('#sub-parking').addEventListener('click', function () {
      if (location.hash !== '#/parking') location.hash = '#/parking';
      else setParkingSub('parking');
    });
    $('#sub-traffic').addEventListener('click', function () {
      if (location.hash !== '#/parking/traffic') location.hash = '#/parking/traffic';
      else setParkingSub('traffic');
    });
    $('#t-now').addEventListener('click', function () {
      S.checkAt = nowMs();
      var parts = P.istParts(S.checkAt);
      $('#t-date').value = parts.y + '-' + pad(parts.mo) + '-' + pad(parts.d);
      $('#t-time').value = pad(parts.h) + ':' + pad(parts.mi);
      renderTrafficPanel();
    });
    ['t-date', 't-time'].forEach(function (id) {
      var n = $('#' + id); if (n) n.addEventListener('change', function () { renderTrafficPanel(); });
    });

    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh('foreground'); });
    window.addEventListener('online', function () { refresh('online'); });
    setInterval(function () { if (document.visibilityState === 'visible') refresh('periodic'); }, PERIODIC_MS);

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferredInstall = e;
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('service-worker.js', { scope: './' }).then(function (reg) { reg.update(); }).catch(function () {});
  }

  /* ---------- test hooks ---------- */
  window.PujaApp = {
    counts: function () {
      var d = S.data;
      if (!d) return { pandals: 0, neighbourhoods: 0, parking: 0, traffic: 0, trafficVisitor: 0, facilities: 0 };
      var vis = (d.traffic || []).filter(P.isVisitorTraffic).length;
      return {
        pandals: d.pandals.length,
        neighbourhoods: d.neighbourhoods.length,
        parking: d.parking.length,
        walkingRoutes: d.walkingRoutes.length,
        traffic: d.traffic.length,
        trafficVisitor: vis,
        facilities: d.facilities.length
      };
    },
    info: function () {
      return {
        route: S.route, nhoodId: S.nhoodId, pandalId: S.pandalId, parkingSub: S.parkingSub,
        q: S.q, load: S.load, checkAt: S.checkAt,
        meta: S.data ? S.data.meta : null
      };
    },
    refresh: function (reason) { return refresh(reason); },
    refreshStats: function () { return { started: R.started, skipped: R.skipped, completed: R.completed, inFlight: !!R.inFlight }; },
    map: function (id) { return maps[id] || null; },
    openNav: openNav,
    state: function () { return S; }
  };

  initTheme(); applyBranding(); bind(); registerSW();
  S.load.lastRefresh = readLast();
  onRoute();
  renderBanners();
  refresh('open');
})();
