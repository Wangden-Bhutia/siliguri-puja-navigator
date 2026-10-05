/* Unit tests for logic.js (pure functions) + copy lint.  Run: node tests/unit.js   (try with TZ=America/Los_Angeles too) */
const L = require('../logic.js');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name + (info !== undefined ? ' | ' + JSON.stringify(info) : '')); } }
const ms = (s) => L.parseIST(s);
const st = (r, s) => L.evaluateRestriction(r, ms(s)).state;
function mk(extra) { return Object.assign({ id: 'r1', name: 'R', type: 'no-entry', locationText: 'x', status: 'admin-verified', source: 'Notice 12', verifiedAt: '2026-10-04T10:00:00+05:30', verifiedBy: 'Admin office' }, extra); }
function ds(rest, extra) { return Object.assign({ meta: { datasetVersion: 'v', lastUpdated: '2026-10-04T10:00:00+05:30', isDemoDataset: false, festival: { name: 'F' } }, pandals: [], parking: [], restrictions: rest || [] }, extra || {}); }
function val(rest) { const v = L.validateDataset(ds(rest)); return v; }

// --- time parsing
t('parse ok', ms('2026-10-18T23:30:00+05:30') === Date.UTC(2026, 9, 18, 18, 0, 0));
t('parse no seconds', ms('2026-10-18T23:30+05:30') === ms('2026-10-18T23:30:00+05:30'));
['2026-10-18T23:30:00', '2026-10-18T23:30:00Z', '2026-10-18T23:30:00+05:00', '2026-02-30T10:00:00+05:30', '2026-13-01T10:00:00+05:30', '2026-10-18T24:00:00+05:30', 'x', null, 5].forEach(s => t('parse rejects ' + s, isNaN(ms(s))));
t('IST format', L.fmtDateTime(ms('2026-10-18T00:05:00+05:30')) === '18 Oct 2026, 12:05 AM IST' && L.fmtDateTime(ms('2026-10-18T12:00:00+05:30')) === '18 Oct 2026, 12:00 PM IST');
t('local input roundtrip', L.toLocalInputValue(ms('2026-10-18T23:30:00+05:30')) === '2026-10-18T23:30' && L.fromLocalInputValue('2026-10-18T23:30') === ms('2026-10-18T23:30:00+05:30'));
t('UTC instant maps to next IST day', L.toLocalInputValue(Date.UTC(2026, 9, 18, 19, 0, 0)) === '2026-10-19T00:30');

// --- single window (start inclusive, end exclusive)
const single = mk({ start: '2026-10-18T18:00:00+05:30', end: '2026-10-20T23:59:00+05:30' });
t('single: 1 min before start = upcoming', st(single, '2026-10-18T17:59:00+05:30') === 'upcoming');
t('single: at start = active', st(single, '2026-10-18T18:00:00+05:30') === 'active');
t('single: middle day 03:00 = active (multi-day span)', st(single, '2026-10-19T03:00:00+05:30') === 'active');
t('single: last minute = active', st(single, '2026-10-20T23:58:00+05:30') === 'active');
t('single: at end = expired (end exclusive)', st(single, '2026-10-20T23:59:00+05:30') === 'expired');
t('single: UTC-equivalent instant is IST-consistent', L.evaluateRestriction(single, Date.UTC(2026, 9, 18, 12, 30)).state === 'active');   // 12:30 UTC = 18:00 IST exactly
t('single: 1ms before start in UTC terms', L.evaluateRestriction(single, ms('2026-10-18T18:00:00+05:30') - 1).state === 'upcoming');
const ev = L.evaluateRestriction(single, ms('2026-10-19T03:00:00+05:30'));
t('single: windowEnd reported', ev.windowEnd === ms('2026-10-20T23:59:00+05:30'));

// --- recurring, crossing midnight 22:00-05:00, dates 17..21 (date = day the window STARTS)
const night = mk({ recurring: { dateStart: '2026-10-17', dateEnd: '2026-10-21', dailyStart: '22:00', dailyEnd: '05:00' } });
t('night: before range', st(night, '2026-10-16T23:00:00+05:30') === 'upcoming');
t('night: 17th 21:59 not yet', st(night, '2026-10-17T21:59:00+05:30') === 'upcoming');
t('night: 17th 22:00 active', st(night, '2026-10-17T22:00:00+05:30') === 'active');
t('night: 17th 23:59 active', st(night, '2026-10-17T23:59:00+05:30') === 'active');
t('night: 18th 00:00 active (crossed midnight)', st(night, '2026-10-18T00:00:00+05:30') === 'active');
t('night: 18th 04:59 active', st(night, '2026-10-18T04:59:00+05:30') === 'active');
t('night: 18th 05:00 inactive (end exclusive)', st(night, '2026-10-18T05:00:00+05:30') === 'upcoming');
t('night: 17th 03:00 inactive (window of the 16th does not exist)', st(night, '2026-10-17T03:00:00+05:30') === 'upcoming');
t('night: 18th 12:00 between windows = upcoming', st(night, '2026-10-18T12:00:00+05:30') === 'upcoming');
t('night: 22nd 04:59 active (tail of 21st window)', st(night, '2026-10-22T04:59:00+05:30') === 'active');
t('night: 22nd 05:00 expired', st(night, '2026-10-22T05:00:00+05:30') === 'expired');
t('night: next window start reported', L.evaluateRestriction(night, ms('2026-10-18T12:00:00+05:30')).windowStart === ms('2026-10-18T22:00:00+05:30'));

// --- recurring same-day + 24:00 end
const day = mk({ recurring: { dateStart: '2026-10-17', dateEnd: '2026-10-21', dailyStart: '16:00', dailyEnd: '22:00' } });
t('day: 15:59 / 16:00 / 21:59 / 22:00', st(day, '2026-10-18T15:59:00+05:30') === 'upcoming' && st(day, '2026-10-18T16:00:00+05:30') === 'active' && st(day, '2026-10-18T21:59:00+05:30') === 'active' && st(day, '2026-10-18T22:00:00+05:30') === 'upcoming');
t('day: after last day expired', st(day, '2026-10-21T22:00:00+05:30') === 'expired');
const full = mk({ recurring: { dateStart: '2026-10-17', dateEnd: '2026-10-17', dailyStart: '00:00', dailyEnd: '24:00' } });
t('24:00 end: all day', st(full, '2026-10-17T00:00:00+05:30') === 'active' && st(full, '2026-10-17T23:59:00+05:30') === 'active' && st(full, '2026-10-18T00:00:00+05:30') === 'expired');

// --- overrides
t('cancelled overrides time', st(mk({ cancelled: true, start: single.start, end: single.end }), '2026-10-19T03:00:00+05:30') === 'cancelled');
t('unconfirmed overrides time', st(mk({ status: 'unconfirmed', start: single.start, end: single.end }), '2026-10-19T03:00:00+05:30') === 'unconfirmed');
t('unconfirmed without schedule', L.evaluateRestriction(mk({ status: 'unconfirmed' }), 0).state === 'unconfirmed');
t('expired', st(mk({ start: '2026-10-12T00:00:00+05:30', end: '2026-10-13T12:00:00+05:30' }), '2026-10-14T00:00:00+05:30') === 'expired');

// --- labels
t('label wording', L.stateLabel('active', true) === 'Scheduled to be in force (per published schedule)');
t('sample label never claims published', !/per published schedule/.test(L.stateLabel('active', false)));

// --- validation
let v = val([mk({ start: single.start, end: single.end })]);
t('valid record accepted', v.restrictions.length === 1 && v.skipped.length === 0 && v.restrictions[0].verified === true, v.skipped);
v = val([mk({ source: '', start: single.start, end: single.end })]); t('missing source rejected', v.restrictions.length === 0 && v.skipped.length === 1 && /source/.test(v.skipped[0].reasons.join()));
v = val([mk({ verifiedAt: undefined, start: single.start, end: single.end })]); t('missing verifiedAt rejected', v.skipped.length === 1);
v = val([mk({ verifiedAt: '2026-10-04T10:00:00', start: single.start, end: single.end })]); t('verifiedAt without +05:30 rejected', v.skipped.length === 1);
v = val([mk({ verifiedBy: ' ', start: single.start, end: single.end })]); t('missing verifiedBy rejected', v.skipped.length === 1);
v = val([mk({ status: 'official', source: '', start: single.start, end: single.end })]); t('official needs source', v.skipped.length === 1);
v = val([mk({ status: 'unconfirmed', source: '', verifiedBy: '', verifiedAt: undefined, start: single.start, end: single.end })]); t('unconfirmed needs no provenance', v.restrictions.length === 1);
v = val([mk({ cancelled: true, source: '', start: single.start, end: single.end })]); t('cancelled verified needs source', v.skipped.length === 1);
v = val([mk({ status: 'draft', source: '' })]); t('draft hidden and not a warning', v.restrictions.length === 0 && v.skipped.length === 0 && v.draftCount === 1);
v = val([mk({ status: 'bogus', start: single.start, end: single.end })]); t('bad status rejected', v.skipped.length === 1);
v = val([mk({ type: 'bogus', start: single.start, end: single.end })]); t('bad type rejected', v.skipped.length === 1);
v = val([mk({ start: single.end, end: single.start })]); t('end before start rejected', v.skipped.length === 1);
v = val([mk({ start: '2026-10-18T10:00:00', end: '2026-10-18T12:00:00+05:30' })]); t('naive start rejected', v.skipped.length === 1);
v = val([mk({ start: single.start, end: single.end, recurring: night.recurring })]); t('both schedules rejected', v.skipped.length === 1);
v = val([mk({})]); t('no schedule rejected (verified)', v.skipped.length === 1);
v = val([mk({ recurring: { dateStart: '2026-10-17', dateEnd: '2026-10-21', dailyStart: '22:00', dailyEnd: '22:00' } })]); t('recurring start==end rejected', v.skipped.length === 1);
v = val([mk({ recurring: { dateStart: '2026-10-21', dateEnd: '2026-10-17', dailyStart: '22:00', dailyEnd: '23:00' } })]); t('recurring end date before start rejected', v.skipped.length === 1);
v = val([mk({ recurring: { dateStart: '2026-10-17', dateEnd: '2026-10-21', dailyStart: '25:00', dailyEnd: '23:00' } })]); t('recurring bad time rejected', v.skipped.length === 1);
v = val([mk({ start: single.start, end: single.end }), mk({ start: single.start, end: single.end })]); t('duplicate id rejected', v.restrictions.length === 1 && v.skipped.length === 1);
v = val([mk({ locationText: '', start: single.start, end: single.end })]); t('needs location text or point', v.skipped.length === 1);
v = val([mk({ locationText: '', lat: 26.72, lon: 88.4, start: single.start, end: single.end })]); t('point alone is enough', v.restrictions.length === 1);
[[26.4, 88.4], [27.1, 88.4], [26.7, 88.1], [26.7, 88.8], ['26.7', '88.4'], [NaN, 88.4], [26.7, null && 1]].forEach((c, i) => {
  v = val([mk({ lat: c[0], lon: c[1], start: single.start, end: single.end })]); t('bad coords rejected #' + i, v.restrictions.length === 0 && v.skipped.length === 1, c);
});
v = val([mk({ lat: 26.7, start: single.start, end: single.end })]); t('lat without lon rejected', v.skipped.length === 1);
v = val([mk({ sourceUrl: 'javascript:alert(1)', start: single.start, end: single.end })]); t('javascript: sourceUrl dropped', v.restrictions[0].sourceUrl === '' && v.notices.length > 0);
v = val([mk({ sourceUrl: 'https://example.org/o.pdf', start: single.start, end: single.end })]); t('https sourceUrl kept', v.restrictions[0].sourceUrl === 'https://example.org/o.pdf');
const geo = { type: 'LineString', coordinates: [[88.39, 26.72], [88.4, 26.73]] };
v = val([mk({ geometry: geo, geometryVerified: true, start: single.start, end: single.end })]); t('verified geometry kept', !!v.restrictions[0].geometry);
v = val([mk({ geometry: geo, start: single.start, end: single.end })]); t('unverified geometry dropped', v.restrictions[0].geometry === null);
v = val([mk({ geometry: { type: 'LineString', coordinates: [[88.39, 26.72], [10, 10]] }, geometryVerified: true, start: single.start, end: single.end })]); t('out-of-box geometry dropped', v.restrictions[0].geometry === null);
v = val([mk({ status: 'demo', demo: true, geometry: geo, geometryVerified: true, start: single.start, end: single.end })]); t('demo geometry never drawn', v.restrictions[0].geometry === null);
v = val([mk({ status: 'demo', source: '', verifiedBy: '', verifiedAt: undefined, start: single.start, end: single.end })]); t('demo needs no provenance and is not verified', v.restrictions.length === 1 && v.restrictions[0].verified === false && v.restrictions[0].badge === 'demo');
v = val([mk({ status: 'official', demo: true, start: single.start, end: single.end })]); t('demo flag overrides: never treated as verified', v.restrictions[0].verified === false);
t('fatal: not object', !L.validateDataset([]).ok && !L.validateDataset(null).ok);
t('fatal: no meta', !L.validateDataset({ pandals: [] }).ok);
t('fatal: bad lastUpdated', !L.validateDataset({ meta: { lastUpdated: 'yesterday' }, pandals: [] }).ok);
t('fatal: pandals not array', !L.validateDataset({ meta: ds().meta, pandals: {} }).ok);
const pv = L.validateDataset(ds([], { pandals: [
  { id: 'p1', name: 'P1', locality: 'L', lat: 26.72, lon: 88.4, status: 'unconfirmed' },
  { id: 'p2', name: 'P2', locality: 'L', lat: 12, lon: 88.4, status: 'unconfirmed' },
  { id: 'p3', name: 'P3', locality: 'L', address: 'addr', status: 'official' },
  { id: 'p4', name: 'P4', locality: 'L', lat: 26.72, lon: 88.4, status: 'official', source: 's', verifiedAt: '2026-10-04T10:00:00+05:30', verifiedBy: 'Office' },
  { id: 'p5', name: '', status: 'official' },
  { id: 'p6', name: 'P6', locality: 'L', imageUrl: 'javascript:alert(1)', status: 'unconfirmed' }
] }));
t('pandals: bad coords skipped, others kept', pv.pandals.map(p => p.id).join() === 'p1,p4,p6' && pv.skipped.length === 3, [pv.pandals.map(p => p.id), pv.skipped]);
t('pandal bad imageUrl dropped', pv.pandals[2].imageUrl === '');

// --- maps link
t('maps coords', L.mapsDirUrl({ lat: 26.7271, lon: 88.3953 }) === 'https://www.google.com/maps/dir/?api=1&destination=26.7271%2C88.3953');
t('maps address encoded', L.mapsDirUrl({ address: 'A & B <x>, "Siliguri"' }) === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('A & B <x>, "Siliguri"'));
t('maps invalid coords fall back to address', L.mapsDirUrl({ lat: 5, lon: 5, address: 'Road 1' }).endsWith('Road%201'));
t('maps invalid coords no address -> null', L.mapsDirUrl({ lat: 5, lon: 5 }) === null && L.mapsDirUrl({}) === null && L.mapsDirUrl({ address: '  ' }) === null);

// --- distance + search
t('distance ~0 and ~1.1km per 0.01deg lat', L.distanceKm(26.7, 88.4, 26.7, 88.4) === 0 && Math.abs(L.distanceKm(26.7, 88.4, 26.71, 88.4) - 1.112) < 0.01);
t('search: AND of word-prefixes, case-insensitive, punctuation-insensitive', L.matches('sample  a', ['DEMO – Sample Pandal A']) && !L.matches('sample z', ['DEMO – Sample Pandal A']) && L.matches('', []) && L.matches('pand', ['Pandal']) && !L.matches('andal', ['Pandal']) && L.matches('rd', ['Hill Cart Rd.']) && L.matches('demo sample', ['DEMO – Sample']));

// ================= visitor-flow additions =================
const DEMO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'puja-data.json'), 'utf8'));
const OKP = { status: 'admin-verified', source: 'Test notice 1', verifiedAt: '2026-10-04T10:00:00+05:30', verifiedBy: 'Test desk' };
function fixture(extra) { // a small fully-verified fixture dataset
  const d = ds([], {
    pandals: [Object.assign({ id: 'p1', name: 'P1', locality: 'L', lat: 26.72, lon: 88.40, entrances: [Object.assign({ id: 'p1-e1', name: 'Gate', lat: 26.7205, lon: 88.4005, verified: true }, OKP)] }, OKP),
              { id: 'p2', name: 'P2', locality: 'L', address: 'Road 2', status: 'unconfirmed', entrances: [{ id: 'p2-e1', name: 'Gate2', lat: 26.73, lon: 88.41, verified: true, source: 's', verifiedAt: OKP.verifiedAt, verifiedBy: 'x' }] },
              { id: 'p3', name: 'P3', locality: 'L', status: 'unconfirmed' }],
    parking: [Object.assign({ id: 'k1', name: 'K1', lat: 26.71, lon: 88.39, approved: true }, OKP)],
    accessPoints: [Object.assign({ id: 'a1', name: 'A1', type: 'drop-off', lat: 26.715, lon: 88.395, designated: true }, OKP)],
    walkingRoutes: [Object.assign({ id: 'w1', name: 'W1', fromId: 'k1', pandalId: 'p1', entranceId: 'p1-e1', routeVerified: true, distanceM: 1800, timeMin: 25,
      waypoints: [{ lat: 26.71, lon: 88.39 }, { lat: 26.715, lon: 88.397 }, { lat: 26.7205, lon: 88.4005 }], instructions: ['Walk north.', 'Gate on left.'] }, OKP)],
    restrictions: [mk({ start: '2026-10-18T10:00:00+05:30', end: '2026-10-18T20:00:00+05:30' })],
    diversionPoints: [Object.assign({ id: 'd1', name: 'D1', restrictionId: 'r1', lat: 26.72, lon: 88.40, instruction: 'Turn left.' }, OKP)],
    facilities: [Object.assign({ id: 'f1', name: 'Hospital', type: 'hospital', lat: 26.72, lon: 88.40, emergencyCapabilityVerified: true, emergencyCapable: true, phone: '+91 353 000000', phoneAuthorised: true }, OKP)]
  });
  return Object.assign(d, extra || {});
}
const good = L.validateDataset(fixture());
t('fixture dataset fully valid', good.ok && good.skipped.length === 0, good.skipped);
t('all new kinds parsed', good.accessPoints.length === 1 && good.walkingRoutes.length === 1 && good.diversionPoints.length === 1 && good.facilities.length === 1);
t('verified route keeps distance/time', good.walkingRoutes[0].routeVerified && good.walkingRoutes[0].distanceM === 1800 && good.walkingRoutes[0].timeMin === 25);
t('verified hospital: capability + authorised phone kept', good.facilities[0].emergencyCapable === true && good.facilities[0].phone === '+91 353 000000');
t('verified entrance kept (own provenance, verified pandal)', good.pandals[0].entrances[0].verified === true);
t('entrance on UNVERIFIED pandal stays unverified', good.pandals[1].entrances[0].verified === false);
t('old-format dataset (no new lists) still valid and silent', (() => { const v = L.validateDataset(ds([mk({ start: single.start, end: single.end })])); return v.ok && v.notices.length === 0 && v.walkingRoutes.length === 0; })());

// directions: verified entrance > point > address > null
const gp = good.pandals;
t('directions -> verified entrance coordinates', L.directionsFor(gp[0]).url === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent('26.7205,88.4005') && L.directionsFor(gp[0]).target === 'entrance');
t('directions -> unverified entrance is NOT used (address fallback)', L.directionsFor(gp[1]).target === 'address' && /Road%202$/.test(L.directionsFor(gp[1]).url));
t('directions -> none (disabled)', L.directionsFor(gp[2]) === null);
t('directions -> pandal point when no verified entrance', (() => { const p = Object.assign({}, gp[0], { entrances: [] }); return L.directionsFor(p).target === 'point'; })());
t('demo data: no entrance is treated as verified, so directions use the pandal point/address', (() => { const v = L.validateDataset(DEMO); return v.pandals.every(p => !L.verifiedEntrance(p)) && L.directionsFor(v.pandals[0]).target === 'point'; })());

// references
function route(extra) { const d = fixture(); d.walkingRoutes = [Object.assign({}, d.walkingRoutes[0], extra)]; return L.validateDataset(d); }
t('route: unknown fromId skipped', route({ fromId: 'nope' }).walkingRoutes.length === 0 && route({ fromId: 'nope' }).skipped[0].reasons.join().includes('fromId'));
t('route: unknown pandalId skipped', route({ pandalId: 'nope' }).walkingRoutes.length === 0);
t('route: entrance of another pandal skipped', route({ entranceId: 'p2-e1' }).walkingRoutes.length === 0);
t('route: from can be an access point', route({ fromId: 'a1' }).walkingRoutes.length === 1);
t('route: invalid waypoint coordinates skipped', route({ waypoints: [{ lat: 26.7, lon: 88.4 }, { lat: 50, lon: 88.4 }] }).walkingRoutes.length === 0);
t('route: verified but missing distance -> downgraded, no distance shown', (() => { const v = route({ distanceM: undefined }); return v.walkingRoutes[0].routeVerified === false && v.walkingRoutes[0].distanceM === null && v.notices.some(n => /unverified/.test(n)); })());
t('route: verified flag on non-verified record -> downgraded', (() => { const d = fixture(); d.walkingRoutes[0].status = 'demo'; d.walkingRoutes[0].demo = true; const v = L.validateDataset(d); return v.walkingRoutes[0].routeVerified === false && v.walkingRoutes[0].timeMin === null; })());
t('route: distance shorter than straight line -> downgraded', route({ distanceM: 50 }).walkingRoutes[0].routeVerified === false);
t('route: <2 waypoints cannot be verified', route({ waypoints: [{ lat: 26.71, lon: 88.39 }] }).walkingRoutes[0].routeVerified === false);
t('route: distance/time ignored when not routeVerified', (() => { const v = route({ routeVerified: false }); return v.walkingRoutes[0].distanceM === null && v.walkingRoutes[0].timeMin === null; })());
t('route: skipped pandal also skips its route', (() => { const d = fixture(); d.pandals[0].lat = 5; return L.validateDataset(d).walkingRoutes.length === 0; })());
function div(extra) { const d = fixture(); d.diversionPoints = [Object.assign({}, d.diversionPoints[0], extra)]; return L.validateDataset(d); }
t('diversion: unknown restrictionId skipped', div({ restrictionId: 'zzz' }).diversionPoints.length === 0);
t('diversion: needs instruction and coordinates', div({ instruction: '' }).diversionPoints.length === 0 && div({ lat: 1 }).diversionPoints.length === 0);
t('diversion: linked ok', div({}).diversionPoints[0].restrictionId === 'r1');
t('diversion: skipped restriction skips its diversion', (() => { const d = fixture(); d.restrictions[0].source = ''; return L.validateDataset(d).diversionPoints.length === 0; })());
function fac(extra) { const d = fixture(); d.facilities = [Object.assign({}, d.facilities[0], extra)]; return L.validateDataset(d); }
t('facility: invalid type skipped', fac({ type: 'bar' }).facilities.length === 0);
t('facility: phone dropped unless phoneAuthorised', fac({ phoneAuthorised: false }).facilities[0].phone === '' );
t('facility: phone dropped on demo/unverified record', fac({ status: 'demo', demo: true }).facilities[0].phone === '' && fac({ status: 'unconfirmed' }).facilities[0].phone === '');
t('facility: emergency capability only when verified flag', fac({ emergencyCapabilityVerified: false }).facilities[0].emergencyCapable === false);
t('facility: malformed phone dropped', fac({ phone: '<script>' }).facilities[0].phone === '');
t('facility: needs coordinates/address/landmark', fac({ lat: undefined, lon: undefined, landmark: undefined }).facilities.length === 0 && fac({ lat: undefined, lon: undefined, landmark: 'Near the gate' }).facilities.length === 1);
t('facility: bad coordinates skipped', fac({ lat: 30 }).facilities.length === 0);
t('access point: invalid type / missing coordinates skipped', (() => { const d = fixture(); d.accessPoints = [Object.assign({}, d.accessPoints[0], { type: 'parking' }), Object.assign({}, d.accessPoints[0], { id: 'a2', lat: undefined, lon: undefined })]; const v = L.validateDataset(d); return v.accessPoints.length === 0 && v.skipped.length >= 2 && v.walkingRoutes.length === 1; })());
t('ids are unique across all kinds incl. entrances', (() => { const d = fixture(); d.facilities[0].id = 'p1-e1'; return L.validateDataset(d).facilities.length === 0; })());
t('published access point without source rejected', (() => { const d = fixture(); d.accessPoints[0].source = ''; return L.validateDataset(d).accessPoints.length === 0; })());

// labels: never "approved/designated" unless explicit AND verified
t('shortLabel: unverified is always "Unverified"', ['active', 'upcoming', 'expired', 'cancelled', 'unconfirmed'].every(s => L.shortLabel(s, false) === 'Unverified'));
t('shortLabel: verified labels', L.shortLabel('active', true) === 'Active' && L.shortLabel('upcoming', true) === 'Upcoming' && L.shortLabel('expired', true) === 'Expired' && L.shortLabel('unconfirmed', true) === 'Unverified');

// expired never active (walk every minute around/after the end of several schedule kinds)
(function () {
  const cases = [single, night, day, full, mk({ start: '2026-10-12T00:00:00+05:30', end: '2026-10-13T12:00:00+05:30' })];
  let bad = 0;
  cases.forEach(r => {
    const w = L.windowsOf(r), last = w[w.length - 1].end;
    for (let m = 0; m <= 3 * 24 * 60; m += 7) { const ev = L.evaluateRestriction(r, last + m * 60000); if (ev.state !== 'expired') bad++; }
    const evEnd = L.evaluateRestriction(r, last - 1); if (evEnd.state !== 'active') bad++;
  });
  t('expired never active: all minutes at/after the final end are "expired"', bad === 0, bad);
})();
t('incomplete data is never active: no schedule -> unconfirmed', L.evaluateRestriction(mk({ status: 'unconfirmed' }), ms('2026-10-18T12:00:00+05:30')).state === 'unconfirmed');

// freshness text
const NOW = ms('2026-10-05T09:00:00+05:30');
t('freshness: fresh network', (() => { const f = L.freshness({ status: 'ok', source: 'network', stale: false, lastRefresh: NOW - 60000 }, NOW); return f.level === 'ok' && f.text === 'Data refreshed 8:59 AM IST'; })());
t('freshness: old (>15 min) shows age and is not "ok"', (() => { const f = L.freshness({ status: 'ok', source: 'network', stale: false, lastRefresh: NOW - 40 * 60000 }, NOW); return f.level === 'old' && /40 min ago/.test(f.text); })());
t('freshness: cached copy is "may be outdated" with last real refresh', (() => { const f = L.freshness({ status: 'ok', source: 'cache', stale: false, lastRefresh: NOW - 3600000 }, NOW); return f.level === 'stale' && /may be outdated/.test(f.text) && /8:00 AM IST/.test(f.text); })());
t('freshness: failed refresh keeps data but flags stale', L.freshness({ status: 'ok', source: 'network', stale: true, lastRefresh: NOW - 1000 }, NOW).level === 'stale');
t('freshness: unknown refresh time never looks current', L.freshness({ status: 'ok', source: 'cache', lastRefresh: null }, NOW).text.includes('unknown'));
t('freshness: other day shows the date', /4 Oct 2026/.test(L.freshness({ status: 'ok', source: 'cache', lastRefresh: ms('2026-10-04T08:00:00+05:30') }, NOW).text));
t('freshness: unavailable / loading', L.freshness({ status: 'unavailable', lastRefresh: null }, NOW).level === 'none' && L.freshness({ status: 'loading' }, NOW).level === 'loading');
t('freshness text never claims current/live/confirmed', ['network', 'cache'].every(src => !/\b(current|live|confirmed|up to date)\b/i.test(L.freshness({ status: 'ok', source: src, stale: false, lastRefresh: NOW }, NOW).text)));

// ---- the bundled demo data file itself
const dv = L.validateDataset(DEMO);
t('demo file: valid, nothing skipped, no notices', dv.ok && dv.skipped.length === 0 && dv.notices.length === 0, [dv.skipped, dv.notices]);
t('demo file: flagged as demo dataset', dv.meta.isDemoDataset === true);
const allDemo = [].concat(dv.pandals, dv.parking, dv.accessPoints, dv.restrictions, dv.walkingRoutes, dv.diversionPoints, dv.facilities);
t('demo file: every record is demo/unconfirmed, none verified', allDemo.every(r => (r.demo || r.status === 'unconfirmed') && r.verified === false), allDemo.filter(r => r.verified).map(r => r.id));
t('demo file: every record id unique and in range', (() => { const ids = allDemo.map(r => r.id); return new Set(ids).size === ids.length && allDemo.every(r => r.lat === undefined || L.validCoords(r.lat, r.lon)); })());
t('demo file: no walking route claims verification, no distance/time', dv.walkingRoutes.every(r => !r.routeVerified && r.distanceM === null && r.timeMin === null) && !/"routeVerified"\s*:\s*true/.test(JSON.stringify(DEMO)));
t('demo file: no phone numbers, no designation/approval claims', !/"phone"|"phoneAuthorised"/.test(JSON.stringify(DEMO)) && !/"(approved|designated)"\s*:\s*true/.test(JSON.stringify(DEMO)) && !/"verified"\s*:\s*true/.test(JSON.stringify(DEMO)));
t('demo file: all route / diversion references resolve', dv.walkingRoutes.length === DEMO.walkingRoutes.length && dv.diversionPoints.length === DEMO.diversionPoints.length);
t('demo file: all five facility types and all four access types present', ['toilet', 'drinking-water', 'first-aid', 'hospital', 'police-booth'].every(x => dv.facilities.some(f => f.type === x)) && ['drop-off', 'pick-up', 'pedestrian-entrance', 'pedestrian-exit'].every(x => dv.accessPoints.some(f => f.type === x)));
t('demo file: no verified geometry drawn', dv.restrictions.every(r => !r.geometry));

// --- copy lint: no false claims of live traffic / open roads / "confirmed in force"
const root = path.join(__dirname, '..');
const scan = ['index.html', 'app.js', 'logic.js', 'offline.html', 'admin-preview.html', 'data/puja-data.json'];
const banned = [/confirmed in force/i, /\bconfirmed live\b/i, /\bclear road/i, /roads? (is|are) (open|clear)/i, /\bsafe to (drive|travel|go)/i, /\bis open\b/i, /\bcurrently closed\b/i, /\bcurrently open\b/i];
scan.forEach(f => {
  const txt = fs.readFileSync(path.join(root, f), 'utf8').replace(/aria-live/g, 'aria-x').replace(/(not|never) assume any road is open or restricted/gi, 'NEGATED-OK');
  banned.forEach(re => t('copy lint ' + f + ' ' + re, !re.test(txt)));
  (txt.match(/[^\n]{0,60}\blive\b[^\n]{0,40}/gi) || []).forEach(m => t('"live" only used negatively in ' + f + ': ' + m.trim(), /(not|no|nor|cannot|without) [^.]{0,40}live|live (traffic|road)/i.test(m) && /(not|no |cannot|without)/i.test(m), m));
});
console.log('unit: ' + pass + ' passed, ' + fail + ' failed (TZ=' + (process.env.TZ || 'default') + ')');
process.exit(fail ? 1 : 0);
