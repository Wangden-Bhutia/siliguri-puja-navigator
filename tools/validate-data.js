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
r.notices.forEach(n => console.warn('note: ' + n));

const pandalIds = new Set(r.pandals.map(p => p.id)), rIds = new Set(r.restrictions.map(x => x.id));
r.pandals.forEach(p => (p.restrictionIds || []).forEach(id => { if (!rIds.has(id)) console.warn('note: pandal ' + p.id + ' refers to unknown restriction "' + id + '"'); }));

const demo = [].concat(r.pandals, r.parking, r.restrictions).filter(x => x.demo).length;
const verified = [].concat(r.pandals, r.parking, r.restrictions).filter(x => x.verified).length;
console.log('File: ' + file);
console.log('Dataset ' + r.meta.datasetVersion + ', last updated ' + L.fmtDateTime(r.meta.lastUpdatedMs) + (r.meta.isDemoDataset ? ' [DEMO DATASET]' : ''));
console.log('Valid records: ' + r.pandals.length + ' pandals, ' + r.parking.length + ' parking, ' + r.restrictions.length + ' restrictions (' + verified + ' verified, ' + demo + ' demo); drafts hidden: ' + r.draftCount + '; skipped: ' + r.skipped.length);
if (!r.meta.isDemoDataset && demo) console.warn('WARNING: meta.isDemoDataset is false but ' + demo + ' demo record(s) are present.');
if (r.meta.isDemoDataset && verified) console.warn('WARNING: meta.isDemoDataset is true but verified records are present.');
const now = Date.now();
const c = { active: 0, upcoming: 0, expired: 0, cancelled: 0, unconfirmed: 0 };
r.restrictions.forEach(x => c[L.evaluateRestriction(x, now).state]++);
console.log('Restriction states right now (IST schedule maths): ' + JSON.stringify(c));
if (problems) { console.error('RESULT: ' + problems + ' record(s) would be skipped by the app. Fix them before publishing.'); process.exit(1); }
console.log('RESULT: OK');
