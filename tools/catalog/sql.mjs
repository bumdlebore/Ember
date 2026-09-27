// SQL that replaces the catalog. Each INSERT stays under
// 80 KB, well below D1's 100 KB statement limit.
export function catalogSql(version, blends) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const out = ["DELETE FROM catalog;"];
  let cur = [], len = 0;
  const flush = () => { if (cur.length) { out.push("INSERT INTO catalog (k, data) VALUES " + cur.join(", ") + ";"); cur = []; len = 0; } };
  for (const b of blends) {
    const v = `(${q(b.k)}, ${q(JSON.stringify(b))})`;
    if (len + v.length > 80000) flush();
    cur.push(v); len += v.length + 2;
  }
  flush();
  out.push(`INSERT INTO catalog_meta (key, value) VALUES ('version', ${q(version)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  return out.join("\n");
}
