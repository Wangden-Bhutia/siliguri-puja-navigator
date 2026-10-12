# Deployment (Cloudflare Pages via GitHub Actions)

The site is static; there is no build step. Deployment is automated: every push to `main` runs `.github/workflows/deploy.yml`, which validates the data, runs the unit tests, refreshes the service-worker precache list, and deploys to Cloudflare Pages.

## One-time setup (already done for this repo)
1. A Cloudflare Pages project named `siliguri-puja-guide` exists in the Cloudflare account (the deploy workflow creates it automatically on first run if it doesn't exist).
2. Two repository secrets are set under GitHub → Settings → Secrets and variables → Actions:
   - `CLOUDFLARE_API_TOKEN` — needs **Account → Cloudflare Pages → Edit** *and* **Account → Workers Scripts → Edit** (Cloudflare Pages deploys run through the unified Workers runtime, so the narrower Pages-only scope is not enough).
   - `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard URL or account home page.

## Normal updates
- **Data only:** edit `data/puja-data.json`, commit, push to `main`. Nothing else needed.
- **Code/assets:** just commit and push; `tools/build-sw.js` runs automatically in the deploy workflow.
- `ci.yml` also runs data validation + unit tests on every push and pull request (including non-`main` branches), independent of deploy.

## Verify
```sh
B=https://siliguri-puja-guide.pages.dev
for f in "" index.html data/puja-data.json service-worker.js manifest.webmanifest offline.html \
         icons/icon-192.png icons/icon-512.png icons/icon-maskable-512.png icons/apple-touch-icon.png \
         vendor/leaflet/leaflet.js vendor/leaflet/leaflet.css vendor/markercluster/leaflet.markercluster.js; do
  printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' "$B/$f")"; echo "$f"
done
```

## Notes
- HTTPS is required for the service worker, install prompt and geolocation – Cloudflare Pages provides it.
- Custom domain: can be added under the Pages project's Custom Domains settings; no code changes needed (paths are relative). This costs nothing on Cloudflare's side, only the domain registration itself if you don't already own one.
- The deploy bundle excludes `tools/`, `tests/`, `docs/`, and `data/sources/` (raw source CSVs) — see the `rsync --exclude` list in `deploy.yml` — so only the files the app actually needs are published.
- Security: a `<meta>` Content-Security-Policy restricts scripts/connections to the site itself (and images to https for tiles/photos). Cloudflare Pages can also set real HTTP headers via a `_headers` file if `frame-ancestors` or similar become necessary later (GitHub Pages could not do this).
- Traffic: OpenStreetMap tiles have a usage policy — see the "Map tiles" section in the main README. For heavy festival traffic, consider a dedicated tile provider.
- A previous Cloudflare Worker (`siliguri-puja-navigator`, serving under the account's shared `workers.dev` subdomain) was deleted — it exposed the account owner's name in its URL and duplicated this Pages deployment. Don't recreate a Worker Git integration for this repo; this site is static and belongs on Pages.
