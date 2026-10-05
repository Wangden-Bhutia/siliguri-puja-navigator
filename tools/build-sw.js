#!/usr/bin/env node
/* Regenerates VERSION (content hash) and ASSETS (app shell precache list) in service-worker.js.
   Run after changing any shipped file:  node tools/build-sw.js
   data/puja-data.json is intentionally NOT precached (it is network-first). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = process.env.SPN_ROOT ? path.resolve(process.env.SPN_ROOT) : path.join(__dirname, '..');
const SKIP = /^(\.git|\.gitignore|\.github|node_modules|tools|tests|docs|screenshots|data|README\.md|service-worker\.js|\.nojekyll|.*\.zip|.*\.md)(\/|$)/;
// branding.js: mark whether BOTH optional logo files exist (so the app never requests missing files)
const bp = path.join(root, 'branding.js');
if (fs.existsSync(bp)) {
  let b = fs.readFileSync(bp, 'utf8');
  const both = ['assets/logos/west-bengal-police.png', 'assets/logos/siliguri-metropolitan-police.png'].every(f => fs.existsSync(path.join(root, f)));
  b = b.replace(/logosPresent: (true|false) \/\*AUTO\*\//, 'logosPresent: ' + both + ' /*AUTO*/');
  fs.writeFileSync(bp, b);
  console.log('logos present: ' + both);
}

function walk(d, base) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const rel = path.posix.join(base, e.name);
    if (SKIP.test(rel)) return [];
    return e.isDirectory() ? walk(path.join(d, e.name), rel) : [rel];
  });
}
const files = walk(root, '').sort();
const h = crypto.createHash('sha1');
files.forEach(f => { h.update(f); h.update(fs.readFileSync(path.join(root, f))); });
const version = 'spn-shell-' + h.digest('hex').slice(0, 10);
const assets = ['./'].concat(files);
const p = path.join(root, 'service-worker.js');
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/^const VERSION = .*$/m, "const VERSION = '" + version + "';").replace(/^const ASSETS = .*$/m, 'const ASSETS = ' + JSON.stringify(assets) + ';');
fs.writeFileSync(p, s);
console.log(version + ' ' + assets.length + ' assets');
