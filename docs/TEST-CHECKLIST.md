# Test checklist

## Automated
```sh
node tests/unit.js                          # status maths, validation, links, search, copy lint (run also with TZ=America/Los_Angeles)
node tools/validate-data.js                 # data file
python tests/e2e.py [BASE_URL]              # Playwright (Chrome): 390x844 touch + desktop; needs `pip install playwright`
```
`tests/e2e.py` expects the site served at `BASE_URL` (default `http://127.0.0.1:8777/siliguri-puja-navigator/`, i.e. a sub-path), stubs the OSM tiles, and writes screenshots to `/workspace/siliguri-puja-navigator-shots/`. Optional axe-core: set `AXE=/path/to/axe.min.js`.

What they cover: status maths for every boundary minute in IST (start inclusive / end exclusive, midnight crossing, multi-day, expired, cancelled, unconfirmed, device-timezone independence); validation (missing source/verifiedAt/verifiedBy, bad coordinates, duplicate ids, bad schedules, drafts); Google Maps link correctness and disabled state; search/filter/clear; markers vs list counts; layer toggles; clustering; popups; geolocation granted/denied/outside; corrupt/404/500/invalid data → data-unavailable; offline reload with stale-data banner; offline.html for uncached navigation; network-first data; XSS strings; file:// without errors; no horizontal scroll; 44 px targets; 16 px inputs; axe WCAG 2.1 A/AA; reduced motion; install prompt; admin-preview page; subpath hosting; no external hosts except OSM tiles.

## Manual (real devices) – do before publishing real data
- [ ] Android Chrome: open the live site, install, go offline (airplane mode) and reopen: shell loads, offline banner appears.
- [ ] iPhone Safari: Add to Home Screen; open; map and lists work; locate-me asks for permission only when pressed.
- [ ] Press "Find pandals near me": allow → distances shown; deny → friendly message.
- [ ] Pick a date/time in the checker: the statuses change as expected for a record you know (try the exact start and end minute).
- [ ] Every record in the real dataset has `source`, `verifiedAt`, `verifiedBy`; run `node tools/validate-data.js` → `RESULT: OK`.
- [ ] `meta.isDemoDataset` is `false`, no `DEMO –` records remain, `lastUpdated` is current.
- [ ] Spot-check 3 "Navigate with Google Maps" links against the real location.
- [ ] Read the Info & safety section once more: disclaimer, privacy, emergency number (112).
- [ ] Screen reader smoke test (TalkBack/VoiceOver): skip link, headings, badges read with their text, map markers reachable, list alternative usable.
- [ ] Large text (200%) and landscape orientation: no clipped controls.
