# Ember private catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline 1,238-cigar catalog with a private, per-blend catalog crawled once from Neptune Cigar, stored in D1, served behind Access, and cached on the phone.

**Architecture:**
- `tools/catalog/` holds four Node scripts: parse (pure), crawl (claude01, resumable), build (groups size pages into blends and merges the legacy catalog), and load (Mac, confirms before writing to D1).
- The Worker gains `GET /api/catalog`, which reads two new D1 tables.
- `index.html` drops the inline `REF` array, caches the catalog in `localStorage`, and adds a size row that fills Shape and a new entry field `sz`.

**Tech Stack:** Node 24 (global `fetch`), Cloudflare Workers + D1, vitest (a workers pool for the Worker and a separate Node project for the tools), `playwright-core` UI checks.

**Spec:** `docs/superpowers/specs/2026-09-25-ember-catalog-design.md`

## Global Constraints

- Branch `catalog`. Commit and push after each task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run commands from the repo root. They must be POSIX `sh`-safe, with no `read -p`.
- The crawled and built data lives only in `~/ember-data/` (overridable with `EMBER_DATA`) and in D1. It never goes into the repo. Test fixtures are hand-written and contain no Neptune prose.
- The crawler waits 3 s between requests, fetches one at a time, sends user agent `EmberCatalog/1.0 (personal journal; contact via ember.austinsego.com)`, and never tries to get past a bot challenge. If one appears, stop and report it.
- Keep only factual fields: brand, blend, size name, shape, length, ring gauge, origin, strength, wrapper color, maker, wrapper, binder, and filler.
- Catalog record: `{k, b, l, w, wn, bn, fi[], o, bd, mk, sizes:[{n, shape, len, rg}], src}`. The entry field for a size is `sz` (a string like `"6½ × 52"`). The catalog key is `sizes`.
- Strength maps to body: `mild → Light`, `mild-medium` / `mild to medium → Med-Light`, `medium → Med`, `medium-full` / `medium to full → Med-Full`, `full → Full`.
- Production writes (`npm run schema`, `load.mjs`, `npm run deploy`) happen only on the Mac and only after Austin says yes in chat. `load.mjs` also asks `[y/N]` and accepts `--yes` only after that chat approval.
- Every existing check must keep passing in light and dark. Checks may be edited only where markup or data changed, and no assertion may be dropped.

## Review Focus

1. **Real Neptune pages drift from the fixtures** (a missing Origin, odd filler punctuation). Expected: the crawler records nulls rather than garbage, and the null rate gets checked. See Task 3 Step 4, `null rate`.
2. **The catalog array `sizes` vs the entry string `sz`.** A catalog pick must leave `#f-size` empty, and a history pick must copy `sz`. See Task 4 checks `pickFills` and `againCopiesSize`.
3. **`localStorage` full or unavailable.** Expected: the catalog still loads for the session. See Task 4 check `quotaSafe`.
4. **Brand spelling splits** ("E.P. Carrillo" vs "EP Carrillo"). See Task 4 check `canonBrand`.
5. **A database without the catalog tables** (a fresh or partial deploy). Expected: an empty catalog, not an error. See Task 1 test "returns an empty catalog when the tables don't exist".

---

### Task 1: D1 tables and `GET /api/catalog`

**Files:**
- Modify: `schema.sql`, `src/index.js`, `test/worker.test.js`
- Create: `src/catalog.js`

**Interfaces:**
- Produces:
  - `getCatalog(db, have) → Promise<{version, blends} | {version, unchanged: true}>`
  - `GET /api/catalog?v=<version>` (Task 4 fetches it)

- [ ] **Step 1: Write the failing tests.** Append to `test/worker.test.js`:

```js
describe("catalog route", () => {
  const url = "https://ember.austinsego.com/api/catalog";
  const get = async (q = "", method = "GET") =>
    callWorker(new Request(url + q, { method, headers: { "Cf-Access-Jwt-Assertion": await mintJwt() } }));
  beforeEach(async () => {
    await env.DB.exec("DROP TABLE IF EXISTS catalog");
    await env.DB.exec("DROP TABLE IF EXISTS catalog_meta");
  });

  it("refuses without an assertion", async () => {
    const res = await SELF.fetch(url);
    expect(res.status).toBe(403);
  });

  it("returns an empty catalog when the tables don't exist", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: null, blends: [] });
  });

  it("returns blends with a version, and unchanged when v matches", async () => {
    await env.DB.exec("CREATE TABLE catalog (k TEXT PRIMARY KEY, data TEXT NOT NULL)");
    await env.DB.exec("CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const blend = { k: "oliva|serie v melanio", b: "Oliva", l: "Serie V Melanio", sizes: [] };
    await env.DB.prepare("INSERT INTO catalog (k, data) VALUES (?, ?)").bind(blend.k, JSON.stringify(blend)).run();
    await env.DB.prepare("INSERT INTO catalog_meta (key, value) VALUES ('version', ?)").bind("2026-09-26T03:00:00Z").run();
    const res = await get();
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(await res.json()).toEqual({ version: "2026-09-26T03:00:00Z", blends: [blend] });
    expect(await (await get("?v=2026-09-26T03:00:00Z")).json()).toEqual({ version: "2026-09-26T03:00:00Z", unchanged: true });
  });

  it("rejects other methods", async () => {
    const res = await get("", "POST");
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run test/worker.test.js`
Expected: the three authenticated tests fail with a 404, and "refuses" may already pass.

- [ ] **Step 3: Tables.** Append to `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS catalog (
  k    TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 4: Implement `src/catalog.js`.**

```js
// Reference catalog of cigar blends, shared across owners. Loaded by tools/catalog/load.mjs.
export async function getCatalog(db, have) {
  let version = null;
  try {
    const row = await db.prepare("SELECT value FROM catalog_meta WHERE key = 'version'").first();
    version = row ? row.value : null;
  } catch {
    // A fresh database has no catalog tables yet; that's an empty catalog, not an error.
    return { version: null, blends: [] };
  }
  if (!version) return { version: null, blends: [] };
  if (have && have === version) return { version, unchanged: true };
  const { results } = await db.prepare("SELECT data FROM catalog").all();
  const blends = [];
  for (const r of results || []) {
    try {
      blends.push(JSON.parse(r.data));
    } catch {
      continue;
    }
  }
  return { version, blends };
}
```

- [ ] **Step 5: Route it.** In `src/index.js`, add `import { getCatalog } from "./catalog.js";` under the entries import. Insert this directly before `if (url.pathname === "/api/entries") {`:

```js
    if (url.pathname === "/api/catalog") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return json(await getCatalog(env.DB, url.searchParams.get("v") || ""));
    }
```

- [ ] **Step 6: Run and commit.**

Run: `npm test`
Expected: 65 tests pass, plus the dry-run.

```bash
git add schema.sql src/catalog.js src/index.js test/worker.test.js && git commit -q -m "feat: catalog tables and GET /api/catalog behind Access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

---

### Task 2: Parser, builder, and legacy extractor (tested in Node)

**Files:**
- Create:
  - `tools/catalog/parse.mjs`, `tools/catalog/build.mjs`, `tools/catalog/extract-legacy.mjs`
  - `tools/catalog/sql.mjs`, `tools/catalog/load.mjs`
  - `tools/catalog/catalog.test.mjs`
  - `tools/catalog/fixtures/cigar.html`, `tools/catalog/fixtures/sampler.html`
  - `vitest.tools.config.js`
- Modify: `vitest.config.js`, `package.json`

**Interfaces:**
- Produces:
  - `parsePage(html) → {brand, blend, size:{n, shape, len, rg}, w, bn, fi[], o, mk, color, strength} | null`
  - `fmtLen(s)`, `stripPrefix(name, brand)`, `splitFiller(s)`, `BODY`
  - `buildCatalog(pages, legacy) → {blends, stats:{neptune, legacy, unmapped[]}}`, and `norm(s)`
  - `catalogSql(version, blends) → string`, with each INSERT under 80 KB so it stays below D1's statement limit
  - `load.mjs` (run in Task 5)
  - `~/ember-data/legacy-ci.json`

- [ ] **Step 1: Split the test projects.**
  - In `vitest.config.js`, add `exclude: ["tools/**", "node_modules/**"],` inside `test: { … }`, before `poolOptions`.
  - Create `vitest.tools.config.js`:

    ```js
    import { defineConfig } from "vitest/config";

    // Node-side tests for tools/ (the crawler and builder). The Worker tests use vitest.config.js.
    export default defineConfig({
      test: { include: ["tools/**/*.test.mjs"], environment: "node" },
    });
    ```

  - In `package.json`, change the `test` script to `"vitest run && vitest run -c vitest.tools.config.js && wrangler deploy --dry-run"`.

- [ ] **Step 2: Write the fixtures.** These are hand-written copies of Neptune's markup structure, with made-up content. Create `tools/catalog/fixtures/cigar.html`:

```html
<!DOCTYPE html><html><head><title>Fixture</title></head><body>
<nav><ul><li><a href="/strength">Strength</a></li><li><a>SHOP BY STRENGTH</a></li></ul></nav>
<div id="page_path"><div itemscope itemtype="https://schema.org/BreadcrumbList"><span itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><a href="/" itemprop="item"><span style="display:none;" itemprop="NAME">Home<meta itemprop="position" content="1" /></span></a></span> <span class="pathSeparator">></span> <span class="pathCat" itemprop="itemListElement"><a href="/cigars" itemprop="item"><span itemprop="NAME">CIGARS</span></a></span> <span class="pathSeparator">></span> <span class="pathCat" itemprop="itemListElement"><a href="/testbrand-cigar" itemprop="item"><span itemprop="name">Testbrand</span></a></span> <span class="pathSeparator">></span> <span class="pathCat" itemprop="itemListElement"><a href="/cigar/testbrand-reserva" itemprop="item"><span itemprop="name">Testbrand Reserva</span></a></span></div></div>
<h1>Testbrand Reserva Robusto 5&quot;1/2 * 50</h1>
<div>Description</div><p>Prose that must not be stored.</p>
<div>Specifications</div>
<div><h3>Brands</h3><span>Testbrand Reserva</span><p>Brand prose that must not be stored.</p></div>
<div><h3>Cigar Shape</h3><span>Robusto</span><p>Shape prose.</p></div>
<div><h3>Cigar Length</h3><span>5"1/2</span></div>
<div><h3>Origin</h3><span>Nicaragua</span><p>Country prose.</p></div>
<div><h3>Cigar Ring Gauge</h3><span>50</span></div>
<div><h3>Strength</h3><span>Medium-Full</span></div>
<div><h3>Wrapper Color</h3><span>Maduro</span></div>
<div><h3>Cigar Manufacturer</h3><span>Test Cigar Co.</span></div>
<div><h3>Cigar Wrapper</h3><span>San Andres</span></div>
<div><h3>Cigar Binder</h3><span>Nicaragua</span></div>
<div><h3>Cigar Filler</h3><span>Nicaragua, Dominican Republic and Honduras</span></div>
</body></html>
```

Create `tools/catalog/fixtures/sampler.html`:

```html
<!DOCTYPE html><html><head><title>Fixture</title></head><body>
<div id="page_path"><div itemscope itemtype="https://schema.org/BreadcrumbList"><span itemprop="itemListElement"><a href="/" itemprop="item"><span style="display:none;" itemprop="NAME">Home</span></a></span> <span class="pathCat" itemprop="itemListElement"><a href="/cigars" itemprop="item"><span itemprop="NAME">CIGARS</span></a></span> <span class="pathCat" itemprop="itemListElement"><a href="/testbrand-cigar" itemprop="item"><span itemprop="name">Testbrand</span></a></span> <span class="pathCat" itemprop="itemListElement"><a href="/cigar/testbrand-samplers" itemprop="item"><span itemprop="name">Testbrand Samplers</span></a></span></div></div>
<h1>Testbrand Five Cigar Sampler</h1>
<div>Specifications</div>
<div><h3>Cigar Shape</h3><span>Assortment</span></div>
<div><h3>Strength</h3><span>Medium</span></div>
</body></html>
```

- [ ] **Step 3: Write the failing tests.** Create `tools/catalog/catalog.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePage, fmtLen, stripPrefix, splitFiller, BODY } from "./parse.mjs";
import { buildCatalog, norm } from "./build.mjs";
import { catalogSql } from "./sql.mjs";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

describe("parsePage", () => {
  it("extracts only the spec fields from a size page", () => {
    expect(parsePage(fx("cigar.html"))).toEqual({
      brand: "Testbrand", blend: "Testbrand Reserva",
      size: { n: "Robusto", shape: "Robusto", len: "5½", rg: 50 },
      w: "San Andres", bn: "Nicaragua", fi: ["Nicaragua", "Dominican Republic", "Honduras"],
      o: "Nicaragua", mk: "Test Cigar Co.", color: "Maduro", strength: "Medium-Full",
    });
  });
  it("stores no description prose", () => {
    expect(JSON.stringify(parsePage(fx("cigar.html")))).not.toMatch(/prose/i);
  });
  it("returns null for a sampler with no wrapper, binder, or filler", () => {
    expect(parsePage(fx("sampler.html"))).toBeNull();
  });
  it("returns null without a breadcrumb", () => {
    expect(parsePage("<h1>Something</h1><div>Specifications</div>")).toBeNull();
  });
});

describe("helpers", () => {
  it("formats lengths", () => {
    expect(fmtLen('6"1/2')).toBe("6½");
    expect(fmtLen('4"3/4')).toBe("4¾");
    expect(fmtLen('5"1/4')).toBe("5¼");
    expect(fmtLen('5"5/8')).toBe("5 5/8");
    expect(fmtLen('7"')).toBe("7");
    expect(fmtLen("")).toBe("");
  });
  it("strips a leading brand only", () => {
    expect(stripPrefix("Oliva Serie V Melanio", "Oliva")).toBe("Serie V Melanio");
    expect(stripPrefix("Serie V", "Oliva")).toBe("Serie V");
    expect(stripPrefix("Olivares Blend", "Oliva")).toBe("Olivares Blend");
  });
  it("splits fillers on commas and 'and'", () => {
    expect(splitFiller("Nicaragua, Dominican Republic and Honduras")).toEqual(["Nicaragua", "Dominican Republic", "Honduras"]);
    expect(splitFiller("")).toEqual([]);
  });
  it("maps strength to body", () => {
    expect(BODY["mild"]).toBe("Light");
    expect(BODY["mild to medium"]).toBe("Med-Light");
    expect(BODY["medium"]).toBe("Med");
    expect(BODY["medium-full"]).toBe("Med-Full");
    expect(BODY["full"]).toBe("Full");
  });
  it("normalizes names for matching", () => {
    expect(norm("E.P. Carrillo")).toBe("epcarrillo");
  });
});

describe("buildCatalog", () => {
  const page = (size, extra = {}) => ({ brand: "Oliva", blend: "Oliva Serie V Melanio", size,
    w: "Ecuadorian Sumatra-Seed", bn: "Nicaragua", fi: ["Jalapa"], o: "Nicaragua", mk: "Oliva Cigar Co.",
    color: "Natural", strength: "Medium", ...extra });
  it("groups sizes under one blend, deduped and sorted by length then ring", () => {
    const { blends } = buildCatalog([
      page({ n: "Churchill", shape: "Churchill", len: "7", rg: 50 }),
      page({ n: "Robusto", shape: "Robusto", len: "5", rg: 50 }),
      page({ n: "Robusto", shape: "Robusto", len: "5", rg: 50 }),
      page({ n: "Torpedo", shape: "Torpedo", len: "6½", rg: 52 }),
    ], []);
    expect(blends).toHaveLength(1);
    expect(blends[0]).toMatchObject({ k: "oliva|serie v melanio", b: "Oliva", l: "Serie V Melanio", bd: "Med", wn: "", src: "np" });
    expect(blends[0].sizes.map((s) => s.n)).toEqual(["Robusto", "Torpedo", "Churchill"]);
  });
  it("keeps Maduro, Oscuro, Claro, and Colorado as the wrapper note", () => {
    expect(buildCatalog([page({ n: "T", shape: "T", len: "6", rg: 52 }, { color: "Maduro" })], []).blends[0].wn).toBe("Maduro");
  });
  it("adds legacy rows only when Neptune lacks the blend", () => {
    const { blends, stats } = buildCatalog([page({ n: "T", shape: "T", len: "6", rg: 52 })],
      [{ l: "Oliva Serie V Melanio", w: "x" }, { l: "Padron 1964 Anniversary", w: "Maduro", o: "Nicaragua", bn: "Nicaraguan", fi: ["Nicaraguan"] }]);
    expect(blends.map((b) => b.l)).toEqual(["Serie V Melanio", "Padron 1964 Anniversary"]);
    expect(blends[1]).toMatchObject({ b: "", src: "ci", sizes: [] });
    expect(stats).toMatchObject({ neptune: 1, legacy: 1 });
  });
  it("skips null pages and reports unmapped strengths", () => {
    const { blends, stats } = buildCatalog([null, page({ n: "T", shape: "T", len: "6", rg: 52 }, { strength: "Spicy" })], []);
    expect(blends).toHaveLength(1);
    expect(blends[0].bd).toBe("");
    expect(stats.unmapped).toEqual(["Spicy"]);
  });
});

describe("catalogSql", () => {
  it("replaces the table, escapes quotes, and sets the version last", () => {
    const sql = catalogSql("v1", [{ k: "b|it's", l: "It's" }]);
    const lines = sql.split("\n");
    expect(lines[0]).toBe("DELETE FROM catalog;");
    expect(sql).toContain("('b|it''s', '{\"k\":\"b|it''s\",\"l\":\"It''s\"}')");
    expect(lines.at(-1)).toBe("INSERT INTO catalog_meta (key, value) VALUES ('version', 'v1') ON CONFLICT(key) DO UPDATE SET value = excluded.value;");
  });
  it("splits inserts so no statement reaches D1's 100 KB limit", () => {
    const big = Array.from({ length: 60 }, (_, i) => ({ k: "b|" + i, l: "x".repeat(5000) }));
    const inserts = catalogSql("v1", big).split("\n").filter((l) => l.startsWith("INSERT INTO catalog ("));
    expect(inserts.length).toBeGreaterThan(3);
    expect(inserts.every((l) => l.length < 100000)).toBe(true);
    expect(inserts.join("").match(/\('b\|/g).length).toBe(60);
  });
});
```

- [ ] **Step 4: Confirm they fail.**

Run: `npx vitest run -c vitest.tools.config.js`
Expected: FAIL, because `./parse.mjs` can't be found.

- [ ] **Step 5: Implement `tools/catalog/parse.mjs`.**

```js
// Parses one Neptune Cigar size page into a record. Keeps only factual spec fields;
// descriptions, ratings, prices and images are never read out of the page.
const ENT = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&#039;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
const decode = (s) => s.replace(/&(amp|quot|#39|#039|lt|gt|nbsp);/g, (m) => ENT[m]).replace(/ /g, " ");
const lines = (html) =>
  decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n"))
    .split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

const LABELS = { "Cigar Shape": "shape", "Cigar Length": "len", Origin: "o", "Cigar Ring Gauge": "rg",
  Strength: "strength", "Wrapper Color": "color", "Cigar Manufacturer": "mk",
  "Cigar Wrapper": "w", "Cigar Binder": "bn", "Cigar Filler": "fi" };

export const BODY = { mild: "Light", "mild-medium": "Med-Light", "mild to medium": "Med-Light",
  medium: "Med", "medium-full": "Med-Full", "medium to full": "Med-Full", full: "Full" };

export function fmtLen(s) {
  const m = String(s || "").match(/^(\d+)\s*"?\s*(?:(\d+)\/(\d+))?/);
  if (!m) return "";
  if (!m[2]) return m[1];
  const frac = `${m[2]}/${m[3]}`;
  const glyph = { "1/4": "¼", "1/2": "½", "3/4": "¾" }[frac];
  return glyph ? m[1] + glyph : `${m[1]} ${frac}`;
}

export function stripPrefix(name, brand) {
  const n = String(name || "").trim(), b = String(brand || "").trim();
  return b && n.toLowerCase().startsWith(b.toLowerCase() + " ") ? n.slice(b.length + 1).trim() : n;
}

export function splitFiller(s) {
  return String(s || "").split(/,|\band\b|&/i).map((x) => x.trim()).filter(Boolean);
}

export function parsePage(html) {
  const crumbBlock = (html.match(/BreadcrumbList[\s\S]*?<\/div>/i) || [""])[0];
  const crumbs = [...crumbBlock.matchAll(/itemprop=["']name["'][^>]*>([^<]+)</gi)].map((m) => decode(m[1]).trim());
  if (crumbs.length < 4) return null; // Home, Cigars, Brand, Blend
  const brand = crumbs[2], blend = crumbs[3];

  const all = lines(html);
  const start = all.indexOf("Specifications");
  const spec = start >= 0 ? all.slice(start) : all; // skip the site menu's "Strength" link
  const f = {};
  for (let i = 0; i < spec.length - 1; i++) {
    const key = LABELS[spec[i]];
    if (key && f[key] === undefined) f[key] = spec[i + 1];
  }
  if (!f.w && !f.bn && !f.fi) return null; // samplers, tins, accessories

  const h1m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1m ? decode(h1m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "";
  let n = h1.toLowerCase().startsWith(blend.toLowerCase()) ? h1.slice(blend.length) : stripPrefix(h1, brand);
  n = n.replace(/\s*\d+\s*"?\s*(\d+\/\d+)?\s*\*\s*\d+\s*$/, "").trim() || f.shape || "";
  const rg = f.rg && Number.isFinite(+f.rg) ? +f.rg : null;

  return { brand, blend, size: { n, shape: f.shape || "", len: fmtLen(f.len), rg },
    w: f.w || "", bn: f.bn || "", fi: splitFiller(f.fi), o: f.o || "", mk: f.mk || "",
    color: f.color || "", strength: f.strength || "" };
}
```

- [ ] **Step 6: Implement `tools/catalog/build.mjs`.**

```js
// Groups crawled Neptune size pages into one record per blend, merges the legacy
// Cigars International catalog where Neptune lacks a blend, and writes catalog.json.
//   node tools/catalog/build.mjs          (reads and writes $EMBER_DATA, default ~/ember-data)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BODY, stripPrefix } from "./parse.mjs";

export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const NOTE = /^(maduro|oscuro|claro|colorado)$/i;
const G = { "¼": 0.25, "½": 0.5, "¾": 0.75 };
const lenNum = (len) => {
  const m = String(len || "").match(/^(\d+)(?:\s+(\d+)\/(\d+)|([¼½¾]))?/);
  return m ? +m[1] + (m[2] ? m[2] / m[3] : m[4] ? G[m[4]] : 0) : 0;
};

export function buildCatalog(pages, legacy) {
  const byKey = new Map(), unmapped = new Set();
  for (const p of pages) {
    if (!p) continue;
    const b = p.brand.trim(), l = stripPrefix(p.blend, b), k = (b + "|" + l).toLowerCase();
    let r = byKey.get(k);
    if (!r) {
      const bd = BODY[String(p.strength || "").toLowerCase()] || "";
      if (p.strength && !bd) unmapped.add(p.strength);
      r = { k, b, l, w: p.w, wn: NOTE.test(p.color) ? p.color : "", bn: p.bn, fi: p.fi, o: p.o, bd, mk: p.mk, sizes: [], src: "np" };
      byKey.set(k, r);
    }
    const s = p.size;
    if (s && s.n && !r.sizes.some((x) => x.n === s.n && x.len === s.len && x.rg === s.rg))
      r.sizes.push({ n: s.n, shape: s.shape, len: s.len, rg: s.rg });
  }
  for (const r of byKey.values()) r.sizes.sort((a, b) => lenNum(a.len) - lenNum(b.len) || (a.rg || 0) - (b.rg || 0));
  const neptune = byKey.size;
  const known = new Set();
  for (const r of byKey.values()) { known.add(norm(r.b + r.l)); known.add(norm(r.l)); }
  let added = 0;
  for (const c of legacy || []) {
    const n = norm(c.l);
    if (!n || known.has(n)) continue;
    known.add(n); added++;
    const k = "ci|" + c.l.toLowerCase();
    byKey.set(k, { k, b: "", l: c.l, w: c.w || "", wn: "", bn: c.bn || "", fi: c.fi || [], o: c.o || "", bd: "", mk: "", sizes: [], src: "ci" });
  }
  return { blends: [...byKey.values()], stats: { neptune, legacy: added, unmapped: [...unmapped] } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.EMBER_DATA || `${process.env.HOME}/ember-data`;
  const rows = readFileSync(`${dir}/neptune.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const pages = rows.map((x) => x.rec);
  const legacy = existsSync(`${dir}/legacy-ci.json`) ? JSON.parse(readFileSync(`${dir}/legacy-ci.json`, "utf8")) : [];
  const { blends, stats } = buildCatalog(pages, legacy);
  const version = new Date().toISOString();
  const json = JSON.stringify({ version, blends });
  writeFileSync(`${dir}/catalog.json`, json);
  const nulls = pages.filter((p) => !p).length;
  console.log(`${rows.length} pages (${nulls} skipped) → ${stats.neptune} Neptune blends + ${stats.legacy} legacy = ${blends.length} blends`);
  console.log(`${Math.round(json.length / 1024)} KB, version ${version}`);
  if (stats.unmapped.length) console.log("Unmapped strengths:", stats.unmapped.join(", "));
}
```

- [ ] **Step 7: Implement `tools/catalog/extract-legacy.mjs`.**

```js
// Copies the old inline REF catalog out of public/index.html at a git ref (default: main)
// into $EMBER_DATA/legacy-ci.json, so it survives REF's removal without living in the repo.
//   node tools/catalog/extract-legacy.mjs [git-ref]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const ref = process.argv[2] || "main";
const html = execFileSync("git", ["show", `${ref}:public/index.html`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const m = html.match(/^const REF = (\[.*\]);\s*$/m);
if (!m) { console.error(`No REF line in public/index.html at ${ref}`); process.exit(1); }
const rows = JSON.parse(m[1]);
const dir = process.env.EMBER_DATA || `${process.env.HOME}/ember-data`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/legacy-ci.json`, JSON.stringify(rows));
console.log(`${rows.length} legacy rows → ${dir}/legacy-ci.json`);
```

- [ ] **Step 7b: Implement `tools/catalog/sql.mjs` and `tools/catalog/load.mjs`.**

```js
// tools/catalog/sql.mjs: SQL that replaces the catalog. Each INSERT stays under
// 80 KB, well below D1's 100 KB statement limit.
export function catalogSql(version, blends) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const out = ["DELETE FROM catalog;"];
  let cur = [], len = 0;
  const flush = () => { if (cur.length) { out.push("INSERT INTO catalog (k, data) VALUES " + cur.join(", ") + ";"); cur = []; len = 0; } };
  for (const b of blends) {
    const v = `(${q(b.k)}, ${q(JSON.stringify(b))})`;
    if (len + v.length > 80000) flush();
    cur.push(v); len += v.length + 2;
  }
  flush();
  out.push(`INSERT INTO catalog_meta (key, value) VALUES ('version', ${q(version)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  return out.join("\n");
}
```

```js
// tools/catalog/load.mjs: loads catalog.json into production D1. Mac only. It asks before
// writing; pass --yes only after Austin has said yes in chat.
//   node tools/catalog/load.mjs <catalog.json> [--yes]
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { catalogSql } from "./sql.mjs";

const file = process.argv[2];
if (!file || file.startsWith("--")) { console.error("usage: node tools/catalog/load.mjs <catalog.json> [--yes]"); process.exit(2); }
const { version, blends } = JSON.parse(readFileSync(file, "utf8"));
if (!version || !Array.isArray(blends) || !blends.length) { console.error("catalog.json has no version or no blends"); process.exit(1); }
const path = join(mkdtempSync(join(tmpdir(), "ember-catalog-")), "load.sql");
writeFileSync(path, catalogSql(version, blends));
const np = blends.filter((b) => b.src === "np").length;
console.log(`${blends.length} blends (${np} Neptune, ${blends.length - np} legacy), version ${version}, SQL at ${path}`);
if (!process.argv.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`Load ${blends.length} blends into production D1? [y/N] `);
  rl.close();
  if (a.trim().toLowerCase() !== "y") { console.log("Not loaded."); process.exit(0); }
}
execFileSync("npx", ["wrangler", "d1", "execute", "ember-journal", "--remote", "--file", path], { stdio: "inherit" });
console.log("Loaded.");
```

- [ ] **Step 8: Run the tests.**

Run: `npx vitest run -c vitest.tools.config.js && npm test`
Expected: every tools test passes, and `npm test` runs both projects plus the dry-run.

- [ ] **Step 9: Extract the legacy catalog while `main` still has it.**

Run: `node tools/catalog/extract-legacy.mjs main`
Expected: `1238 legacy rows → /…/ember-data/legacy-ci.json`

- [ ] **Step 10: Commit.**

```bash
git add tools vitest.config.js vitest.tools.config.js package.json && git commit -q -m "feat: Neptune page parser, catalog builder, legacy extractor (Node-tested)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

---

### Task 3: Crawler, smoke run, then the full crawl in the background (claude01)

**Files:**
- Create: `tools/catalog/crawl.mjs`

**Interfaces:**
- Consumes: `parsePage` (Task 2).
- Produces: `~/ember-data/neptune.jsonl`, with one `{"url", "rec"}` line per page, where `rec` is a record or null.

- [ ] **Step 1: Implement `tools/catalog/crawl.mjs`.**

```js
// One-time, polite crawl of Neptune Cigar size pages. Resumable. Run on claude01:
//   node tools/catalog/crawl.mjs [--limit N]
// Appends {url, rec} lines to $EMBER_DATA/neptune.jsonl and skips URLs already there.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { parsePage } from "./parse.mjs";

const UA = "EmberCatalog/1.0 (personal journal; contact via ember.austinsego.com)";
const DELAY = 3000;
const dir = process.env.EMBER_DATA || `${process.env.HOME}/ember-data`;
const out = `${dir}/neptune.jsonl`;
const li = process.argv.indexOf("--limit");
const limit = li > 0 ? +process.argv[li + 1] || 0 : 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res = null;
    try { res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" } }); } catch { res = null; }
    if (res && res.ok) {
      const html = await res.text();
      // Never try to get past bot protection: stop and let a person decide.
      if (/<title>\s*(Client Challenge|Just a moment)|cf-chl-/i.test(html.slice(0, 4000))) throw new Error("BOT_CHALLENGE " + url);
      return html;
    }
    if (res && res.status === 404) return null;
    if (attempt < 3) await sleep(60000);
  }
  throw new Error("failed after retries: " + url);
}

mkdirSync(dir, { recursive: true });
const done = new Set(existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).url) : []);
const sitemap = await get("https://www.neptunecigar.com/sitemap.xml");
const all = [...sitemap.matchAll(/<loc>(https:\/\/www\.neptunecigar\.com\/cigars\/[^<]+)<\/loc>/g)].map((m) => m[1]);
const todo = all.filter((u) => !done.has(u)).slice(0, limit || undefined);
console.log(`${all.length} size pages in sitemap, ${done.size} already done, fetching ${todo.length}`);

let errors = 0, n = 0;
for (const url of todo) {
  await sleep(DELAY);
  try {
    const html = await get(url);
    const rec = html ? parsePage(html) : null;
    appendFileSync(out, JSON.stringify({ url, rec }) + "\n");
    errors = 0; n++;
    if (n % 100 === 0) console.log(`${n}/${todo.length} ${new Date().toISOString()}`);
  } catch (e) {
    console.error(String(e));
    if (String(e).includes("BOT_CHALLENGE")) { console.error("Bot challenge seen. Stopping."); process.exit(3); }
    if (++errors >= 20) { console.error("20 errors in a row. Stopping."); process.exit(1); }
  }
}
console.log(`finished: ${n} pages fetched this run`);
```

- [ ] **Step 2: Commit.** (A live network script has no unit test. The parser it calls is tested, and Steps 3–4 check it against the real site.)

```bash
git add tools/catalog/crawl.mjs && git commit -q -m "feat: resumable, rate-limited Neptune crawler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

- [ ] **Step 3: Smoke test against the live site (5 pages, about 20 seconds).**

Run: `node tools/catalog/crawl.mjs --limit 5 && tail -5 ~/ember-data/neptune.jsonl`
Expected: `6544 size pages in sitemap` (or close to it), then five lines. Most should have a non-null `rec` with `brand`, `blend`, `w`, `bn`, `fi`, and a `size` with `len` and `rg`. Compare one line by hand with its page in a browser. If fields are shifted or empty, stop and fix `parse.mjs` with a new fixture covering the difference before crawling more.

- [ ] **Step 4: A 200-page sample and the null rate.**

Run: `node tools/catalog/crawl.mjs --limit 195 && node -e 'const l=require("fs").readFileSync(process.env.HOME+"/ember-data/neptune.jsonl","utf8").trim().split("\n").map(JSON.parse);const nul=l.filter(x=>!x.rec).length;const noO=l.filter(x=>x.rec&&!x.rec.o).length;const noS=l.filter(x=>x.rec&&!x.rec.strength).length;console.log({pages:l.length,nulls:nul,rate:(nul/l.length).toFixed(2),noOrigin:noO,noStrength:noS})'`
Expected: `rate` is under 0.30. Samplers and accessories account for the nulls. If it's higher, inspect the null URLs, add a fixture for the missed pattern, and fix the parser before continuing. Because this stays in the resume file, those pages won't be fetched again. If the parser changes after this step, delete `~/ember-data/neptune.jsonl` and restart the crawl, so every record comes from the same parser. Announce that deletion first.

- [ ] **Step 5: Start the full crawl in the background.** It takes about 5.5 hours.

Run: `nohup node tools/catalog/crawl.mjs > ~/ember-data/crawl.log 2>&1 & echo started`

Check progress any time with: `wc -l < ~/ember-data/neptune.jsonl; tail -2 ~/ember-data/crawl.log`

Record the start time in the plan's handoff block and move on to Task 4 while it runs.

---

### Task 4: Client uses the private catalog (can run while the crawl runs)

**Files:**
- Modify: `public/index.html`, `test/ui/checks.mjs`, `test/worker.test.js` (a size check only if needed)
- Create: `test/ui/fixtures/catalog.json`, `test/ui/checks/cat1.js`

**Interfaces:**
- Consumes: `GET /api/catalog` (Task 1) and the record shape from the Global Constraints.
- Produces:
  - `CAT` (array), `catVersion`, `loadCatalogCache()`, `refreshCatalog(force)`
  - `canonBrand(b)`, `renderSizes(list?)`
  - the entry field `sz` and the `#f-size`, `#sizes`, `#sizeopts`, and `#moresizes` elements

- [ ] **Step 1: The runner serves a catalog fixture.** In `test/ui/checks.mjs`, inside the server handler, add this as the first lines of the `try` block:

```js
    if (path === "/api/catalog") {
      const body = await readFile(join(here, "fixtures", "catalog.json"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
```

Then create `test/ui/fixtures/catalog.json`:

```json
{"version":"fixture-1","blends":[
 {"k":"e.p. carrillo|pledge prequel","b":"E.P. Carrillo","l":"Pledge Prequel","w":"Ecuador Habano","wn":"","bn":"Nicaragua","fi":["Nicaragua"],"o":"Dominican Republic","bd":"Full","mk":"Tabacalera La Alianza","sizes":[{"n":"Robusto","shape":"Robusto","len":"5½","rg":52},{"n":"Toro","shape":"Toro","len":"6","rg":52}],"src":"np"},
 {"k":"testbrand|reserva robusto line","b":"Testbrand","l":"Reserva Robusto Line","w":"San Andres","wn":"Maduro","bn":"Nicaragua","fi":["Nicaragua","Honduras"],"o":"Nicaragua","bd":"Med-Full","mk":"Test Cigar Co.","sizes":[{"n":"Petit","shape":"Corona","len":"4","rg":40},{"n":"Corona","shape":"Corona","len":"5½","rg":42},{"n":"Robusto","shape":"Robusto","len":"5","rg":50},{"n":"Short Toro","shape":"Toro","len":"5½","rg":54},{"n":"Toro","shape":"Toro","len":"6","rg":52},{"n":"Belicoso","shape":"Belicoso","len":"6¼","rg":52},{"n":"Torpedo","shape":"Torpedo","len":"6½","rg":52},{"n":"Churchill","shape":"Churchill","len":"7","rg":48},{"n":"Gordo","shape":"Gordo","len":"6","rg":60},{"n":"Double Corona","shape":"Double Corona","len":"7½","rg":50}],"src":"np"},
 {"k":"ci|oliva serie g maduro","b":"","l":"Oliva Serie G Maduro","w":"Maduro","wn":"","bn":"Nicaraguan","fi":["Nicaraguan"],"o":"Nicaragua","bd":"","mk":"","sizes":[],"src":"ci"}
]}
```

- [ ] **Step 2: Write the checks.** Create `test/ui/checks/cat1.js`:

```js
// Catalog Task 4: private catalog, brand spelling, size row, offline cache.
// Run: npm run test:ui -- cat1   and   --dark
(async () => {
  const r = {};
  for (let i = 0; i < 60 && !CAT.length; i++) await new Promise((s) => setTimeout(s, 50));
  r.noREF = typeof REF === "undefined" && !document.documentElement.outerHTML.includes('const REF = [');
  r.catalogLoaded = CAT.length === 3 && catVersion === "fixture-1";
  r.cached = JSON.parse(localStorage.getItem("ember.catalog") || "{}").version === "fixture-1";
  const inp = $("#f-label");
  const type = (v) => { inp.value = v; inp.dispatchEvent(new Event("input")); };
  const sg = (re) => [...document.querySelectorAll("#sugg .sg")].find((b) => re.test(b.textContent));
  type("prequel");
  const row = sg(/Pledge Prequel/);
  r.catalogRowShowsBrand = !!row && row.querySelector(".sgm").textContent === "E.P. Carrillo";
  row.click();
  r.pickFills = $("#f-label").value === "Pledge Prequel" && $("#f-wrapper").value === "Ecuador Habano" &&
    $("#f-body").value === "Full" && $("#f-origin").value === "Dominican Republic" && $("#f-size").value === "";
  r.canonBrand = $("#f-brand").value === "EP Carrillo";
  r.shapeNotFilled = $("#f-shape").value === "";
  r.sizeRow = !$("#sizes").hidden && document.querySelectorAll("#sizeopts button").length === 2 && $("#moresizes").hidden;
  document.querySelector("#sizeopts button").click();
  r.sizeSets = $("#f-shape").value === "Robusto" && $("#f-size").value === "5½ × 52" &&
    document.querySelector("#sizeopts button").classList.contains("on");
  document.querySelector("#sizeopts button").click();
  r.sizeClears = $("#f-shape").value === "" && $("#f-size").value === "";
  document.querySelector("#sizeopts button").click();
  document.querySelector('.rchip[data-r="4.5"]').click();
  const n0 = data.length; $("#save").click();
  const saved = data[0];
  r.savedSize = data.length === n0 + 1 && saved.sh === "Robusto" && saved.sz === "5½ × 52" && saved.b === "EP Carrillo";
  r.sizeRowHiddenAfterSave = $("#sizes").hidden;
  type("reserva robusto"); sg(/Reserva Robusto Line/).click();
  r.moreSizes = document.querySelectorAll("#sizeopts button").length === 8 && !$("#moresizes").hidden;
  $("#moresizes").click();
  r.allSizes = document.querySelectorAll("#sizeopts button").length === 10 && $("#moresizes").hidden;
  type("something else");
  r.retypeHidesSizes = $("#sizes").hidden && $("#f-size").value === "";
  clearForm();
  openDetail(saved.id); r.detailShowsSize = /Robusto, 5½ × 52/.test($("#sheet").textContent); closeDetail();
  smokeAgain(saved.id);
  r.againCopiesSize = $("#f-shape").value === "Robusto" && $("#f-size").value === "5½ × 52" && $("#sizes").hidden;
  clearForm();
  CAT = []; const realFetch = window.fetch; window.fetch = () => Promise.reject(new Error("offline"));
  loadCatalogCache(); await refreshCatalog(true); window.fetch = realFetch;
  type("prequel"); r.offlineSuggests = !!sg(/Pledge Prequel/); clearForm();
  const realSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); };
  CAT = []; catVersion = null; await refreshCatalog(true); Storage.prototype.setItem = realSet;
  r.quotaSafe = CAT.length === 3;
  let csv = ""; const realDl = window.dl; window.dl = (n, t) => { csv = t; }; $("#exp-csv").click(); window.dl = realDl;
  r.csvSize = csv.split("\n")[0].endsWith(",Size");
  return r;
})()
```

- [ ] **Step 3: Confirm it fails.**

Run: `npm run test:ui -- cat1`
Expected: `RESULT: FAIL`. It throws, because `CAT` is not defined.

- [ ] **Step 4: Remove the inline catalog.** Delete the line `/* Reference catalog — full CigarsInternational scrape from your sheet (1,238 cigars) */` and the single long line under it that starts `const REF = [`.

- [ ] **Step 5: Catalog cache and refresh.** Add this directly after the `/* ============ STATE ============ */` block, after the `function save(d){…}` line:

```js
/* ============ CATALOG (private, from /api/catalog; cached on the phone for offline) ============ */
const CATKEY="ember.catalog";
let CAT=[], catVersion=null, catFetchedAt=0;
function loadCatalogCache(){
  try{const c=JSON.parse(localStorage.getItem(CATKEY)||"null");
    if(c&&Array.isArray(c.blends)){CAT=c.blends;catVersion=c.version||null;}}catch(e){}
}
async function refreshCatalog(force){
  if(!force&&Date.now()-catFetchedAt<36e5)return;
  catFetchedAt=Date.now();
  try{
    const out=await apiFetch("/api/catalog?v="+encodeURIComponent(catVersion||""));
    if(out.unchanged||!Array.isArray(out.blends))return;
    CAT=out.blends;catVersion=out.version;
    /* a full or blocked localStorage still leaves the catalog usable for this session */
    try{localStorage.setItem(CATKEY,JSON.stringify({version:catVersion,blends:CAT}));}catch(e){}
    fillDatalists();
  }catch(e){}
}
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
/* prefer Austin's own spelling of a brand he's logged ("EP Carrillo" over "E.P. Carrillo") */
function canonBrand(b){const n=norm(b);return uniq(live().map(e=>e.b)).find(x=>norm(x)===n)||b;}
```

`uniq` and `live` are defined later in HELPERS. That's safe, because `canonBrand` runs only after boot.

- [ ] **Step 6: Point everything that used `REF` at `CAT`.**
  - `fillDatalists`: change `REF.map(r=>r.b)`, `REF.map(r=>r.o)`, `REF.map(r=>r.w)`, and `REF.map(r=>r.bn)` to `CAT.map(r=>r.b)`, `CAT.map(r=>r.o)`, `CAT.map(r=>r.w)`, and `CAT.map(r=>r.bn)`.
  - `findMatch`: change `pool=pool||[...live(),...REF];` to `pool=pool||[...live(),...CAT];`.
  - The backfill handler: change `const pool=[...REF,...live().filter(x=>x.id!==e.id)];` to `const pool=[...CAT,...live().filter(x=>x.id!==e.id)];`.
  - `suggest`: replace the `const cat=REF.filter(…)…map(r=>({kind:"catalog",e:r}));` statement with:

    ```js
      const full=r=>((r.b?r.b+" ":"")+(r.l||"")).toLowerCase();
      const cat=CAT.filter(r=>{const f=full(r),l=(r.l||"").toLowerCase();
          return f.includes(q)&&!known.some(k=>f.endsWith(k)||l===k);})
        .sort((a,b)=>(full(b).startsWith(q)||(b.l||"").toLowerCase().startsWith(q))-(full(a).startsWith(q)||(a.l||"").toLowerCase().startsWith(q)))
        .map(r=>({kind:"catalog",e:r}));
    ```

  - `renderSugg`: change `${s.kind==="history"?esc(s.e.b||"yours"):"catalog"}` to `${s.kind==="history"?esc(s.e.b||"yours"):esc(s.e.b||"catalog")}`.

- [ ] **Step 7: Size row markup and the Size field.** In the `#log` section, directly after the Brand/Wrapper cells' closing `</div>` (the `fgrid c2` holding `#cell-brand` and `#cell-wrapper`), add:

```html
      <div class="field" id="sizes" hidden>
        <div class="lab rowlbl"><span>Size</span>
          <button type="button" class="linkbtn" id="moresizes" hidden>More sizes</button></div>
        <div class="sizeopts" id="sizeopts" role="group" aria-label="Size"></div>
      </div>
```

Inside `#details`, directly after the `fgrid c2` holding Body and Filler, add:

```html
          <div class="fgrid c2">
            <div class="field"><label class="lab" for="f-size">Size</label>
              <input id="f-size" placeholder="6½ × 52" autocomplete="off"></div>
          </div>
```

Add this at the end of the `<style>` block:

```css
  .sizeopts{display:flex;flex-wrap:wrap;column-gap:18px;border-bottom:1px solid var(--rule)}
  .sizeopts button{appearance:none;background:none;border:0;padding:0;min-height:44px;
    font:17px var(--hand);color:var(--faint);cursor:pointer}
  .sizeopts button.on{color:var(--pen);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:6px}
```

- [ ] **Step 8: Size row logic and the pick paths.** Add this directly above `let pickedLabel=null, sugList=[];`:

```js
/* size row: a picked catalog blend's sizes; tapping one fills Shape and Size */
let sizeList=[], sizeAll=false, pickedSize=null;
const sizeText=s=>[s.len,s.rg].filter(Boolean).join(" × ");
function renderSizes(list){
  if(list!==undefined){sizeList=list||[];sizeAll=false;pickedSize=null;}
  $("#sizes").hidden=!sizeList.length;
  const shown=sizeAll?sizeList:sizeList.slice(0,8);
  $("#moresizes").hidden=sizeAll||sizeList.length<=8;
  $("#sizeopts").innerHTML=shown.map((s,i)=>`<button type="button" data-i="${i}" class="${pickedSize===s?"on":""}" aria-pressed="${pickedSize===s}">${
    esc(s.n)}${sizeText(s)?" "+esc(sizeText(s)):""}</button>`).join("");
}
$("#sizeopts").addEventListener("click",e=>{const b=e.target.closest("button[data-i]");if(!b)return;
  const s=sizeList[+b.dataset.i];
  if(pickedSize===s){pickedSize=null;$("#f-shape").value="";$("#f-size").value="";}
  else{pickedSize=s;$("#f-shape").value=s.shape||s.n;$("#f-size").value=sizeText(s);}
  renderSizes();renderSummary();});
$("#moresizes").onclick=()=>{sizeAll=true;renderSizes();};
```

Then make these changes:
- Replace `function clearLeaf(){setLeaf({});$("#f-brand").value="";}` with:

  ```js
  function clearLeaf(){setLeaf({});$("#f-brand").value="";$("#f-size").value="";renderSizes([]);}
  ```

- Replace `applyPick` with:

  ```js
  function applyPick(src,kind){
    let b=src.b||"", l=src.l||"";
    if(kind==="catalog"){if(b)b=canonBrand(b);else{const sp=splitBrand(l);b=sp.b;l=sp.l;}}
    $("#f-label").value=l;$("#f-brand").value=b;setLeaf(src);
    /* catalog rows carry a sizes array; history entries carry their chosen size string */
    $("#f-size").value=typeof src.sz==="string"?src.sz:"";
    renderSizes(kind==="catalog"?(src.sizes||[]):[]);
    pickedLabel=l;hideSugg();renderSummary();renderAgain();
  }
  ```

- In `clearForm`, add `"f-size"` to the id list (after `"f-notes"`), and add `renderSizes([]);` after `setTags([]);`.
- In `startEdit`, after `$("#f-notes").value=e.n||"";`, add `$("#f-size").value=e.sz||"";renderSizes([]);`.
- In `formFields`, add `sz:$("#f-size").value.trim(),` right after `sh:$("#f-shape").value.trim(),`.
- In `openDetail`, change `${row("Shape",e.sh)}` to `${row("Shape",[e.sh,e.sz].filter(Boolean).join(", "))}`.
- In the CSV handler, append `"sz"` to `cols` and `"Size"` to `head`.

- [ ] **Step 9: Boot and resume.** Change the boot line `buildRating();buildOpts();fillDatalists();clearForm();renderAll();` to `loadCatalogCache();buildRating();buildOpts();fillDatalists();clearForm();renderAll();`. Change `updateSyncUI();syncNow(true);` to `updateSyncUI();syncNow(true);refreshCatalog(true);`. In the `visibilitychange` handler, add `refreshCatalog();` right before `syncNow(true);`.

- [ ] **Step 10: Run every check in both schemes.**

Run: `for c in cat1 tf1 tf2 tf3 tf4 task2 task3 task4 baseline; do printf "%s %s / %s\n" $c "$(npm run -s test:ui -- $c 2>&1 | tail -1)" "$(npm run -s test:ui -- $c --dark 2>&1 | tail -1)"; done`
Expected: 18 `RESULT: PASS`.

`task3`'s `catalogSplit` now relies on the fixture's legacy "Oliva Serie G Maduro" row. That's why the fixture has it.

Then run `npm run test:ui -- cat1 --shot='$("#f-label").value="prequel";$("#f-label").dispatchEvent(new Event("input"));document.querySelector("#sugg .sg").click()'` and look at the size row under the Brand/Wrapper cells.

- [ ] **Step 11: `npm test`, then commit.**

```bash
npm test && git add public/index.html test/ui && git commit -q -m "feat: client reads the private catalog; size row; drop inline REF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

- [ ] **Step 12: Whole-branch review.** Use superpowers:requesting-code-review with one reviewer on the most capable model over `git diff main...catalog`. Fix what it confirms, rerun everything, and push.

---

### Task 5: Build, load, deploy, and the phone check (after the crawl finishes)

- [ ] **Step 1: Confirm the crawl finished (claude01).**

Run: `tail -3 ~/ember-data/crawl.log; wc -l < ~/ember-data/neptune.jsonl`
Expected: `finished: …` in the log, and a line count near the sitemap's size-page count. If it stopped early for errors, run the Task 3 Step 5 command again. It resumes where it left off.

- [ ] **Step 2: Build (claude01).**

Run: `node tools/catalog/build.mjs && node -e 'const c=require(process.env.HOME+"/ember-data/catalog.json");const m=c.blends.find(b=>b.b==="Oliva"&&/Serie V Melanio$/.test(b.l));console.log(JSON.stringify(m,null,1).slice(0,900))'`
Expected: a summary of pages, skipped pages, Neptune blends, legacy rows, KB, and the version, with no unmapped strengths (if any appear, add them to `BODY` with a test, then rebuild). Then a Serie V Melanio record with wrapper, binder, filler, body `Med`, and several sizes.

- [ ] **Step 3: Hand off to the Mac.** Update the plan's handoff block and push. Then give Austin this, to paste on the Mac or to hand to the Mac session:

```bash
cd /usr/local/ember && git fetch && git checkout catalog && git pull && npm ci && npm test && mkdir -p /tmp/ember-data && scp -O -i ~/Documents/Claude/Projects/Homelab/.ssh/claude01 austin@192.168.3.159:/home/austin/ember-data/catalog.json /tmp/ember-data/catalog.json && ls -l /tmp/ember-data/catalog.json
```

- [ ] **Step 4: Production writes (Mac only, each after Austin's yes in chat).**
  1. Apply the schema. It's safe to rerun, because every statement is `CREATE … IF NOT EXISTS`: `npm run schema`
  2. Load the catalog. It prints counts, then asks. Use `--yes` only after the chat yes: `node tools/catalog/load.mjs /tmp/ember-data/catalog.json`
  3. Verify the load: `npx wrangler d1 execute ember-journal --remote --command "SELECT count(*) AS n, (SELECT value FROM catalog_meta WHERE key='version') AS v FROM catalog"`. It should report the build's blend count and version.
  4. Deploy: `npm run deploy`

- [ ] **Step 5: Austin's phone check (about 3 minutes).**
  1. Open Ember from the home screen.
  2. Type a cigar that wasn't in the old catalog (a recent boutique release) and pick it.
  3. Pick a size and save.
  4. Open the entry: Shape should read like "Robusto, 5½ × 52".
  5. Turn on Airplane Mode, reopen Ember, type the same name, and confirm the suggestion still appears.

- [ ] **Step 6: Finish the branch.** Use superpowers:finishing-a-development-branch to open a PR from `catalog`, merge it into `main`, and push. Tick the resume pointer in the handoff block.
