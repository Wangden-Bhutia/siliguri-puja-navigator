# Admin guide – replacing the demo data with verified data

All content lives in **`data/puja-data.json`**. The app reads it on every visit (network-first), so after you commit a change and GitHub Pages redeploys, users see it on their next load – no version numbers to bump.

> The file is **public**. Never put private notes, phone numbers or personal names in it. `adminNotes` fields are *not shown* in the app but are visible to anyone who opens the JSON.

## 1. What the demo data is
Every record in the bundled file is a placeholder: names start with `DEMO –`, `status` is `demo`, `demo` is `true`, locations are generic points near Siliguri's centre (~26.7271, 88.3953) with `approximateLocation: true`, and `meta.isDemoDataset` is `true`, which shows the "Sample data – not real pandals or orders" banner. The demo restrictions exist only to exercise the app: a midnight-crossing recurring window, a multi-day span, expired, cancelled, unconfirmed and scheduled-future.

**To go live:** delete the demo records, add verified ones, set `"isDemoDataset": false`, update `datasetVersion` and `lastUpdated`, run the validator, commit.

## 2. Structure
```jsonc
{
  "meta": {
    "datasetVersion": "2026-10-01.1",
    "lastUpdated": "2026-10-01T18:30:00+05:30",   // ISO time WITH +05:30 – shown to users
    "isDemoDataset": false,
    "festival": { "name": "Durga Puja 2026", "startDate": "2026-10-17", "endDate": "2026-10-21", "note": "" },
    "notice": ""                                   // optional text for the demo banner only
  },
  "pandals": [ ... ], "parking": [ ... ], "restrictions": [ ... ]
}
```
**All times are India time with an explicit `+05:30` offset** (`2026-10-18T22:00:00+05:30`). Times without an offset, or with `Z`, are rejected. Dates are `YYYY-MM-DD`, daily times `HH:MM` (24-hour; `24:00` allowed for a window end).

### Pandal
| field | notes |
|---|---|
| `id` | unique; letters, digits, `.`, `_`, `-` |
| `name`, `locality` | required: `name`. `locality` strongly recommended (used for the filter) |
| `address` | text; also used for navigation if there are no coordinates |
| `lat`, `lon` | numbers (not strings) inside the Siliguri box: lat 26.5–27.0, lon 88.2–88.7. Both or neither. Without coordinates the pandal is listed but not drawn; with neither coordinates nor address the Navigate button is disabled |
| `approximateLocation` | `true` if the point is not exact |
| `description`, `timings`, `entrance`, `nearestParking`, `accessibility` | free text |
| `restrictionIds` | list of restriction `id`s to cross-link |
| `imageUrl` | optional; relative path or `https://` URL (loaded only when "More details" is opened) |
| `source`, `verifiedAt`, `verifiedBy` | **required for `official` / `admin-verified`** |
| `status` | `official`, `admin-verified`, `unconfirmed`, `demo`, `draft` |
| `demo` | `true` only for sample data |

### Parking
`id`, `name`, `locality`, `address`, `lat`, `lon`, `capacity` (number), `vehicleTypes` (list), `notes`, `source`, `verifiedAt`, `verifiedBy`, `status`, `demo`.

### Restriction
| field | notes |
|---|---|
| `id`, `name` | required |
| `type` | `no-entry`, `vehicle-restriction`, `one-way`, `diversion`, `parking-restriction`, `pedestrian-zone`, `other` |
| `description`, `locationText`, `roads` | `locationText` or a valid point is required; `roads` (list) is searchable |
| `lat`, `lon` | optional approximate point |
| **single window** | `start`, `end` – e.g. 18 Oct 6 PM to 20 Oct 11:59 PM. `end` must be after `start`. Start is inclusive, end exclusive |
| **recurring daily window** | `"recurring": {"dateStart":"2026-10-17","dateEnd":"2026-10-21","dailyStart":"22:00","dailyEnd":"05:00"}`. If `dailyEnd` is earlier than `dailyStart` the window crosses midnight and ends the next morning. `dateStart`/`dateEnd` are the first/last dates on which a daily window **starts** (so the 21st's night window runs until 05:00 on the 22nd). Max 366 days |
| | Use **either** `start`/`end` **or** `recurring`, never both. (Only `unconfirmed` records may omit the schedule.) |
| `vehicleTypes`, `pedestrianAccess`, `alternativeAccess` | text/list shown on the card |
| `authority` | issuing office, e.g. "Siliguri Police Commissionerate – Traffic" |
| `source` | what you copied this from, e.g. "Traffic advisory no. 12/2026 dated 1 Oct 2026" |
| `sourceUrl` | optional `http(s)` link to the order/post |
| `verifiedAt`, `verifiedBy` | when and by whom (a **public role/office**, e.g. "Site admin – verification desk"; not a private name) |
| `cancelled` | `true` if a published cancellation exists (requires source/verifiedAt/verifiedBy) |
| `status` | `official`, `admin-verified`, `unconfirmed`, `demo`, `draft` |
| `geometry`, `geometryVerified` | optional GeoJSON `LineString` (`[lon,lat]` pairs). **Only drawn if `geometryVerified` is `true`, valid, and the record is official/admin-verified.** Don't draw guessed road lines |
| `adminNotes` | internal note – not displayed, but public in the file |

### Status meanings and badges
- **Official** – copied from an official order/notice; `source` says which.
- **Admin-verified** – checked by the maintainers against a named source (e.g. confirmed by a committee or an official social post).
- **Unconfirmed** – a report not yet checked. Shown only in the "Sample / unverified" group, never as scheduled.
- **Demo** – placeholder.
- **draft** – hidden completely (work in progress); not counted as an error.

How the schedule is described in the app: *"Scheduled to be in force (per published schedule)"* means only that the *published* schedule includes that moment. The app never claims a road is open or closed right now; it does not know.

## 3. Verification checklist (before setting status to `official` / `admin-verified`)
1. Identify the **primary source**: official order/notice/advisory (police, traffic department, municipal body), an official verified social account, or direct confirmation from the puja committee.
2. Record it exactly in `source` (document number/date/URL) and add `sourceUrl` if public.
3. Copy dates/times **exactly**; convert to IST with `+05:30`. For overnight windows use the recurring form and check the midnight crossing.
4. Check the location against the source wording; if you cannot place a point precisely, use `locationText` and `approximateLocation: true` – do not guess coordinates or road lines.
5. Have a second person re-read the record when possible.
6. Set `verifiedAt` (now, IST) and `verifiedBy` (public role/office).
7. If an order is withdrawn or changed, set `cancelled: true` (or edit the times), update `verifiedAt`, and `lastUpdated`.
8. If you cannot verify it, use `unconfirmed` or `draft`, never `official`.

Acceptable source types: official orders/advisories; official press releases; official social-media posts from verified accounts; written confirmation from the organising committee or authority; on-the-ground photo of an official notice (record where/when taken). Not acceptable on their own: forwarded messages, unattributed posts, memory.

## 4. Editing via the GitHub web UI
1. Open the repository on GitHub → `data/puja-data.json` → pencil icon (**Edit**).
2. Make your changes (keep valid JSON: commas between records, double quotes). Update `meta.lastUpdated`.
3. *Optional but recommended:* copy the text into `admin-preview.html` (open the live site's `/admin-preview.html`) → **Validate & preview**; or use the command line below. This only checks; it does not publish.
4. **Commit changes** (to `main`, or open a pull request for a second pair of eyes).
5. GitHub Pages redeploys in about a minute. Reload the site (the data file is network-first and fetched with cache-busting, so you see new data immediately once deployed).

## 5. Validate from a terminal
```sh
node tools/validate-data.js            # exit code 0 = OK, 1 = problems (records that would be skipped)
```
It prints skipped records with reasons, counts, and the current schedule states. The same rules run in the browser: bad records are skipped and users see a visible "data-quality warning" with the number skipped.

## 6. If something goes wrong
- *Users see "Data unavailable"*: the JSON is invalid or `meta` is broken. Revert the commit on GitHub (History → Revert) or fix and recommit.
- *A record is missing*: run the validator – it tells you why it was skipped.
- *Wrong information was published*: fix it immediately, update `lastUpdated`; if unsure, set the record to `draft` to hide it.
