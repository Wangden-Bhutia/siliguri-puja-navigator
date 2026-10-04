# Deployment (GitHub Pages)

The site is static; there is no build step. It works from a sub-path (`/siliguri-puja-navigator/`) because every URL is relative.

## 1. Create the repository and push
```sh
cd siliguri-puja-navigator
node tools/build-sw.js            # refresh service-worker version + precache list
node tests/unit.js                # optional sanity check
git init -b main
git add -A
git commit -m "Siliguri Puja Navigator MVP"
gh auth setup-git                 # once, so git can push with the gh login
gh repo create Wangden-Bhutia/siliguri-puja-navigator --public --source=. --push
```

## 2. Enable Pages from `main` / (root)
```sh
gh api -X POST repos/Wangden-Bhutia/siliguri-puja-navigator/pages \
  -f "source[branch]=main" -f "source[path]=/"
```
(or: repository → Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.)
The `.nojekyll` file makes Pages serve files as-is.

## 3. Wait and verify
```sh
B=https://wangden-bhutia.github.io/siliguri-puja-navigator
for f in "" index.html data/puja-data.json service-worker.js manifest.webmanifest offline.html \
         icons/icon-192.png icons/icon-512.png icons/icon-maskable-512.png icons/apple-touch-icon.png \
         vendor/leaflet/leaflet.js vendor/leaflet/leaflet.css vendor/markercluster/leaflet.markercluster.js; do
  printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' "$B/$f")"; echo "$f"
done
```
The first deploy usually takes 1–3 minutes (404 until then).

## 4. Updating
- **Data only:** edit `data/puja-data.json`, commit. Nothing else needed.
- **Code/assets:** run `node tools/build-sw.js` before committing so installed apps pick up the new service worker (the cache name contains a content hash).
- Browsers revalidate the service worker script on each visit; users get the new shell on the next load after the new worker activates.

## 5. Notes
- HTTPS is required for the service worker, install prompt and geolocation – Pages provides it.
- GitHub Pages sends `Cache-Control: max-age=600` for files; the app avoids stale data by fetching the data file with `cache: 'no-store'` plus a cache-busting query string, and the service worker handles it network-first.
- Custom domain: add a `CNAME` file via Settings → Pages; no code changes are needed (paths are relative).
- Traffic: GitHub Pages has soft bandwidth limits (100 GB/month) and OpenStreetMap tiles have a usage policy – see README. For heavy festival traffic plan a tile provider and consider a CDN.
- Security: a `<meta>` Content-Security-Policy restricts scripts/connections to the site itself (and images to https for tiles/photos). Pages cannot set HTTP headers, so `frame-ancestors` and similar are unavailable.
