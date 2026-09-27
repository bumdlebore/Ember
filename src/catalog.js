// Reference catalog of cigar blends, shared across owners. Loaded by tools/catalog/load.mjs.
export async function getCatalog(db, have) {
  let version = null;
  try {
    const row = await db.prepare("SELECT value FROM catalog_meta WHERE key = 'version'").first();
    version = row ? row.value : null;
  } catch {
    // A fresh database has no catalog tables yet; that's an empty catalog, not an error.
    return { version: null, blends: [] };
  }
  if (!version) return { version: null, blends: [] };
  if (have && have === version) return { version, unchanged: true };
  const { results } = await db.prepare("SELECT data FROM catalog").all();
  const blends = [];
  for (const r of results || []) {
    try {
      blends.push(JSON.parse(r.data));
    } catch {
      continue;
    }
  }
  return { version, blends };
}
