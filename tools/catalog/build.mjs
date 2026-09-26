// Groups crawled Neptune size pages into one record per blend, merges the legacy
// Cigars International catalog where Neptune lacks a blend, and writes catalog.json.
//   node tools/catalog/build.mjs          (reads and writes $EMBER_DATA, default ~/ember-data)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BODY, LABELS, stripPrefix } from "./parse.mjs";

export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const NOTE = /^(maduro|oscuro|claro|colorado)$/i;
const G = { "¼": 0.25, "½": 0.5, "¾": 0.75 };
const lenNum = (len) => {
  const m = String(len || "").match(/^(\d+)(?:\s+(\d+)\/(\d+)|([¼½¾]))?/);
  return m ? +m[1] + (m[2] ? m[2] / m[3] : m[4] ? G[m[4]] : 0) : 0;
};

// A value that is a spec label or runs past 60 characters is page text, not a spec value.
const clean = (v) => { v = String(v || "").trim(); return v.length > 60 || LABELS[v] ? "" : v; };
// Most common value, skipping blanks unless keepBlank (a blank wrapper note means a natural wrapper); ties go to the first seen.
const mode = (vals, keepBlank) => {
  const n = new Map();
  for (const v of vals) if (v || keepBlank) n.set(v, (n.get(v) || 0) + 1);
  let best = "", c = 0;
  for (const [v, k] of n) if (k > c) { best = v; c = k; }
  return best;
};

export function buildCatalog(pages, legacy) {
  const groups = new Map(), unmapped = new Set();
  for (const p of pages) {
    if (!p) continue;
    const b = p.brand.trim(), l = stripPrefix(p.blend, b), k = (b + "|" + l).toLowerCase();
    const bd = BODY[String(p.strength || "").toLowerCase()] || "";
    if (p.strength && !bd) unmapped.add(p.strength);
    const color = clean(p.color);
    const f = { w: clean(p.w), wn: NOTE.test(color) ? color : "", bn: clean(p.bn), o: clean(p.o), bd, mk: clean(p.mk),
      fi: JSON.stringify((p.fi || []).map(clean).filter(Boolean)) };
    if (!groups.has(k)) groups.set(k, { k, b, l, pages: [] });
    groups.get(k).pages.push({ f, size: p.size });
  }
  const byKey = new Map();
  for (const g of groups.values()) {
    // Sizes of one blend can differ (a Cameroon size in a Connecticut line), so the blend takes the most common value.
    const m = {};
    for (const key of ["w", "wn", "bn", "o", "bd", "mk", "fi"]) m[key] = mode(g.pages.map((x) => x.f[key]), key === "wn");
    const r = { k: g.k, b: g.b, l: g.l, w: m.w, wn: m.wn, bn: m.bn, fi: JSON.parse(m.fi || "[]"), o: m.o, bd: m.bd, mk: m.mk, sizes: [], src: "np" };
    for (const { f, size: s } of g.pages) {
      if (!s || !s.n || r.sizes.some((x) => x.n === s.n && x.len === s.len && x.rg === s.rg)) continue;
      const sz = { n: s.n, shape: s.shape, len: s.len, rg: s.rg };
      // A size keeps its own wrapper, note and body only where they differ from the blend's.
      for (const key of ["w", "wn", "bd"]) if (f[key] !== r[key] && (f[key] || key === "wn")) sz[key] = f[key];
      r.sizes.push(sz);
    }
    r.sizes.sort((a, b) => lenNum(a.len) - lenNum(b.len) || (a.rg || 0) - (b.rg || 0));
    byKey.set(g.k, r);
  }
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
