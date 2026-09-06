export async function listEntries(db, owner, since) {
  const cursor = Number.isFinite(since) ? since : 0;
  const { results } = await db
    .prepare("SELECT id, data, u, deleted FROM entries WHERE owner = ? AND u >= ? ORDER BY u ASC")
    .bind(owner, cursor)
    .all();

  const entries = [];
  let max = cursor;
  for (const row of results || []) {
    let parsed;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      continue;
    }
    entries.push({ ...parsed, id: row.id, u: row.u, deleted: row.deleted });
    if (row.u > max) max = row.u;
  }
  return { entries, cursor: max };
}

export async function upsertEntries(db, owner, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const statements = [];
  let skipped = 0;

  const sql = `INSERT INTO entries (owner, id, data, u, deleted)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(owner, id) DO UPDATE SET
                 data = excluded.data,
                 u = excluded.u,
                 deleted = excluded.deleted
               WHERE excluded.u >= entries.u`;

  for (const entry of list) {
    if (!entry || typeof entry !== "object") { skipped++; continue; }
    const id = entry.id;
    const u = entry.u;
    if (typeof id !== "string" || !id || typeof u !== "number" || !Number.isFinite(u)) {
      skipped++;
      continue;
    }
    statements.push(
      db.prepare(sql).bind(owner, id, JSON.stringify(entry), u, entry.deleted ? 1 : 0)
    );
  }

  if (statements.length) await db.batch(statements);
  return { written: statements.length, skipped };
}
