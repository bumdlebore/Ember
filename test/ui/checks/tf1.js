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
