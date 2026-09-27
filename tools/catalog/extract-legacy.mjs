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
