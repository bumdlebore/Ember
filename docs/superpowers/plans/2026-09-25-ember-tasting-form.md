# Ember tasting form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle Ember as a printed tasting form, and add a 47-tag flavor wheel, draw/burn/again fields, and a scorecard Palate.

**Architecture:** All UI stays in `public/index.html`. Task 1 replaces the whole stylesheet with a token system (light and dark via `prefers-color-scheme`), self-hosts Barlow Condensed through a new Worker route, and rewrites the header, journal rows, and detail sheet. Tasks 2–4 rewrite the Log form, add the flavor wheel, and rebuild Palate, all against that stylesheet. Entries gain optional fields `t`, `dr`, `bu`, and `ag`. The Worker stores entries as opaque JSON, so sync needs no change.

**Tech Stack:** Cloudflare Workers + D1, vitest (`@cloudflare/vitest-pool-workers`), wrangler 4, vanilla JS/CSS, `rsvg-convert`, `playwright-core` with the system Chromium (`npm run test:ui`).

**Spec:** `docs/superpowers/specs/2026-09-25-ember-tasting-form-design.md`

## Global Constraints

- Run every command from the repo root. Commands are POSIX `sh`-safe, with no `read -p`.
- The branch is `tasting-form`. Commit at the end of each task, then `git push`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Existing entry fields are unchanged: `d b l sh bd w wn bn fi o r s n u deleted id`. New optional fields are `t` (lowercase tags in wheel order), `dr` (`tight|good|loose`), `bu` (`even|canoe|relit`), and `ag` (`yes|maybe|no`). An absent field means unset.
- Colors, exact: light `--paper #FAFAF7 --form #2F5D45 --rule #C9D8CE --pen #1C2333 --mark #C2362B --faint #66736C`; dark `--paper #15191A --form #8DBE9F --rule #2A3530 --pen #ECEAE4 --mark #FF6B5B --faint #7F8C86`.
- Fonts: print is Barlow Condensed (500, 600, 700), self-hosted. Pen is `ui-serif,"New York",Georgia,serif`. No Google Fonts.
- No gradients, glows, shadows, or radial backgrounds. No all-caps labels. No middle-dot `·` strings in the UI.
- Inputs stay at 16px or larger.
- Keep every existing element id the checks use: `#f-label #sugg #save #cancel #details #edithd #unrated #ratechips #ratechips-low #ratelow #f-date #datelabel #f-notes #f-social #list #q #sort #verdict #scrim #sheet #toast #hdcount #syncbtn`, plus the classes `.rchip .sg .againchip .entry .nm .tabbar`.
- UI checks: `npm run test:ui -- <name>` in light and `npm run test:ui -- <name> --dark` in dark. Both must pass. When markup changes, an existing check may be edited to match, but none of its assertions may be dropped.

## Review Focus

1. **Checking a tag must not make the page jump.** The wheel re-renders on every tap. Task 3 check `noJump`.
2. **Old entries** (every entry logged so far) have no `t`, `dr`, `bu`, or `ag`. They must render, edit, and save cleanly. Task 3 check `oldEntryEdits`.
3. **Dark mode legibility on every screen.** Each task's checks run with `--dark`, and Task 1 checks contrast in both schemes.
4. **The pinned Save bar must not cover the last field** when the form is scrolled to the bottom. Task 2 check `lastFieldClear`.
5. **Tag patterns must not over-match past notes** ("creamy" isn't "cream", "nutmeg" isn't "nutty"). Task 4 check `creamVsCreamy`.

---

### Task 1: Visual foundation (fonts, tokens, chrome, journal, detail sheet)

**Files:**
- Create: `public/fonts/barlow-condensed-500.woff2`, `public/fonts/barlow-condensed-600.woff2`, `public/fonts/barlow-condensed-700.woff2`, `public/fonts/OFL.txt`, `test/ui/checks/tf1.js`
- Modify: `src/index.js`, `wrangler.toml`, `test/worker.test.js`, `test/ui/checks.mjs`, `public/index.html` (the `<head>`, the whole `<style>`, the header, the journal markup, `entryRow`, `openDetail`, `setPill`/`updateSyncUI`, the toast strings, `renderPalate`'s `#hdcount` line, and `renderAll`)

**Interfaces:**
- Produces:
  - the full final stylesheet (every later task uses its classes)
  - `OPTS` and `optLabel(k, v)` (Task 2 uses them)
  - `RING` (an SVG string; Task 2 uses it)
  - `entryRow(e)`, which renders `e.t` as `.etags` (Task 3 fills `t`)
  - the runner's `--dark` flag

- [ ] **Step 1: Write the failing Worker tests.** Append to `test/worker.test.js`:

```js
describe("self-hosted fonts", () => {
  const url = (p) => "https://ember.austinsego.com" + p;
  const authed = async (p) =>
    callWorker(new Request(url(p), { headers: { "Cf-Access-Jwt-Assertion": await mintJwt() } }));

  it("refuses a font without an assertion", async () => {
    const res = await SELF.fetch(url("/fonts/barlow-condensed-600.woff2"));
    expect(res.status).toBe(403);
  });

  for (const w of [500, 600, 700]) {
    it(`serves barlow-condensed-${w}.woff2 as woff2`, async () => {
      const res = await authed(`/fonts/barlow-condensed-${w}.woff2`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("font/woff2");
      expect(res.headers.get("X-Ember-Shell")).toBe("1");
      const sig = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 4));
      expect(sig).toBe("wOF2");
    });
  }

  it("the shell no longer loads Google Fonts", async () => {
    const html = await (await authed("/")).text();
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run test/worker.test.js`
Expected: the woff2 tests fail with 404 and the Google Fonts test fails. The "refuses" test may already pass.

- [ ] **Step 3: Download Barlow Condensed.** Austin approved this on 2026-09-25: the three woff2 files (about 60 KB each) and `OFL.txt` from `github.com/jpt/barlow`, under the SIL Open Font License.

```bash
B=$(gh api repos/jpt/barlow --jq .default_branch) && mkdir -p public/fonts && for w in Medium:500 SemiBold:600 Bold:700; do curl -fsSL "https://raw.githubusercontent.com/jpt/barlow/$B/fonts/woff2/BarlowCondensed-${w%%:*}.woff2" -o "public/fonts/barlow-condensed-${w##*:}.woff2" || exit 1; done && curl -fsSL "https://raw.githubusercontent.com/jpt/barlow/$B/OFL.txt" -o public/fonts/OFL.txt && ls -l public/fonts && head -c 4 public/fonts/barlow-condensed-600.woff2 && echo && grep -m1 "SIL OPEN FONT LICENSE" public/fonts/OFL.txt
```

Expected: three files of roughly 55–65 KB, the signature `wOF2`, and the OFL header line.

- [ ] **Step 4: Serve the fonts.** In `wrangler.toml`, change the PNG rule's globs to `globs = ["**/*.png", "**/*.woff2"]`. In `src/index.js`, add these under the icon imports:

```js
import FONT_500 from "../public/fonts/barlow-condensed-500.woff2";
import FONT_600 from "../public/fonts/barlow-condensed-600.woff2";
import FONT_700 from "../public/fonts/barlow-condensed-700.woff2";

const FONTS = {
  "/fonts/barlow-condensed-500.woff2": FONT_500,
  "/fonts/barlow-condensed-600.woff2": FONT_600,
  "/fonts/barlow-condensed-700.woff2": FONT_700,
};
```

Then add this directly after the `if (ICONS[url.pathname]) { ... }` block:

```js
    if (FONTS[url.pathname]) {
      return new Response(FONTS[url.pathname], {
        headers: {
          "Content-Type": "font/woff2",
          "Cache-Control": "public, max-age=604800",
          "X-Ember-Shell": "1",
        },
      });
    }
```

- [ ] **Step 5: Add dark mode and woff2 to the UI runner.** In `test/ui/checks.mjs`:
  - Add `".woff2": "font/woff2",` to the `types` map.
  - Add `const dark = rest.includes("--dark");` after the `shot` line.
  - Change `browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 })` to `browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" })`.
  - Change both uses of `name + ".png"` to `name + (dark ? "-dark" : "") + ".png"`.
  - Update the usage comment at the top to mention `[--dark]`.

- [ ] **Step 6: Write the Task 1 UI checks.** Create `test/ui/checks/tf1.js`:

```js
// Tasting form Task 1: tokens, fonts, chrome, journal rows, detail sheet.
// Run: npm run test:ui -- tf1   and   npm run test:ui -- tf1 --dark
(async () => {
  await document.fonts.ready;
  const r = {};
  const lum = (h) => { const c = h.replace("#", "").match(/\w\w/g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase();
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  r.schemeApplied = v("--paper") === (dark ? "#15191A" : "#FAFAF7");
  for (const k of ["--pen", "--form", "--mark", "--faint"]) r["contrast" + k] = cr(v(k), v("--paper")) >= 4.5;
  r.paperOnForm = cr(v("--paper"), v("--form")) >= 4.5;
  r.barlowLoaded = document.fonts.check('600 16px "Barlow Condensed"');
  r.noGoogleFonts = !document.querySelector('link[href*="fonts.googleapis"]') &&
    !performance.getEntriesByType("resource").some((e) => /fonts\.(googleapis|gstatic)\.com/.test(e.name));
  r.headerCount = /^No\. \d+$/.test($("#hdcount").textContent);
  r.syncLabelPlain = !/[●○↻⚠]/.test($("#syncbtn").textContent);
  r.noGradients = ![...document.styleSheets].some((s) => [...s.cssRules].some((x) => /gradient\((?!to bottom,transparent)/.test(x.cssText) && !/select|textarea/.test(x.selectorText || "")));
  const row = document.querySelector("#list .entry");
  r.journalRow = !!row && !!row.querySelector(".nm") && !!row.querySelector(".sc") && !row.querySelector(".embers");
  r.noMiddleDots = !/·/.test($("#list").textContent);
  openDetail(row.dataset.id);
  r.sheetForm = !!document.querySelector("#sheet .dl") && !!$("#editbtn") && !!$("#againbtn") && !!$("#closex");
  closeDetail();
  return r;
})()
```

- [ ] **Step 7: Confirm the checks fail.**

Run: `npm run test:ui -- tf1`
Expected: `RESULT: FAIL`, with `schemeApplied`, `barlowLoaded`, `noGoogleFonts`, and `headerCount` false.

- [ ] **Step 8: Replace the `<head>` font and theme lines.** Delete the three Google Fonts lines (the two `preconnect` links and the `css2?family=Fraunces…` stylesheet). Replace `<meta name="theme-color" content="#1c1611">` with:

```html
<meta name="theme-color" content="#FAFAF7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15191A" media="(prefers-color-scheme: dark)">
```

`black-translucent` would put white status-bar text over light paper, so change `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` to `content="default"`. Whether iOS 26 standalone then shows the right status-bar text in dark mode is **assumed**, and the phone check covers it.

- [ ] **Step 9: Replace the whole `<style>…</style>` block** with:

```html
<style>
  @font-face{font-family:"Barlow Condensed";font-weight:500;font-style:normal;font-display:swap;
    src:url(/fonts/barlow-condensed-500.woff2) format("woff2")}
  @font-face{font-family:"Barlow Condensed";font-weight:600;font-style:normal;font-display:swap;
    src:url(/fonts/barlow-condensed-600.woff2) format("woff2")}
  @font-face{font-family:"Barlow Condensed";font-weight:700;font-style:normal;font-display:swap;
    src:url(/fonts/barlow-condensed-700.woff2) format("woff2")}
  :root{
    --paper:#FAFAF7;--form:#2F5D45;--rule:#C9D8CE;--pen:#1C2333;--mark:#C2362B;--faint:#66736C;
    --print:"Barlow Condensed","Avenir Next Condensed","Arial Narrow",sans-serif;
    --hand:ui-serif,"New York",Georgia,serif;
    --bar:49px;color-scheme:light dark;
  }
  @media (prefers-color-scheme:dark){:root{
    --paper:#15191A;--form:#8DBE9F;--rule:#2A3530;--pen:#ECEAE4;--mark:#FF6B5B;--faint:#7F8C86}}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  [hidden]{display:none!important}
  html,body{margin:0;background:var(--paper);color:var(--pen)}
  body{font:500 16px/1.4 var(--print);-webkit-font-smoothing:antialiased;min-height:100vh}
  h1,h2,h3,p{margin:0}
  :focus-visible{outline:2px solid var(--form);outline-offset:2px}
  .wrap{max-width:640px;margin:0 auto;padding:0 16px calc(140px + env(safe-area-inset-bottom))}

  /* header */
  header{max-width:640px;margin:0 auto;padding:calc(12px + env(safe-area-inset-top)) 16px 10px;
    display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule)}
  header h1{font:700 28px/1 var(--print);color:var(--form);letter-spacing:.01em}
  #hdcount{font:600 16px var(--print);color:var(--form);font-variant-numeric:tabular-nums}
  .syncpill{margin-left:auto;appearance:none;background:none;border:0;padding:6px 0;
    font:600 15px var(--print);color:var(--form);cursor:pointer}
  .syncpill.busy{color:var(--faint)}
  .syncpill.err{color:var(--mark)}

  /* tabs and the pinned save bar */
  nav.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30;background:var(--paper);
    border-top:1px solid var(--rule);padding:0 12px env(safe-area-inset-bottom)}
  .tabs{display:flex;max-width:640px;margin:0 auto}
  .tabs button{flex:1;appearance:none;background:none;border:0;border-top:2px solid transparent;
    margin-top:-1px;min-height:48px;font:600 17px var(--print);color:var(--form);cursor:pointer}
  .tabs button[aria-selected=true]{color:var(--pen);border-top-color:var(--form)}
  .savebar{position:fixed;left:0;right:0;bottom:calc(var(--bar) + env(safe-area-inset-bottom));z-index:29;
    background:var(--paper);border-top:1px solid var(--rule);padding:8px 16px}
  .savebar .in{max-width:608px;margin:0 auto;display:flex;gap:10px}
  .savebar .primary{flex:1}
  .panel{display:none;padding-top:14px}
  .panel.on{display:block}

  /* printed form basics */
  .lab,label.fl{display:block;font:600 15px/1.2 var(--print);color:var(--form);letter-spacing:.01em;margin:0 0 2px}
  .rowlbl{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
  input,select,textarea{width:100%;margin:0;background:transparent;border:0;border-bottom:1px solid var(--rule);
    border-radius:0;color:var(--pen);font:17px/1.35 var(--hand);padding:6px 0 7px;
    appearance:none;-webkit-appearance:none}
  input:focus,select:focus,textarea:focus{outline:0;border-bottom-color:var(--form);box-shadow:0 1px 0 var(--form)}
  ::placeholder{color:var(--faint);font-style:italic;opacity:1}
  select{padding-right:22px;background-repeat:no-repeat;background-size:5px 5px;
    background-image:linear-gradient(45deg,transparent 50%,var(--form) 50%),linear-gradient(135deg,var(--form) 50%,transparent 50%);
    background-position:calc(100% - 9px) 55%,calc(100% - 4px) 55%}
  textarea{resize:vertical;min-height:52px;font-style:italic;line-height:26px;padding:0;border-bottom:0;
    background:repeating-linear-gradient(to bottom,transparent 0 25px,var(--rule) 25px 26px);background-attachment:local}
  .btn{appearance:none;min-height:46px;padding:10px 16px;border:1.5px solid var(--form);border-radius:6px;
    background:transparent;color:var(--form);font:600 18px var(--print);cursor:pointer}
  .btn.primary{background:var(--form);color:var(--paper)}
  .linkbtn{appearance:none;background:none;border:0;padding:0;font:600 15px var(--print);color:var(--form);
    text-decoration:underline;text-underline-offset:3px;cursor:pointer}
  .box{appearance:none;-webkit-appearance:none;flex:none;width:20px;height:20px;margin:0;padding:0;
    border:1.5px solid var(--form);border-radius:3px;background:none;display:grid;place-content:center}
  .box:checked::after{content:"✓";font:700 17px/1 var(--print);color:var(--pen)}
  .fgrid{display:grid;gap:20px}
  .fgrid.c2{grid-template-columns:1fr 1fr;gap:16px 14px}
  .field{min-width:0}

  /* log form */
  .unrated{margin-bottom:6px}
  .unrated button{appearance:none;display:flex;justify-content:space-between;align-items:baseline;gap:10px;width:100%;
    background:none;border:0;border-bottom:1px solid var(--rule);padding:10px 0;min-height:44px;text-align:left;
    font:17px var(--hand);color:var(--pen);cursor:pointer}
  .unrated .lab{display:inline;margin-right:6px}
  .unrated b{font:600 16px var(--print);color:var(--mark);flex:none}
  .edithd{font:700 22px var(--print);color:var(--form)}
  .namebox{position:relative}
  #f-label{font-size:22px;padding:4px 0 8px}
  .sugg{position:absolute;left:0;right:0;top:calc(100% + 2px);z-index:20;background:var(--paper);
    border:1px solid var(--form);border-radius:6px;overflow:hidden}
  .sg{appearance:none;display:flex;justify-content:space-between;align-items:baseline;gap:10px;width:100%;
    background:none;border:0;border-top:1px solid var(--rule);padding:10px 12px;min-height:44px;text-align:left;
    color:var(--pen);cursor:pointer}
  .sg:first-child{border-top:0}
  .sg span:first-child{font:17px var(--hand);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .sgm{font:600 15px var(--print);color:var(--form);flex:none}
  .cell{min-width:0;cursor:pointer}
  .cell .v{font:17px/1.35 var(--hand);color:var(--pen);border-bottom:1px solid var(--rule);padding:6px 0 7px;
    min-height:33px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cell .v:empty::before{content:"—";color:var(--faint)}
  .again:empty{display:none}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .againchip{appearance:none;background:none;border:1px solid var(--rule);border-radius:18px;padding:5px 12px;
    min-height:36px;font:16px var(--hand);color:var(--pen);cursor:pointer}
  .ratechips{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--rule)}
  .ratechips.low{margin-top:2px}
  .rchip{position:relative;appearance:none;background:none;border:0;padding:0;min-height:48px;
    font:600 19px var(--print);font-variant-numeric:tabular-nums;color:var(--form);cursor:pointer}
  .rchip.on{color:var(--pen)}
  .ring{position:absolute;left:50%;top:50%;width:54px;height:38px;transform:translate(-50%,-50%) rotate(-4deg);
    overflow:visible;pointer-events:none}
  .ring path{fill:none;stroke:var(--mark);stroke-width:2.2;stroke-linecap:round;
    stroke-dasharray:150;stroke-dashoffset:150;transition:stroke-dashoffset .18s ease-out}
  .rchip.on .ring path,.ring.static path{stroke-dashoffset:0}
  .opts{display:grid;grid-template-columns:64px repeat(3,1fr);align-items:center;
    border-bottom:1px solid var(--rule);min-height:46px}
  .opts .lab{margin:0}
  .opts button{appearance:none;background:none;border:0;padding:0;min-height:46px;
    font:17px var(--hand);color:var(--faint);cursor:pointer}
  .opts button.on{color:var(--pen);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:6px}
  .footrow{display:flex;justify-content:space-between;align-items:center;gap:12px}
  .toggle{display:flex;align-items:center;gap:8px;min-height:44px;font:600 17px var(--print);color:var(--form);cursor:pointer}
  .datebtn{position:relative;font:600 17px var(--print);color:var(--form);border-bottom:1px solid var(--rule);
    padding:6px 0;cursor:pointer}
  .datebtn input{position:absolute;inset:0;opacity:0;width:100%;height:100%;padding:0;border:0}
  #details summary{list-style:none;cursor:pointer;font:600 17px var(--print);color:var(--form);
    min-height:40px;display:flex;align-items:center}
  #details summary::-webkit-details-marker{display:none}
  #details summary::before{content:"+";width:1.1em}
  #details[open] summary::before{content:"−"}
  #details > .fgrid{margin-top:8px}

  /* flavor wheel */
  .tasted{display:flex;flex-wrap:wrap;gap:2px 8px;min-height:34px;padding:4px 0 6px;border-bottom:1px solid var(--rule)}
  .tasted:empty::before{content:"Open a family and check what you taste";font:italic 17px var(--hand);color:var(--faint)}
  .tasted button{appearance:none;background:none;border:0;padding:2px 0;font:italic 17px var(--hand);
    color:var(--pen);cursor:pointer}
  .tasted button:not(:last-child)::after{content:","}
  .fams{display:grid;grid-template-columns:1fr 1fr;column-gap:14px}
  .fam{appearance:none;background:none;border:0;border-bottom:1px solid var(--rule);display:flex;
    justify-content:space-between;align-items:center;min-height:44px;padding:0;text-align:left;
    font:600 17px var(--print);color:var(--form);cursor:pointer}
  .fam b{font-weight:700;color:var(--pen);font-variant-numeric:tabular-nums}
  .fam[aria-expanded=true]{color:var(--pen);border-bottom:2px solid var(--form)}
  .famtags{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;column-gap:14px;
    padding:4px 0 8px;border-bottom:1px solid var(--rule)}
  .tag{display:flex;align-items:center;gap:10px;min-height:42px;font:17px var(--hand);color:var(--pen);cursor:pointer}

  /* journal */
  .toolbar{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:end;margin-bottom:4px}
  .sortsel{width:auto;font:600 16px var(--print);color:var(--form)}
  .entry{display:grid;grid-template-columns:1fr auto;column-gap:14px;padding:11px 0;
    border-bottom:1px solid var(--rule);cursor:pointer}
  .entry .nm{font:19px/1.3 var(--hand);color:var(--pen);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .entry .sc{grid-column:2;grid-row:1/span 2;align-self:center;font:600 22px var(--print);
    font-variant-numeric:tabular-nums;color:var(--pen)}
  .entry .sc.un{font:italic 15px var(--hand);color:var(--faint)}
  .entry .meta{grid-column:1;font:500 16px var(--print);color:var(--form);display:flex;gap:10px;flex-wrap:wrap}
  .entry .etags{grid-column:1/-1;font:italic 15px/1.4 var(--hand);color:var(--pen);margin-top:2px}
  .empty{padding:40px 0;text-align:center;font:italic 17px var(--hand);color:var(--faint)}

  /* detail sheet */
  .scrim{position:fixed;inset:0;z-index:60;display:none;align-items:flex-end;justify-content:center;
    background:color-mix(in srgb,var(--pen) 40%,transparent)}
  .scrim.on{display:flex}
  .sheet{position:relative;width:100%;max-width:640px;max-height:88vh;overflow:auto;background:var(--paper);
    border-radius:12px 12px 0 0;padding:18px 16px calc(20px + env(safe-area-inset-bottom))}
  .sheet .x{position:absolute;top:18px;right:16px}
  .sheet h2{font:24px/1.25 var(--hand);color:var(--pen);margin:6px 64px 2px 0}
  .sheet .sub{font:500 16px var(--print);color:var(--form)}
  .sheet .score{position:relative;display:inline-block;margin:12px 0 4px 12px;font:600 26px var(--print);
    color:var(--pen);font-variant-numeric:tabular-nums}
  .sheet .score .ring{width:72px;height:48px}
  .dl{display:grid;grid-template-columns:92px 1fr;margin:8px 0}
  .dl dt{font:600 15px var(--print);color:var(--form);padding:8px 0;border-bottom:1px solid var(--rule)}
  .dl dd{margin:0;font:17px var(--hand);color:var(--pen);padding:7px 0;border-bottom:1px solid var(--rule)}
  .dnotes{font:italic 17px/1.5 var(--hand);color:var(--pen);margin:6px 0 14px}
  .actrow{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}
  .delrow{display:flex;justify-content:flex-end;margin-top:14px}
  .del{appearance:none;background:none;border:0;padding:8px 0;font:600 16px var(--print);color:var(--mark);cursor:pointer}

  /* palate scorecard */
  .ptitle{font:700 28px/1.1 var(--print);color:var(--form)}
  .psum{font:17px/1.4 var(--hand);color:var(--pen);margin-top:4px}
  #verdict .line{font:21px/1.35 var(--hand);color:var(--pen);margin-top:14px}
  .psec{margin-top:26px}
  .psec:empty{display:none}
  .tally{display:grid;grid-template-columns:44px 1fr auto;align-items:center;column-gap:10px;
    min-height:30px;border-bottom:1px solid var(--rule)}
  .tally .y{font:600 16px var(--print);color:var(--form)}
  .tally .c{font:600 16px var(--print);color:var(--pen);font-variant-numeric:tabular-nums}
  .tally svg{display:block;overflow:visible}
  .tally line{stroke:var(--pen);stroke-width:1.6;stroke-linecap:round}
  .tally line.strike{stroke:var(--mark)}
  .frow{display:grid;grid-template-columns:1fr 34% 34px 40px;align-items:center;column-gap:10px;min-height:40px;
    width:100%;padding:0;appearance:none;background:none;border:0;border-bottom:1px solid var(--rule);
    text-align:left;color:var(--pen);cursor:pointer}
  .frow .nm{font:600 17px var(--print);color:var(--form)}
  .frow .bar{display:block;height:6px;background:var(--form);border-radius:1px}
  .frow .n,.frow .a{font:600 16px var(--print);font-variant-numeric:tabular-nums;text-align:right}
  .frow.sub{cursor:default}
  .frow.sub .nm{font:17px var(--hand);color:var(--pen);padding-left:12px}
  .frow[aria-expanded=true] .nm{color:var(--pen)}
  .tables{display:grid;gap:26px}
  @media(min-width:620px){.tables{grid-template-columns:1fr 1fr}}
  .tbl{display:grid;grid-template-columns:1fr auto auto;column-gap:16px}
  .tbl .h{font:600 15px var(--print);color:var(--form);padding:0 0 4px;border-bottom:1px solid var(--form)}
  .tbl .k{font:17px var(--hand);color:var(--pen);padding:6px 0;border-bottom:1px solid var(--rule);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .tbl .r{font:600 16px var(--print);font-variant-numeric:tabular-nums;padding:6px 0;
    border-bottom:1px solid var(--rule);text-align:right}
  .tbl .h.r{padding:0 0 4px;border-bottom:1px solid var(--form)}
  .dbline{font:17px var(--hand);color:var(--pen);padding:6px 0;border-bottom:1px solid var(--rule)}
  .dbline .lab{display:inline;margin-right:8px}
  .note{font:italic 17px var(--hand);color:var(--faint);padding:6px 0}
  .foot{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:30px;padding-top:12px;border-top:1px solid var(--rule)}
  .foot button{appearance:none;background:none;border:0;padding:6px 0;font:600 16px var(--print);color:var(--form);
    text-decoration:underline;text-underline-offset:3px;cursor:pointer}

  /* toast */
  .toast{position:fixed;left:50%;bottom:calc(var(--bar) + 76px + env(safe-area-inset-bottom));transform:translateX(-50%);
    z-index:80;max-width:calc(100% - 32px);background:var(--paper);border:1px solid var(--form);border-radius:4px;
    padding:8px 14px;font:italic 16px var(--hand);color:var(--pen);opacity:0;transition:opacity .2s;pointer-events:none}
  .toast.on{opacity:1}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
</style>
```

- [ ] **Step 10: Header markup.** Replace the whole `<header>…</header>` block with:

```html
<header>
  <h1>Ember</h1>
  <span id="hdcount"></span>
  <button id="syncbtn" class="syncpill">Local</button>
</header>
```

In `renderPalate`, delete the line `$("#hdcount").textContent=live().length+" logged";`. Replace `renderAll` with:

```js
function renderAll(){$("#hdcount").textContent="No. "+(live().length+1);
  renderPalate();renderJournal();renderAgain();renderUnrated();}
```

- [ ] **Step 11: Sync label and toast wording.**
  - Replace `updateSyncUI` with:

    ```js
    function updateSyncUI(){
      if(syncing){setPill("busy","Syncing");return;}
      if(!account){setPill("","Offline");return;}
      const t=cursor?new Date(cursor).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"";
      setPill("ok",t?"Synced "+t:"Connected");
    }
    ```

  - In `syncNow`'s catch block, change `setPill("err","⚠ Sign in")` to `setPill("err","Sign in")` and `setPill("err","⚠ Offline")` to `setPill("err","Offline")`.
  - Change `"Session expired — reload to sign in"` to `"Your sign-in expired. Reload to sign in."` and `"Sync failed — you're offline"` to `"Couldn't sync. You're offline."`.
  - In the backfill handler, change `"Nothing to fill — entries already complete or unmatched"` to `"Nothing to fill. Entries are complete or unmatched."`.
  - In the save handler, change `toast("Saved changes · "+(f.l||f.b))` to `toast("Saved changes to "+(f.l||f.b))` and `toast("Saved · "+(f.l||f.b))` to `toast("Saved "+(f.l||f.b))`.
  - In `openDetail`'s delete handler, change `toast("Entry deleted")` to `toast("Deleted")`.

- [ ] **Step 12: Journal markup, rows, and constants.** In the journal section, change `<div class="card" id="list"></div>` to `<div id="list"></div>`. Change the search placeholder to `placeholder="Search a cigar, brand, flavor, or note"`. Delete `function embers(r){…}`. Replace `function entryRow(e,last){…}` with:

```js
/* printed option rows (Log form, detail sheet, Palate) */
const OPTS={dr:{label:"Draw",vals:[["tight","tight"],["good","just right"],["loose","loose"]]},
  bu:{label:"Burn",vals:[["even","even"],["canoe","canoed"],["relit","relit"]]},
  ag:{label:"Again",vals:[["yes","yes"],["maybe","maybe"],["no","no"]]}};
const optLabel=(k,v)=>(OPTS[k].vals.find(x=>x[0]===v)||[])[1]||"";
/* the judge's red circle around a score */
const RING='<svg class="ring" viewBox="0 0 54 38" aria-hidden="true"><path d="M8 21 C6 9 24 3 38 6 C52 9 53 27 38 32 C24 36 6 31 6 19 C6 14 11 9 17 8"/></svg>';
function tagLine(e){const t=e.t||[];
  return t.length?esc(t.slice(0,4).join(", "))+(t.length>4?` +${t.length-4}`:""):"";}
function entryRow(e){
  const sc=typeof e.r==="number"?`<span class="sc">${e.r}</span>`:`<span class="sc un">unrated</span>`;
  const tl=tagLine(e);
  return `<div class="entry" data-id="${esc(e.id)}"><span class="nm">${esc(e.l||e.b||"Untitled")}</span>${sc}
    <span class="meta"><span>${esc(e.b||"")}</span><span>${esc(fmtDate(e.d))}</span>${e.s?"<span>with friends</span>":""}</span>
    ${tl?`<span class="etags">${tl}</span>`:""}</div>`;
}
```

In `renderJournal`, change `rows.map((e,i)=>entryRow(e,i===rows.length-1)).join("")` to `rows.map(e=>entryRow(e)).join("")`, and add `(e.t||[]).join(" ")` to the searched array, right after `(e.fi||[]).join(" ")`.

- [ ] **Step 13: Detail sheet as a read-only form.** Replace the `$("#sheet").innerHTML=\`…\`;` assignment in `openDetail` (the whole template, from `<button class="x"` through the `delrow` div) with:

```js
  const row=(k,v)=>v?`<dt>${k}</dt><dd>${esc(v)}</dd>`:"";
  $("#sheet").innerHTML=`
    <button class="linkbtn x" id="closex">Close</button>
    <div class="lab">${esc(fmtDate(e.d))}${e.s?", with friends":""}</div>
    <h2>${esc(e.l||e.b||"Untitled")}</h2>
    <div class="sub">${esc(e.b||"")}</div>
    ${typeof e.r==="number"?`<div class="score">${e.r}${RING.replace('class="ring"','class="ring static"')}</div>`:`<p class="note">Unrated</p>`}
    <dl class="dl">
      ${row("Tasted",(e.t||[]).join(", "))}
      ${row("Draw",optLabel("dr",e.dr))}${row("Burn",optLabel("bu",e.bu))}${row("Again",optLabel("ag",e.ag))}
      ${row("Origin",e.o)}${row("Body",e.bd)}${row("Shape",e.sh)}
      ${row("Wrapper",[e.w,e.wn].filter(Boolean).join(", "))}${row("Binder",e.bn)}${row("Filler",(e.fi||[]).join(", "))}
    </dl>
    ${e.n?`<p class="dnotes">${esc(e.n)}</p>`:""}
    <div class="actrow"><button class="btn" id="editbtn">Edit</button>
      <button class="btn" id="againbtn">Smoke again</button></div>
    <div class="delrow"><button class="del" id="delbtn">Delete</button></div>`;
```

Delete the now-unused `const fi=(e.fi||[]).join(", ");` line above it. Keep the handler lines below it unchanged.

Palate still uses its old markup until Task 4, and it renders plain on the new stylesheet. That's expected on the branch.

- [ ] **Step 14: Run everything.**

Run: `npm test && npm run test:ui -- tf1 && npm run test:ui -- tf1 --dark && npm run test:ui -- baseline && npm run test:ui -- task2 && npm run test:ui -- task3 && npm run test:ui -- task4`
Expected: vitest passes (61 tests) plus the dry-run, and every UI check prints `RESULT: PASS`.

`task3`'s `saveAboveFold` still measures the old in-flow Save button. If it fails here only because the new type is larger, apply its Task 2 Step 8 update now, keeping the assertion.

Open `test/ui/out/tf1.png` and `test/ui/out/tf1-dark.png` and confirm the header is green print, the paper is flat, and the tab bar is ruled. If a check needs a markup-driven edit, keep every assertion.

- [ ] **Step 15: Commit.**

```bash
git add public/fonts public/index.html src/index.js wrangler.toml test/worker.test.js test/ui/checks.mjs test/ui/checks/tf1.js && git commit -q -m "feat: tasting-form visual system, self-hosted Barlow Condensed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

---

### Task 2: Log form (cells, score circle, draw/burn/again, pinned Save)

**Files:**
- Modify: `public/index.html` (the `#log` section markup, a new `#savebar` element, `buildRating`, `setRating`, `renderSummary`, the cell handlers, the new option-row functions, `setEditMode`, `startEdit`, `clearForm`, `formFields`, `switchTab`, and boot)
- Modify: `test/ui/checks/task3.js`, `test/ui/checks/task4.js` (markup-driven edits only)
- Create: `test/ui/checks/tf2.js`

**Interfaces:**
- Consumes: `OPTS`, `RING`, and the Task 1 stylesheet.
- Produces:
  - `let opt = {dr, bu, ag}` and `setOpt(k, v)`
  - `buildOpts()`
  - the `#optrows` element (Task 3 inserts the wheel before it)
  - `#savebar`
  - the `#c-brand` and `#c-wrapper` cells

- [ ] **Step 1: Write the Task 2 checks.** Create `test/ui/checks/tf2.js`:

```js
// Tasting form Task 2: log form cells, score circle, option rows, pinned Save bar.
// Run: npm run test:ui -- tf2   and   npm run test:ui -- tf2 --dark
(() => {
  const r = {};
  r.headerNo = $("#hdcount").textContent === "No. " + (live().length + 1);
  r.ringOnChip = !!document.querySelector('.rchip[data-r="4.75"] .ring');
  const c425 = document.querySelector('.rchip[data-r="4.25"]'); c425.click();
  r.chipPressed = c425.getAttribute("aria-pressed") === "true" && rating === 4.25; c425.click();
  const q = (k, v) => document.querySelector(`#optrows button[data-k="${k}"][data-v="${v}"]`);
  q("dr", "tight").click(); r.optSet = opt.dr === "tight" && q("dr", "tight").classList.contains("on");
  q("dr", "tight").click(); r.optClears = opt.dr === "";
  q("dr", "good").click(); q("bu", "canoe").click(); q("ag", "yes").click();
  document.querySelector(".againchip").click(); document.querySelector('.rchip[data-r="4.5"]').click();
  r.cellsShowPick = $("#c-brand").textContent.length > 0;
  const n0 = data.length; $("#save").click();
  r.optsSaved = data.length === n0 + 1 && data[0].dr === "good" && data[0].bu === "canoe" && data[0].ag === "yes";
  r.optsResetAfterSave = !opt.dr && !opt.bu && !opt.ag && !document.querySelector("#optrows button.on");
  startEdit(data[0].id);
  r.optsLoadOnEdit = opt.dr === "good" && opt.bu === "canoe" && opt.ag === "yes" && $("#save").textContent === "Save changes";
  $("#cancel").click();
  r.saveLabel = $("#save").textContent === "Save to log";
  smokeAgain(data[0].id);
  r.againClearsOpts = !opt.dr && !opt.bu && !opt.ag && $("#f-label").value !== "";
  clearForm();
  const bar = () => document.querySelector(".tabbar").getBoundingClientRect();
  const inView = () => { const s = $("#save").getBoundingClientRect(); return s.top >= 0 && s.bottom <= bar().top + 1; };
  window.scrollTo(0, 0); r.saveInViewTop = inView();
  $("#details").open = true; window.scrollTo(0, document.documentElement.scrollHeight);
  r.saveInViewBottom = inView();
  r.lastFieldClear = $("#f-filler").getBoundingClientRect().bottom <= $("#savebar").getBoundingClientRect().top;
  $("#details").open = false; window.scrollTo(0, 0);
  switchTab("journal"); r.saveBarHiddenOffLog = $("#savebar").hidden; switchTab("log");
  r.saveBarShownOnLog = !$("#savebar").hidden;
  return r;
})()
```

- [ ] **Step 2: Confirm it fails.**

Run: `npm run test:ui -- tf2`
Expected: `RESULT: FAIL`. It throws, because `opt` is not defined.

- [ ] **Step 3: Log section markup.** Replace the whole `<!-- ===== LOG ===== -->` section with:

```html
  <!-- ===== LOG ===== -->
  <section class="panel on" id="log" role="tabpanel">
    <div class="unrated" id="unrated"></div>
    <div class="fgrid">
      <div class="edithd" id="edithd" hidden></div>
      <div class="field">
        <label class="lab" for="f-label">Cigar</label>
        <div class="namebox">
          <input id="f-label" placeholder="What are you smoking?" autocomplete="off"
            autocapitalize="words" enterkeyhint="done">
          <div class="sugg" id="sugg" role="listbox" hidden></div>
        </div>
      </div>
      <div class="fgrid c2">
        <div class="cell" id="cell-brand"><div class="lab">Brand</div><div class="v" id="c-brand"></div></div>
        <div class="cell" id="cell-wrapper"><div class="lab">Wrapper</div><div class="v" id="c-wrapper"></div></div>
      </div>
      <div class="again" id="again"></div>
      <div class="field">
        <div class="lab rowlbl"><span>Score</span>
          <button type="button" class="linkbtn" id="ratelow" aria-expanded="false">Lower scores</button></div>
        <div class="ratechips" id="ratechips" role="group" aria-label="Score"></div>
        <div class="ratechips low" id="ratechips-low" role="group" aria-label="Lower scores" hidden></div>
      </div>
      <div class="field" id="optrows"></div>
      <div class="field"><label class="lab" for="f-notes">Notes</label>
        <textarea id="f-notes" rows="2" placeholder="Anything the boxes missed"></textarea></div>
      <div class="footrow">
        <label class="toggle"><input type="checkbox" class="box" id="f-social"> With friends</label>
        <label class="datebtn"><span id="datelabel"></span>
          <input id="f-date" type="date" aria-label="Date"></label>
      </div>
      <details id="details">
        <summary>Details</summary>
        <div class="fgrid">
          <div class="fgrid c2">
            <div class="field"><label class="lab" for="f-brand">Brand</label>
              <input id="f-brand" list="dl-brand" placeholder="Oliva" autocomplete="off"></div>
            <div class="field"><label class="lab" for="f-origin">Origin</label>
              <input id="f-origin" list="dl-origin" placeholder="Nicaragua" autocomplete="off"></div>
          </div>
          <div class="fgrid c2">
            <div class="field"><label class="lab" for="f-wrapper">Wrapper</label>
              <input id="f-wrapper" list="dl-wrapper" placeholder="San Andres" autocomplete="off"></div>
            <div class="field"><label class="lab" for="f-wnote">Wrapper note</label>
              <input id="f-wnote" list="dl-wnote" placeholder="Maduro" autocomplete="off"></div>
          </div>
          <div class="fgrid c2">
            <div class="field"><label class="lab" for="f-binder">Binder</label>
              <input id="f-binder" list="dl-binder" placeholder="Nicaraguan" autocomplete="off"></div>
            <div class="field"><label class="lab" for="f-shape">Shape</label>
              <input id="f-shape" list="dl-shape" placeholder="Toro" autocomplete="off"></div>
          </div>
          <div class="fgrid c2">
            <div class="field"><label class="lab" for="f-body">Body</label>
              <select id="f-body"><option value="">—</option><option>Light</option><option>Med-Light</option>
                <option>Med</option><option>Med-Full</option><option>Full</option></select></div>
            <div class="field"><label class="lab" for="f-filler">Filler</label>
              <input id="f-filler" placeholder="Nicaraguan, Dominican" autocomplete="off"></div>
          </div>
        </div>
      </details>
    </div>
  </section>
```

Directly after the closing `</div>` of `.wrap` (before `<!-- datalists -->`), add:

```html
<div class="savebar" id="savebar"><div class="in">
  <button class="btn primary" id="save">Save to log</button>
  <button class="btn" id="cancel" hidden>Cancel</button>
</div></div>
```

- [ ] **Step 4: Score scale with the ring.** Replace `buildRating` and `setRating` with:

```js
function buildRating(){
  const mk=v=>`<button type="button" class="rchip" data-r="${v}" aria-pressed="false"><span>${v}</span>${RING}</button>`;
  $("#ratechips").innerHTML=RATE_MAIN.map(mk).join("");
  $("#ratechips-low").innerHTML=RATE_LOW.map(mk).join("");
  $$(".rchip").forEach(b=>b.onclick=()=>{const v=+b.dataset.r;setRating(rating===v?null:v);});
  $("#ratelow").onclick=()=>{const low=$("#ratechips-low");low.hidden=!low.hidden;
    $("#ratelow").setAttribute("aria-expanded",String(!low.hidden));};
}
function setRating(v){rating=v;
  $$(".rchip").forEach(b=>{const on=+b.dataset.r===rating;b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on));});
  if(rating!=null&&rating<3.5){$("#ratechips-low").hidden=false;$("#ratelow").setAttribute("aria-expanded","true");}}
```

- [ ] **Step 5: Cells replace the summary line.** Replace `renderSummary` and the `$("#showdetails").onclick=…` statement with:

```js
function renderSummary(){
  $("#c-brand").textContent=$("#f-brand").value.trim();
  $("#c-wrapper").textContent=[$("#f-wrapper").value,$("#f-wnote").value].map(s=>s.trim()).filter(Boolean).join(" ");
}
["#cell-brand","#cell-wrapper"].forEach(s=>$(s).onclick=()=>{$("#details").open=true;
  $("#details").scrollIntoView({behavior:"smooth",block:"start"});});
```

- [ ] **Step 6: Option rows.** Add this directly above `/* dates */`:

```js
/* draw, burn, would-smoke-again: tap to underline, tap again to clear */
let opt={dr:"",bu:"",ag:""};
function buildOpts(){
  $("#optrows").innerHTML=Object.entries(OPTS).map(([k,o])=>`<div class="opts" role="group" aria-label="${o.label}">
    <span class="lab">${o.label}</span>${o.vals.map(([v,t])=>
      `<button type="button" data-k="${k}" data-v="${v}" aria-pressed="false">${t}</button>`).join("")}</div>`).join("");
  $$("#optrows button").forEach(b=>b.onclick=()=>{const k=b.dataset.k;setOpt(k,opt[k]===b.dataset.v?"":b.dataset.v);});
}
function setOpt(k,v){opt[k]=v;
  $$(`#optrows button[data-k="${k}"]`).forEach(b=>{const on=b.dataset.v===v;
    b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on));});}
```

- [ ] **Step 7: Wire the options through edit, clear, and save.**
  - In `setEditMode`, change `$("#save").textContent=id?"Save changes":"Save";` to `$("#save").textContent=id?"Save changes":"Save to log";`.
  - In `startEdit`, after `setRating(typeof e.r==="number"?e.r:null);`, add `Object.keys(OPTS).forEach(k=>setOpt(k,e[k]||""));`.
  - In `clearForm`, after `setRating(null);`, add `Object.keys(OPTS).forEach(k=>setOpt(k,""));`.
  - In `formFields`, change `n:$("#f-notes").value.trim()};` to `n:$("#f-notes").value.trim(),dr:opt.dr,bu:opt.bu,ag:opt.ag};`.
  - Replace `switchTab` with:

    ```js
    function switchTab(name){
      $$(".tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===name));
      $$(".panel").forEach(p=>p.classList.toggle("on",p.id===name));
      $("#savebar").hidden=name!=="log";
      window.scrollTo({top:0,behavior:"smooth"});
    }
    ```

  - In the `visibilitychange` handler's `untouched` expression, append `&&!opt.dr&&!opt.bu&&!opt.ag`.
  - Boot: change `buildRating();fillDatalists();clearForm();renderAll();` to `buildRating();buildOpts();fillDatalists();clearForm();renderAll();`.

- [ ] **Step 8: Update the older checks for the new markup, keeping every assertion.**
  - In `test/ui/checks/task3.js`, replace the `r.summary = …` line with `r.summary = $("#c-brand").textContent==="Oliva" && $("#c-wrapper").textContent==="San Andres Maduro";`.
  - In the same file, in the `r.retypeClears` line, replace `&& $("#summary").hidden` with `&& $("#c-brand").textContent==="" && $("#c-wrapper").textContent===""`.
  - In the same file, replace the `r.saveAboveFold = …` line with `r.saveAboveFold = (()=>{const s=$("#save").getBoundingClientRect();return s.top>=0 && s.bottom <= document.querySelector(".tabbar").getBoundingClientRect().top + 1;})();`.
  - In `test/ui/checks/task4.js`, change `$("#save").textContent==="Save"` to `$("#save").textContent==="Save to log"`.

- [ ] **Step 9: Run the checks in both schemes.**

Run: `for c in tf1 tf2 task2 task3 task4; do npm run -s test:ui -- $c | tail -1; npm run -s test:ui -- $c --dark | tail -1; done`
Expected: ten `RESULT: PASS` lines.

Then run `npm run test:ui -- tf2 --shot='clearForm()'` and `npm run test:ui -- tf2 --dark --shot='document.querySelector(".againchip").click();document.querySelector(".rchip[data-r=\"4.75\"]").click()'`. Look at both screenshots. The red circle should sit around 4.75, the option rows should read as printed lines, and the Save bar should sit above the tab bar.

- [ ] **Step 10: `npm test`, then commit.**

```bash
npm test && git add public/index.html test/ui/checks && git commit -q -m "feat: tasting-form log screen with score circle, draw/burn/again, pinned save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

---

### Task 3: Flavor wheel

**Files:**
- Modify: `public/index.html` (wheel markup before `#optrows`, the `WHEEL` lexicon, wheel state and render functions, `formFields`, `startEdit`, `clearForm`, the visibility handler, and boot)
- Create: `test/ui/checks/tf3.js`

**Interfaces:**
- Consumes: `.box`, `.fam`, `.famtags`, `.tag`, `.tasted` (Task 1 CSS), and `esc`.
- Produces:
  - `WHEEL`: an array of `{f: string, re: RegExp|null, tags: [[tag, RegExp], …]}`, 10 families and 47 tags
  - `TAG_ORDER` (string[])
  - `let tags` (a Set), `setTags(list)`, and `renderWheel()`

  Task 4 uses `WHEEL` for Palate.

- [ ] **Step 1: Write the checks.** Create `test/ui/checks/tf3.js`:

```js
// Tasting form Task 3: the flavor wheel. Run: npm run test:ui -- tf3   and   --dark
(() => {
  const r = {};
  r.lexicon = WHEEL.length === 10 && TAG_ORDER.length === 47 && new Set(TAG_ORDER).size === 47;
  const fam = (i) => document.querySelectorAll("#fams .fam")[i];
  const tick = (t) => document.querySelector(`.famtags input[data-t="${t}"]`).click();
  const line = () => [...document.querySelectorAll("#tasted button")].map((b) => b.textContent).join("|");
  fam(5).click();
  r.opensOne = document.querySelectorAll(".famtags").length === 1 && fam(5).getAttribute("aria-expanded") === "true";
  window.scrollTo(0, 300); const y = scrollY;
  tick("black pepper");
  r.noJump = Math.abs(scrollY - y) < 2;
  tick("clove");
  fam(1).click();
  r.switchFamily = document.querySelectorAll(".famtags").length === 1 && fam(5).getAttribute("aria-expanded") === "false";
  tick("chocolate");
  r.familyCount = fam(5).querySelector("b")?.textContent === "2" && fam(1).querySelector("b")?.textContent === "1";
  r.tastedLine = line() === "chocolate|black pepper|clove";
  document.querySelector('#tasted button[data-t="clove"]').click();
  r.untickFromLine = !tags.has("clove") && fam(5).querySelector("b")?.textContent === "1";
  fam(5).click(); tick("clove");
  $("#f-label").value = "Tag Test"; document.querySelector('.rchip[data-r="4"]').click();
  const n0 = data.length; $("#save").click();
  const saved = data[0];
  r.saved = data.length === n0 + 1 && JSON.stringify(saved.t) === JSON.stringify(["chocolate", "black pepper", "clove"]);
  r.clearedAfterSave = tags.size === 0 && document.querySelectorAll("#tasted button").length === 0 && openFam === null;
  startEdit(saved.id);
  r.editLoads = tags.size === 3 && tags.has("clove") && line() === "chocolate|black pepper|clove";
  $("#cancel").click();
  smokeAgain(saved.id);
  r.againLeavesClear = tags.size === 0 && $("#f-label").value === "Tag Test";
  clearForm();
  const old = data.find((e) => e.id === "seed9");
  startEdit(old.id); const u0 = old.u; $("#save").click();
  const o2 = data.find((e) => e.id === "seed9");
  r.oldEntryEdits = Array.isArray(o2.t) && o2.t.length === 0 && o2.dr === "" && o2.u > u0 && o2.l === "1926 Maduro";
  $("#q").value = "clove"; renderJournal();
  r.searchTags = [...document.querySelectorAll("#list .entry .nm")].some((n) => n.textContent === "Tag Test");
  $("#q").value = ""; renderJournal();
  r.journalShowsTags = document.querySelector(`#list .entry[data-id="${saved.id}"] .etags`)?.textContent === "chocolate, black pepper, clove";
  return r;
})()
```

- [ ] **Step 2: Confirm it fails.**

Run: `npm run test:ui -- tf3`
Expected: `RESULT: FAIL`. It throws, because `WHEEL` is not defined.

- [ ] **Step 3: Wheel markup.** In the `#log` section, directly before `<div class="field" id="optrows"></div>`, add:

```html
      <div class="field" id="wheel">
        <div class="lab">Tasted</div>
        <div class="tasted" id="tasted" aria-live="polite"></div>
        <div class="fams" id="fams"></div>
      </div>
```

- [ ] **Step 4: Lexicon and picker.** Add this directly above `/* draw, burn, would-smoke-again … */`:

```js
/* Flavor wheel: 10 families, 47 tags. Each tag's regex also counts past notes.
   An independent list; its coverage draws on published cigar wheels (Blind Man's Puff,
   Cigar Snob) and Wu et al. 2024 (CC BY). Family-level `re` catches vague words. */
const WHEEL=[
 {f:"Sweet",re:/sweet/i,tags:[["sweet",/sweet|sugar/i],["caramel",/caramel/i],["honey",/honey/i],["molasses",/molasses/i],["vanilla",/vanilla/i]]},
 {f:"Cocoa and coffee",re:null,tags:[["chocolate",/chocolat|s'?more/i],["cocoa",/cocoa/i],["coffee",/coffee/i],["espresso",/espresso/i]]},
 {f:"Nut and cream",re:null,tags:[["nutty",/\bnut(ty|s)?\b/i],["almond",/almond/i],["peanut",/peanut/i],["cream",/\bcream(?!y)/i]]},
 {f:"Bread and toast",re:null,tags:[["cracker",/cracker/i],["graham",/graham/i],["toast",/toast/i],["bread",/bread/i]]},
 {f:"Wood",re:null,tags:[["cedar",/cedar/i],["oak",/\boak/i],["woody",/wood/i],["charred",/\bchar\b|charred|barrel/i]]},
 {f:"Spice",re:/spice|spicy/i,tags:[["black pepper",/black pepper|pepper/i],["white pepper",/white pepper/i],["cinnamon",/cinnamon/i],["clove",/clove/i],["nutmeg",/nutmeg/i],["anise",/anise|licorice/i]]},
 {f:"Earth and leather",re:null,tags:[["earth",/earth/i],["leather",/leather/i],["meaty",/meaty|\bmeat\b/i],["funk",/funk/i],["mineral",/mineral|graphite/i]]},
 {f:"Fruit",re:/fruit|\bfig\b|\bplum\b/i,tags:[["raisin",/raisin/i],["cherry",/cherry/i],["citrus",/citrus|orange|\blime|lemon/i],["apricot",/apricot/i]]},
 {f:"Floral and herbal",re:null,tags:[["floral",/floral|flower/i],["hay",/\bhay\b/i],["grass",/grass/i],["tea",/\btea\b/i],["herbal",/herb/i]]},
 {f:"Feel",re:null,tags:[["smooth",/smooth/i],["creamy",/creamy/i],["harsh",/harsh/i],["bitter",/bitter/i],["acidic",/acid/i],["dry",/\bdry\b/i]]}
];
const TAG_ORDER=WHEEL.flatMap(F=>F.tags.map(([t])=>t));
let tags=new Set(), openFam=null;
function setTags(list){tags=new Set(list||[]);renderWheel();}
function renderWheel(){
  const fams=$("#fams");
  fams.innerHTML=WHEEL.map((F,i)=>{const n=F.tags.filter(([t])=>tags.has(t)).length;
    return `<button type="button" class="fam" data-i="${i}" aria-expanded="${openFam===i}">${esc(F.f)}${n?`<b>${n}</b>`:""}</button>`;}).join("");
  if(openFam!==null){
    const F=WHEEL[openFam], panel=document.createElement("div");
    panel.className="famtags";panel.setAttribute("role","group");panel.setAttribute("aria-label",F.f);
    panel.innerHTML=F.tags.map(([t])=>`<label class="tag"><input type="checkbox" class="box" data-t="${esc(t)}"${tags.has(t)?" checked":""}>${esc(t)}</label>`).join("");
    /* open the panel under the row holding the family: the grid has 2 columns */
    const btns=fams.querySelectorAll(".fam");
    fams.insertBefore(panel,btns[(openFam|1)+1]||null);
  }
  $("#tasted").innerHTML=TAG_ORDER.filter(t=>tags.has(t))
    .map(t=>`<button type="button" data-t="${esc(t)}" aria-label="Remove ${esc(t)}">${esc(t)}</button>`).join("");
}
$("#fams").addEventListener("click",e=>{const b=e.target.closest(".fam");if(!b)return;
  const i=+b.dataset.i;openFam=openFam===i?null:i;renderWheel();});
$("#fams").addEventListener("change",e=>{const c=e.target.closest("input[data-t]");if(!c)return;
  if(c.checked)tags.add(c.dataset.t);else tags.delete(c.dataset.t);renderWheel();});
$("#tasted").addEventListener("click",e=>{const b=e.target.closest("button[data-t]");if(!b)return;
  tags.delete(b.dataset.t);renderWheel();});
```

- [ ] **Step 5: Wire the tags through the form.**
  - In `formFields`, change `dr:opt.dr,bu:opt.bu,ag:opt.ag};` to `dr:opt.dr,bu:opt.bu,ag:opt.ag,t:TAG_ORDER.filter(x=>tags.has(x))};`.
  - In `startEdit`, after the `Object.keys(OPTS).forEach(k=>setOpt(k,e[k]||""));` line, add `setTags(e.t);`.
  - In `clearForm`, after the `Object.keys(OPTS).forEach(k=>setOpt(k,""));` line, add `openFam=null;setTags([]);`.
  - In the `visibilitychange` handler's `untouched` expression, append `&&!tags.size`.

  `smokeAgain` already calls `clearForm()` before `applyPick`, so tags stay clear.

- [ ] **Step 6: Run the checks.**

Run: `for c in tf3 tf2 tf1 task3 task4; do npm run -s test:ui -- $c | tail -1; npm run -s test:ui -- $c --dark | tail -1; done`
Expected: ten `RESULT: PASS` lines.

Then run `npm run test:ui -- tf3 --shot='clearForm();document.querySelectorAll("#fams .fam")[5].click();document.querySelector(".famtags input[data-t=\"black pepper\"]").click();window.scrollTo(0,document.querySelector("#wheel").offsetTop-80)'` and look at `test/ui/out/tf3.png`. The Spice panel should open under its row, and "black pepper" should appear on the Tasted line.

- [ ] **Step 7: `npm test`, then commit.**

```bash
npm test && git add public/index.html test/ui/checks/tf3.js && git commit -q -m "feat: 47-tag flavor wheel on the tasting form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

---

### Task 4: Palate scorecard, CSV columns, Punch date fix

**Files:**
- Modify: `public/index.html` (the Palate section markup, `renderPalate` and its helpers, the removal of `FLAVORS`, `rankCard`, and the stat strip, the CSV export, the Punch line in `SEED`, and `load()`)
- Create: `test/ui/checks/tf4.js`

**Interfaces:**
- Consumes: `WHEEL`, `OPTS`, `entryRow`, `topBy`, `agg`, and `bodyOrder`.
- Produces:
  - `hits(e) → {tags: Set, fams: Set}`
  - `flavorStats(list) → [{F, n, avg, tags: [{t, n, avg}]}]`, sorted by n descending
  - `applyFixups(list) → number` (entries changed)

- [ ] **Step 1: Write the checks.** Create `test/ui/checks/tf4.js`:

```js
// Tasting form Task 4: scorecard Palate, CSV columns, the Punch date fix.
// Run: npm run test:ui -- tf4   and   --dark
(() => {
  const r = {};
  const fs = flavorStats(live());
  const fam = (f) => fs.find((x) => x.F.f === f);
  const tag = (f, t) => fam(f)?.tags.find((x) => x.t === t);
  r.spice14 = fam("Spice")?.n === 14;
  r.smooth12 = tag("Feel", "smooth")?.n === 12;
  r.creamVsCreamy = tag("Feel", "creamy")?.n === 1 && !tag("Nut and cream", "cream") && tag("Nut and cream", "nutty")?.n === 1;
  const t23 = [...document.querySelectorAll("#tally .tally")].find((d) => d.querySelector(".y").textContent === "2023");
  r.tally2023 = !!t23 && t23.querySelectorAll("line").length === 17 && t23.querySelector(".c").textContent === "17";
  r.tallyStrikes = !!t23 && t23.querySelectorAll("line.strike").length === 3;
  r.punchFixed = !data.some((e) => e.d === "2021-01-01") && data.some((e) => e.l === "Cigar City Brewing" && e.d === "2022-01-01");
  const t = [{ b: "Punch", l: "Cigar City Brewing", d: "2021-01-01", u: 1 }];
  r.migration = applyFixups(t) === 1 && t[0].d === "2022-01-01" && t[0].u > 1 && applyFixups(t) === 0;
  r.summary = /^51 smokes and 25 brands since October 2021, averaging 4\.\d\d\.$/.test($("#psum").textContent);
  r.verdictPlain = !!document.querySelector("#verdict .line") && !document.querySelector("#verdict em");
  r.buyAgainEmpty = /Mark "yes" under Again/.test($("#buyagain").textContent);
  r.drawBurnHidden = $("#drawburn").innerHTML === "";
  const now = Date.now();
  data = [0, 1, 2].map((i) => ({ id: "db" + i, u: now, deleted: 0, d: localToday(), b: "Test", l: "DB " + i, r: 4,
    dr: i ? "good" : "tight", bu: "even", ag: "yes", fi: [], t: ["cedar"] })).concat(data);
  renderAll();
  r.buyAgainList = document.querySelectorAll("#buyagain .entry").length === 3;
  r.drawBurnShown = /tight 1, just right 2, loose 0 of 3/.test($("#drawburn").textContent) &&
    /even 3, canoed 0, relit 0 of 3/.test($("#drawburn").textContent);
  r.tagCounted = flavorStats(live()).find((x) => x.F.f === "Wood")?.tags.find((x) => x.t === "cedar")?.n === 3;
  const wood = [...document.querySelectorAll("#flavors button.frow")].find((b) => b.dataset.f === "Wood");
  wood.click();
  r.familyExpands = !!document.querySelector("#flavors .frow.sub") &&
    document.querySelector('#flavors button.frow[data-f="Wood"]').getAttribute("aria-expanded") === "true";
  r.tables = /Nicaragua/.test($("#rk-origin").textContent) && document.querySelectorAll("#rk-origin .k").length > 0;
  r.topRated = document.querySelectorAll("#toprated .entry").length === 6;
  r.noOldCards = !document.querySelector("#palate .card") && !document.querySelector("#statstrip");
  let csv = ""; const orig = window.dl; window.dl = (n, text) => { csv = text; };
  $("#exp-csv").click(); window.dl = orig;
  r.csvColumns = csv.split("\n")[0].endsWith(",Flavors,Draw,Burn,Again") && csv.includes('"cedar","tight","even","yes"');
  return r;
})()
```

The seed notes never mention cedar, so `tagCounted` expects exactly the three test rows.

- [ ] **Step 2: Confirm it fails.**

Run: `npm run test:ui -- tf4`
Expected: `RESULT: FAIL`. It throws, because `flavorStats` is not defined.

- [ ] **Step 3: The Punch fix.**
  - In `SEED`, change the line starting `{d:"2021-01-01",b:"Punch",l:"Cigar City Brewing"` so it starts `{d:"2022-01-01",b:"Punch",l:"Cigar City Brewing"`.
  - Add this above `function load(){`:

    ```js
    /* One-time data fixes, matched on content so they apply once and then never match again.
       2026-09-25: Punch Cigar City Brewing was logged 2021-01-01 (sheet row 7); it sits between
       2021-12-26 and 2022-01-18, so the year was a typo. Austin confirmed the fix. */
    function applyFixups(list){let n=0;
      list.forEach(e=>{if(e.b==="Punch"&&e.l==="Cigar City Brewing"&&e.d==="2021-01-01"){e.d="2022-01-01";e.u=Date.now();n++;}});
      return n;}
    ```

  - In `load()`, change `save(d);return d;}` to `applyFixups(d);save(d);return d;}`.

  The fixed entry gets a fresh `u`, so the next sync pushes it to D1 and the other devices pull it.

- [ ] **Step 4: Palate markup.** Replace the whole `<!-- ===== PALATE ===== -->` section with:

```html
  <!-- ===== PALATE ===== -->
  <section class="panel" id="palate" role="tabpanel">
    <h2 class="ptitle">Your palate</h2>
    <p class="psum" id="psum"></p>
    <div id="verdict"></div>
    <div class="psec"><div class="lab">Smokes by year</div><div id="tally"></div></div>
    <div class="psec"><div class="lab rowlbl"><span>Flavors, by smokes</span><span>avg</span></div>
      <div id="flavors"></div></div>
    <div class="psec"><div class="lab">Would smoke again</div><div id="buyagain"></div></div>
    <div class="psec" id="drawburn"></div>
    <div class="psec tables">
      <div id="rk-origin"></div><div id="rk-wrapper"></div><div id="rk-binder"></div>
      <div id="rk-filler"></div><div id="rk-body"></div><div id="rk-shape"></div>
    </div>
    <div class="psec"><div class="lab">Top rated</div><div id="toprated"></div></div>
    <div class="foot">
      <button id="backfill">Fill blanks from catalog</button>
      <button id="exp-json">Export backup (.json)</button>
      <button id="exp-csv">Export spreadsheet (.csv)</button>
      <button id="imp">Import backup</button>
      <input type="file" id="impfile" accept=".json" hidden>
    </div>
  </section>
```

- [ ] **Step 5: Replace the Palate code.** Delete the `/* flavor lexicon -> regex */` comment and the `const FLAVORS=[…];` block. Replace `function renderPalate(){…}` and `function rankCard(…){…}` with:

```js
/* which tags and families a smoke hits: its checked tags plus regex hits in its notes */
function hits(e){
  const n=e.n||"", tagsHit=new Set(e.t||[]), fams=new Set();
  WHEEL.forEach(F=>{F.tags.forEach(([t,re])=>{if(re.test(n))tagsHit.add(t);});
    if(F.tags.some(([t])=>tagsHit.has(t))||(F.re&&F.re.test(n)))fams.add(F.f);});
  return {tags:tagsHit,fams};
}
function flavorStats(list){
  const H=list.map(e=>({e,h:hits(e)}));
  const avgOf=xs=>{const rs=xs.filter(x=>typeof x.e.r==="number");return rs.length?rs.reduce((a,x)=>a+x.e.r,0)/rs.length:null;};
  return WHEEL.map(F=>{const fh=H.filter(x=>x.h.fams.has(F.f));
    return {F,n:fh.length,avg:avgOf(fh),
      tags:F.tags.map(([t])=>{const th=H.filter(x=>x.h.tags.has(t));return {t,n:th.length,avg:avgOf(th)};})
        .filter(x=>x.n).sort((a,b)=>b.n-a.n)};})
    .filter(x=>x.n).sort((a,b)=>b.n-a.n);
}
const plural=(n,w)=>n+" "+w+(n===1?"":"s");
let openStatFam=null;
function renderFlavors(list){
  const fs=flavorStats(list), max=Math.max(1,...fs.map(x=>x.n)), fmt=a=>a==null?"":a.toFixed(2);
  const bar=n=>`<span class="bar" style="width:${Math.round(n/max*100)}%"></span>`;
  $("#flavors").innerHTML=fs.length?fs.map(x=>`<button type="button" class="frow" data-f="${esc(x.F.f)}" aria-expanded="${openStatFam===x.F.f}">
      <span class="nm">${esc(x.F.f)}</span>${bar(x.n)}<span class="n">${x.n}</span><span class="a">${fmt(x.avg)}</span></button>${
      openStatFam===x.F.f?x.tags.map(t=>`<div class="frow sub"><span class="nm">${esc(t.t)}</span>${bar(t.n)}<span class="n">${t.n}</span><span class="a">${fmt(t.avg)}</span></div>`).join(""):""}`).join("")
    :`<p class="note">Check flavors on the Log form and they add up here.</p>`;
}
$("#flavors").addEventListener("click",e=>{const b=e.target.closest("button.frow");if(!b)return;
  openStatFam=openStatFam===b.dataset.f?null:b.dataset.f;renderFlavors(live());});
function tallySvg(n){let s="";
  for(let i=0;i<n;i++){const x0=Math.floor(i/5)*26,k=i%5;
    s+=k<4?`<line x1="${x0+k*5}" y1="3" x2="${x0+k*5}" y2="17"/>`:`<line class="strike" x1="${x0-3}" y1="14" x2="${x0+18}" y2="5"/>`;}
  const w=Math.max(1,Math.ceil(n/5))*26;
  return `<svg width="${w}" height="20" viewBox="0 0 ${w} 20" aria-hidden="true">${s}</svg>`;}
function renderTally(list){
  const by={};list.forEach(e=>{const y=(e.d||"").slice(0,4);if(y)by[y]=(by[y]||0)+1;});
  const ys=Object.keys(by).sort();
  if(!ys.length){$("#tally").innerHTML="";return;}
  const rows=[];
  for(let y=+ys[0];y<=+ys[ys.length-1];y++){const n=by[y]||0;
    rows.push(`<div class="tally"><span class="y">${y}</span>${tallySvg(n)}<span class="c">${n}</span></div>`);}
  $("#tally").innerHTML=rows.join("");
}
function renderBuyAgain(list){
  const seen=new Map();
  [...list].sort((a,b)=>(b.d||"").localeCompare(a.d||"")).forEach(e=>{if(e.ag!=="yes")return;
    const k=((e.b||"")+"|"+(e.l||"")).toLowerCase();if(!seen.has(k))seen.set(k,e);});
  $("#buyagain").innerHTML=seen.size?[...seen.values()].map(e=>entryRow(e)).join("")
    :`<p class="note">Mark "yes" under Again and they collect here.</p>`;
}
function renderDrawBurn(list){
  const line=k=>{const set=list.filter(e=>e[k]);if(set.length<3)return"";
    return `<div class="dbline"><span class="lab">${OPTS[k].label}</span>${
      OPTS[k].vals.map(([v,t])=>`${t} ${set.filter(e=>e[k]===v).length}`).join(", ")} of ${set.length}</div>`;};
  const html=line("dr")+line("bu");
  $("#drawburn").innerHTML=html?`<div class="lab">Draw and burn</div>${html}`:"";
}
function rankTable(sel,title,rows,keepOrder){
  let r=rows.slice(0,6);if(keepOrder)r=[...r].sort((a,b)=>bodyOrder.indexOf(a.k)-bodyOrder.indexOf(b.k));
  $(sel).innerHTML=`<div class="tbl"><span class="h">${title}</span><span class="h r">n</span><span class="h r">avg</span>${
    r.length?r.map(x=>`<span class="k">${esc(x.k)}</span><span class="r">${x.n}</span><span class="r">${x.avg.toFixed(2)}</span>`).join("")
    :`<span class="k" style="grid-column:1/-1;color:var(--faint)">Not enough smokes yet</span>`}</div>`;
}
function renderPalate(){
  const L=live(), R=rated();
  if(!L.length){$("#psum").textContent="No smokes yet. Log one and your scorecard starts here.";
    ["#verdict","#tally","#flavors","#buyagain","#drawburn","#toprated"].forEach(s=>$(s).innerHTML="");return;}
  const first=L.map(e=>e.d).filter(Boolean).sort()[0]||localToday();
  const since=new Date(+first.slice(0,4),+first.slice(5,7)-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const avg=R.length?R.reduce((a,e)=>a+e.r,0)/R.length:0;
  $("#psum").textContent=`${plural(L.length,"smoke")} and ${plural(uniq(L.map(e=>e.b)).length,"brand")} since ${since}${R.length?`, averaging ${avg.toFixed(2)}`:""}.`;
  let v="";
  if(R.length){
    const origin=topBy(agg(e=>[e.o]),2,avg), wrapper=topBy(agg(e=>[e.w]),2,avg), body=topBy(agg(e=>[e.bd]),2,avg);
    const maduro=R.filter(e=>/maduro/i.test(e.wn)||/maduro/i.test(e.l));
    const madAvg=maduro.length?maduro.reduce((a,e)=>a+e.r,0)/maduro.length:0;
    const social=R.filter(e=>e.s), solo=R.filter(e=>!e.s);
    const mean=xs=>xs.reduce((a,e)=>a+e.r,0)/xs.length;
    const headTop=rows=>rows[0]&&rows[0].n>=HEADLINE_MIN_N?rows[0]:null;
    const o=headTop(origin), w=headTop(wrapper), bd=body[0];
    let line;
    if(o){line=`You're a ${esc(o.k)} smoker`;if(w)line+=`, happiest under a ${esc(w.k)} wrapper`;}
    else if(w)line=`You're happiest under a ${esc(w.k)} wrapper`;
    else line=`Log a few more and a pattern shows up here`;
    if(o&&madAvg>=avg+0.1&&maduro.length>=3)line+=`, and a maduro at heart`;
    v=`<p class="line">${line}.</p>${bd?`<div class="dbline"><span class="lab">Sweet spot body</span>${esc(bd.k)}</div>`:""}${
      social.length&&solo.length?`<div class="dbline"><span class="lab">With friends</span>${mean(social).toFixed(2)} avg, alone ${mean(solo).toFixed(2)}</div>`:""}`;
    rankTable("#rk-origin","Origin",origin);rankTable("#rk-wrapper","Wrapper",wrapper);
    rankTable("#rk-binder","Binder",topBy(agg(e=>[e.bn]),2,avg));
    rankTable("#rk-filler","Filler",topBy(agg(e=>[...(e.fi||[])]),2,avg));
    rankTable("#rk-body","Body",body,true);rankTable("#rk-shape","Shape",topBy(agg(e=>[e.sh]),2,avg));
  }else ["#rk-origin","#rk-wrapper","#rk-binder","#rk-filler","#rk-body","#rk-shape"].forEach(s=>$(s).innerHTML="");
  $("#verdict").innerHTML=v;
  renderTally(L);renderFlavors(L);renderBuyAgain(L);renderDrawBurn(L);
  $("#toprated").innerHTML=[...R].sort((a,b)=>b.r-a.r||(b.d>a.d?1:-1)).slice(0,6).map(e=>entryRow(e)).join("");
}
```

- [ ] **Step 6: CSV columns.** In the `#exp-csv` handler, change:
  - `const cols=["d","b","l","sh","bd","w","wn","bn","fi","o","r","s","n"];` to `const cols=["d","b","l","sh","bd","w","wn","bn","fi","o","r","s","n","t","dr","bu","ag"];`
  - `…"Rating","Social","Notes"];` to `…"Rating","Social","Notes","Flavors","Draw","Burn","Again"];`
  - `esc(c==="fi"?(e.fi||[]).join(", "):e[c])` to `esc(c==="fi"||c==="t"?(e[c]||[]).join(", "):e[c])`

- [ ] **Step 7: Run all the checks.**

Run: `for c in tf1 tf2 tf3 tf4 task2 task3 task4 baseline; do npm run -s test:ui -- $c | tail -1; npm run -s test:ui -- $c --dark | tail -1; done`
Expected: sixteen `RESULT: PASS` lines.

Then run `npm run test:ui -- tf4 --shot='switchTab("palate")'` and `npm run test:ui -- tf4 --dark --shot='switchTab("palate")'`. Look at both. You should see the tally marks with red fifth strokes, flavor bars, printed tables, and no cards.

- [ ] **Step 8: `npm test`, then commit.**

```bash
npm test && git add public/index.html test/ui/checks/tf4.js && git commit -q -m "feat: palate scorecard with tallies, flavor families, buy-again list; fix Punch date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

---

### Task 5: Flame icon, manifest colors, ship

**Files:**
- Modify: `public/icon-source.svg`, `public/icon-180.png`, `public/icon-192.png`, `public/icon-512.png`, `public/manifest.webmanifest`

- [ ] **Step 1: Flame icon source.** Replace `public/icon-source.svg` with:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#2F5D45"/>
  <path d="M256 92 C297 174 369 215 369 307 A113 113 0 0 1 143 307 C143 246 184 205 205 159 C220 205 241 220 256 236 C261 184 251 138 256 92 Z" fill="#FAFAF7"/>
</svg>
```

- [ ] **Step 2: Render the PNGs and check one.**

```bash
(cd public && for s in 180 192 512; do rsvg-convert -w $s -h $s icon-source.svg -o icon-$s.png; done && file icon-*.png)
```

Expected: three PNG lines at 180, 192, and 512. Open `public/icon-512.png` to confirm a solid cream flame on flat green, edge to edge, with no transparency.

- [ ] **Step 3: Manifest colors.** In `public/manifest.webmanifest`, set `"background_color": "#FAFAF7"` and `"theme_color": "#FAFAF7"`.

- [ ] **Step 4: Full test pass, then commit.**

```bash
npm test && for c in tf1 tf2 tf3 tf4 task2 task3 task4 baseline; do npm run -s test:ui -- $c | tail -1; done && git add public/icon-source.svg public/icon-*.png public/manifest.webmanifest && git commit -q -m "feat: flame icon on tasting-form green

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
```

- [ ] **Step 5: Whole-branch review.** Use superpowers:requesting-code-review with one reviewer on the most capable model over `git diff main...tasting-form`. Fix what it confirms, rerun `npm test` and all UI checks in both schemes, and push.

- [ ] **Step 6: Deploy (Austin's Mac only).** claude01 has no Cloudflare credential. If this session isn't on the Mac, stop and hand Austin this command:

```bash
cd /usr/local/ember && git fetch && git checkout tasting-form && git pull && npm ci && npm test && npm run deploy
```

On the Mac, ask Austin before running it. Expected: wrangler prints `ember.austinsego.com` and a version id.

- [ ] **Step 7: Austin's phone check (about 5 minutes).**
  1. Long-press the Ember icon → Remove App → Delete from Home Screen. Then add it again from Safari (Share → Add to Home Screen) so iOS fetches the new flame.
  2. In Clear mode, check that the flame reads as a crisp mark.
  3. Open Ember and log a smoke with two families of tags, a draw, and "Again: yes". Save it.
  4. Open Palate. The smoke should appear under "Would smoke again", and 2021 should show 4 tally marks.
  5. Switch the phone between light and dark (Settings → Display & Brightness). Both should be legible, and the status bar text should be readable in both.

  If the status bar text is invisible in either mode, that's the `status-bar-style` assumption from Task 1 Step 8. Report it, and don't guess a fix.

- [ ] **Step 8: Finish the branch.** Use superpowers:finishing-a-development-branch to open a PR from `tasting-form`, merge it into `main`, and push.
