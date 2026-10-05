# Siliguri Puja Navigator

**Find Your Pandal. Know Your Route.**
A mobile-first, installable web app (PWA) with a pandal directory, a map, parking, and *published* traffic-restriction schedules for Siliguri during the puja season.

> **Important:** the bundled `data/puja-data.json` is a **DEMO dataset** ("Sample data – not real pandals or orders"). It contains no real pandals or orders. Replace it with verified records before public use (see [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md)).
>
> The app **does not show live traffic** and never says a road is open. Schedules are copied from published information. *Traffic restrictions are subject to official orders and on-ground changes. Follow the directions of traffic police.*

Live site (after deployment): https://wangden-bhutia.github.io/siliguri-puja-navigator/

## Features
- **Simple visitor flow** (hash routes, Back button works, no menus/modals): Home (three big actions) → **Find a Pandal** (`#/find`) · **Parking & Walking Routes** (`#/parking`) · **Traffic Updates & Help** (`#/traffic`, `#/help`) · **Safety & info** (`#/info`). No map on the home screen; each screen creates its own Leaflet map lazily.
- Find a Pandal: searchable list (name, locality, landmark, road) + map; selecting a pandal shows its location and one primary **Directions** button (Google Maps link built safely: verified public entrance → pandal point → written address → disabled with an explanation). Location permission is asked only after tapping "Sort by distance from me".
- Parking & Walking: parking, designated drop-off / pick-up and pedestrian entrance/exit are separate record kinds; a walking route links an access point to a pandal entrance. Distance, time and the route line appear **only** when the route is marked verified. No turn-by-turn routing, no straight-line "routes".
- Traffic: restriction status computed in **Asia/Kolkata (fixed UTC+05:30)** (single windows, recurring daily windows, overnight). Labels **Active / Upcoming / Expired / Cancelled / Unverified** (text + icon, not colour only); incomplete or unverified data is never treated as active. Road/stretch, direction, vehicles, IST times, pedestrian access (verified only) and linked diversion points are shown.
- Help & facilities: toilets, drinking water, first aid, hospitals, police assistance booths; shown on the map only on demand. Hospital phone / emergency capability only when verified **and** flagged authorised.
- The Google-Maps disclaimer is shown on the navigation, traffic, help and info screens (verbatim; filled in by `app.js` from one constant).
- Refresh: fresh fetch (`no-store` + cache-bust) on open, on return to the app, when the network returns and about every 5 min while visible; one request at a time with a minimum interval; manual Refresh; the **last successful network refresh** is stored separately from the service-worker copy, shown in IST, and a failed refresh keeps the data but says "may be outdated".
- Map (Leaflet 1.9.4 + markercluster 1.5.3, self-hosted in `vendor/`). Tiles: OpenStreetMap standard tile server with attribution and a visible message when tiles are unavailable.
- Records need `source`, `verifiedAt`, `verifiedBy` to count as verified; invalid records are skipped with a visible data-quality warning.
- Offline: app shell cached by a service worker; `data/puja-data.json` is **network-first**.
- Privacy: no analytics, no tracking, no accounts. Geolocation only after a button tap, kept in memory, never stored or sent. Day/night theme choice is the only other thing stored locally.
- Accessible: skip link, landmarks, 44 px targets (primary buttons 50 px+), high contrast day and night themes, reduced-motion support; automated axe-core WCAG 2.1 A/AA checks pass.

## Files
```
index.html  styles.css  app.js  logic.js        app (logic.js = pure, shared with the tools)
data/puja-data.json                              the data you edit (DEMO now)
manifest.webmanifest  service-worker.js  offline.html  icons/
vendor/leaflet  vendor/markercluster             self-hosted libraries + licences
admin-preview.html  admin-preview.js             local-only validator/preview page (publishes nothing)
tools/validate-data.js  tools/build-sw.js        CLI validator; service-worker version/precache generator
tests/unit.js  tests/e2e.py                      unit tests (node) and Playwright tests (python; screenshots to $SHOTS)
docs/ADMIN-GUIDE.md  docs/DEPLOYMENT.md  docs/TEST-CHECKLIST.md
```

## Run locally
```sh
python3 -m http.server 8000      # then open http://localhost:8000/
```
Opening `index.html` directly (file://) also loads the shell and map but cannot load the data file (browsers block it) – the app then says so. The service worker only runs on http(s).

## Validate data
```sh
node tools/validate-data.js                 # checks data/puja-data.json
node tools/validate-data.js path/to/other.json
```
Or open `admin-preview.html` (local preview only; it cannot publish).

## Deploy (GitHub Pages)
```sh
git init -b main && git add -A && git commit -m "Siliguri Puja Navigator"
gh repo create Wangden-Bhutia/siliguri-puja-navigator --public --source=. --push
gh api -X POST repos/Wangden-Bhutia/siliguri-puja-navigator/pages -f "source[branch]=main" -f "source[path]=/"
curl -I https://wangden-bhutia.github.io/siliguri-puja-navigator/        # wait for 200
```
Details and troubleshooting: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## After changing code or assets
```sh
node tools/build-sw.js      # refreshes the service-worker cache version + precache list
node tests/unit.js
```
Changing only `data/puja-data.json` needs nothing else (the data is fetched network-first with cache-busting).

## Map tiles and the OSM tile usage policy
Tiles come from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. That server is run by volunteers; the [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) allows light use with attribution (included) and a valid Referer (the app sends one), and forbids heavy use or bulk downloading (the service worker deliberately does **not** cache tiles). This is fine for an MVP with modest traffic. If many people will use the app during the festival, switch to a commercial/hosted tile provider or your own tile server by changing the URL in `app.js` (`L.tileLayer(...)`) and adjusting the attribution and the `connect-src`/`img-src` CSP in `index.html` if needed.

## Known limits
- No live traffic, routing or road geometry is computed. "Directions" just opens Google Maps with the destination; Google chooses the route and does not know about local restrictions.
- Data is only as good as the records you publish. Keep `lastUpdated` honest.
- iOS Safari may not offer an install prompt; use Share → Add to Home Screen.
- This is an independent community project; it is not run or endorsed by the police or any authority.
