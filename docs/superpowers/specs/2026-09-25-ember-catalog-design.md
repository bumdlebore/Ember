# Ember — private cigar catalog

Design doc, spec 2 of 2. Written 2026-09-25. Austin approved the design in chat, including a
one-time private crawl of Neptune Cigar, one catalog entry per blend with its sizes, and D1
storage.

## Problem

- Autocomplete runs on 1,238 cigars scraped from Cigars International and inlined in
  `public/index.html`.
- That data has no brand field, no strength, no sizes, and it misses many lines.
- It also ships in a public GitHub repo, and it adds about 128 KB to every page load.

## Source (verified 2026-09-25)

- **Famous Smoke is out.** Its sitemap returns a JavaScript bot challenge, and getting past
  bot protection is not an option.
- **Neptune Cigar (`www.neptunecigar.com`) is the source.**
  - Its `robots.txt` allows every path.
  - No terms-of-use page was found, and its privacy and security pages say nothing about
    automated access. Absence isn't permission. Austin accepted the terms risk.
  - `sitemap.xml` lists 6,544 `/cigars/<slug>` pages, one per size.
  - Each size page carries a schema.org `BreadcrumbList` (Home › Cigars › *Brand* ›
    *Blend*), an `<h1>` like `Oliva Serie V Melanio Torpedo 6"1/2 * 52`, and a spec list of
    label/value pairs:

    `Cigar Shape`, `Cigar Section`, `Cigar Length`, `Origin`, `Cigar Ring Gauge`,
    `Strength`, `Wrapper Color`, `Rolling Type`, `Cigar Manufacturer`, `Cigar Wrapper`,
    `Cigar Binder`, `Cigar Filler`.

The crawl keeps only those factual fields and never stores descriptions, ratings, prices,
or images.

## Components

### 1. Crawler — `tools/catalog/crawl.mjs` (runs on claude01)

- **Input:** the Neptune sitemap. Only `/cigars/` URLs are used.
- **Pacing:** one request at a time, a 3 s wait between requests, and
  `Accept-Encoding: gzip`. The user agent names the tool and its owner:
  `EmberCatalog/1.0 (personal journal; contact via ember.austinsego.com)`.
- **Errors:** HTTP 429 or 5xx waits 60 s and retries up to 3 times. After 20 errors in a
  row, the crawler stops and says so.
- **Resume:** each parsed page appends one JSON line to `~/ember-data/neptune.jsonl`, and
  `crawl.mjs` skips URLs already in that file, so a crash or reboot loses nothing.
- **Parse:** a pure function `parsePage(html) → record | null` in
  `tools/catalog/parse.mjs`. It returns null when wrapper, binder, and filler are all
  missing, which catches samplers, tins, and accessories.
- **Runtime:** about 5.5 hours unattended, under 1 GB transferred, run with `nohup` or in
  tmux.

### 2. Build — `tools/catalog/build.mjs`

It reads `neptune.jsonl`, plus `legacy-ci.json` (the current inline catalog, extracted
once from `index.html` before it's removed), and writes `~/ember-data/catalog.json`.

- **One record per blend.** The key is the breadcrumb brand plus the blend, lowercased.
- **Blend name:** the breadcrumb blend with a leading brand prefix removed ("Oliva Serie V
  Melanio" under brand "Oliva" becomes "Serie V Melanio"). This matches how Austin logs
  (`b` "Oliva", `l` "Serie V Melanio Maduro").
- **Blend fields** come from the blend's first size page:
  - wrapper, binder, filler list (split on commas and "and"), origin, and maker
  - wrapper note: `Wrapper Color` when it's Maduro, Oscuro, Claro, or Colorado, otherwise
    empty
  - body, mapped from `Strength`: Mild → Light, Mild-Medium → Med-Light, Medium → Med,
    Medium-Full → Med-Full, Full → Full
- **Sizes:** name (the `<h1>` minus the brand and blend prefix and minus the size,
  e.g. "Torpedo"), shape, length (`6"1/2` → `6½`, and `¼`/`¾` the same way; other
  fractions stay as `6 5/8`), and ring gauge. Duplicates are removed and the list is
  sorted by length, then ring.
- **Legacy CI rows** are added only when no Neptune blend has the same normalized name.
  Normalized means lowercase with non-alphanumerics removed, compared against both
  `brand + blend` and `blend` alone. Legacy rows have no sizes and no brand, so the client
  keeps today's brand split for them.
- **Record shape (compact keys):** `{k, b, l, w, wn, bn, fi[], o, bd, mk, sz:[{n, len, rg}], src}`,
  where `src` is `"np"` or `"ci"`.
- **Expected size:** about 1,500 to 2,000 blends, about 400 KB raw and about 80 KB gzipped.
  The build prints the real counts.

### 3. Storage — D1

- Tables:
  - `catalog(k TEXT PRIMARY KEY, data TEXT NOT NULL)`
  - `catalog_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`, with a single row
    `version`
- Added to `schema.sql` with `CREATE TABLE IF NOT EXISTS`, so applying it is safe.
- **Loader:** `tools/catalog/load.mjs` runs on the Mac, which is the only machine with a
  Cloudflare login (`wrangler d1` verified working 2026-09-25).
  - It writes a SQL file to a temp path. The file runs
    `DELETE FROM catalog;`, then one batched `INSERT` per blend, then sets `version` to
    the build timestamp.
  - It then runs `wrangler d1 execute ember-journal --remote --file …`.
  - This writes production data, so the loader prints the counts and asks
    `Load N blends into production D1? [y/N]` before running. Austin confirms at run time.
- The catalog is shared, not owner-scoped. It's reference data behind the same Access
  gate.

### 4. Route — `GET /api/catalog` (Worker)

- The route is behind the existing Access check.
- `GET /api/catalog?v=<version>`:
  - When the version matches, it returns `{version, unchanged: true}`.
  - Otherwise it returns `{version, blends: [...]}`, where `blends` is the parsed `data`
    of every row.
- The response is `Cache-Control: no-store`, like the other API routes.
- When the table is empty or missing, it returns `{version: null, blends: []}` rather than
  an error, so a fresh database doesn't break the app.

### 5. Client (`public/index.html`)

- **Remove** the inline `REF` array and its comment. The public repo stops shipping
  scraped data. Past commits still contain it, and rewriting git history is out of scope.
- **Cache:** `let CAT = []` is loaded at boot from `localStorage["ember.catalog"]`
  (`{version, blends}`).
  - After boot, and again on every `visibilitychange` to visible (at most once an hour), the
    client fetches `/api/catalog?v=<cached version>`. When the answer is new data, it stores
    and swaps it in.
  - Offline, the client uses the cache, so autocomplete keeps working.
  - Every read and write is wrapped in try/catch. A failed write, for example storage
    full, still uses the data for the session.
- **Every place that used `REF`** now uses `CAT`: suggestions, `findMatch`, backfill, and
  datalists.
- **Suggestions:**
  - A catalog row shows its blend, with its brand on the right (legacy rows show
    "catalog").
  - Matching covers `b + " " + l` as well as `l`.
  - The existing history-first ordering, exact-match-first rule, and dedupe against
    history are unchanged.
- **Brand spelling:** picking a catalog row with a brand runs `canonBrand(b)`. It returns
  Austin's own spelling when a logged brand matches after normalization ("E.P. Carrillo"
  becomes "EP Carrillo"), otherwise the catalog spelling. Legacy rows without `b` keep
  today's `splitBrand`.
- **Fields a pick fills:** brand, blend, wrapper, wrapper note, binder, filler, origin,
  and body. It doesn't fill shape.
- **Size row:**
  - When the picked blend has sizes, a "Size" row of pen-text options appears under the
    Brand/Wrapper cells. There are at most 8, and "More sizes" shows the rest.
  - Tapping a size sets Shape (`sh`) to the size's shape and a new optional field
    `sz` to `"6½ × 52"`. Tapping it again clears both.
  - The row hides when the blend has no sizes, and on clear or retype.
- **Display of `sz`:** the detail sheet shows it on the Shape row ("Torpedo, 6½ × 52"),
  and the CSV gains a Size column.
- Sizes belong to one smoke, so Smoke again copies `sh` and `sz` from history as it does
  today, and Edit loads them.

## Non-goals

- Re-crawling on a schedule. The crawl is one-time. It can be rerun by hand, and the
  loader replaces the table.
- Prices, ratings, stock, and images.
- Rewriting git history to remove the old inline catalog.

## Testing

- **vitest, Worker:** `/api/catalog`
  - returns 403 without Access
  - returns `{version: null, blends: []}` on an empty table
  - returns rows and the version after seeding the test D1
  - returns `unchanged: true` when `v` matches
- **vitest, tools** (a Node test project separate from the workers pool): `parsePage`
  against two hand-written fixture pages (a cigar and a sampler) that copy Neptune's
  breadcrumb and spec-list markup but contain no Neptune prose. It covers:
  - field extraction, the strength-to-body map, and the sampler returning null
  - length formatting (`6"1/2` → `6½`, `5"5/8` → `5 5/8`)
  - the brand-prefix strip
  - in `build.mjs`: grouping by blend and the legacy dedupe
- **UI checks:** a new `cat1.js` stubs `fetch("/api/catalog")` with a three-blend fixture.
  It checks:
  - suggestions show catalog rows with brands
  - a pick fills the fields and applies `canonBrand` ("E.P. Carrillo" becomes
    "EP Carrillo")
  - the size row appears, sets `sh` and `sz`, and clears
  - a reload with the fetch failing still suggests from the cache
  - no `REF` global remains
  - all existing checks still pass in light and dark
- **Crawl smoke test:** `crawl.mjs --limit 5` against the live site before the full run,
  inspected by hand.
- **Phone (Austin, about 3 minutes):** type a cigar that isn't in the old catalog, pick it,
  pick a size, and save.
