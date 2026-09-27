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
