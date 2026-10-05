# Test checklist

## Automated
```sh
node tests/unit.js                          # status maths, validation, links, search, copy lint (run also with TZ=America/Los_Angeles)
node tools/validate-data.js                 # data file
python tests/e2e.py [BASE_URL]              # Playwright (Chrome): 390x844 touch + desktop; needs `pip install playwright`
```
`tests/e2e.py` expects the site served at `BASE_URL` (default `http://127.0.0.1:8777/siliguri-puja-navigator/`, i.e. a sub-path), stubs the OSM tiles, and writes screenshots to `$SHOTS` (default `/workspace/siliguri-puja-navigator-shots-v2/`). Optional axe-core: set `AXE=/path/to/axe.min.js`.

What they cover: IST status maths at every boundary (start inclusive / end exclusive, overnight, multi-day, expired never active, incomplete = Unverified, device-timezone independence); validation of every record kind (required fields, lat/lon ranges, unique ids across kinds, route → access point + entrance references, diversion → restriction references, verified-only distance/time/entrance/phone/emergency flags); the bundled demo file (nothing verified, no phone numbers, no straight-line routes); Directions priority and disabled state; search/empty states/missing coordinates; hash navigation and Back; geolocation never requested on load, granted/denied/outside; refresh in-flight guard, rate limit, manual button, visibilitychange, 5-minute timer (fake clock), failures (abort/500/invalid JSON/invalid structure) keeping data with a "may be outdated" state; offline reload, cache-copy vs real refresh time, `offline.html`; disclaimer text on each screen; XSS strings; file://; no console errors; no horizontal scroll; 44 px targets; axe in day and night themes; no external hosts except OSM tiles.

## Manual (real devices) – do before publishing real data
- [ ] Android Chrome: open the live site, install, go offline (airplane mode) and reopen: shell loads, offline banner appears.
- [ ] iPhone Safari: Add to Home Screen; open; map and lists work; locate-me asks for permission only when pressed.
- [ ] Press "Find pandals near me": allow → distances shown; deny → friendly message.
- [ ] Pick a date/time in the checker: the statuses change as expected for a record you know (try the exact start and end minute).
- [ ] Every record in the real dataset has `source`, `verifiedAt`, `verifiedBy`; run `node tools/validate-data.js` → `RESULT: OK`.
- [ ] `meta.isDemoDataset` is `false`, no `DEMO –` records remain, `lastUpdated` is current.
- [ ] Spot-check 3 "Directions" links against the real location.
- [ ] Read the Info & safety section once more: disclaimer, privacy, emergency number (112).
- [ ] Screen reader smoke test (TalkBack/VoiceOver): skip link, headings, badges read with their text, map markers reachable, list alternative usable.
- [ ] Large text (200%) and landscape orientation: no clipped controls.

### Android (Chrome) quick checklist for the visitor flow
- [ ] Home shows the three big buttons without scrolling past the first screen; the freshness line shows a time in IST.
- [ ] Find a Pandal → search → tap a result → one "Directions" button; it opens Google Maps (or the browser) at the expected place. Pandal without a location shows a disabled button with a reason.
- [ ] Back button returns step by step (detail → list → home); it never exits unexpectedly.
- [ ] Location: nothing is asked until "Sort by distance from me" is tapped; Deny → app still works.
- [ ] Parking & Walking: demo records say "not verified"; no route line and no distance/time on unverified routes.
- [ ] Traffic: labels read Active / Upcoming / Expired / Unverified; change the date/time to 22:00–05:00 boundaries on a real record.
- [ ] Help: facilities hidden on the map until "Show these on the map" or "Show on map" is tapped.
- [ ] Airplane mode → reopen: saved data with a "may be outdated" notice; reconnect → tap Refresh → notice disappears and the IST refresh time changes.
- [ ] Outdoors at night: Night mode readable at low and full brightness; buttons usable with gloves/one hand.
- [ ] Disclaimer visible on Find (with a selected pandal), Parking, Traffic, Help and Safety screens.
