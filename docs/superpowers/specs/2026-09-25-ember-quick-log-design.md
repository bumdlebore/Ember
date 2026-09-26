# Ember — quick log, so the app beats the spreadsheet

Design doc. Written 2026-09-25. The design was approved in chat before this doc was written.

## Problem

Austin still logs cigars in the "Cigar journal" Google Sheet instead of Ember.
An audit on 2026-09-25 found these causes. Each was checked against the sheet
or the running app:

1. The rating picker allows half points only. 29 of 50 rated smokes are
   quarter scores (4.25, 4.75), so the picker can't record most of his ratings.
2. Logging is the third tab. The form has 12 inputs and is 1,228px tall at a
   375px phone width. His last four sheet rows filled in date, brand, blend,
   rating, and notes, and left the leaf columns blank.
3. An entry can't be edited, only deleted. It can't be saved now and rated
   later, and his notes show he logs late.
4. The date field is filled with `new Date().toISOString().slice(0,10)`, which
   is a UTC date. At 8:30pm Central it pre-fills tomorrow.
5. The Palate headline ranks by average rating with a two-smoke minimum. It
   reads "You're a Honduras smoker" from 2 smokes (avg 4.38), while Nicaragua
   has 20 smokes (avg 4.29).
6. There is no web manifest or touch icon, so the app has no proper
   home-screen icon.

## User

One person, on an iPhone, usually outdoors in the evening, one hand free.
He repeats favorites (Encore, M81, Serie V Melanio). An entry is done when it
has a name, a rating, and a few words. The catalog supplies the leaf.
He has ADHD. Every extra tap or field raises the chance the sheet wins.

Success means he can log a repeat smoke in three taps plus notes, and a new
smoke by typing part of its name, from a home-screen icon.

## Non-goals

- The Worker's sync, auth, and D1 schema do not change. The entry shape
  (`d b l sh bd w wn bn fi o r s n u deleted id`) does not change.
- No "try next" recommendations, copy rewrite, or lazy catalog load in this
  round. Those are the next round.
- The single-file structure stays. `public/index.html` holds all UI code.

## Design

### Navigation

- A bottom tab bar with three tabs: Log, Journal, Palate. It sits within
  thumb reach and uses `env(safe-area-inset-bottom)`.
- The app always opens on Log.
- The header shrinks to the wordmark, the entry count, and the sync pill. The
  tagline goes, to save vertical space.

### Log screen (the home screen)

Top to bottom:

1. **Unrated strip.** Lists entries with `r == null`, not deleted, and dated
   within the last 14 days. It shows up to 3. Tapping one opens it in edit
   mode. It is hidden when empty. The 14-day window keeps the old unrated
   seed rows (2022 Hemingway) out of the strip.
2. **Name field**, placeholder "What are you smoking?". It uses a custom
   suggestion list, not a `<datalist>`, because iOS renders 1,238 datalist
   options poorly. As he types (1+ characters), it shows up to 8 matches:
   - his own history first, deduplicated on brand + blend, most recent first
   - then catalog names that contain the typed text
   - each row shows the blend in normal weight, then the brand or "catalog"
     in muted text

   Picking a history row fills brand, blend, and every leaf field from the
   most recent entry of that cigar. Picking a catalog row sets the blend and
   leaf fields. Catalog names include the brand ("Oliva Serie G Maduro").
   If a brand from his history is a prefix of the name, the brand is split
   off. Otherwise the whole name becomes the blend and brand stays blank.
   Typing without picking keeps today's behavior. On blur, `findMatch`
   fills blank leaf fields.
3. **Match summary.** One muted line under the field, such as "Oliva · San
   Andres Maduro · Nicaraguan · Med-Full", followed by an "Edit details" link.
   It's hidden until there is something to summarize.
4. **Smoke again chips.** Up to 6 cigars he has logged more than once, most
   recent first. Tapping one does what picking its history row does. The
   chips are hidden while the name field has text.
5. **Rating chips.** Seven chips: 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5. A "Lower"
   chip opens a second row: 2, 2.25, 2.5, 2.75, 3, 3.25. Tapping the
   selected chip clears the rating. Each chip is at least 40px tall.
6. **Notes.** A textarea that starts at 2 rows. Placeholder "Flavors, draw,
   burn…".
7. **Footer row.** A "With friends" toggle on the left sets `s`. The date on
   the right reads "Today, Sep 25" when it is today and "Sep 23" otherwise.
   Tapping it opens the native date input.
8. **Details** (collapsed by default, opened by "Edit details"): brand,
   origin, body, wrapper, wrapper note, binder, shape, filler. These are
   today's fields and datalists. Blend moves to the name field. Details sit
   above Save, so edits happen before the button.
9. **Save**, full width. Save works with no rating. Unrated saves then appear
   in the unrated strip.

After a save, the app stays on Log, clears the form, and shows the toast
"Saved · <name>". The next action is often the next smoke or nothing, so it
no longer switches to Journal.

### Edit and smoke again

- The detail sheet gets two buttons, "Edit" and "Smoke again". Delete stays
  as a small text button.
- **Edit** loads the entry into the Log form with details expanded. The
  header reads "Editing <name>", and the buttons read "Save changes" and
  "Cancel". Saving writes the same `id` with a new `u = Date.now()`. Sync
  already treats a newer `u` as a write, so the server needs no change.
- **Smoke again** loads the entry's brand, blend, and leaf into a new entry.
  The date is today. Rating and notes are blank, and "with friends" is off.

### Dates

`localToday()` returns `YYYY-MM-DD` from local `getFullYear()`,
`getMonth()`, and `getDate()`. It replaces every `toISOString().slice(0,10)`.

### Palate

- Rankings use a shrunk average: `(n·avg + k·mean) / (n + k)`, with `k = 5`
  and `mean` = his overall average. The bar and number still show the raw
  average and `×n`. Ranking by the shrunk value stops 2 smokes from topping
  20.
- A headline clause (origin, wrapper) appears only when its top row has
  `n ≥ 5`. Checked against the seed data (mean 4.215): origin goes to
  Nicaragua (n 21, shrunk 4.28) over Honduras (n 2, shrunk 4.26), and
  wrapper goes to San Andres (n 8, shrunk 4.43) over Connecticut Habano
  (n 2, shrunk 4.33).

### Home-screen install

- `public/manifest.webmanifest`: name "Ember", `display: "standalone"`,
  `start_url: "/"`, background and theme `#1c1611`, and 192px and 512px icons.
- Icons: PNGs of the ember mark (a glowing orange dot on the dark background)
  at 180px (`apple-touch-icon`), 192px, and 512px. They are generated once
  and committed.
- The Worker serves `/manifest.webmanifest` and `/icon-*.png` behind the same
  Access check as `/`. `wrangler.toml` gets a `Data` rule for `*.png`. The
  `<link rel="manifest">` uses `crossorigin="use-credentials"` so the fetch
  carries the Access cookie.
- The manifest and icon responses carry `X-Ember-Shell: 1`, since they come
  from the Worker and not an Access interstitial. The service worker's
  existing rule then caches them, and `sw.js` doesn't change.
- `<meta name="apple-mobile-web-app-capable">` and a status-bar style meta
  are added.

**Risk (assumed, not verified):** in iOS standalone mode, the Access login
redirect to Google may not return to the app cleanly. The fallback is
`display: "browser"`, which keeps the icon and opens in Safari with Safari's
cookies. This is checked on his phone before the work counts as done.

**Manual step for Austin:** raise the Access application's session duration
for ember.austinsego.com, so the login lapses rarely. The exact dashboard path
gets verified against Cloudflare's docs before he's asked to do it.

### Escaping

New render code, and `entryRow` and `openDetail`, pass user and catalog text
through an `esc()` helper. The suggestion list renders catalog and history
strings, and without escaping, a `<` in a note breaks the markup.

## Testing

- **Worker routes (vitest, test-first):** `/manifest.webmanifest` and each
  icon return 200 with the right `Content-Type` when authenticated, and 403
  without an assertion. `/` still carries `X-Ember-Shell`.
- **UI (scripted checks in the browser pane):** the pure logic stays inside
  `index.html`, so it isn't unit-tested. Each behavior gets a JS assertion
  run against the local static server at 375×812:
  - every rating chip value, including 4.25 and 4.75, round-trips to `r`
  - `localToday()` matches the local date at 20:30 and 23:59
  - picking history and catalog rows fills the expected fields
  - Edit keeps `id` and raises `u`, and Smoke again makes a new `id`
  - the unrated strip shows only entries from the last 14 days
  - the seed-data headline names Nicaragua
  - the Log screen fits Save above the fold at 812px when details are
    collapsed
- **On the phone (Austin, about 5 minutes):** add it to the home screen,
  confirm it opens and syncs, log one smoke, then edit it.
- `npm test` (vitest plus `wrangler deploy --dry-run`) passes before deploy.
