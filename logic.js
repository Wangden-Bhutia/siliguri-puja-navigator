/* Siliguri Puja Navigator - pure logic (no DOM). Shared by the app, admin-preview.html,
   tools/validate-data.js and the unit tests. All schedule maths is done in Asia/Kolkata
   (fixed UTC+05:30, no DST) using epoch milliseconds, so the device time zone never matters. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PujaLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IST_MIN = 330, IST_MS = IST_MIN * 60000, DAY_MS = 86400000;
  var BBOX = { latMin: 26.5, latMax: 27.0, lonMin: 88.2, lonMax: 88.7 };
  var STATUSES = ['official', 'admin-verified', 'unconfirmed', 'demo', 'draft'];
  var RTYPES = ['no-entry', 'vehicle-restriction', 'one-way', 'diversion', 'parking-restriction', 'pedestrian-zone', 'other'];
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
  function fmtDate(ms) { var p = istParts(ms); return p.d + ' ' + MONTHS[p.mo - 1] + ' ' + p.y; }
  function fmtTime(ms) { var p = istParts(ms), h12 = p.h % 12 || 12; return h12 + ':' + pad(p.mi) + ' ' + (p.h < 12 ? 'AM' : 'PM'); }
  function fmtDateTime(ms) { return isFinite(ms) ? fmtDate(ms) + ', ' + fmtTime(ms) + ' IST' : 'unknown'; }
  function fmtHM(min) { if (min === 1440) return '12:00 AM (midnight)'; var h = Math.floor(min / 60), h12 = h % 12 || 12; return h12 + ':' + pad(min % 60) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  // epoch ms -> value for <input type="datetime-local"> expressed in IST
  function toLocalInputValue(ms) { var p = istParts(ms); return p.y + '-' + pad(p.mo) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi); }
  function fromLocalInputValue(v) { return typeof v === 'string' && v ? parseIST(v + (v.length === 16 ? ':00' : '') + '+05:30') : NaN; }

  /* ---------- coordinates / links ---------- */
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function validCoords(lat, lon) {
    return isNum(lat) && isNum(lon) && lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
  }
  function mapsDirUrl(rec) {
    var base = 'https://www.google.com/maps/dir/?api=1&destination=';
    if (rec && validCoords(rec.lat, rec.lon)) return base + encodeURIComponent(rec.lat + ',' + rec.lon);
    if (rec && typeof rec.address === 'string' && rec.address.trim()) return base + encodeURIComponent(rec.address.trim());
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

  /* ---------- schedule windows ---------- */
  // Returns sorted [{start,end}] (epoch ms, start inclusive, end exclusive) or null if no schedule / invalid.
  function windowsOf(r) {
    if (r._windows !== undefined) return r._windows;
    var out = null;
    if (r.recurring && typeof r.recurring === 'object') {
      var rc = r.recurring, d0 = parseISTDate(rc.dateStart), d1 = parseISTDate(rc.dateEnd);
      var s = parseHM(rc.dailyStart, false), e = parseHM(rc.dailyEnd, true);
      if (isFinite(d0) && isFinite(d1) && isFinite(s) && isFinite(e) && s !== e && d1 >= d0 && Math.round((d1 - d0) / DAY_MS) + 1 <= MAX_RECURRING_DAYS) {
        out = [];
        var crosses = e < s;
        for (var d = d0; d <= d1; d += DAY_MS) {
          out.push({ start: d + s * 60000, end: d + (crosses ? DAY_MS : 0) + e * 60000 });
        }
      }
    } else if (r.start !== undefined || r.end !== undefined) {
      var a = parseIST(r.start), b = parseIST(r.end);
      if (isFinite(a) && isFinite(b) && b > a) out = [{ start: a, end: b }];
    }
    try { Object.defineProperty(r, '_windows', { value: out, enumerable: false, writable: true }); } catch (e2) {}
    return out;
  }

  // Computes the schedule state of a (validated) restriction at epoch ms `now`.
  // state: 'active' | 'upcoming' | 'expired' | 'cancelled' | 'unconfirmed'
  function evaluateRestriction(r, now) {
    var w = windowsOf(r), timeState = 'unconfirmed', info = {};
    if (w && w.length) {
      var i, next = null;
      for (i = 0; i < w.length; i++) {
        if (w[i].start <= now && now < w[i].end) { timeState = 'active'; info = { windowStart: w[i].start, windowEnd: w[i].end }; next = null; break; }
        if (w[i].start > now && !next) next = w[i];
      }
      if (timeState !== 'active') {
        if (next) { timeState = 'upcoming'; info = { windowStart: next.start, windowEnd: next.end }; }
        else { timeState = 'expired'; info = { windowStart: w[w.length - 1].start, windowEnd: w[w.length - 1].end }; }
      }
    }
    var state = timeState;
    if (r.cancelled === true) state = 'cancelled';
    else if (r.status === 'unconfirmed' || !w) state = 'unconfirmed';
    return { state: state, timeState: timeState, windowStart: info.windowStart, windowEnd: info.windowEnd };
  }

  function isVerified(r) { return !isDemo(r) && (r.status === 'official' || r.status === 'admin-verified'); }
  function isDemo(r) { return r.demo === true || r.status === 'demo'; }

  var STATE_LABEL_VERIFIED = {
    active: 'Scheduled to be in force (per published schedule)',
    upcoming: 'Scheduled - not yet started (per published schedule)',
    expired: 'Schedule has ended (expired)',
    cancelled: 'Cancelled (per published notice)',
    unconfirmed: 'Unconfirmed - awaiting verification'
  };
  var STATE_LABEL_SAMPLE = {
    active: 'Sample/unverified schedule: inside its window at this time',
    upcoming: 'Sample/unverified schedule: not yet started',
    expired: 'Sample/unverified schedule: ended',
    cancelled: 'Sample/unverified record marked cancelled',
    unconfirmed: 'Unconfirmed - awaiting verification'
  };
  function stateLabel(state, verified) { return (verified ? STATE_LABEL_VERIFIED : STATE_LABEL_SAMPLE)[state] || state; }

  function describeSchedule(r) {
    if (r.recurring && typeof r.recurring === 'object') {
      var rc = r.recurring, s = parseHM(rc.dailyStart, false), e = parseHM(rc.dailyEnd, true);
      if (!isFinite(s) || !isFinite(e)) return 'Schedule not available';
      return 'Daily ' + fmtHM(s) + ' to ' + fmtHM(e) + (e < s ? ' (next day)' : '') + ' IST, windows starting ' +
        fmtDate(parseISTDate(rc.dateStart)) + ' to ' + fmtDate(parseISTDate(rc.dateEnd));
    }
    var a = parseIST(r.start), b = parseIST(r.end);
    if (isFinite(a) && isFinite(b)) return fmtDateTime(a) + ' to ' + fmtDateTime(b);
    return 'Schedule not published';
  }

  /* ---------- validation ---------- */
  function str(x, max) { if (typeof x !== 'string') return ''; x = x.trim(); return x.length > (max || 2000) ? x.slice(0, max || 2000) : x; }
  function strList(x) { if (!Array.isArray(x)) return []; var o = []; for (var i = 0; i < x.length && i < 50; i++) { var s = str(x[i], 200); if (s) o.push(s); } return o; }

  function checkCommon(rec, kind, seen, reasons, notices) {
    var out = {};
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { reasons.push('record is not an object'); return null; }
    out.id = str(rec.id, 80);
    if (!out.id || !/^[A-Za-z0-9._-]+$/.test(out.id)) reasons.push('missing or invalid id (letters, digits, . _ - only)');
    else if (seen[out.id]) reasons.push('duplicate id');
    out.name = str(rec.name, 200);
    if (!out.name) reasons.push('missing name');
    var st = str(rec.status, 30);
    if (STATUSES.indexOf(st) < 0) reasons.push('invalid status "' + st + '"');
    out.status = st;
    out.demo = rec.demo === true || st === 'demo';
    if (rec.demo !== undefined && typeof rec.demo !== 'boolean') reasons.push('demo must be true/false');
    // provenance for anything presented as published
    var needs = !out.demo && (st === 'official' || st === 'admin-verified' || (kind === 'restriction' && rec.cancelled === true && st !== 'unconfirmed' && st !== 'draft'));
    out.source = str(rec.source, 500); out.verifiedBy = str(rec.verifiedBy, 200);
    out.verifiedAtMs = parseIST(rec.verifiedAt); out.verifiedAt = typeof rec.verifiedAt === 'string' ? rec.verifiedAt : '';
    if (needs) {
      if (!out.source) reasons.push('published record requires "source"');
      if (!isFinite(out.verifiedAtMs)) reasons.push('published record requires "verifiedAt" as ISO time with +05:30 offset');
      if (!out.verifiedBy) reasons.push('published record requires "verifiedBy" (public role/office)');
    } else if (rec.verifiedAt !== undefined && !isFinite(out.verifiedAtMs)) {
      notices.push('verifiedAt ignored (not an ISO time with +05:30)'); out.verifiedAt = ''; 
    }
    out.sourceUrl = safeHttpUrl(rec.sourceUrl);
    if (rec.sourceUrl && !out.sourceUrl) notices.push('sourceUrl ignored (must be http/https)');
    out.description = str(rec.description, 3000);
    out.locality = str(rec.locality, 200);
    out.address = str(rec.address, 500);
    out.approximateLocation = rec.approximateLocation === true;
    // coordinates: optional, but if one is present both must be valid and inside the Siliguri box
    var hasLat = rec.lat !== undefined && rec.lat !== null, hasLon = rec.lon !== undefined && rec.lon !== null;
    if (hasLat || hasLon) {
      if (!validCoords(rec.lat, rec.lon)) reasons.push('invalid coordinates (need numeric lat 26.5-27.0, lon 88.2-88.7)');
      else { out.lat = rec.lat; out.lon = rec.lon; }
    }
    out.hasCoords = out.lat !== undefined;
    return out;
  }
  function badgeOf(o) { return o.demo ? 'demo' : o.status; }

  function validateDataset(raw) {
    var res = { ok: false, fatal: '', meta: null, pandals: [], parking: [], restrictions: [], skipped: [], notices: [], draftCount: 0 };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { res.fatal = 'Data file is not a JSON object.'; return res; }
    var m = raw.meta;
    if (!m || typeof m !== 'object') { res.fatal = 'Data file has no "meta" section.'; return res; }
    var lu = parseIST(m.lastUpdated);
    if (!isFinite(lu)) { res.fatal = 'meta.lastUpdated is missing or not an ISO time with +05:30.'; return res; }
    if (!Array.isArray(raw.pandals)) { res.fatal = 'Data file has no "pandals" list.'; return res; }
    var f = m.festival && typeof m.festival === 'object' ? m.festival : {};
    res.meta = {
      datasetVersion: str(m.datasetVersion, 60), lastUpdatedMs: lu, lastUpdated: m.lastUpdated,
      isDemoDataset: m.isDemoDataset === true,
      timezone: 'Asia/Kolkata',
      festival: { name: str(f.name, 200), startDate: str(f.startDate, 20), endDate: str(f.endDate, 20), note: str(f.note, 600) },
      notice: str(m.notice, 600)
    };
    if (typeof m.isDemoDataset !== 'boolean') res.notices.push('meta.isDemoDataset should be true or false (treated as false).');
    var seen = {};
    function skip(kind, rec, reasons) { res.skipped.push({ kind: kind, id: rec && typeof rec === 'object' ? str(rec.id, 80) : '', reasons: reasons }); }

    function handle(list, kind, build) {
      if (list === undefined) { res.notices.push('No "' + kind + '" list found; treated as empty.'); return; }
      if (!Array.isArray(list)) { res.notices.push('"' + kind + '" is not a list; ignored.'); return; }
      list.forEach(function (rec) {
        var reasons = [], notices = [], base = checkCommon(rec, kind === 'restrictions' ? 'restriction' : 'other', seen, reasons, notices);
        if (base && base.status === 'draft') { res.draftCount++; return; }
        var out = base && build(rec, base, reasons, notices);
        if (reasons.length || !out) { skip(kind, rec, reasons.length ? reasons : ['invalid record']); return; }
        seen[out.id] = true; out.badge = badgeOf(out); out.verified = isVerified(out);
        notices.forEach(function (n) { res.notices.push(out.id + ': ' + n); });
        res[kind].push(out);
      });
    }

    handle(raw.pandals, 'pandals', function (rec, o, reasons) {
      if (!o.hasCoords && !o.address && !o.locality) reasons.push('needs coordinates, address or locality');
      o.kind = 'pandal';
      o.timings = str(rec.timings, 500); o.entrance = str(rec.entrance, 500); o.nearestParking = str(rec.nearestParking, 500);
      o.accessibility = str(rec.accessibility, 500); o.restrictionIds = strList(rec.restrictionIds);
      var img = str(rec.imageUrl, 500);
      o.imageUrl = /^https:\/\//i.test(img) || /^(?!\w+:|\/\/)[\w./-]+\.(png|jpe?g|webp|gif)$/i.test(img) ? img : '';
      return o;
    });
    handle(raw.parking, 'parking', function (rec, o, reasons) {
      if (!o.hasCoords && !o.address) reasons.push('needs coordinates or address');
      o.kind = 'parking'; o.notes = str(rec.notes, 500); o.capacity = isNum(rec.capacity) && rec.capacity >= 0 ? Math.floor(rec.capacity) : null;
      o.vehicleTypes = strList(rec.vehicleTypes);
      return o;
    });
    handle(raw.restrictions, 'restrictions', function (rec, o, reasons, notices) {
      o.kind = 'restriction';
      var t = str(rec.type, 40); if (RTYPES.indexOf(t) < 0) reasons.push('invalid type "' + t + '"'); o.type = t;
      o.cancelled = rec.cancelled === true;
      o.locationText = str(rec.locationText, 500); o.roads = strList(rec.roads);
      if (!o.locationText && !o.hasCoords) reasons.push('needs locationText or a valid point');
      var hasSingle = rec.start !== undefined || rec.end !== undefined, hasRec = rec.recurring !== undefined;
      if (hasSingle && hasRec) reasons.push('use either start/end or recurring, not both');
      else if (!hasSingle && !hasRec) { if (o.status !== 'unconfirmed') reasons.push('missing schedule (start/end or recurring)'); }
      else if (hasSingle) {
        var a = parseIST(rec.start), b = parseIST(rec.end);
        if (!isFinite(a) || !isFinite(b)) reasons.push('start/end must be ISO times with +05:30 offset');
        else if (b <= a) reasons.push('end must be after start');
        else { o.start = rec.start; o.end = rec.end; }
      } else {
        var rc = rec.recurring;
        if (!rc || typeof rc !== 'object') reasons.push('recurring must be an object');
        else {
          o.recurring = { dateStart: rc.dateStart, dateEnd: rc.dateEnd, dailyStart: rc.dailyStart, dailyEnd: rc.dailyEnd };
          if (!windowsOf(o)) reasons.push('invalid recurring schedule (dates YYYY-MM-DD, times HH:MM, start != end, end date not before start, max ' + MAX_RECURRING_DAYS + ' days)');
        }
      }
      o.vehicleTypes = strList(rec.vehicleTypes); o.pedestrianAccess = str(rec.pedestrianAccess, 500); o.alternativeAccess = str(rec.alternativeAccess, 800);
      o.authority = str(rec.authority, 300); o.adminNotes = '';
      // geometry: only kept when explicitly verified, valid, and the record itself is verified
      o.geometry = null;
      if (rec.geometry !== undefined) {
        var g = rec.geometry, okg = g && g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.length <= 500 &&
          g.coordinates.every(function (c) { return Array.isArray(c) && validCoords(c[1], c[0]); });
        if (rec.geometryVerified === true && okg && isVerified(o)) o.geometry = { type: 'LineString', coordinates: g.coordinates.map(function (c) { return [c[0], c[1]]; }) };
        else notices.push('geometry not drawn (needs geometryVerified:true, valid LineString inside the Siliguri box, and a verified record)');
      }
      return o;
    });
    res.ok = true;
    return res;
  }

  /* ---------- search ---------- */
  // Word-prefix search: every typed word must match the START of some word (letters/digits) in the record.
  function norm(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function matches(q, fields) {
    q = norm(q); if (!q) return true;
    var hay = ' ' + norm(fields.join(' ')) + ' ';
    return q.split(' ').every(function (t) { return hay.indexOf(' ' + t) >= 0; });
  }
  function pandalFields(p) { return [p.name, p.locality, p.address, p.description]; }
  function restrictionFields(r) { return [r.name, r.locationText, r.description].concat(r.roads || []); }
  function parkingFields(p) { return [p.name, p.locality, p.address, p.notes]; }

  return {
    IST_MS: IST_MS, BBOX: BBOX, STATUSES: STATUSES, RTYPES: RTYPES,
    parseIST: parseIST, parseISTDate: parseISTDate, parseHM: parseHM, istParts: istParts,
    fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, fmtHM: fmtHM, toLocalInputValue: toLocalInputValue, fromLocalInputValue: fromLocalInputValue,
    validCoords: validCoords, mapsDirUrl: mapsDirUrl, distanceKm: distanceKm, safeHttpUrl: safeHttpUrl,
    windowsOf: windowsOf, evaluateRestriction: evaluateRestriction, isVerified: isVerified, isDemo: isDemo,
    stateLabel: stateLabel, describeSchedule: describeSchedule,
    validateDataset: validateDataset, matches: matches, pandalFields: pandalFields, restrictionFields: restrictionFields, parkingFields: parkingFields
  };
});
