# Ember quick log Implementation Plan

## Handoff — 2026-09-25 18:10 (Claude Code desktop on MacBook → claude01, Opus 5.5)

- [ ] Resume: build Ember quick log from this plan on claude01. Tick this in Task 5 Step 5.

**Progress 2026-09-25 (claude01):** Tasks 1–4 are done and pushed, along with the Task 5 Step 1 review fixes (last commit `cbbee91`). `npm test` passes 56/56, and the UI checks for baseline and tasks 2–4 all pass. Next is Task 5 Step 2: Austin deploys from the Mac. Rulings and deferred minors are in the claude01 session's final message and in draft PR #1's body.

**Goal:** Execute Tasks 1–5 below on branch `quick-log`, so logging in Ember beats the Cigar journal sheet.

**Decisions made:** everything is in the spec (`docs/superpowers/specs/2026-09-25-ember-quick-log-design.md`). Ember has no vault or personal project folder. This repo is its only canonical record, so don't write Ember notes into Homelab files.

**Current state** (updated 2026-09-25 18:40, Mac)
- verified: Tasks 1–4 and the Task 5 Step 1 review fixes are pushed (`cbbee91`). Rerun on the Mac: `npm test` passes 56/56, and `test:ui` passes for baseline and tasks 2–4.
- verified: Task 5 Step 2 is done. Version `f603a820-8726-4ab4-9ad1-e111466ac8e1` was deployed from the Mac at 18:37, and Access still returns 302 for unauthenticated requests to `/` and `/manifest.webmanifest`.
- assumed: the iOS home-screen login round-trip works. Task 5 Step 4 decides it.

**Next 3 actions**
1. Austin raises the Ember Access application's session duration (Task 5 Step 3; the steps are in the Mac session's reply).
2. Austin runs the phone check (Task 5 Step 4). If the login doesn't return to the app, apply the `display: "browser"` fallback.
3. Finish the branch (Task 5 Step 5): merge PR #1 into `main`.

**Open questions:** execution method. Austin's kickoff message says `native` or `subagents`. If it's missing, use native, because Tasks 2–4 share one file.

**Files touched so far:** `docs/superpowers/specs/2026-09-25-ember-quick-log-design.md`, `docs/superpowers/plans/2026-09-25-ember-quick-log.md`, `test/ui/checks.mjs`, `test/ui/checks/*.js`, `package.json`, `package-lock.json`, `.gitignore`, `.claude/launch.json`

**Credentials needed:** GitHub via `gh` on claude01 (already logged in as `bumdlebore`, and git uses it through `gh auth setup-git`). The Cloudflare wrangler login lives on the Mac only, and Austin runs the deploy.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make logging a cigar in Ember faster than opening the Cigar journal sheet, and make the numbers trustworthy.

**Architecture:** All UI stays in the single file `public/index.html`, which the Worker serves at `/`. The Worker gains three authenticated static routes: the manifest and two kinds of icon. The Log screen becomes the home screen, with a custom suggestion list, rating chips, and collapsed details. Edit, smoke again, and a rate-later strip reuse that same form.

**Tech Stack:** Cloudflare Workers, D1, vitest with `@cloudflare/vitest-pool-workers`, wrangler 4, vanilla JS/CSS, `rsvg-convert` for icons (Debian `librsvg2-bin`, Homebrew `librsvg`), and `playwright-core` driving the system Chromium for UI checks.

**Spec:** `docs/superpowers/specs/2026-09-25-ember-quick-log-design.md`

## Global Constraints

- The entry shape is unchanged: `d b l sh bd w wn bn fi o r s n u deleted id`. The Worker's sync, auth, and D1 schema are unchanged.
- All UI code lives in `public/index.html`. The only new served files are `public/manifest.webmanifest`, `public/icon-180.png`, `public/icon-192.png`, and `public/icon-512.png`.
- Main rating chips: `3.5, 3.75, 4, 4.25, 4.5, 4.75, 5`. Lower row: `2, 2.25, 2.5, 2.75, 3, 3.25`.
- Palate shrinkage uses `k = 5`. A headline clause needs its top row at `n ≥ 5`.
- The unrated strip covers the last 14 days, shows at most 3 entries, and applies to `typeof r !== "number"`.
- At most 8 suggestions and at most 6 smoke-again chips (cigars logged more than once).
- Every text input, select, and textarea is at least 16px, so iOS doesn't zoom on focus.
- Run every command from the repo root. Commands are POSIX `sh`-safe (the Mac shell is zsh), with no `read -p`.
- After each task's commit, run `git push` so `origin/quick-log` shows progress.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The branch is `quick-log`. Don't commit to `main`.

## Review Focus

1. **A pick followed by retyping a new name.** Leaf fields from the old pick must clear, not stay stuck on the new cigar. Task 3 check `retypeClears`.
2. **Standalone app left open overnight.** An untouched form must roll its date to today when the app becomes visible. Task 3 check `dayRolls`.
3. **Tapping a suggestion on a touchscreen.** The input's blur must not close the list before the tap registers. Task 3 check `keepsFocus`.
4. **Names and notes containing `<`, `&`, or quotes.** They must render as literal text, never as markup. Task 2 check `escapedRow`.
5. **iOS focus zoom on inputs under 16px.** Task 3 check `noZoom`.

## How the UI checks run

The UI logic lives inside `index.html`, so vitest doesn't import it. Each UI task's checks live in `test/ui/checks/<task>.js` (already committed). `test/ui/checks.mjs` runs them:

```bash
npm run test:ui -- task3
```

The runner serves `public/` on a random localhost port and opens it in headless Chromium at 375×812 with a fresh profile, so the seed data loads and no reset is needed. It prints the result object and saves `test/ui/out/<task>.png`, so look at the screenshot. It exits 1 if any key isn't `true`, if the block throws, or if the page raises an uncaught error. `npm run test:ui -- baseline` is the runner's self-test and passes on any build.

Sync fails with a 404 under the runner, so the sync pill shows "⚠ Sign in". That's expected.

The checks are the spec for each UI task. If one looks wrong, stop and say so rather than editing it to pass.

---

### Task 1: Home-screen install files

**Files:**
- Create: `public/icon-source.svg`, `public/icon-180.png`, `public/icon-192.png`, `public/icon-512.png`, `public/manifest.webmanifest`
- Modify: `src/index.js`, `wrangler.toml`, `public/index.html` (`<head>` and header CSS)
- Test: `test/worker.test.js`

**Interfaces:**
- Consumes: `mintJwt()`, `callWorker()`, and `SELF` from the existing `test/worker.test.js`.
- Produces: `GET /manifest.webmanifest` and `GET /icon-{180,192,512}.png`, authenticated, with `X-Ember-Shell: 1`.

- [ ] **Step 1: Write the failing tests.** Append this to `test/worker.test.js`:

```js
describe("install files", () => {
  const url = (p) => "https://ember.austinsego.com" + p;
  const authed = async (p) =>
    callWorker(new Request(url(p), { headers: { "Cf-Access-Jwt-Assertion": await mintJwt() } }));

  it("refuses the manifest without an assertion", async () => {
    const res = await SELF.fetch(url("/manifest.webmanifest"));
    expect(res.status).toBe(403);
  });

  it("refuses an icon without an assertion", async () => {
    const res = await SELF.fetch(url("/icon-192.png"));
    expect(res.status).toBe(403);
  });

  it("serves the manifest with the Ember name, start_url, and both icons", async () => {
    const res = await authed("/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/application\/manifest\+json/);
    expect(res.headers.get("X-Ember-Shell")).toBe("1");
    const m = await res.json();
    expect(m.name).toBe("Ember");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.icons.map((i) => i.src).sort()).toEqual(["/icon-192.png", "/icon-512.png"]);
  });

  for (const size of [180, 192, 512]) {
    it(`serves icon-${size}.png as a ${size}px PNG`, async () => {
      const res = await authed(`/icon-${size}.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("X-Ember-Shell")).toBe("1");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const width = new DataView(bytes.buffer).getUint32(16);
      expect(width).toBe(size);
    });
  }

  it("links the manifest and touch icon from the app shell", async () => {
    const html = await (await authed("/")).text();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon-180.png">');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run test/worker.test.js`
Expected: the new tests fail. Authenticated manifest and icon requests get 404, and the shell has no manifest link. The two "refuses" tests may already pass, because every unauthenticated path returns 403.

- [ ] **Step 3: Create the icon source.** Write `public/icon-source.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#e07a37" stop-opacity=".45"/>
      <stop offset="1" stop-color="#e07a37" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coal" cx="38%" cy="34%" r="70%">
      <stop offset="0" stop-color="#f0a85a"/>
      <stop offset=".55" stop-color="#e07a37"/>
      <stop offset="1" stop-color="#7a2f10"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="#1c1611"/>
  <circle cx="256" cy="256" r="200" fill="url(#glow)"/>
  <circle cx="256" cy="256" r="104" fill="url(#coal)"/>
</svg>
```

- [ ] **Step 4: Render the three PNGs.**

```bash
(cd public && for s in 180 192 512; do rsvg-convert -w $s -h $s icon-source.svg -o icon-$s.png; done && file icon-*.png)
```

Expected: three lines, each reading `PNG image data, <s> x <s>`.

- [ ] **Step 5: Write `public/manifest.webmanifest`.**

```json
{
  "name": "Ember",
  "short_name": "Ember",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#1c1611",
  "theme_color": "#1c1611",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 6: Add a Data rule for PNGs.** Append this to `wrangler.toml`, after the existing `[[rules]]` blocks and before `[vars]`:

```toml
[[rules]]
type = "Data"
globs = ["**/*.png"]
fallthrough = true
```

- [ ] **Step 7: Serve the routes.** In `src/index.js`, add these imports under the `SW` import:

```js
import MANIFEST from "../public/manifest.webmanifest";
import ICON_180 from "../public/icon-180.png";
import ICON_192 from "../public/icon-192.png";
import ICON_512 from "../public/icon-512.png";

const ICONS = { "/icon-180.png": ICON_180, "/icon-192.png": ICON_192, "/icon-512.png": ICON_512 };
```

Then insert this directly before `if (url.pathname === "/api/entries") {`, after the identity check:

```js
    // Install files sit behind Access like the shell. X-Ember-Shell marks them
    // as coming from this Worker (not an Access interstitial), so the service
    // worker's existing rule caches them.
    if (url.pathname === "/manifest.webmanifest") {
      return new Response(MANIFEST, {
        headers: {
          "Content-Type": "application/manifest+json",
          "Cache-Control": "no-cache",
          "X-Ember-Shell": "1",
        },
      });
    }
    if (ICONS[url.pathname]) {
      return new Response(ICONS[url.pathname], {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
          "X-Ember-Shell": "1",
        },
      });
    }
```

- [ ] **Step 8: Link the files from the shell.** In `public/index.html`, replace the viewport meta and the theme-color meta (lines 5–6) with:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#1c1611">
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="apple-touch-icon" href="/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Ember">
```

`black-translucent` draws content under the status bar. Replace the header rule `header{padding:26px 16px 14px;max-width:880px;margin:0 auto}` with:

```css
  header{padding:calc(14px + env(safe-area-inset-top)) 16px 8px;max-width:880px;margin:0 auto}
```

- [ ] **Step 9: Run the full suite.**

Run: `npm test`
Expected: all vitest tests pass, and `wrangler deploy --dry-run` lists the upload with no errors.

- [ ] **Step 10: Commit.**

```bash
git add public/icon-source.svg public/icon-*.png public/manifest.webmanifest src/index.js wrangler.toml public/index.html test/worker.test.js && git commit -q -m "feat: serve manifest and icons for home-screen install

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Local dates, escaping, honest Palate

**Files:**
- Modify: `public/index.html` (script: helpers, `topBy`, `renderPalate`, `rankCard`, `entryRow`, `openDetail`, `fillDatalists`, `clearForm`, save handler)

**Interfaces:**
- Produces: `localToday(d = new Date()) → "YYYY-MM-DD"` (local calendar date), `esc(s) → string` (HTML-escaped), and the constants `SHRINK_K = 5` and `HEADLINE_MIN_N = 5`. Tasks 3 and 4 use `localToday` and `esc`.

- [ ] **Step 1: Confirm the checks fail on the current code.**

Run: `npm run test:ui -- task2`
Expected: `check threw: ... ReferenceError: localToday is not defined`, `RESULT: FAIL`.

- [ ] **Step 2: Add the helpers.** In the `HELPERS` section, directly after `function uniq(arr){...}`, add:

```js
function localToday(d=new Date()){const p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());}
const ESC={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>ESC[c]);}
```

- [ ] **Step 3: Replace every UTC date.** Replace both occurrences of `new Date().toISOString().slice(0,10)` (in `clearForm` and in the save handler) with `localToday()`. Then confirm none remain:

Run: `grep -c "toISOString().slice(0,10)" public/index.html`
Expected: `0`

- [ ] **Step 4: Shrink the rankings.** Replace `function topBy(rows,minN){...}` with:

```js
/* Rank by a shrunk average so 2 smokes can't outrank 20:
   (n·avg + k·mean)/(n + k). The raw avg is still what the UI shows. */
const SHRINK_K=5, HEADLINE_MIN_N=5;
function topBy(rows,minN,mean){
  return rows.filter(r=>r.n>=minN)
    .map(r=>({...r,shr:(r.n*r.avg+SHRINK_K*mean)/(r.n+SHRINK_K)}))
    .sort((a,b)=>b.shr-a.shr||b.n-a.n);
}
```

In `renderPalate`, pass `avg` as the third argument to all six `topBy(...)` calls, for example `const origin=topBy(agg(e=>[e.o]),2,avg);`. The line `const avg=...` is already above them.

- [ ] **Step 5: Gate and escape the headline.** Replace the block from `const o=origin[0], w=wrapper[0], bd=body[0];` through `line+=\`.\`;` with:

```js
  const top=rows=>rows[0]&&rows[0].n>=HEADLINE_MIN_N?rows[0]:null;
  const o=top(origin), w=top(wrapper), bd=body[0];
  let line;
  if(o){line=`You're a <em>${esc(o.k)}</em> smoker`;
    if(w) line+=`, happiest under a <em>${esc(w.k)}</em> wrapper`;}
  else if(w) line=`You're happiest under a <em>${esc(w.k)}</em> wrapper`;
  else line=`Log a few more and a pattern shows up here`;
  if(o&&madAvg>=avg+0.1 && maduro.length>=3) line+=` — and a <em>maduro</em> at heart`;
  line+=`.`;
```

In the same `innerHTML` template, change `<b>${bd.k}</b>` to `<b>${esc(bd.k)}</b>`.

- [ ] **Step 6: Escape the render paths.**
  - In `rankCard`, change `<span>${x.k}</span>` to `<span>${esc(x.k)}</span>`.
  - In `entryRow`, wrap every interpolated entry field in `esc()`:
    - `${esc(e.id)}`
    - `${esc(e.l||e.b||"Untitled")}`
    - `${esc(e.b||"")}`
    - `${esc(e.o)}`, `${esc(e.w)}`, `${esc(e.bd)}`, `${esc(e.sh)}`
    - `${esc(e.n)}`
  - In `openDetail`, do the same for `e.l||e.b||"Untitled"`, `e.b`, `e.o`, `e.bd`, `e.sh`, `e.w`, `e.wn`, `e.bn`, `fi`, and `e.n`.
  - In `fillDatalists`, change `${v.replace(/"/g,'&quot;')}` to `${esc(v)}`.

- [ ] **Step 7: Run the checks and confirm they pass.**

Run: `npm run test:ui -- task2`
Expected: every key `true`, `RESULT: PASS`. The checks cover local dates at 20:30 and 23:59, `esc()`, the Nicaragua/San Andres headline, and a markup-laden entry rendering as text. See `test/ui/checks/task2.js`.

- [ ] **Step 8: Commit.**

```bash
git add public/index.html && git commit -q -m "fix: local dates, escaped rendering, shrunk palate rankings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Log screen as home, bottom tabs, rating chips, suggestions

**Files:**
- Modify: `public/index.html`: CSS, the header, `nav`, the `#log` section, the datalists, and the script sections `LOG FORM`, `TABS / WIRING`, `SYNC` (visibility handler), and `BOOT`

**Interfaces:**
- Consumes: `localToday`, `esc` (Task 2), and the existing `findMatch(label, brand, pool)`, `cleanLeaf(s)`, `REF`, `live()`, `fmtDate(d)`, `toast`, `save`, `fillDatalists`, `renderAll`, `pushSync`, and `switchTab`.
- Produces, for Task 4:
  - `let rating` (number or null), `setRating(v)`, `RATE_MAIN`, `RATE_LOW`
  - `let pickedLabel`, `let formDay`
  - `historyCigars() → [{e, count}]`, most recent first, one per brand+blend
  - `suggest(q) → [{kind: "history" | "catalog", e}]`
  - `setLeaf(src)`, `clearLeaf()`, `applyPick(src, kind)`
  - `renderSummary()`, `renderAgain()`, `renderSugg()`, `hideSugg()`
  - `fmtShort(d) → "Sep 19"`, `dateLabel(d)`, `clearForm()`
  - element ids `#unrated`, `#edithd`, `#cancel`, and `#details`

- [ ] **Step 1: Confirm the checks fail on the current code.**

Run: `npm run test:ui -- task3`
Expected: `RESULT: FAIL`. It throws on the missing `.rchip`, or reports `opensOnLog: false`.

- [ ] **Step 2: Header.** Delete the tagline line `<div class="tag">A journal for the leaf — and what it tells you about your palate.</div>` and the `.tag{...}` CSS rule. Change `.brand h1{font-size:30px;font-weight:600}` to `.brand h1{font-size:24px;font-weight:600}`.

- [ ] **Step 3: Bottom tab bar.** Replace the `<nav>...</nav>` block with:

```html
<nav class="tabbar">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-tab="log">Log</button>
    <button role="tab" aria-selected="false" data-tab="journal">Journal</button>
    <button role="tab" aria-selected="false" data-tab="palate">Palate</button>
  </div>
</nav>
```

Replace the `/* Tabs */` CSS block (the `nav{...}`, `.tabs{...}`, `.tabs button{...}`, `.tabs button[aria-selected=true]{...}`, and `.tabs button:focus-visible{...}` rules) with:

```css
  /* Tabs — bottom bar, thumb reach */
  nav.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30;background:var(--bg2);
    border-top:1px solid var(--line2);padding:6px 12px calc(6px + env(safe-area-inset-bottom))}
  .tabs{display:flex;gap:4px;max-width:560px;margin:0 auto}
  .tabs button{flex:1;appearance:none;border:0;background:transparent;color:var(--mute);
    font:inherit;font-weight:600;font-size:14px;min-height:44px;border-radius:9px;
    cursor:pointer;transition:.15s;letter-spacing:.01em}
  .tabs button[aria-selected=true]{background:var(--card2);color:var(--ink)}
  .tabs button:focus-visible{outline:2px solid var(--ember);outline-offset:2px}
```

Remove `on` from `<section class="panel on" id="palate"`. The `#log` section gets `class="panel on"` in Step 5.

- [ ] **Step 4: Base input size and toast position.**
  - In the `input,select,textarea{...}` rule, change `font-size:15px` to `font-size:16px`.
  - In `.toast{...}`, change `bottom:22px` to `bottom:calc(76px + env(safe-area-inset-bottom))`.
  - Delete these CSS rules: `.ratepick`, `.stars`, `.stars button`, `.stars .dot`, `.stars button.on .dot`, `.stars button.half .dot`, `.rateval`, `.prefill`, `.prefill.nomatch`, and `.prefill.show`. Keep `.ratehint`, because `entryRow` uses it.

- [ ] **Step 5: Log section markup.** Replace the whole `<!-- ===== LOG ===== -->` section with:

```html
  <!-- ===== LOG ===== -->
  <section class="panel on" id="log" role="tabpanel">
    <div class="unrated" id="unrated"></div>
    <div class="card pad">
      <div class="fgrid">
        <div class="edithd" id="edithd" hidden></div>
        <div class="field">
          <div class="namebox">
            <input id="f-label" placeholder="What are you smoking?" autocomplete="off"
              autocapitalize="words" enterkeyhint="done" aria-label="Cigar name">
            <div class="sugg" id="sugg" role="listbox" hidden></div>
          </div>
          <div class="summary" id="summary" hidden><span id="summarytext"></span>
            <button type="button" class="linkbtn" id="showdetails">Edit details</button></div>
        </div>

        <div class="again" id="again"></div>

        <div class="field">
          <div class="fl rowlbl"><span>Rating</span>
            <button type="button" class="linkbtn" id="ratelow">Lower scores</button></div>
          <div class="ratechips" id="ratechips"></div>
          <div class="ratechips low" id="ratechips-low" hidden></div>
        </div>

        <textarea id="f-notes" rows="2" placeholder="Flavors, draw, burn…" aria-label="Notes"></textarea>

        <div class="footrow">
          <label class="toggle"><input type="checkbox" id="f-social"> With friends</label>
          <label class="datebtn"><span id="datelabel"></span>
            <input id="f-date" type="date" aria-label="Date"></label>
        </div>

        <details id="details">
          <summary>Details</summary>
          <div class="fgrid">
            <div class="fgrid c2">
              <div class="field"><label class="fl" for="f-brand">Brand</label>
                <input id="f-brand" list="dl-brand" placeholder="Oliva" autocomplete="off"></div>
              <div class="field"><label class="fl" for="f-origin">Origin</label>
                <input id="f-origin" list="dl-origin" placeholder="Nicaragua" autocomplete="off"></div>
            </div>
            <div class="fgrid c2">
              <div class="field"><label class="fl" for="f-wrapper">Wrapper</label>
                <input id="f-wrapper" list="dl-wrapper" placeholder="San Andres" autocomplete="off"></div>
              <div class="field"><label class="fl" for="f-wnote">Wrapper note</label>
                <input id="f-wnote" list="dl-wnote" placeholder="Maduro" autocomplete="off"></div>
            </div>
            <div class="fgrid c2">
              <div class="field"><label class="fl" for="f-binder">Binder</label>
                <input id="f-binder" list="dl-binder" placeholder="Nicaraguan" autocomplete="off"></div>
              <div class="field"><label class="fl" for="f-shape">Shape</label>
                <input id="f-shape" list="dl-shape" placeholder="Toro" autocomplete="off"></div>
            </div>
            <div class="fgrid c2">
              <div class="field"><label class="fl" for="f-body">Body</label>
                <select id="f-body"><option value="">—</option><option>Light</option><option>Med-Light</option>
                  <option>Med</option><option>Med-Full</option><option>Full</option></select></div>
              <div class="field"><label class="fl" for="f-filler">Filler</label>
                <input id="f-filler" placeholder="Nicaraguan, Dominican" autocomplete="off"></div>
            </div>
          </div>
        </details>

        <div class="btnrow">
          <button class="btn primary" id="save">Save</button>
          <button class="btn ghost" id="cancel" hidden>Cancel</button>
        </div>
      </div>
    </div>
  </section>
```

Delete `<datalist id="dl-label"></datalist>`.

- [ ] **Step 6: Log screen CSS.** Add this at the end of the `<style>` block:

```css
  /* ---- Quick log ---- */
  .unrated{display:grid;gap:6px;margin-bottom:10px}
  .unrated:empty{display:none}
  .unrated button{appearance:none;display:flex;justify-content:space-between;align-items:center;gap:10px;
    width:100%;background:#3a2a17;border:1px solid #5c3b1f;color:var(--ember2);font:inherit;font-size:14px;
    padding:10px 12px;border-radius:var(--rad-s);cursor:pointer;text-align:left;min-height:44px}
  .unrated button b{font-weight:600;color:var(--ink);flex:none}
  .edithd{font-family:'Fraunces',serif;font-size:19px}
  .namebox{position:relative}
  #f-label{font-size:17px;padding:13px 14px}
  .sugg{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:20;background:var(--card2);
    border:1px solid var(--line2);border-radius:var(--rad-s);overflow:hidden;box-shadow:var(--shadow)}
  .sg{appearance:none;display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;
    background:transparent;border:0;border-top:1px solid var(--line);color:var(--ink);font:inherit;
    font-size:15px;padding:10px 12px;text-align:left;cursor:pointer;min-height:44px}
  .sg:first-child{border-top:0}
  .sg span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .sgm{color:var(--mute);font-size:12px;font-family:'JetBrains Mono',monospace;flex:none}
  .summary{font-size:12.5px;color:var(--mute);margin:8px 2px 0;line-height:1.5}
  .linkbtn{appearance:none;background:none;border:0;padding:0;font:inherit;font-size:12.5px;
    color:var(--ember2);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .again:empty{display:none}
  .again .chips{margin-top:0}
  .againchip{font:inherit;font-size:13px;cursor:pointer;min-height:36px;padding:6px 12px}
  .rowlbl{display:flex;justify-content:space-between;align-items:baseline}
  .ratechips{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
  .ratechips.low{margin-top:4px}
  .rchip{appearance:none;min-height:42px;border-radius:8px;border:1px solid var(--line2);background:var(--bg2);
    color:var(--ink2);font-family:'JetBrains Mono',monospace;font-size:13px;padding:0;cursor:pointer}
  .rchip.on{background:linear-gradient(180deg,var(--ember2),var(--ember));color:#241206;
    border-color:transparent;font-weight:700}
  .footrow{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px;color:var(--ink2)}
  .toggle{display:flex;align-items:center;gap:8px;cursor:pointer;min-height:40px}
  .toggle input{width:20px;height:20px;accent-color:var(--ember);margin:0}
  .datebtn{position:relative;font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--ink2);
    border:1px solid var(--line2);border-radius:20px;padding:8px 12px;cursor:pointer}
  .datebtn input{position:absolute;inset:0;opacity:0;width:100%;height:100%;padding:0;border:0}
  #details summary{cursor:pointer;color:var(--mute);font-size:13px;padding:4px 2px;list-style:none}
  #details summary::-webkit-details-marker{display:none}
  #details summary::before{content:"▸ "}
  #details[open] summary::before{content:"▾ "}
  #details > .fgrid{margin-top:10px}
```

- [ ] **Step 7: Replace the form script.** In the `LOG FORM` section, replace everything from `let rating=null;` through the end of the `$("#save").onclick=...` handler with the code below. That range covers `buildStars`, `paintStars`, `fillDatalists`, `cleanLeaf`, `shortest`, `findMatch`, `tryPrefill` and its three listeners, the backfill handler, `clearForm`, the clear handler, and the save handler. Keep `fillDatalists` (minus its `dl-label` line), `cleanLeaf`, `shortest`, `findMatch`, and the backfill handler exactly as they are, placed before this code:

```js
/* rating chips: quarter points, tap again to clear */
const RATE_MAIN=[3.5,3.75,4,4.25,4.5,4.75,5], RATE_LOW=[2,2.25,2.5,2.75,3,3.25];
let rating=null;
function buildRating(){
  const mk=v=>`<button type="button" class="rchip" data-r="${v}">${v}</button>`;
  $("#ratechips").innerHTML=RATE_MAIN.map(mk).join("");
  $("#ratechips-low").innerHTML=RATE_LOW.map(mk).join("");
  $$(".rchip").forEach(b=>b.onclick=()=>{const v=+b.dataset.r;setRating(rating===v?null:v);});
  $("#ratelow").onclick=()=>{$("#ratechips-low").hidden=!$("#ratechips-low").hidden;};
}
function setRating(v){rating=v;
  $$(".rchip").forEach(b=>b.classList.toggle("on",+b.dataset.r===rating));
  if(rating!=null&&rating<3.5)$("#ratechips-low").hidden=false;}

/* history + catalog suggestions */
function historyCigars(){
  const m=new Map();
  [...live()].sort((a,b)=>(b.d||"").localeCompare(a.d||"")).forEach(e=>{
    if(!e.l&&!e.b)return;
    const key=((e.b||"")+"|"+(e.l||"")).toLowerCase();
    if(m.has(key))m.get(key).count++;else m.set(key,{e,count:1});
  });
  return [...m.values()];
}
function suggest(q){
  q=q.trim().toLowerCase();if(!q)return[];
  const hist=historyCigars()
    .filter(h=>((h.e.b||"")+" "+(h.e.l||"")).toLowerCase().includes(q))
    .map(h=>({kind:"history",e:h.e}));
  const known=hist.map(h=>(h.e.l||"").toLowerCase()).filter(Boolean);
  const cat=REF.filter(r=>{const l=r.l.toLowerCase();return l.includes(q)&&!known.some(k=>l.endsWith(k));})
    .sort((a,b)=>b.l.toLowerCase().startsWith(q)-a.l.toLowerCase().startsWith(q))
    .map(r=>({kind:"catalog",e:r}));
  return [...hist,...cat].slice(0,8);
}
/* catalog names carry the brand ("Oliva Serie G Maduro"); split it off when a known brand prefixes it */
function splitBrand(name){
  const low=name.toLowerCase();
  const hit=uniq(live().map(e=>e.b)).sort((a,b)=>b.length-a.length)
    .find(br=>low.startsWith(br.toLowerCase()+" "));
  return hit?{b:hit,l:name.slice(hit.length+1).trim()}:{b:"",l:name};
}
const LEAF_IDS={o:"#f-origin",w:"#f-wrapper",wn:"#f-wnote",bn:"#f-binder",bd:"#f-body",sh:"#f-shape"};
function setLeaf(src){
  Object.entries(LEAF_IDS).forEach(([k,sel])=>$(sel).value=cleanLeaf(src[k]));
  $("#f-filler").value=(src.fi||[]).map(cleanLeaf).filter(Boolean).join(", ");
}
function clearLeaf(){setLeaf({});$("#f-brand").value="";}
let pickedLabel=null, sugList=[];
function applyPick(src,kind){
  let b=src.b||"", l=src.l||"";
  if(kind==="catalog"){const sp=splitBrand(l);b=sp.b;l=sp.l;}
  $("#f-label").value=l;$("#f-brand").value=b;setLeaf(src);
  pickedLabel=l;hideSugg();renderSummary();renderAgain();
}
function renderSugg(){
  const box=$("#sugg");sugList=suggest($("#f-label").value);
  if(!sugList.length){hideSugg();return;}
  box.innerHTML=sugList.map((s,i)=>`<button type="button" class="sg" role="option" data-i="${i}">
    <span>${esc(s.e.l||s.e.b)}</span><span class="sgm">${s.kind==="history"?esc(s.e.b||"yours"):"catalog"}</span></button>`).join("");
  box.hidden=false;
}
function hideSugg(){$("#sugg").hidden=true;$("#sugg").innerHTML="";sugList=[];}
/* mousedown fires before the input blurs; preventing it keeps focus so the tap lands */
$("#sugg").addEventListener("mousedown",e=>e.preventDefault());
$("#sugg").addEventListener("click",e=>{const b=e.target.closest(".sg");if(!b)return;
  const s=sugList[+b.dataset.i];if(s){applyPick(s.e,s.kind);$("#f-label").blur();}});
$("#f-label").addEventListener("input",()=>{
  if(pickedLabel!==null&&$("#f-label").value!==pickedLabel){clearLeaf();pickedLabel=null;}
  renderSugg();renderAgain();renderSummary();
});
$("#f-label").addEventListener("keydown",e=>{if(e.key!=="Enter")return;e.preventDefault();
  const s=sugList[0];if(s)applyPick(s.e,s.kind);$("#f-label").blur();});
$("#f-label").addEventListener("blur",()=>{setTimeout(hideSugg,150);tryPrefill();});
/* typed without picking: fill blank leaf fields from history/catalog, as before */
function tryPrefill(){
  const m=findMatch($("#f-label").value,$("#f-brand").value);if(!m)return;
  const setIf=(sel,val)=>{val=cleanLeaf(val);if(val&&!$(sel).value)$(sel).value=val;};
  setIf("#f-brand",m.b);Object.entries(LEAF_IDS).forEach(([k,sel])=>setIf(sel,m[k]));
  if(m.fi&&m.fi.length&&!$("#f-filler").value)$("#f-filler").value=m.fi.map(cleanLeaf).filter(Boolean).join(", ");
  renderSummary();
}
function renderSummary(){
  const parts=[$("#f-brand").value,[$("#f-wrapper").value,$("#f-wnote").value].filter(Boolean).join(" "),
    $("#f-binder").value,$("#f-body").value].map(s=>s.trim()).filter(Boolean);
  $("#summarytext").textContent=parts.join(" · ");$("#summary").hidden=!parts.length;
}
$("#details").addEventListener("input",renderSummary);
$("#details").addEventListener("change",renderSummary);
$("#showdetails").onclick=()=>{$("#details").open=true;
  $("#details").scrollIntoView({behavior:"smooth",block:"start"});};

/* smoke-again chips: cigars logged more than once */
function renderAgain(){
  const box=$("#again");
  if($("#f-label").value.trim()||(typeof editingId!=="undefined"&&editingId)){box.innerHTML="";return;}
  const reps=historyCigars().filter(h=>h.count>1).slice(0,6);
  box.innerHTML=reps.length?`<div class="fl">Smoke again</div><div class="chips">${
    reps.map((h,i)=>`<button type="button" class="chip againchip" data-i="${i}">${esc(h.e.l||h.e.b)}</button>`).join("")}</div>`:"";
  box.querySelectorAll(".againchip").forEach(b=>b.onclick=()=>applyPick(reps[+b.dataset.i].e,"history"));
}

/* dates */
function fmtShort(d){if(!d)return"";const[y,m,da]=d.split("-");
  return new Date(y,m-1,da).toLocaleDateString("en-US",{month:"short",day:"numeric"});}
function dateLabel(d){d=d||localToday();const t=localToday();
  return (d===t?"Today, ":"")+fmtShort(d)+(d.slice(0,4)!==t.slice(0,4)?", "+d.slice(0,4):"");}
$("#f-date").addEventListener("change",()=>{$("#datelabel").textContent=dateLabel($("#f-date").value);});
let formDay=localToday();

function clearForm(){
  ["f-label","f-brand","f-origin","f-wrapper","f-wnote","f-binder","f-shape","f-filler","f-notes"]
    .forEach(id=>$("#"+id).value="");
  $("#f-body").value="";$("#f-social").checked=false;setRating(null);$("#ratechips-low").hidden=true;
  formDay=localToday();$("#f-date").value=formDay;$("#datelabel").textContent=dateLabel(formDay);
  $("#details").open=false;pickedLabel=null;hideSugg();renderSummary();renderAgain();
}
function formFields(){
  return {d:$("#f-date").value||localToday(),
    b:$("#f-brand").value.trim(),l:$("#f-label").value.trim(),
    sh:$("#f-shape").value.trim(),bd:$("#f-body").value,
    w:$("#f-wrapper").value.trim(),wn:$("#f-wnote").value.trim(),bn:$("#f-binder").value.trim(),
    fi:$("#f-filler").value.split(",").map(x=>x.trim()).filter(Boolean),
    o:$("#f-origin").value.trim(),r:rating,s:$("#f-social").checked?1:0,n:$("#f-notes").value.trim()};
}
$("#save").onclick=()=>{
  const f=formFields();
  if(!f.l&&!f.b){toast("Add a name first");$("#f-label").focus();return;}
  const e={id:"e"+Date.now(),u:Date.now(),deleted:0,...f};
  data=[e,...data];save();fillDatalists();renderAll();clearForm();
  toast("Saved · "+(e.l||e.b));pushSync();window.scrollTo({top:0});
};
```

- [ ] **Step 8: Roll the date forward on resume.** In the `SYNC` section, replace:

```js
document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncNow(true);});
```

with:

```js
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)return;
  /* a standalone app can stay open overnight; move an untouched date to today */
  if($("#f-date").value===formDay&&formDay!==localToday()){
    formDay=localToday();$("#f-date").value=formDay;$("#datelabel").textContent=dateLabel(formDay);}
  syncNow(true);
});
```

- [ ] **Step 9: Boot.** In the `BOOT` section, change `buildStars();fillDatalists();clearForm();renderAll();` to `buildRating();fillDatalists();clearForm();renderAll();`. In `renderAll`, add `renderAgain()`:

```js
function renderAll(){renderPalate();renderJournal();renderAgain();}
```

Confirm nothing points at removed code:

Run: `grep -nE "buildStars|paintStars|#stars|#rateval|#prefill|dl-label|#clear\b|switchTab\(\"journal\"\)" public/index.html`
Expected: no output.

- [ ] **Step 10: Run the checks and confirm they pass.**

Run: `npm run test:ui -- task3`
Expected: every key `true`, `RESULT: PASS`. See `test/ui/checks/task3.js`. It covers the rating round-trip for all 13 values, Save above the tab bar, 16px inputs, history and catalog picks, the retype clearing stale leaf, the smoke-again order `Encore|M81|Serie V Melanio Maduro`, save staying on Log, and the overnight date roll.

Then open `test/ui/out/task3.png`, rerun with `--shot='clearForm()'` so the screenshot shows the empty form, and confirm the name field, rating chips, and Save are all visible with nothing under the tab bar.

- [ ] **Step 11: Run `npm test`.** Expected: pass. The shell test still finds the manifest link.

- [ ] **Step 12: Commit.**

```bash
git add public/index.html && git commit -q -m "feat: quick-log home screen with rating chips and suggestions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Edit, smoke again, rate later

**Files:**
- Modify: `public/index.html` (the `LOG FORM` save handler, `clearForm`, `openDetail`, `renderAll`, and CSS)

**Interfaces:**
- Consumes: everything Task 3 produces, plus `openDetail(id)`, `closeDetail()`, `switchTab(name)`, and `fmtShort(d)`.
- Produces: `let editingId`, `startEdit(id)`, `smokeAgain(id)`, `unratedRecent()`, and `renderUnrated()`.

- [ ] **Step 1: Confirm the checks fail on the current code.**

Run: `npm run test:ui -- task4`
Expected: `RESULT: FAIL`, with `stripRecentOnly: false` because `#unrated` is empty.

- [ ] **Step 2: Add edit state and the two actions.** Put this directly above `function clearForm(){`:

```js
/* edit mode reuses the Log form; saving keeps the id and bumps u */
let editingId=null;
function setEditMode(id,title){
  editingId=id;
  $("#edithd").hidden=!id;$("#edithd").textContent=id?"Editing "+title:"";
  $("#save").textContent=id?"Save changes":"Save";$("#cancel").hidden=!id;
}
function startEdit(id){
  const e=data.find(x=>x.id===id);if(!e)return;
  closeDetail();switchTab("log");clearForm();
  $("#f-label").value=e.l||"";$("#f-brand").value=e.b||"";setLeaf(e);
  $("#f-notes").value=e.n||"";$("#f-social").checked=!!e.s;
  setRating(typeof e.r==="number"?e.r:null);
  $("#f-date").value=e.d||localToday();$("#datelabel").textContent=dateLabel($("#f-date").value);
  pickedLabel=e.l||"";setEditMode(id,e.l||e.b);
  $("#details").open=true;renderSummary();renderAgain();renderUnrated();
}
function smokeAgain(id){
  const e=data.find(x=>x.id===id);if(!e)return;
  closeDetail();switchTab("log");clearForm();applyPick(e,"history");
}
function unratedRecent(){
  const cutoff=localToday(new Date(Date.now()-14*864e5));
  return live().filter(e=>typeof e.r!=="number"&&(e.d||"")>=cutoff)
    .sort((a,b)=>(b.d||"").localeCompare(a.d||"")).slice(0,3);
}
function renderUnrated(){
  const rows=editingId?[]:unratedRecent();
  $("#unrated").innerHTML=rows.map(e=>`<button type="button" data-id="${esc(e.id)}">
    <span>Unrated: ${esc(e.l||e.b)}, ${esc(fmtShort(e.d))}</span><b>Rate it</b></button>`).join("");
  $$("#unrated button").forEach(b=>b.onclick=()=>startEdit(b.dataset.id));
}
$("#cancel").onclick=()=>{clearForm();renderUnrated();};
```

- [ ] **Step 3: Leave edit mode on clear.** In `clearForm`, add `setEditMode(null);` right after `$("#details").open=false;`. The function then reads:

```js
function clearForm(){
  ["f-label","f-brand","f-origin","f-wrapper","f-wnote","f-binder","f-shape","f-filler","f-notes"]
    .forEach(id=>$("#"+id).value="");
  $("#f-body").value="";$("#f-social").checked=false;setRating(null);$("#ratechips-low").hidden=true;
  formDay=localToday();$("#f-date").value=formDay;$("#datelabel").textContent=dateLabel(formDay);
  $("#details").open=false;setEditMode(null);pickedLabel=null;hideSugg();renderSummary();renderAgain();
}
```

Because `editingId` is now declared before `renderAgain` runs, change the guard in `renderAgain` from `(typeof editingId!=="undefined"&&editingId)` to `editingId`.

- [ ] **Step 4: Save edits in place.** Replace the save handler with:

```js
$("#save").onclick=()=>{
  const f=formFields();
  if(!f.l&&!f.b){toast("Add a name first");$("#f-label").focus();return;}
  const cur=editingId&&data.find(x=>x.id===editingId&&!x.deleted);
  if(cur){Object.assign(cur,f,{u:Date.now()});toast("Saved changes · "+(f.l||f.b));}
  else{data=[{id:"e"+Date.now(),u:Date.now(),deleted:0,...f},...data];toast("Saved · "+(f.l||f.b));}
  save();fillDatalists();clearForm();renderAll();pushSync();window.scrollTo({top:0});
};
```

`clearForm()` now runs before `renderAll()`, so the unrated strip renders after edit mode has ended.

- [ ] **Step 5: Detail sheet actions.** In `openDetail`, replace

```js
    <div class="delrow"><button class="del" id="delbtn">Delete entry</button></div>`;
```

with

```js
    <div class="actrow"><button class="btn ghost" id="editbtn">Edit</button>
      <button class="btn ghost" id="againbtn">Smoke again</button></div>
    <div class="delrow"><button class="del" id="delbtn">Delete</button></div>`;
```

After `$("#closex").onclick=closeDetail;`, add:

```js
  $("#editbtn").onclick=()=>startEdit(id);
  $("#againbtn").onclick=()=>smokeAgain(id);
```

In the delete handler, after `save();closeDetail();`, add `if(editingId===id)clearForm();`.

Add this CSS at the end of the `<style>` block:

```css
  .actrow{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:6px 20px 12px}
  .del{border:0;padding:8px 4px}
```

- [ ] **Step 6: Render the strip with everything else.**

```js
function renderAll(){renderPalate();renderJournal();renderAgain();renderUnrated();}
```

- [ ] **Step 7: Run the checks and confirm they pass.**

Run: `npm run test:ui -- task4 --shot='openDetail("u-new")'`
Expected: every key `true`, `RESULT: PASS`. See `test/ui/checks/task4.js`. Open `test/ui/out/task4.png` and confirm the detail sheet shows Edit and Smoke again side by side.

- [ ] **Step 8: Run `npm test`.** Expected: pass.

- [ ] **Step 9: Commit.**

```bash
git add public/index.html && git commit -q -m "feat: edit, smoke again, and rate-later strip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ship and check on the phone

**Files:** none changed unless the phone check forces the `display: "browser"` fallback. In that case, change `public/manifest.webmanifest` and the one test expectation.

- [ ] **Step 1: Whole-branch review.** Use superpowers:requesting-code-review with one reviewer on the most capable model over `git diff main...quick-log`. Fix anything it confirms, then rerun `npm test` and `npm run test:ui -- task2`, `task3`, and `task4`. Push.

- [ ] **Step 2: Hand the deploy to Austin.** Deploying replaces the live app at ember.austinsego.com, and only the Mac holds a wrangler login. claude01 has no Cloudflare credential by design. Tell Austin the branch is pushed and give him this to run on the Mac:

```bash
cd /usr/local/ember && git fetch && git checkout quick-log && git pull && npm ci && npm test && npm run deploy
```

Expected: wrangler prints the `ember.austinsego.com` custom domain and a version id. Wait for him to confirm before Step 4.

- [ ] **Step 3: Look up the Access session setting.** Read Cloudflare's current docs for Access application session duration (WebFetch on developers.cloudflare.com). Then give Austin the exact dashboard path for `ember.austinsego.com` as numbered steps, with a recommended value.

- [ ] **Step 4: Austin's phone check (about 5 minutes).** Give him these steps:
  1. Open ember.austinsego.com in Safari and sign in.
  2. Share → Add to Home Screen. Confirm the icon is the orange ember dot.
  3. Open it from the home screen. The Log screen should appear, and the pill should read "● Synced".
  4. Log a smoke with a quarter rating, then open it in Journal → Edit → Save changes.

  If step 3 lands on a login page that won't return to the app, switch `"display": "standalone"` to `"display": "browser"` in the manifest, update the `toBe("standalone")` test expectation, then run `npm test`, commit, push, and ask Austin to rerun the Step 2 deploy command.

- [ ] **Step 5: Finish the branch.** Use superpowers:finishing-a-development-branch to merge `quick-log` into `main` and push `main`. Then tick the resume pointer in the Handoff block at the top of this file.
