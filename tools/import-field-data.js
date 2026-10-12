#!/usr/bin/env node
/* Import a filled-in Field Data Collection Pack (.docx, same layout as
   tools/build-field-data-pack.js produces) into data/puja-data.json.

   Usage:
     node tools/import-field-data.js <filled.docx>              dry run: writes a preview + report, changes nothing
     node tools/import-field-data.js <filled.docx> --apply       writes data/puja-data.json (after a timestamped backup)

   How it reads the document: converts it with `pandoc -t json` and reads the
   structured table AST (not rendered text), so cell content is read exactly as
   typed regardless of how Word wraps or re-flows a cell.

   What it does NOT do: it never sets verificationStatus to "approved" or
   "fieldVerified", and it never auto-rewrites an existing pandal's name from
   the Notes column. A field survey is a first pass, not a sign-off — matches
   the rule already enforced by logic.js (verifyDataset) that approved/
   fieldVerified records must name verifiedBy, which a bulk import can't supply
   honestly. Status changes needing judgement (name "Wrong", pandal
   "Not found") are written to the report for a human to action, not applied.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../logic.js');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'puja-data.json');

function usage() {
  console.error('Usage: node tools/import-field-data.js <filled.docx> [--apply]');
  process.exit(1);
}

const args = process.argv.slice(2);
const docxPath = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
if (!docxPath) usage();
if (!fs.existsSync(docxPath)) { console.error('File not found: ' + docxPath); process.exit(1); }

/* ---------- pandoc JSON table extraction ---------- */
function runPandocJson(file) {
  const out = execFileSync('pandoc', ['-t', 'json', file], { maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8'));
}
function inlineText(inl) {
  if (!inl) return '';
  return inl.map((x) => {
    if (x.t === 'Str') return x.c;
    if (x.t === 'Space') return ' ';
    if (x.t === 'SoftBreak') return ' ';
    if (x.c && Array.isArray(x.c)) return inlineText(x.c);
    return '';
  }).join('');
}
function cellText(cell) {
  const blocks = cell[4] || [];
  return blocks.map((b) => (b.t === 'Para' || b.t === 'Plain') ? inlineText(b.c) : '').join(' ').replace(/\s+/g, ' ').trim();
}
function rowCells(row) { return row[1].map(cellText); }
function extractTables(doc) {
  return (doc.blocks || []).filter((b) => b.t === 'Table').map((t) => {
    let header = rowCells(t.c[3][1][0] || [null, []]);
    let bodyRowsRaw = (t.c[4] || []).flatMap((body) => body[3] || []);
    // Word did not mark a header row (e.g. the file was re-saved by another
    // editor and lost the "repeat header row" flag) -> fall back to treating
    // the first body row as the header, as long as it looks non-empty.
    if (!header.length && bodyRowsRaw.length) {
      header = rowCells(bodyRowsRaw[0]);
      bodyRowsRaw = bodyRowsRaw.slice(1);
    }
    const rows = bodyRowsRaw.map(rowCells);
    return { header, rows };
  });
}
function findTableByHeader(tables, mustInclude) {
  return tables.find((t) => mustInclude.every((h) => t.header.some((c) => c.toLowerCase() === h.toLowerCase())));
}
function col(table, name) { return table.header.findIndex((h) => h.toLowerCase() === name.toLowerCase()); }

/* ---------- small parsing helpers ---------- */
function clean(s) { return (s || '').trim(); }
function isBlankRow(cells) { return cells.every((c) => !clean(c)); }
function parseGps(s) {
  s = clean(s);
  if (!s) return null;
  const m = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/.exec(s);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (!L.validCoords(lat, lon)) return null;
  return { lat, lon };
}
// "Confirmed / Wrong / Not found" (untouched placeholder) -> null (not filled in)
// "Confirmed" / "Wrong" / "Not found" / anything containing exactly one of the three -> that one
function parseStatus(s) {
  s = clean(s).toLowerCase();
  const has = { confirmed: /confirmed/.test(s), wrong: /wrong/.test(s), notfound: /not found/.test(s) };
  const count = Object.values(has).filter(Boolean).length;
  if (count !== 1) return null; // untouched placeholder, or unclear edit
  if (has.confirmed) return 'confirmed';
  if (has.wrong) return 'wrong';
  return 'notfound';
}
function slugId(prefix, name, used) {
  var base = prefix + '-' + L.slug(name).slice(0, 24);
  var id = base, n = 2;
  while (used[id]) { id = base + '-' + n; n++; }
  used[id] = true;
  return id;
}
function normName(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
// lenient "18 Oct, 6 PM" / "18 Oct 2026 6:30 PM" -> "YYYY-MM-DDTHH:MM+05:30", or null if unparseable
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseLenientIST(s, assumedYear) {
  s = clean(s);
  if (!s) return null;
  const m = /(\d{1,2})\s*([A-Za-z]{3,})\s*(\d{4})?[,\s]+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/.exec(s);
  if (!m) return null;
  const day = +m[1], monKey = m[2].slice(0, 3).toLowerCase(), year = m[3] ? +m[3] : assumedYear;
  const mo = MONTHS[monKey];
  if (!mo || !year) return null;
  let h = +m[4], mi = m[5] ? +m[5] : 0;
  const ap = (m[6] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  const iso = year + '-' + String(mo).padStart(2, '0') + '-' + String(day).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':00+05:30';
  return isFinite(L.parseIST(iso)) ? iso : null;
}
function restrictionTypeFromText(s) {
  s = clean(s).toLowerCase();
  if (/no.?entry/.test(s)) return 'noEntry';
  if (/one.?way/.test(s)) return 'oneWay';
  if (/diversion/.test(s)) return 'diversion';
  if (/relocat/.test(s)) return 'routeRelocation';
  if (/control/.test(s)) return 'controlledMovement';
  if (/vehicle|class|restrict/.test(s)) return 'vehicleClassRestriction';
  return 'diversion';
}

/* ---------- load existing data ---------- */
const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const today = new Date();
const todayIso = today.toISOString().slice(0, 10);
const SOURCE = 'Field Data Collection Pack 2026';
const usedIds = {};
(raw.pandals || []).forEach((p) => { usedIds[p.id] = true; });
(raw.parking || []).forEach((p) => { usedIds[p.id] = true; });
(raw.traffic || []).forEach((p) => { usedIds[p.id] = true; });
(raw.facilities || []).forEach((p) => { usedIds[p.id] = true; });

const report = { updatedPandals: [], newPandals: [], flagged: [], newParking: [], unmatchedParkingPandals: [], newTraffic: [], unresolvedTrafficTimes: [], newFacilities: [], newContacts: [], skippedBlankRows: 0 };

// index existing pandals by normalized (locality, name) for the checklist match
const pandalByKey = {};
(raw.pandals || []).forEach((p) => { pandalByKey[normName(p.locality) + '|' + normName(p.name)] = p; });
function findPandalByName(name) {
  const nk = normName(name);
  const hit = (raw.pandals || []).find((p) => normName(p.name) === nk);
  return hit || null;
}

/* ---------- read tables ---------- */
const doc = runPandocJson(docxPath);
const tables = extractTables(doc);

const tPandal = findTableByHeader(tables, ['Pandal name (as listed)', 'GPS coordinates', 'Status (circle one)']);
const tParking = findTableByHeader(tables, ['Serves which pandal(s)', 'Walk distance (m)']);
const tTraffic = findTableByHeader(tables, ['Road / junction affected', 'Restriction type']);
const tFacilities = findTableByHeader(tables, ['Type (Police Booth / Hospital)', 'Contact number']);
const tContacts = findTableByHeader(tables, ['Organisation / role', 'Phone number']);

/* ---------- 1. Pandal verification checklist ---------- */
if (tPandal) {
  const cLoc = col(tPandal, 'Neighbourhood'), cName = col(tPandal, 'Pandal name (as listed)'),
    cStatus = col(tPandal, 'Status (circle one)'), cGps = col(tPandal, 'GPS coordinates'), cNotes = col(tPandal, 'Notes / correction');
  tPandal.rows.forEach((cells) => {
    if (isBlankRow(cells)) { report.skippedBlankRows++; return; }
    const loc = clean(cells[cLoc]), name = clean(cells[cName]), status = parseStatus(cells[cStatus]),
      gps = parseGps(cells[cGps]), notes = clean(cells[cNotes]);
    const existing = loc && name ? pandalByKey[normName(loc) + '|' + normName(name)] : (name ? findPandalByName(name) : null);

    if (existing) {
      if (status === null && !gps && !notes) return; // completely untouched row
      if (status === 'confirmed' || (status === null && gps)) {
        const changes = {};
        if (gps && (existing.lat !== gps.lat || existing.lon !== gps.lon)) { existing.latitude = gps.lat; existing.longitude = gps.lon; changes.coords = gps; }
        if (gps && existing.locationStatus !== 'confirmed') { existing.locationStatus = 'confirmed'; changes.locationStatus = 'confirmed'; }
        if (Object.keys(changes).length) {
          existing.lastVerified = todayIso; existing.lastUpdated = todayIso;
          if (!existing.source) existing.source = SOURCE;
          report.updatedPandals.push({ id: existing.id, name: existing.name, locality: existing.locality, changes, notes });
        }
      } else if (status === 'wrong' || status === 'notfound') {
        report.flagged.push({ id: existing.id, name: existing.name, locality: existing.locality, status, notes });
      }
    } else if (loc && name) {
      // row filled in for a pandal not on the printed list -> new pandal
      const id = slugId('SG26-NEW', name, usedIds);
      const np = {
        id, name, locality: loc, verificationStatus: 'pendingVerification', demo: false,
        source: SOURCE, lastVerified: todayIso, lastUpdated: todayIso,
        locationStatus: gps ? 'confirmed' : 'unconfirmed',
      };
      if (gps) { np.latitude = gps.lat; np.longitude = gps.lon; }
      if (notes) np._fieldNotes = notes;
      raw.pandals.push(np);
      pandalByKey[normName(loc) + '|' + normName(name)] = np;
      report.newPandals.push({ id, name, locality: loc, hasGps: !!gps, notes });
    }
  });
}

/* ---------- 2. Parking & drop-off points ---------- */
if (tParking) {
  const cName = col(tParking, 'Parking / drop point name or landmark'), cGps = col(tParking, 'GPS coordinates'),
    cServes = col(tParking, 'Serves which pandal(s)'), cDist = col(tParking, 'Walk distance (m)'),
    cTime = col(tParking, 'Walk time (min)'), cNotes = col(tParking, 'Limitations / notes');
  raw.parking = raw.parking || [];
  tParking.rows.forEach((cells) => {
    if (isBlankRow(cells)) { report.skippedBlankRows++; return; }
    const name = clean(cells[cName]); if (!name) return;
    const gps = parseGps(cells[cGps]);
    const servesNames = clean(cells[cServes]).split(/[,;/]|(?:\band\b)/i).map((s) => s.trim()).filter(Boolean);
    const servedPandalIds = [];
    servesNames.forEach((sn) => { const p = findPandalByName(sn); if (p) servedPandalIds.push(p.id); else if (sn) report.unmatchedParkingPandals.push({ parkingName: name, text: sn }); });
    const id = slugId('PK26', name, usedIds);
    const rec = { id, name, verificationStatus: 'pendingVerification', demo: false, source: SOURCE, lastVerified: todayIso, lastUpdated: todayIso, type: 'parking', servedPandalIds };
    if (gps) { rec.latitude = gps.lat; rec.longitude = gps.lon; }
    const dist = parseInt(clean(cells[cDist]), 10); if (isFinite(dist) && dist > 0) rec.walkingDistance = dist;
    const time = parseInt(clean(cells[cTime]), 10); if (isFinite(time) && time > 0) rec.walkingTime = time;
    const notes = clean(cells[cNotes]); if (notes) rec.limitations = notes;
    raw.parking.push(rec);
    report.newParking.push({ id, name, servedPandalIds, hasGps: !!gps });
  });
}

/* ---------- 3. Traffic restrictions ---------- */
if (tTraffic) {
  const cRoad = col(tTraffic, 'Road / junction affected'), cType = col(tTraffic, 'Restriction type'),
    cVeh = col(tTraffic, 'Vehicles affected'), cStart = col(tTraffic, 'Start date & time'),
    cEnd = col(tTraffic, 'End date & time'), cNotes = col(tTraffic, 'Diversion / notes');
  raw.traffic = raw.traffic || [];
  const assumedYear = new Date(raw.meta.lastUpdated || Date.now()).getFullYear() || today.getFullYear();
  tTraffic.rows.forEach((cells) => {
    if (isBlankRow(cells)) { report.skippedBlankRows++; return; }
    const road = clean(cells[cRoad]); if (!road) return;
    const id = slugId('TR26', road, usedIds);
    const start = parseLenientIST(cells[cStart], assumedYear), end = parseLenientIST(cells[cEnd], assumedYear);
    const rec = {
      id, name: road, affectedRoad: road, verificationStatus: 'pendingVerification', demo: false,
      source: SOURCE, lastVerified: todayIso, lastUpdated: todayIso,
      restrictionType: restrictionTypeFromText(cells[cType]), status: 'scheduled',
      vehicleTypes: clean(cells[cVeh]) ? [clean(cells[cVeh])] : [],
      visitorAction: clean(cells[cNotes]) || 'Follow on-ground police directions.',
    };
    if (start) rec.plannedStart = start; else if (clean(cells[cStart])) report.unresolvedTrafficTimes.push({ id, field: 'start', text: clean(cells[cStart]) });
    if (end) rec.plannedEnd = end; else if (clean(cells[cEnd])) report.unresolvedTrafficTimes.push({ id, field: 'end', text: clean(cells[cEnd]) });
    raw.traffic.push(rec);
    report.newTraffic.push({ id, road, hasWindow: !!(start && end) });
  });
}

/* ---------- 4. Facilities ---------- */
if (tFacilities) {
  const cType = col(tFacilities, 'Type (Police Booth / Hospital)'), cName = col(tFacilities, 'Name'),
    cGps = col(tFacilities, 'GPS coordinates'), cLandmark = col(tFacilities, 'Landmark'), cPhone = col(tFacilities, 'Contact number');
  raw.facilities = raw.facilities || [];
  tFacilities.rows.forEach((cells) => {
    if (isBlankRow(cells)) { report.skippedBlankRows++; return; }
    const name = clean(cells[cName]); if (!name) return;
    const typeText = clean(cells[cType]).toLowerCase();
    const type = /hosp/.test(typeText) ? 'hospital' : 'police-booth';
    const gps = parseGps(cells[cGps]);
    const id = slugId('FC26', name, usedIds);
    const rec = {
      id, name, type, verificationStatus: 'pendingVerification', demo: false, source: SOURCE,
      lastVerified: todayIso, lastUpdated: todayIso, locationStatus: gps ? 'mapped' : 'unconfirmed',
      landmark: clean(cells[cLandmark]),
    };
    if (gps) { rec.latitude = gps.lat; rec.longitude = gps.lon; }
    const phone = clean(cells[cPhone]); if (phone) rec._fieldPhone = phone; // not auto-published; see help.contacts rule
    raw.facilities.push(rec);
    report.newFacilities.push({ id, name, type, hasGps: !!gps, phone });
  });
}

/* ---------- 5. Emergency & help contacts ---------- */
if (tContacts) {
  const cOrg = col(tContacts, 'Organisation / role'), cName = col(tContacts, 'Contact name'),
    cPhone = col(tContacts, 'Phone number'), cNotes = col(tContacts, 'Notes');
  raw.help = raw.help || { emergencyNumber: '112', contacts: [] };
  raw.help.contacts = raw.help.contacts || [];
  tContacts.rows.forEach((cells) => {
    if (isBlankRow(cells)) { report.skippedBlankRows++; return; }
    const org = clean(cells[cOrg]); if (!org) return;
    const id = slugId('HC26', org, usedIds);
    // Phone is captured but verificationStatus stays pendingVerification, so
    // validateDataset will not surface it to visitors until someone approves it.
    raw.help.contacts.push({
      id, name: org + (clean(cells[cName]) ? ' (' + clean(cells[cName]) + ')' : ''),
      phone: clean(cells[cPhone]), verificationStatus: 'pendingVerification',
    });
    report.newContacts.push({ id, org, phone: clean(cells[cPhone]), notes: clean(cells[cNotes]) });
  });
}

/* ---------- validate the merged result ---------- */
const check = L.validateDataset(raw);
if (!check.ok) {
  console.error('FATAL: merged data no longer validates: ' + check.fatal);
  process.exit(1);
}
// A record can be written into raw.* above but still be dropped by the app's
// own validation rules (e.g. a facility without coordinates is skipped
// outright — logic.js keeps pandals without coords listed, but not
// facilities). Surface that now rather than let it go unnoticed after --apply.
const addedIds = new Set([
  ...report.newPandals.map((r) => r.id), ...report.newParking.map((r) => r.id),
  ...report.newTraffic.map((r) => r.id), ...report.newFacilities.map((r) => r.id),
]);
report.droppedByValidation = check.skipped.filter((s) => addedIds.has(s.id));

/* ---------- write outputs ---------- */
function printSummary() {
  console.log('--- Field data import summary ---');
  console.log('Pandals updated (GPS/confirmed):', report.updatedPandals.length);
  console.log('Pandals flagged for review (wrong/not found):', report.flagged.length);
  console.log('New pandals added:', report.newPandals.length);
  console.log('New parking points added:', report.newParking.length, '(unmatched "serves" text:', report.unmatchedParkingPandals.length + ')');
  console.log('New traffic records added:', report.newTraffic.length, '(unresolved date/time text:', report.unresolvedTrafficTimes.length + ')');
  console.log('New facilities added:', report.newFacilities.length);
  console.log('New help contacts added:', report.newContacts.length);
  console.log('Blank rows skipped:', report.skippedBlankRows);
  if (check.errors.length) console.log('Validator warnings/errors on merged data:', check.errors.length, '(run tools/validate-data.js for details)');
  if (report.droppedByValidation.length) {
    console.log('WARNING: ' + report.droppedByValidation.length + ' newly-added record(s) will NOT appear in the app (missing required data):');
    report.droppedByValidation.forEach((s) => console.log('  - ' + s.kind + ' "' + s.id + '": ' + s.reasons.join('; ')));
  }
}
printSummary();

const reportPath = path.join(ROOT, (APPLY ? 'data' : '.'), 'field-import-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log('Report written to', path.relative(ROOT, reportPath));

if (APPLY) {
  const backupPath = DATA_PATH.replace(/\.json$/, '.backup-' + Date.now() + '.json');
  fs.copyFileSync(DATA_PATH, backupPath);
  fs.writeFileSync(DATA_PATH, JSON.stringify(raw, null, 2) + '\n');
  console.log('Applied. Backup of the previous file: ' + path.relative(ROOT, backupPath));
  console.log('Run `node tools/validate-data.js` to re-check, and review the report for flagged/unresolved items before publishing.');
} else {
  const previewPath = path.join(ROOT, 'data', 'puja-data.import-preview.json');
  fs.writeFileSync(previewPath, JSON.stringify(raw, null, 2) + '\n');
  console.log('Dry run only — nothing in data/puja-data.json changed.');
  console.log('Preview written to ' + path.relative(ROOT, previewPath) + '. Re-run with --apply to write it for real.');
}
