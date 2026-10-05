/* Siliguri Puja Guide - pure logic (no DOM). Shared by the app, admin-preview.html,
   tools/validate-data.js and the unit tests. All schedule maths is done in Asia/Kolkata
   (fixed UTC+05:30, no DST) using epoch milliseconds, so the device time zone never matters.

   Data model (schemaVersion 2):  pandals · neighbourhoods (derived from pandal locality) · parking (parking/drop points,
   one point -> many pandals) · walkingRoutes (parking -> pandal) · traffic · facilities (police booths, hospitals) · help.
   Validation never silently discards data: every problem is reported in `errors` / `warnings`; only records that
   cannot be identified at all (no id / duplicate id / no name) or whose references are broken are left out, and those
   are listed in `skipped`. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PujaLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IST_MIN = 330, IST_MS = IST_MIN * 60000, DAY_MS = 86400000;
  var BBOX = { latMin: 26.5, latMax: 27.0, lonMin: 88.2, lonMax: 88.7 };
  // Section 23 data-status values. Only "approved" (and, for locations, "fieldVerified") ever count as checked.
  var VSTATUSES = ['reference', 'pendingVerification', 'fieldVerified', 'approved', 'expired'];
  var TSTATUSES = ['scheduled', 'cancelled', 'expired'];
  var RTYPES = ['noEntry', 'controlledMovement', 'diversion', 'routeRelocation', 'oneWay', 'vehicleClassRestriction'];
  var RTYPE_LABEL = { noEntry: 'No entry', controlledMovement: 'Controlled movement', diversion: 'Diversion', routeRelocation: 'Route relocation', oneWay: 'One-way', vehicleClassRestriction: 'Vehicle restriction' };
  var PARKING_TYPES = ['parking', 'drop', 'parking-drop'];
  var FACILITY_TYPES = ['police-booth', 'hospital', 'first-aid', 'toilet', 'drinking-water'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MAX_RECURRING_DAYS = 366;

  /* ---------- time helpers (all IST) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // "2026-10-18T22:00:00+05:30" (seconds optional) -> epoch ms, or NaN. Only +05:30 is accepted.
  function parseIST(s) {
    if (typeof s !== 'string') return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+05:30$/.exec(s);
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], sec = m[6] ? +m[6] : 0;
    var u = Date.UTC(y, mo - 1, d, h, mi, sec), c = new Date(u);
    if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d || h > 23 || mi > 59 || sec > 59) return NaN;
    return u - IST_MS;
  }
  // "YYYY-MM-DD" -> epoch ms of 00:00 IST that day, or NaN
  function parseISTDate(s) {
    if (typeof s !== 'string') return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3], u = Date.UTC(y, mo - 1, d), c = new Date(u);
    if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return NaN;
    return u - IST_MS;
  }
  // "HH:MM" -> minutes since midnight (end may be "24:00"), or NaN
  function parseHM(s, allow24) {
    if (typeof s !== 'string') return NaN;
    var m = /^(\d{2}):(\d{2})$/.exec(s);
    if (!m) return NaN;
    var h = +m[1], mi = +m[2];
    if (mi > 59) return NaN;
    if (h === 24 && mi === 0 && allow24) return 1440;
    if (h > 23) return NaN;
    return h * 60 + mi;
  }
  function istParts(ms) {
    var d = new Date(ms + IST_MS);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
  }
  function dayStart(ms) { var p = istParts(ms); return Date.UTC(p.y, p.mo - 1, p.d) - IST_MS; }
  function fmtDate(ms) { var p = istParts(ms); return p.d + ' ' + MONTHS[p.mo - 1] + ' ' + p.y; }
  function fmtTime(ms) { var p = istParts(ms), h12 = p.h % 12 || 12; return h12 + ':' + pad(p.mi) + ' ' + (p.h < 12 ? 'AM' : 'PM'); }
  function fmtDateTime(ms) { return isFinite(ms) ? fmtDate(ms) + ', ' + fmtTime(ms) + ' IST' : 'unknown'; }
  // compact clock: "6 PM", "1:30 AM", "12 AM"
  function fmtClock(ms) { var p = istParts(ms), h12 = p.h % 12 || 12; return h12 + (p.mi ? ':' + pad(p.mi) : '') + ' ' + (p.h < 12 ? 'AM' : 'PM'); }
  function fmtTimeRange(a, b) { return fmtClock(a) + '\u2013' + fmtClock(b); }
  // "16–21 Oct" / "31 Oct–2 Nov" / "18 Oct"
  function fmtDayRange(a, b) {
    var x = istParts(a), y = istParts(b);
    if (x.y === y.y && x.mo === y.mo && x.d === y.d) return x.d + ' ' + MONTHS[x.mo - 1];
    if (x.y === y.y && x.mo === y.mo) return x.d + '\u2013' + y.d + ' ' + MONTHS[x.mo - 1];
    return x.d + ' ' + MONTHS[x.mo - 1] + '\u2013' + y.d + ' ' + MONTHS[y.mo - 1];
  }
  function toLocalInputValue(ms) { var p = istParts(ms); return p.y + '-' + pad(p.mo) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi); }
  function fromLocalInputValue(v) { return typeof v === 'string' && v ? parseIST(v + (v.length === 16 ? ':00' : '') + '+05:30') : NaN; }
  function fromDateTimeInputs(d, t) { return (typeof d === 'string' && d) ? fromLocalInputValue(d + 'T' + (t || '00:00')) : NaN; }
  function fmtShort(ms, now) {
    if (!isFinite(ms)) return 'unknown';
    var a = istParts(ms), b = istParts(isFinite(now) ? now : ms);
    return (a.y === b.y && a.mo === b.mo && a.d === b.d) ? fmtTime(ms) + ' IST' : fmtDateTime(ms);
  }
  function fmtAge(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' h ' + (m % 60) + ' min ago';
    var d = Math.floor(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  var OLD_AFTER_MS = 30 * 60000;
  // Compact freshness line (section 33): "Updated 8 min ago" or "Data may be outdated". Never claims the data is current.
  // load = {status:'loading'|'ok'|'unavailable', source:'network'|'cache', stale:bool, lastRefresh:ms|null}
  function freshness(load, now) {
    if (!load || load.status === 'loading') return { level: 'loading', text: 'Loading data\u2026', detail: '' };
    var detail = load.lastRefresh ? 'Last successful update on this device: ' + fmtShort(load.lastRefresh, now) : 'No successful update recorded on this device';
    if (load.status === 'unavailable') return { level: 'none', text: 'Data unavailable', detail: detail };
    if (load.source === 'cache' || load.stale || !(load.lastRefresh > 0)) return { level: 'stale', text: 'Data may be outdated', detail: detail };
    var age = now - load.lastRefresh;
    if (age > OLD_AFTER_MS) return { level: 'old', text: 'Updated ' + fmtAge(age) + ' \u00B7 may be outdated', detail: detail };
    return { level: 'ok', text: 'Updated ' + fmtAge(age), detail: detail };
  }

  /* ---------- coordinates / links ---------- */
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validCoords(lat, lon) {
    return isNum(lat) && isNum(lon) && lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
  }
  function decimals(x) { var s = String(x); var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function mapsDirUrl(rec) {
    var base = 'https://www.google.com/maps/dir/?api=1&destination=';
    if (rec && validCoords(rec.lat, rec.lon)) return base + encodeURIComponent(rec.lat + ',' + rec.lon);
    return null;
  }
  function distanceKm(lat1, lon1, lat2, lon2) {
    var R = 6371, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function safeHttpUrl(u) {
    if (typeof u !== 'string') return '';
    try { var x = new URL(u.trim()); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch (e) { return ''; }
  }
  // visitor-friendly area slug: "Mahananda Para" -> "mahananda-para"
  function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other'; }

  /* ---------- statuses ---------- */
  function isCheckedLocation(v) { return v === 'fieldVerified' || v === 'approved'; }
  // Short visitor label for a record's data status. Never says "verified" for unchecked data.
  function statusLabel(rec) {
    if (rec.demo) return 'DEMO';
    switch (rec.verificationStatus) {
      case 'approved': return 'Approved';
      case 'fieldVerified': return 'Field-checked 2026';
      case 'pendingVerification': return 'Pending 2026 verification';
      case 'reference': return 'Reference only';
      case 'expired': return 'Expired';
    }
    return 'Unverified';
  }

  /* ---------- traffic schedule ---------- */
  // Windows of a traffic record: [{start,end}] (start inclusive, end exclusive), or null when no usable schedule.
  // plannedStart/plannedEnd (+05:30). With dailyStart/dailyEnd ("HH:MM") the record repeats every day whose date lies
  // between the plannedStart date and the plannedEnd date (a window may cross midnight). actualStart moves the first
  // start; actualEnd ends the record early.
  function windowsOf(r) {
    if (r._windows !== undefined) return r._windows;
    var out = null, a = parseIST(r.actualStart || r.plannedStart), b = parseIST(r.plannedEnd), ae = parseIST(r.actualEnd);
    if (r.dailyStart !== undefined || r.dailyEnd !== undefined) {
      var d0 = parseIST(r.plannedStart), d1 = parseIST(r.plannedEnd), s = parseHM(r.dailyStart, false), e = parseHM(r.dailyEnd, true);
      if (isFinite(d0) && isFinite(d1) && isFinite(s) && isFinite(e) && s !== e && d1 >= d0) {
        var first = dayStart(d0), last = dayStart(d1);
        if (Math.round((last - first) / DAY_MS) + 1 <= MAX_RECURRING_DAYS) {
          out = [];
          for (var d = first; d <= last; d += DAY_MS) out.push({ start: d + s * 60000, end: d + (e < s ? DAY_MS : 0) + e * 60000 });
          var as = parseIST(r.actualStart);
          if (isFinite(as)) out = out.filter(function (w) { return w.end > as; }).map(function (w) { return { start: Math.max(w.start, as), end: w.end }; });
        }
      }
    } else if (isFinite(a) && isFinite(b) && b > a) out = [{ start: a, end: b }];
    if (out && isFinite(ae)) out = out.filter(function (w) { return w.start < ae; }).map(function (w) { return { start: w.start, end: Math.min(w.end, ae) }; });
    try { Object.defineProperty(r, '_windows', { value: out, enumerable: false, writable: true }); } catch (e2) {}
    return out;
  }
  // state: 'active' | 'upcoming' | 'ended' | 'cancelled' | 'unscheduled'
  function evaluateTraffic(r, now) {
    if (r.status === 'cancelled') return { state: 'cancelled' };
    if (r.status === 'expired' || r.verificationStatus === 'expired' || r.verificationStatus === 'reference') return { state: 'ended' };
    var w = windowsOf(r);
    if (!w || !w.length) return { state: 'unscheduled' };
    var next = null;
    for (var i = 0; i < w.length; i++) {
      if (w[i].start <= now && now < w[i].end) return { state: 'active', windowStart: w[i].start, windowEnd: w[i].end, first: w[0].start, last: w[w.length - 1].end };
      if (w[i].start > now && !next) next = w[i];
    }
    if (next) return { state: 'upcoming', windowStart: next.start, windowEnd: next.end, first: w[0].start, last: w[w.length - 1].end };
    return { state: 'ended', windowStart: w[w.length - 1].start, windowEnd: w[w.length - 1].end };
  }
  // Records a visitor may ever see in the traffic feed: Police-approved 2026 records, or DEMO samples (always labelled).
  // Reference / historical (2025 baseline), pending, cancelled and expired records stay in the data for audit only.
  function isVisitorTraffic(r) {
    if (r.status !== 'scheduled') return false;
    if (r.demo) return true;
    return r.verificationStatus === 'approved';
  }
  function trafficFeed(list, now) {
    var active = [], upcoming = [];
    (list || []).forEach(function (r) {
      if (!isVisitorTraffic(r)) return;
      var ev = evaluateTraffic(r, now);
      if (ev.state === 'active') active.push({ r: r, ev: ev });
      else if (ev.state === 'upcoming') upcoming.push({ r: r, ev: ev });
    });
    var by = function (x, y) { return x.ev.windowStart - y.ev.windowStart; };
    active.sort(by); upcoming.sort(by);
    return { active: active, upcoming: upcoming };
  }
  // "6 PM–1 AM · 16–21 Oct" (daily) or "18 Oct, 6 PM–19 Oct, 2 AM" (single)
  function describeTrafficTime(r, ev) {
    var w = windowsOf(r); if (!w || !w.length) return '';
    if (r.dailyStart !== undefined) return fmtTimeRange(w[0].start, w[0].end) + ' daily \u00B7 ' + fmtDayRange(w[0].start, w[w.length - 1].start);
    var a = w[0].start, b = w[0].end;
    if (dayStart(a) === dayStart(b) || (b - a <= DAY_MS && istParts(b).h < 6)) return fmtDayRange(a, a) + ', ' + fmtTimeRange(a, b);
    return fmtDayRange(a, a) + ', ' + fmtClock(a) + ' \u2013 ' + fmtDayRange(b, b) + ', ' + fmtClock(b);
  }

  /* ---------- walking ---------- */
  // Walk from a parking/drop point to one pandal: a specific walkingRoute record wins, else the point's own defaults.
  function walkFor(parking, pandalId, routes) {
    var r = null;
    (routes || []).forEach(function (w) { if (!r && w.parkingId === parking.id && w.pandalId === pandalId) r = w; });
    var src = r || parking;
    return {
      route: r, distanceM: isNum(src.walkingDistance) ? src.walkingDistance : null, timeMin: isNum(src.walkingTime) ? src.walkingTime : null,
      steps: src.walkingRoute || [], geometry: r && r.routeGeometry && isCheckedLocation(r.verificationStatus) && !r.demo ? r.routeGeometry : null,
      demo: !!(parking.demo || (r && r.demo))
    };
  }
  function parkingForPandal(parking, pandalId) { return (parking || []).filter(function (k) { return k.servedPandalIds.indexOf(pandalId) >= 0; }); }

  /* ---------- neighbourhoods ---------- */
  function groupNeighbourhoods(pandals) {
    var map = {}, list = [];
    (pandals || []).forEach(function (p) {
      var name = p.locality || 'Other areas', id = slug(name);
      if (!map[id]) { map[id] = { id: id, name: name, pandalIds: [] }; list.push(map[id]); }
      map[id].pandalIds.push(p.id);
    });
    list.forEach(function (n) { n.count = n.pandalIds.length; });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list;
  }

  /* ---------- validation ---------- */
  function str(x, max) { if (typeof x !== 'string') return ''; x = x.trim(); return x.length > (max || 2000) ? x.slice(0, max || 2000) : x; }
  function strList(x, max) { if (!Array.isArray(x)) return []; var o = []; for (var i = 0; i < x.length && i < (max || 50); i++) { var s = str(x[i], 300); if (s) o.push(s); } return o; }
  function steps(x) { if (Array.isArray(x)) return strList(x, 30); var s = str(x, 1000); return s ? [s] : []; }
  function normName(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function geomOk(g) {
    if (!g || typeof g !== 'object') return false;
    if (g.type === 'Point') return Array.isArray(g.coordinates) && validCoords(g.coordinates[1], g.coordinates[0]);
    if (g.type === 'LineString') return Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.length <= 500 && g.coordinates.every(function (c) { return Array.isArray(c) && validCoords(c[1], c[0]); });
    return false;
  }

  function validateDataset(raw) {
    var res = { ok: false, fatal: '', meta: null, pandals: [], neighbourhoods: [], parking: [], walkingRoutes: [], traffic: [], facilities: [],
      help: { emergencyNumber: '112', contacts: [] }, errors: [], warnings: [], skipped: [] };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { res.fatal = 'Data file is not a JSON object.'; return res; }
    var m = raw.meta;
    if (!m || typeof m !== 'object') { res.fatal = 'Data file has no "meta" section.'; return res; }
    var lu = parseIST(m.lastUpdated);
    if (!isFinite(lu)) { res.fatal = 'meta.lastUpdated is missing or not an ISO time with +05:30.'; return res; }
    if (!Array.isArray(raw.pandals)) { res.fatal = 'Data file has no "pandals" list.'; return res; }
    var f = m.festival && typeof m.festival === 'object' ? m.festival : {};
    res.meta = { schemaVersion: m.schemaVersion, datasetVersion: str(m.datasetVersion, 60), lastUpdatedMs: lu, lastUpdated: m.lastUpdated,
      isDemoDataset: m.isDemoDataset === true, containsDemoRecords: m.containsDemoRecords === true, timezone: 'Asia/Kolkata',
      festival: { name: str(f.name, 200), startDate: str(f.startDate, 20), endDate: str(f.endDate, 20) } };
    var ids = {};
    function err(kind, id, msg) { res.errors.push({ kind: kind, id: id || '', message: msg }); }
    function warn(kind, id, msg) { res.warnings.push({ kind: kind, id: id || '', message: msg }); }
    function skip(kind, id, why) { res.skipped.push({ kind: kind, id: id || '', reasons: why }); why.forEach(function (w) { err(kind, id, w + ' (record not shown)'); }); }
    // identity + common fields; returns null (skipped) only when the record cannot be identified
    function base(rec, kind) {
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { skip(kind, '', ['record is not an object']); return null; }
      var o = { id: str(rec.id, 80), name: str(rec.name, 200) }, why = [];
      if (!o.id || !/^[A-Za-z0-9._-]+$/.test(o.id)) why.push('missing or invalid id (letters, digits, . _ - only)');
      else if (ids[o.id]) why.push('duplicate id');
      if (!o.name) why.push('missing name');
      if (why.length) { skip(kind, o.id, why); return null; }
      ids[o.id] = true;
      o.demo = rec.demo === true;
      if (rec.demo !== undefined && typeof rec.demo !== 'boolean') err(kind, o.id, 'demo must be true/false');
      var vs = str(rec.verificationStatus, 30);
      if (VSTATUSES.indexOf(vs) < 0) { err(kind, o.id, 'invalid verificationStatus "' + vs + '" (use ' + VSTATUSES.join(', ') + '); treated as pendingVerification'); vs = 'pendingVerification'; }
      if (o.demo && (vs === 'approved' || vs === 'fieldVerified')) { err(kind, o.id, 'a DEMO record cannot be ' + vs + '; treated as pendingVerification'); vs = 'pendingVerification'; }
      o.verificationStatus = vs;
      if ((vs === 'approved' || vs === 'fieldVerified') && !str(rec.verifiedBy, 200)) err(kind, o.id, vs + ' record should name verifiedBy');
      o.source = str(rec.source, 300); o.sourceType = str(rec.sourceType, 200); o.sourceUrl = safeHttpUrl(rec.sourceUrl);
      o.verifiedBy = str(rec.verifiedBy, 200); o.lastVerified = str(rec.lastVerified, 40); o.lastUpdated = str(rec.lastUpdated, 40);
      // coordinates: latitude/longitude (lat/lon accepted for older files)
      var la = rec.latitude !== undefined ? rec.latitude : rec.lat, lo = rec.longitude !== undefined ? rec.longitude : rec.lon;
      o.coordProblem = '';
      if ((la === undefined || la === null || la === '') && (lo === undefined || lo === null || lo === '')) o.coordProblem = 'missing coordinates';
      else if (!validCoords(la, lo)) o.coordProblem = 'invalid coordinates ' + JSON.stringify([la, lo]) + ' (need numeric latitude 26.5\u201327.0, longitude 88.2\u201388.7)';
      else { o.lat = la; o.lon = lo; }
      o.hasCoords = o.lat !== undefined;
      return o;
    }

    // ---- pandals: kept even with missing coordinates / neighbourhood (listed, not mapped) so nothing disappears silently
    var byName = {}, byCoord = {};
    raw.pandals.forEach(function (rec) {
      var o = base(rec, 'pandal'); if (!o) return;
      o.kind = 'pandal';
      if (o.coordProblem) err('pandal', o.id, o.coordProblem + ' \u2013 listed without map location or directions');
      o.locality = str(rec.locality, 120);
      if (!o.locality) err('pandal', o.id, 'missing neighbourhood/locality \u2013 listed under "Other areas"');
      o.police2024Name = str(rec.police2024Name, 200);
      var nk = normName(o.name);
      if (byName[nk]) warn('pandal', o.id, 'duplicate pandal name (same as ' + byName[nk] + ')'); else byName[nk] = o.id;
      if (o.hasCoords) {
        var ck = o.lat + ',' + o.lon;
        if (byCoord[ck]) warn('pandal', o.id, 'duplicate coordinates (same as ' + byCoord[ck] + ')'); else byCoord[ck] = o.id;
        if (Math.min(decimals(o.lat), decimals(o.lon)) < 4) warn('pandal', o.id, 'low-precision coordinates (' + o.lat + ', ' + o.lon + '): fewer than 4 decimals, about \u00B1100 m');
      }
      res.pandals.push(o);
    });
    // near-duplicates (< 25 m apart) are worth a field check
    for (var i = 0; i < res.pandals.length; i++) for (var j = i + 1; j < res.pandals.length; j++) {
      var a = res.pandals[i], b = res.pandals[j];
      if (a.hasCoords && b.hasCoords && !(a.lat === b.lat && a.lon === b.lon) && distanceKm(a.lat, a.lon, b.lat, b.lon) < 0.025) warn('pandal', b.id, 'within 25 m of ' + a.id + ' \u2013 check both locations');
    }
    var pById = {}; res.pandals.forEach(function (p) { pById[p.id] = p; });
    res.neighbourhoods = groupNeighbourhoods(res.pandals);

    // ---- optional stored neighbourhood list must agree with pandal localities
    if (raw.neighbourhoods !== undefined) {
      if (!Array.isArray(raw.neighbourhoods)) err('neighbourhood', '', '"neighbourhoods" is not a list');
      else {
        var seenN = {}, listed = {};
        raw.neighbourhoods.forEach(function (n) {
          var id = str(n && n.id, 80), name = str(n && n.name, 120);
          if (!id || !name) { err('neighbourhood', id, 'needs id and name'); return; }
          if (seenN[id]) err('neighbourhood', id, 'duplicate neighbourhood id'); seenN[id] = true;
          strList(n.pandalIds, 500).forEach(function (pid) {
            var p = pById[pid];
            if (!p) err('neighbourhood', id, 'pandalId "' + pid + '" does not exist');
            else if (p.locality !== name) err('neighbourhood', id, 'pandal ' + pid + ' has locality "' + p.locality + '", not "' + name + '"');
            if (listed[pid]) err('neighbourhood', id, 'pandal ' + pid + ' is listed in more than one neighbourhood'); listed[pid] = true;
          });
        });
        res.pandals.forEach(function (p) { if (!listed[p.id]) warn('neighbourhood', '', 'pandal ' + p.id + ' is not listed in any stored neighbourhood (derived from its locality instead)'); });
      }
    }

    // ---- parking / drop points (one point may serve many pandals)
    var kById = {};
    (Array.isArray(raw.parking) ? raw.parking : []).forEach(function (rec) {
      var o = base(rec, 'parking'); if (!o) return;
      o.kind = 'parking';
      if (o.coordProblem) { skip('parking', o.id, [o.coordProblem]); return; }
      o.type = str(rec.type, 20) || 'parking';
      if (PARKING_TYPES.indexOf(o.type) < 0) { err('parking', o.id, 'invalid type "' + o.type + '" (use ' + PARKING_TYPES.join(', ') + ')'); o.type = 'parking'; }
      var served = strList(rec.servedPandalIds, 100), okIds = [];
      if (!served.length) err('parking', o.id, 'missing servedPandalIds (which pandals does this point serve?)');
      served.forEach(function (pid) { if (pById[pid]) okIds.push(pid); else err('parking', o.id, 'servedPandalIds refers to nonexistent pandal "' + pid + '"'); });
      if (!okIds.length) { skip('parking', o.id, ['serves no existing pandal']); return; }
      o.servedPandalIds = okIds;
      o.walkingDistance = isNum(rec.walkingDistance) && rec.walkingDistance > 0 && rec.walkingDistance <= 20000 ? Math.round(rec.walkingDistance) : null;
      o.walkingTime = isNum(rec.walkingTime) && rec.walkingTime > 0 && rec.walkingTime <= 240 ? Math.round(rec.walkingTime) : null;
      if (rec.walkingDistance !== undefined && rec.walkingDistance !== null && o.walkingDistance === null) err('parking', o.id, 'walkingDistance must be metres (1\u201320000)');
      if (rec.walkingTime !== undefined && rec.walkingTime !== null && o.walkingTime === null) err('parking', o.id, 'walkingTime must be minutes (1\u2013240)');
      o.walkingRoute = steps(rec.walkingRoute); o.limitations = str(rec.limitations, 500); o.landmark = str(rec.landmark, 200);
      res.parking.push(o); kById[o.id] = o;
    });

    // ---- walking routes (parking -> pandal)
    (Array.isArray(raw.walkingRoutes) ? raw.walkingRoutes : []).forEach(function (rec) {
      if (rec && typeof rec === 'object' && !rec.name) rec = Object.assign({ name: 'Walk ' + rec.parkingId + ' \u2192 ' + rec.pandalId }, rec);
      var o = base(rec, 'walkingRoute'); if (!o) return;
      o.kind = 'walkingRoute'; o.parkingId = str(rec.parkingId, 80); o.pandalId = str(rec.pandalId, 80);
      var why = [];
      if (!kById[o.parkingId]) why.push('parkingId "' + o.parkingId + '" does not exist');
      if (!pById[o.pandalId]) why.push('pandalId "' + o.pandalId + '" does not exist');
      if (why.length) { skip('walkingRoute', o.id, why); return; }
      if (kById[o.parkingId].servedPandalIds.indexOf(o.pandalId) < 0) err('walkingRoute', o.id, 'pandal ' + o.pandalId + ' is not in servedPandalIds of ' + o.parkingId);
      o.walkingDistance = isNum(rec.walkingDistance) && rec.walkingDistance > 0 && rec.walkingDistance <= 20000 ? Math.round(rec.walkingDistance) : null;
      o.walkingTime = isNum(rec.walkingTime) && rec.walkingTime > 0 && rec.walkingTime <= 240 ? Math.round(rec.walkingTime) : null;
      o.walkingRoute = steps(rec.walkingRoute);
      o.routeGeometry = null;
      if (rec.routeGeometry !== undefined && rec.routeGeometry !== null) {
        var g = rec.routeGeometry;
        if (Array.isArray(g) && g.length >= 2 && g.every(function (c) { return Array.isArray(c) && validCoords(c[0], c[1]); })) o.routeGeometry = g.map(function (c) { return [c[0], c[1]]; });
        else err('walkingRoute', o.id, 'routeGeometry must be a list of [latitude, longitude] pairs inside the Siliguri area');
      }
      var k = kById[o.parkingId], p = pById[o.pandalId];
      if (o.walkingDistance && p.hasCoords && o.walkingDistance < 0.9 * 1000 * distanceKm(k.lat, k.lon, p.lat, p.lon)) err('walkingRoute', o.id, 'walkingDistance is shorter than the straight line between parking and pandal');
      res.walkingRoutes.push(o);
    });

    // ---- traffic
    (Array.isArray(raw.traffic) ? raw.traffic : []).forEach(function (rec) {
      if (rec && typeof rec === 'object' && !rec.name) rec = Object.assign({ name: rec.affectedRoad || rec.id }, rec);
      var o = base(rec, 'traffic'); if (!o) return;
      o.kind = 'traffic';
      ['origin', 'destination', 'affectedRoad', 'affectedSegment', 'diversionRoute', 'visitorAction', 'place', 'orderDate', 'dateContext'].forEach(function (k) { o[k] = str(rec[k], 500); });
      o.vehicleTypes = strList(rec.vehicleTypes);
      o.restrictionType = str(rec.restrictionType, 40);
      if (RTYPES.indexOf(o.restrictionType) < 0) err('traffic', o.id, 'invalid restrictionType "' + o.restrictionType + '" (use ' + RTYPES.join(', ') + ')');
      o.status = str(rec.status, 20);
      if (TSTATUSES.indexOf(o.status) < 0) { err('traffic', o.id, 'invalid status "' + o.status + '" (use ' + TSTATUSES.join(', ') + '); treated as expired'); o.status = 'expired'; }
      ['plannedStart', 'plannedEnd', 'actualStart', 'actualEnd'].forEach(function (k) {
        if (rec[k] === undefined || rec[k] === null || rec[k] === '') return;
        if (isFinite(parseIST(rec[k]))) o[k] = rec[k]; else err('traffic', o.id, k + ' must be an ISO time with +05:30');
      });
      if (rec.dailyStart !== undefined || rec.dailyEnd !== undefined) { o.dailyStart = rec.dailyStart; o.dailyEnd = rec.dailyEnd; }
      if (o.status === 'scheduled' && !windowsOf(o)) err('traffic', o.id, 'scheduled record needs a valid plannedStart/plannedEnd (and dailyStart/dailyEnd "HH:MM" if daily)');
      if (o.status === 'scheduled' && !o.demo && o.verificationStatus === 'approved' && !o.source) err('traffic', o.id, 'approved record needs a source');
      if (o.status === 'scheduled' && !o.visitorAction) err('traffic', o.id, 'missing visitorAction (what should a visitor do?)');
      o.mapGeometry = null;
      if (rec.mapGeometry !== undefined && rec.mapGeometry !== null) { if (geomOk(rec.mapGeometry)) o.mapGeometry = rec.mapGeometry; else err('traffic', o.id, 'invalid mapGeometry (GeoJSON Point or LineString, [longitude, latitude], inside Siliguri)'); }
      o.approximateLocation = rec.approximateLocation === true;
      o.relatedPandalIds = strList(rec.relatedPandalIds).filter(function (pid) { if (pById[pid]) return true; err('traffic', o.id, 'relatedPandalIds refers to nonexistent pandal "' + pid + '"'); return false; });
      if (o.demo && o.status === 'scheduled' && !/^DEMO/.test(o.name)) err('traffic', o.id, 'DEMO traffic record names must start with "DEMO"');
      res.traffic.push(o);
    });

    // ---- facilities (police assistance booths, hospitals)
    (Array.isArray(raw.facilities) ? raw.facilities : []).forEach(function (rec) {
      var o = base(rec, 'facility'); if (!o) return;
      o.kind = 'facility'; o.type = str(rec.type, 40);
      if (FACILITY_TYPES.indexOf(o.type) < 0) { skip('facility', o.id, ['invalid type "' + o.type + '"']); return; }
      if (o.coordProblem) { skip('facility', o.id, [o.coordProblem]); return; }
      o.landmark = str(rec.landmark, 200); o.hours = str(rec.hours, 200);
      res.facilities.push(o);
    });

    // ---- help: emergency number + control rooms. A phone number is shown only when approved for 2026.
    var h = raw.help && typeof raw.help === 'object' ? raw.help : {};
    res.help.emergencyNumber = '112';
    if (h.emergencyNumber !== undefined && h.emergencyNumber !== '112') err('help', 'emergencyNumber', 'emergency number must be 112');
    (Array.isArray(h.contacts) ? h.contacts : []).forEach(function (c) {
      var id = str(c && c.id, 80), name = str(c && c.name, 120), phone = str(c && c.phone, 30), vs = str(c && c.verificationStatus, 30);
      if (!id || !name) { err('help', id, 'contact needs id and name'); return; }
      if (VSTATUSES.indexOf(vs) < 0) err('help', id, 'invalid verificationStatus "' + vs + '"');
      var shown = '';
      if (phone) {
        if (vs === 'approved' && /^[0-9+][0-9 ()-]{2,19}$/.test(phone) && str(c.verifiedBy, 200)) shown = phone;
        else warn('help', id, 'phone not shown: only an approved 2026 number with verifiedBy is published');
      }
      res.help.contacts.push({ id: id, name: name, phone: shown, verificationStatus: vs });
    });
    res.ok = true;
    return res;
  }

  /* ---------- search ---------- */
  function norm(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  // Word-prefix search: every typed word must match the START of some word in the record.
  function matches(q, fields) {
    q = norm(q); if (!q) return true;
    var hay = ' ' + norm(fields.join(' ')) + ' ';
    return q.split(' ').every(function (t) { return hay.indexOf(' ' + t) >= 0; });
  }
  function pandalFields(p) { return [p.name, p.locality, p.police2024Name]; }

  return {
    IST_MS: IST_MS, BBOX: BBOX, VSTATUSES: VSTATUSES, TSTATUSES: TSTATUSES, RTYPES: RTYPES, RTYPE_LABEL: RTYPE_LABEL, PARKING_TYPES: PARKING_TYPES, FACILITY_TYPES: FACILITY_TYPES,
    parseIST: parseIST, parseISTDate: parseISTDate, parseHM: parseHM, istParts: istParts, dayStart: dayStart,
    fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, fmtClock: fmtClock, fmtTimeRange: fmtTimeRange, fmtDayRange: fmtDayRange,
    fmtShort: fmtShort, fmtAge: fmtAge, freshness: freshness,
    toLocalInputValue: toLocalInputValue, fromLocalInputValue: fromLocalInputValue, fromDateTimeInputs: fromDateTimeInputs,
    validCoords: validCoords, mapsDirUrl: mapsDirUrl, distanceKm: distanceKm, safeHttpUrl: safeHttpUrl, slug: slug,
    isCheckedLocation: isCheckedLocation, statusLabel: statusLabel,
    windowsOf: windowsOf, evaluateTraffic: evaluateTraffic, isVisitorTraffic: isVisitorTraffic, trafficFeed: trafficFeed, describeTrafficTime: describeTrafficTime,
    walkFor: walkFor, parkingForPandal: parkingForPandal, groupNeighbourhoods: groupNeighbourhoods,
    validateDataset: validateDataset, matches: matches, pandalFields: pandalFields
  };
});
