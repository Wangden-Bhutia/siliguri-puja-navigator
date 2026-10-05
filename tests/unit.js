/* Unit tests for logic.js (schema v2) + branding / copy lint. Run: node tests/unit.js */
const L = require('../logic.js');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name + (info !== undefined ? ' | ' + JSON.stringify(info) : '')); } }
const ms = (s) => L.parseIST(s);
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const DEMO = JSON.parse(rd('data/puja-data.json'));

function baseMeta(extra) {
  return Object.assign({ schemaVersion: 2, datasetVersion: 't', lastUpdated: '2026-10-04T10:00:00+05:30', isDemoDataset: false, festival: { name: 'F', startDate: '2026-10-16', endDate: '2026-10-21' } }, extra || {});
}
function ds(extra) {
  return Object.assign({ meta: baseMeta(), pandals: [], neighbourhoods: [], parking: [], walkingRoutes: [], traffic: [], facilities: [], help: { emergencyNumber: '112', contacts: [] } }, extra || {});
}
function pandal(id, extra) {
  return Object.assign({ id: id, name: 'Pandal ' + id, locality: 'Deshbandhupara', latitude: 26.7118, longitude: 88.4237, verificationStatus: 'pendingVerification' }, extra || {});
}
function traffic(id, extra) {
  return Object.assign({
    id: id, name: 'DEMO – Sample at Sevoke More', place: 'Sevoke More', affectedRoad: 'Sevoke More',
    restrictionType: 'vehicleClassRestriction', status: 'scheduled', verificationStatus: 'pendingVerification',
    plannedStart: '2026-10-16T00:00:00+05:30', plannedEnd: '2026-10-21T23:59:00+05:30',
    dailyStart: '18:00', dailyEnd: '01:00', visitorAction: 'Follow the marked Police diversion.', demo: true
  }, extra || {});
}

// --- time parsing
t('parse ok', ms('2026-10-18T23:30:00+05:30') === Date.UTC(2026, 9, 18, 18, 0, 0));
t('parse no seconds', ms('2026-10-18T23:30+05:30') === ms('2026-10-18T23:30:00+05:30'));
['2026-10-18T23:30:00', '2026-10-18T23:30:00Z', '2026-10-18T23:30:00+05:00', 'x', null, 5].forEach(s => t('parse rejects ' + s, isNaN(ms(s))));
t('IST format', L.fmtDateTime(ms('2026-10-18T00:05:00+05:30')) === '18 Oct 2026, 12:05 AM IST');
t('local input roundtrip', L.toLocalInputValue(ms('2026-10-18T23:30:00+05:30')) === '2026-10-18T23:30' && L.fromLocalInputValue('2026-10-18T23:30') === ms('2026-10-18T23:30:00+05:30'));
t('fromDateTimeInputs', L.fromDateTimeInputs('2026-10-18', '18:00') === ms('2026-10-18T18:00:00+05:30'));

// --- traffic windows
const night = traffic('t-night');
t('night: before = upcoming', L.evaluateTraffic(night, ms('2026-10-16T17:00:00+05:30')).state === 'upcoming');
t('night: 18:00 active', L.evaluateTraffic(night, ms('2026-10-16T18:00:00+05:30')).state === 'active');
t('night: 00:30 active (cross midnight)', L.evaluateTraffic(night, ms('2026-10-17T00:30:00+05:30')).state === 'active');
t('night: 01:00 ended for that window / upcoming next', L.evaluateTraffic(night, ms('2026-10-17T01:00:00+05:30')).state === 'upcoming');
t('cancelled', L.evaluateTraffic(Object.assign({}, night, { status: 'cancelled' }), ms('2026-10-16T19:00:00+05:30')).state === 'cancelled');
t('expired verification => ended', L.evaluateTraffic(Object.assign({}, night, { verificationStatus: 'expired', demo: false, status: 'expired' }), ms('2026-10-16T19:00:00+05:30')).state === 'ended');
t('reference verification => ended', L.evaluateTraffic(Object.assign({}, night, { verificationStatus: 'reference', demo: false, status: 'scheduled' }), ms('2026-10-16T19:00:00+05:30')).state === 'ended');

// --- visitor traffic filter
t('demo scheduled is visitor-visible', L.isVisitorTraffic(night) === true);
t('approved scheduled is visitor-visible', L.isVisitorTraffic(Object.assign({}, night, { demo: false, verificationStatus: 'approved', source: 'Police order' })) === true);
t('pending non-demo is NOT visitor-visible', L.isVisitorTraffic(Object.assign({}, night, { demo: false, verificationStatus: 'pendingVerification' })) === false);
t('expired status not visitor-visible', L.isVisitorTraffic(Object.assign({}, night, { status: 'expired' })) === false);
const feed = L.trafficFeed([
  night,
  Object.assign({}, night, { id: 'hist', demo: false, verificationStatus: 'reference', status: 'expired', name: '2025 baseline' }),
  Object.assign({}, night, { id: 'pend', demo: false, verificationStatus: 'pendingVerification', name: 'Pending 2026' })
], ms('2026-10-16T19:00:00+05:30'));
t('feed only shows visitor-eligible', feed.active.length === 1 && feed.active[0].r.id === 't-night');
t('describeTrafficTime has range', /PM/.test(L.describeTrafficTime(night, feed.active[0].ev)));

// --- status labels — never claim verified for pending
t('statusLabel DEMO', L.statusLabel({ demo: true }) === 'DEMO');
t('statusLabel pending (non-pandal)', L.statusLabel({ verificationStatus: 'pendingVerification' }) === 'Pending 2026 verification');
t('statusLabel location confirmed pandal', L.statusLabel({ kind: 'pandal', locationStatus: 'confirmed', hasCoords: true, verificationStatus: 'pendingVerification' }) === 'Location confirmed');
t('statusLabel fieldVerified still wins over location confirmed', L.statusLabel({ kind: 'pandal', locationStatus: 'confirmed', hasCoords: true, verificationStatus: 'fieldVerified' }) === 'Field-checked 2026');
t('statusLabel never says verified for pending', !/verified/i.test(L.statusLabel({ verificationStatus: 'pendingVerification' })));
t('statusLabel fieldVerified', L.statusLabel({ verificationStatus: 'fieldVerified' }) === 'Field-checked 2026');
t('statusLabel approved', L.statusLabel({ verificationStatus: 'approved' }) === 'Approved');
t('isCheckedLocation', L.isCheckedLocation('fieldVerified') && L.isCheckedLocation('approved') && !L.isCheckedLocation('pendingVerification'));

// --- neighbourhoods
const nh = L.groupNeighbourhoods([pandal('a'), pandal('b', { locality: 'Hakimpara' }), pandal('c', { locality: 'Hakimpara' })]);
t('groupNeighbourhoods counts', nh.length === 2 && nh.find(n => n.name === 'Hakimpara').count === 2);
t('slug', L.slug('Desh Bandhu Para') === 'desh-bandhu-para');

// --- parking / walk
const park = { id: 'k1', servedPandalIds: ['a', 'b'], walkingDistance: 400, walkingTime: 7, walkingRoute: ['Go north'], demo: true, verificationStatus: 'pendingVerification' };
t('parkingForPandal', L.parkingForPandal([park], 'a').length === 1 && L.parkingForPandal([park], 'z').length === 0);
const walk = L.walkFor(park, 'a', [{ id: 'w1', parkingId: 'k1', pandalId: 'a', walkingDistance: 450, walkingTime: 8, walkingRoute: ['Specific'], verificationStatus: 'pendingVerification', demo: true }]);
t('walkFor prefers route record', walk.distanceM === 450 && walk.timeMin === 8 && walk.steps[0] === 'Specific' && walk.demo === true);

// --- maps / coords
t('maps coords', L.mapsDirUrl({ lat: 26.7271, lon: 88.3953 }) === 'https://www.google.com/maps/dir/?api=1&destination=26.7271%2C88.3953');
t('maps invalid -> null', L.mapsDirUrl({ lat: 5, lon: 5 }) === null && L.mapsDirUrl({}) === null);
t('validCoords bbox', L.validCoords(26.72, 88.4) && !L.validCoords(12, 88.4));
t('matches word prefix', L.matches('dada', L.pandalFields(pandal('x', { name: 'Dada Bhai Sporting Club' }))) && !L.matches('zzzz', L.pandalFields(pandal('x'))));

// --- freshness
const NOW = ms('2026-10-05T09:00:00+05:30');
t('freshness ok', (() => { const f = L.freshness({ status: 'ok', source: 'network', stale: false, lastRefresh: NOW - 60000 }, NOW); return f.level === 'ok' && /Updated/.test(f.text) && /1 min ago/.test(f.text); })());
t('freshness stale cache', /may be outdated/.test(L.freshness({ status: 'ok', source: 'cache', stale: false, lastRefresh: NOW - 3600000 }, NOW).text));
t('freshness old', L.freshness({ status: 'ok', source: 'network', stale: false, lastRefresh: NOW - 40 * 60000 }, NOW).level === 'old');
t('freshness unavailable/loading', L.freshness({ status: 'unavailable', lastRefresh: null }, NOW).level === 'none' && L.freshness({ status: 'loading' }, NOW).level === 'loading');
t('freshness never claims live/current', !/\b(current|live|confirmed|up to date)\b/i.test(L.freshness({ status: 'ok', source: 'network', stale: false, lastRefresh: NOW }, NOW).text));

// --- validation
t('fatal: not object', !L.validateDataset([]).ok && !L.validateDataset(null).ok);
t('fatal: no meta', !L.validateDataset({ pandals: [] }).ok);
t('fatal: bad lastUpdated', !L.validateDataset({ meta: { lastUpdated: 'yesterday' }, pandals: [] }).ok);
let v = L.validateDataset(ds({ pandals: [pandal('p1'), pandal('p1', { name: 'Dup' })] }));
t('duplicate id skipped', v.pandals.length === 1 && v.skipped.length === 1);
v = L.validateDataset(ds({ pandals: [pandal('p1'), pandal('p2', { latitude: 12, longitude: 88.4 })] }));
t('bad coords kept but errored', v.pandals.length === 2 && v.pandals[1].hasCoords === false && v.errors.some(e => /invalid coordinates/.test(e.message)));
v = L.validateDataset(ds({
  pandals: [pandal('p1'), pandal('p2', { locality: 'Hakimpara' })],
  parking: [{ id: 'k1', name: 'Drop', latitude: 26.71, longitude: 88.42, servedPandalIds: ['p1', 'nope'], verificationStatus: 'pendingVerification', demo: true }]
}));
t('parking drops nonexistent pandal refs', v.parking.length === 1 && v.parking[0].servedPandalIds.join() === 'p1' && v.errors.some(e => /nonexistent pandal/.test(e.message)));
v = L.validateDataset(ds({
  pandals: [pandal('p1')],
  parking: [{ id: 'k1', name: 'Drop', latitude: 26.71, longitude: 88.42, servedPandalIds: ['p1'], verificationStatus: 'pendingVerification', demo: true }],
  walkingRoutes: [{ id: 'w1', parkingId: 'k1', pandalId: 'nope', walkingDistance: 100, walkingTime: 2, verificationStatus: 'pendingVerification', demo: true }]
}));
t('walkingRoute bad pandal skipped', v.walkingRoutes.length === 0 && v.skipped.some(s => s.kind === 'walkingRoute'));
v = L.validateDataset(ds({
  pandals: [pandal('p1')],
  traffic: [traffic('t1'), Object.assign({}, traffic('t2'), { demo: false, verificationStatus: 'approved', source: 'Order', verifiedBy: 'Office', name: 'Approved restriction' })]
}));
t('traffic accepted', v.traffic.length === 2);
v = L.validateDataset(ds({ help: { emergencyNumber: '999', contacts: [{ id: 'pcr', name: 'PCR', phone: '0353-123', verificationStatus: 'pendingVerification' }] } }));
t('help emergency must be 112; unverified phone hidden', v.help.emergencyNumber === '112' && v.help.contacts[0].phone === '' && v.errors.some(e => /112/.test(e.message)));

// --- bundled data file
const dv = L.validateDataset(DEMO);
t('demo file valid', dv.ok && dv.fatal === '', dv.fatal);
t('demo file: 83 pandals, 28 nhoods', dv.pandals.length === 83 && dv.neighbourhoods.length === 28, [dv.pandals.length, dv.neighbourhoods.length]);
t('demo file: all pandals pendingVerification (ops) + location confirmed', dv.pandals.every(p => p.verificationStatus === 'pendingVerification') && dv.pandals.every(p => p.locationStatus === 'confirmed' && L.isLocationConfirmed(p)));
t('location confirmed ≠ fieldVerified/approved', dv.pandals.every(p => !L.isCheckedLocation(p.verificationStatus) && L.statusLabel(p) === 'Location confirmed' && L.statusLabel(p) !== 'Field-checked 2026' && L.statusLabel(p) !== 'Approved'));
t('confirmed pandal has Google Maps directions URL', !!L.mapsDirUrl(dv.pandals[0]) && /destination=26\.7118%2C88\.4237/.test(L.mapsDirUrl(dv.pandals[0])));
t('isLocationConfirmed requires coords + confirmed + not demo', L.isLocationConfirmed({ locationStatus: 'confirmed', hasCoords: true, demo: false }) && !L.isLocationConfirmed({ locationStatus: 'confirmed', hasCoords: false }) && !L.isLocationConfirmed({ locationStatus: 'confirmed', hasCoords: true, demo: true }) && !L.isLocationConfirmed({ locationStatus: 'unconfirmed', hasCoords: true }));
v = L.validateDataset(ds({ pandals: [pandal('pc', { locationStatus: 'confirmed' }), pandal('pb', { locationStatus: 'confirmed', latitude: undefined, longitude: undefined }), pandal('pd', { locationStatus: 'confirmed', demo: true, verificationStatus: 'pendingVerification' })] }));
t('confirmed without coords / DEMO confirmed rejected', v.pandals.find(p=>p.id==='pc').locationStatus==='confirmed' && v.pandals.find(p=>p.id==='pb').locationStatus==='unconfirmed' && v.pandals.find(p=>p.id==='pd').locationStatus==='unconfirmed');
t('branding still disabled', require('../branding.js').officialBrandingApproved === false);
t('demo file: parking/facilities are DEMO', dv.parking.every(p => p.demo) && dv.facilities.every(f => f.demo));
t('demo file: only DEMO traffic is visitor-visible', dv.traffic.filter(L.isVisitorTraffic).every(r => r.demo) && dv.traffic.filter(L.isVisitorTraffic).length >= 1);
t('demo file: 2025 baseline never visitor-visible', dv.traffic.filter(r => r.verificationStatus === 'reference' || r.verificationStatus === 'expired' || r.status === 'expired').every(r => !L.isVisitorTraffic(r)));
t('demo file: no approved phones', dv.help.contacts.every(c => !c.phone));
t('demo file: schema 2 + demo flags', dv.meta.schemaVersion === 2 && dv.meta.isDemoDataset === true && dv.meta.containsDemoRecords === true);

// --- branding
const BR = require('../branding.js');
const html = rd('index.html'), manifest = JSON.parse(rd('manifest.webmanifest')), offline = rd('offline.html');
const txtOf = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&ndash;/g, '\u2013').replace(/\s+/g, ' ');
t('branding fields', BR.appName === 'Siliguri Puja Guide' && BR.tagline === 'Find pandals. Plan your route. Travel safely.' && BR.descriptor === 'Official Durga Puja Traffic & Visitor Information' && BR.descriptorDefault === 'Durga Puja Visitor Information \u00B7 Siliguri' && BR.festivalDates === '16 \u2013 21 October 2026');
t('branding approval false', BR.officialBrandingApproved === false && /Demo version/.test(BR.footerDemo));
t('index has brand + 3 tabs + SOS', /id="brand-name"/.test(html) && /data-tab="home"/.test(html) && /data-tab="pandals"/.test(html) && /data-tab="parking"/.test(html) && /id="sos-fab"/.test(html) && /id="sos-sheet"/.test(html) && /id="nav-sheet"/.test(html));
t('index tagline/descriptor/dates/footer', txtOf(html).includes(BR.tagline) && txtOf(html).includes(BR.descriptorDefault) && txtOf(html).includes(BR.festivalDates) && html.includes(BR.footerDemo));
t('manifest name', manifest.name === BR.appName && manifest.short_name === BR.shortName);
t('offline name', /Siliguri Puja Guide/.test(offline));
t('old Navigator name absent from visitor files', ['index.html', 'app.js', 'branding.js', 'offline.html', 'manifest.webmanifest'].every(f => !/Siliguri Puja Navigator/i.test(rd(f))));
t('no endorsed/approved-by claims', !/endorsed by|approved by/i.test(rd('index.html') + rd('app.js') + rd('offline.html')));
t('3-tab nav only (no Help/Safety tab)', !/data-tab="help"|data-tab="safety"|data-tab="traffic"/.test(html));
t('home primary Find a Pandal', /Find a Pandal/.test(html) && /Parking &amp; Walking/.test(html));
t('institutional logos configured', BR.institutionalBranding.enabled === true && BR.institutionalBranding.logosPresent === true);

// build-sw logosPresent
(function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spn-build-'));
  const copy = (f) => { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(tmp, f)); };
  ['index.html', 'app.js', 'logic.js', 'branding.js', 'styles.css', 'service-worker.js', 'assets/logos/README.md'].forEach(copy);
  const run = () => execFileSync('node', [path.join(root, 'tools', 'build-sw.js')], { env: Object.assign({}, process.env, { SPN_ROOT: tmp }) }).toString();
  const assets = () => JSON.parse(fs.readFileSync(path.join(tmp, 'service-worker.js'), 'utf8').match(/^const ASSETS = (.*);$/m)[1]);
  run();
  t('build-sw: no logos -> logosPresent false', /logosPresent: false/.test(fs.readFileSync(path.join(tmp, 'branding.js'), 'utf8')) && !assets().some(a => a.startsWith('assets/')));
  fs.mkdirSync(path.join(tmp, 'assets/logos'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'assets/logos/west-bengal-police.png'), 'x');
  fs.writeFileSync(path.join(tmp, 'assets/logos/siliguri-metropolitan-police.png'), 'x');
  run();
  t('build-sw: both logos -> logosPresent true', /logosPresent: true/.test(fs.readFileSync(path.join(tmp, 'branding.js'), 'utf8')) && assets().includes('assets/logos/west-bengal-police.png'));
  fs.rmSync(tmp, { recursive: true, force: true });
})();

// --- copy lint: no false live-traffic / verified claims on visitor surfaces
const scan = ['index.html', 'app.js', 'logic.js', 'offline.html', 'admin-preview.html'];
const banned = [/confirmed in force/i, /\bconfirmed live\b/i, /\bclear road/i, /roads? (is|are) (open|clear)/i, /\bsafe to (drive|travel|go)/i, /\bcurrently closed\b/i, /\bcurrently open\b/i];
scan.forEach(f => {
  let txt = rd(f).replace(/aria-live/g, 'aria-x').replace(/(not|never) assume any road is open or restricted/gi, 'NEGATED-OK');
  banned.forEach((re, i) => t('banned phrase #' + i + ' absent from ' + f, !re.test(txt)));
});
// Visitor-facing strings in app.js / index must not label pending data as verified
const visitorCopy = rd('app.js') + rd('index.html');
t('no false "verified" claim for pending locations', !/Location verified/i.test(visitorCopy) && /Location confirmed/.test(visitorCopy) && /Parking and traffic arrangements for 2026 are being finalised/.test(visitorCopy));
t('DEMO label present in UI paths', /DEMO \\u2014 NOT VERIFIED/.test(rd('app.js')) && /Sample 2026 scenario/.test(rd('app.js')));
// --- refinement pass guards
t('facility types limited to booths + hospitals', L.FACILITY_TYPES.join() === 'police-booth,hospital');
v = L.validateDataset(ds({ facilities: [{ id: 'f1', name: 'Toilet block', type: 'toilet', latitude: 26.72, longitude: 88.42, verificationStatus: 'pendingVerification' }] }));
t('toilet facility rejected and reported', v.facilities.length === 0 && v.skipped.some(s => s.kind === 'facility'));
t('no toilets / drinking water / first aid on visitor surfaces', !/toilet|drinking.water|first.aid/i.test(rd('index.html') + rd('app.js') + rd('offline.html') + rd('manifest.webmanifest')));
t('no "Official" claim in visitor HTML/manifest while not approved', BR.officialBrandingApproved === false && !/official/i.test(txtOf(html).replace(/official durga puja traffic/i, '')) && !/official/i.test(rd('manifest.webmanifest')));
t('app.js uses approval flag for descriptor (not hardcoded)', /approved \? \(BR\.descriptor/.test(rd('app.js')) && /BR\.descriptorDefault/.test(rd('app.js')));
t('no "P" text or emoji used as nav/home icons', !/<span class="(bi|ti)"[^>]*>[^<]+<\/span>/.test(html) && (html.match(/<use href="#i-/g) || []).length >= 7);

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
