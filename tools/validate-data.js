#!/usr/bin/env node
/* Validate data/puja-data.json with the SAME rules the app uses (logic.js).
   Usage: node tools/validate-data.js [path/to/puja-data.json]
   Exit code 0 = file is valid (warnings allowed), 1 = fatal problem or skipped records. */
const fs = require('fs');
const path = require('path');
const L = require('../logic.js');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'puja-data.json');
let raw;
try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error('FAIL: cannot read/parse JSON: ' + e.message); process.exit(1); }

const r = L.validateDataset(raw);
if (!r.ok) { console.error('FAIL: ' + r.fatal); process.exit(1); }

let problems = 0;
r.skipped.forEach(s => { problems++; console.error('SKIPPED ' + s.kind + ' "' + s.id + '": ' + s.reasons.join('; ')); });
(r.errors || []).forEach(e => console.error('ERROR ' + e.kind + ' "' + e.id + '": ' + e.message));
(r.warnings || []).forEach(w => console.warn('WARN ' + w.kind + ' "' + w.id + '": ' + w.message));

const ALL = [].concat(r.pandals, r.parking, r.walkingRoutes, r.traffic, r.facilities);
const demo = ALL.filter(x => x.demo).length;
const approved = ALL.filter(x => x.verificationStatus === 'approved').length;
const pending = r.pandals.filter(x => x.verificationStatus === 'pendingVerification').length;
console.log('File: ' + file);
console.log('Dataset ' + r.meta.datasetVersion + ' (schema ' + r.meta.schemaVersion + '), last updated ' + L.fmtDateTime(r.meta.lastUpdatedMs) + (r.meta.isDemoDataset ? ' [DEMO DATASET]' : ''));
var locOk = r.pandals.filter(function (p) { return L.isLocationConfirmed(p); }).length;
console.log('Valid records: ' + r.pandals.length + ' pandals (' + locOk + ' location confirmed, ' + pending + ' ops pending verification), ' +
  r.neighbourhoods.length + ' neighbourhoods, ' + r.parking.length + ' parking/drop, ' +
  r.walkingRoutes.length + ' walking routes, ' + r.traffic.length + ' traffic, ' +
  r.facilities.length + ' facilities (' + approved + ' approved, ' + demo + ' demo); skipped: ' + r.skipped.length);
if (!r.meta.isDemoDataset && demo) console.warn('WARNING: meta.isDemoDataset is false but ' + demo + ' demo record(s) are present.');
const now = Date.now();
const feed = L.trafficFeed(r.traffic, now);
const c = { active: feed.active.length, upcoming: feed.upcoming.length, visitorEligible: 0, referenceOrExpired: 0 };
r.traffic.forEach(x => {
  if (L.isVisitorTraffic(x)) c.visitorEligible++;
  else c.referenceOrExpired++;
});
console.log('Traffic visitor feed right now: ' + JSON.stringify(c));
console.log('Neighbourhoods: ' + r.neighbourhoods.map(n => n.name + ' (' + n.count + ')').join(', '));
if (problems || (r.errors && r.errors.length)) {
  console.error('RESULT: FAIL (' + problems + ' skipped, ' + (r.errors || []).length + ' errors). Fix before publishing.');
  process.exit(1);
}
console.log('RESULT: OK');
