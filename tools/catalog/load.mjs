// Loads catalog.json into production D1. Mac only. It asks before
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
