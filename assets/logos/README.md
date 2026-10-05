# Institutional logos (NOT included)

The real logo files have **not** been supplied and must **not** be redrawn, recreated or cropped from a mock-up.
Put the original artwork here, with exactly these file names:

| file | used for |
|---|---|
| `west-bengal-police.png` | identity strip on the home screen (alt text "West Bengal Police logo") |
| `siliguri-metropolitan-police.png` | identity strip on the home screen (alt text "Siliguri Metropolitan Police logo") |

Requirements: transparent PNG (SVG with the same base name is not wired yet – convert to PNG), original colours,
at least ~400 px tall, no padding around the artwork. The app shows each at a maximum height of about 44 px
(width automatic, aspect ratio preserved).

Behaviour:
- While either file is missing, the whole "A joint initiative by …" strip stays hidden (no broken images, no gap).
- After adding **both** files run `node tools/build-sw.js`; it sets `logosPresent: true` in `branding.js` and adds the
  files to the offline cache list. Commit all of it.
- To switch the strip off even with the files present set `institutionalBranding.enabled = false` in `branding.js`.

**Written approval from the responsible authority is required before the logos, the caption "A joint initiative by …"
or the descriptor "Official Durga Puja Traffic & Visitor Information" are published.** See the comment at the top of
`branding.js`.
