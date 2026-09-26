// Parses one Neptune Cigar size page into a record. Keeps only factual spec fields;
// descriptions, ratings, prices and images are never read out of the page.
const ENT = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&#039;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
const decode = (s) => s.replace(/&(amp|quot|#39|#039|lt|gt|nbsp);/g, (m) => ENT[m]).replace(/\u00a0/g, " ");
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
  if (crumbs.length < 4) return null; // Home, Cigars, [category,] Brand, Blend
  const brand = crumbs.at(-2), blend = crumbs.at(-1); // a category crumb ("Flavored") can precede the brand

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
