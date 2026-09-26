// Runs a UI check block from test/ui/checks/<name>.js against public/index.html
// in headless Chromium at phone size, from a fresh profile (so the seed data loads).
//
//   npm run test:ui -- <name> [--dark] [--shot='<js to run before the screenshot>']
//
// Prints the check's result object. Exits 1 if any key is not true, the block
// throws, or the page raises an uncaught error. Saves test/ui/out/<name>.png
// (<name>-dark.png with --dark, which emulates prefers-color-scheme: dark).
//
// Chromium: CHROMIUM_PATH, else the first of the known install paths below.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "public");
const [name, ...rest] = process.argv.slice(2);
const shot = (rest.find((a) => a.startsWith("--shot=")) || "").slice(7);
const dark = rest.includes("--dark");
if (!name) {
  console.error("usage: npm run test:ui -- <check-name> [--dark] [--shot='<js>']");
  process.exit(2);
}
const check = await readFile(join(here, "checks", name + ".js"), "utf8");

const exe =
  process.env.CHROMIUM_PATH ||
  ["/usr/bin/chromium", "/usr/bin/chromium-browser",
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!exe) {
  console.error("No Chromium found. Set CHROMIUM_PATH.");
  process.exit(2);
}

const types = { ".html": "text/html", ".js": "text/javascript", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(root, path === "/" ? "index.html" : path);
  try {
    if (!file.startsWith(root)) throw new Error("outside root");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(500);

  let result;
  try {
    result = await page.evaluate(check);
  } catch (e) {
    console.error("check threw:", e.message.split("\n")[0]);
    failed = true;
  }
  if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
    const bad = Object.entries(result).filter(([, v]) => v !== true).map(([k]) => k);
    if (bad.length) { console.error("FAILED:", bad.join(", ")); failed = true; }
  }
  if (pageErrors.length) { console.error("page errors:", pageErrors.join(" | ")); failed = true; }

  if (shot) { await page.evaluate(shot); await page.waitForTimeout(400); }
  await page.evaluate(() => window.scrollTo(0, 0));
  const out = join(here, "out");
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: join(out, name + (dark ? "-dark" : "") + ".png") });
  console.log("screenshot:", join("test/ui/out", name + (dark ? "-dark" : "") + ".png"));
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
