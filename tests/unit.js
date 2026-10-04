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

// --- copy lint: no false claims of live traffic / open roads / "confirmed in force"
const root = path.join(__dirname, '..');
const scan = ['index.html', 'app.js', 'logic.js', 'offline.html', 'data/puja-data.json'];
const banned = [/confirmed in force/i, /\bconfirmed live\b/i, /\bclear road/i, /roads? (is|are) (open|clear)/i, /\bsafe to (drive|travel|go)/i, /\bis open\b/i, /\bcurrently closed\b/i, /\bcurrently open\b/i];
scan.forEach(f => {
  const txt = fs.readFileSync(path.join(root, f), 'utf8').replace(/aria-live/g, 'aria-x').replace(/(not|never) assume any road is open or restricted/gi, 'NEGATED-OK');
  banned.forEach(re => t('copy lint ' + f + ' ' + re, !re.test(txt)));
  (txt.match(/[^\n]{0,60}\blive\b[^\n]{0,40}/gi) || []).forEach(m => t('"live" only used negatively in ' + f + ': ' + m.trim(), /(not|no|nor|cannot|without) [^.]{0,40}live|live (traffic|road)/i.test(m) && /(not|no |cannot|without)/i.test(m), m));
});
console.log('unit: ' + pass + ' passed, ' + fail + ' failed (TZ=' + (process.env.TZ || 'default') + ')');
process.exit(fail ? 1 : 0);
