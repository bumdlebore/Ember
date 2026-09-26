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
