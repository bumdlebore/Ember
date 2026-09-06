import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { listEntries, upsertEntries } from "../src/entries.js";

beforeEach(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS entries");
  await env.DB.exec(
    "CREATE TABLE entries (owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, u INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, id))"
  );
});

const A = "austin@example.com";
const B = "cara@example.com";

describe("upsertEntries", () => {
  it("writes new entries and reads them back", async () => {
    const r = await upsertEntries(env.DB, A, [
      { id: "e1", u: 100, deleted: 0, l: "Padron 1964" },
    ]);
    expect(r.written).toBe(1);

    const out = await listEntries(env.DB, A, 0);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].l).toBe("Padron 1964");
    expect(out.entries[0].id).toBe("e1");
  });

  it("keeps the higher u on conflict", async () => {
    await upsertEntries(env.DB, A, [{ id: "e1", u: 200, l: "newer" }]);
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "older" }]);

    const out = await listEntries(env.DB, A, 0);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].l).toBe("newer");
    expect(out.entries[0].u).toBe(200);
  });

  it("an equal-u write overwrites, last writer wins", async () => {
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "first" }]);
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "second" }]);
    const out = await listEntries(env.DB, A, 0);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].u).toBe(100);
    expect(out.entries[0].l).toBe("second");
  });

  it("skips malformed rows but writes the rest", async () => {
    const r = await upsertEntries(env.DB, A, [
      { id: "good", u: 100, l: "ok" },
      { u: 100, l: "no id" },
      { id: "no-u", l: "missing u" },
      null,
    ]);
    expect(r.written).toBe(1);
    expect(r.skipped).toBe(3);
    const out = await listEntries(env.DB, A, 0);
    expect(out.entries.map((e) => e.id)).toEqual(["good"]);
  });

  it("round-trips tombstones", async () => {
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "x" }]);
    await upsertEntries(env.DB, A, [{ id: "e1", u: 300, deleted: 1, l: "x" }]);
    const out = await listEntries(env.DB, A, 0);
    expect(out.entries[0].deleted).toBe(1);
  });

  it("returns written 0 for an empty batch", async () => {
    const r = await upsertEntries(env.DB, A, []);
    expect(r.written).toBe(0);
  });
});

describe("listEntries", () => {
  it("never returns another owner's rows", async () => {
    await upsertEntries(env.DB, A, [{ id: "mine", u: 100, l: "mine" }]);
    await upsertEntries(env.DB, B, [{ id: "theirs", u: 100, l: "theirs" }]);

    const out = await listEntries(env.DB, A, 0);
    expect(out.entries.map((e) => e.id)).toEqual(["mine"]);
  });

  it("lets two owners hold the same entry id independently", async () => {
    await upsertEntries(env.DB, A, [{ id: "shared", u: 100, l: "a-version" }]);
    await upsertEntries(env.DB, B, [{ id: "shared", u: 100, l: "b-version" }]);

    expect((await listEntries(env.DB, A, 0)).entries[0].l).toBe("a-version");
    expect((await listEntries(env.DB, B, 0)).entries[0].l).toBe("b-version");
  });

  it("filters by cursor inclusively", async () => {
    await upsertEntries(env.DB, A, [
      { id: "old", u: 100, l: "old" },
      { id: "edge", u: 200, l: "edge" },
      { id: "new", u: 300, l: "new" },
    ]);

    const out = await listEntries(env.DB, A, 200);
    expect(out.entries.map((e) => e.id).sort()).toEqual(["edge", "new"]);
  });

  it("returns the max u as the cursor", async () => {
    await upsertEntries(env.DB, A, [
      { id: "a", u: 100, l: "a" },
      { id: "b", u: 450, l: "b" },
    ]);
    const out = await listEntries(env.DB, A, 0);
    expect(out.cursor).toBe(450);
  });

  it("echoes the cursor back when nothing matches", async () => {
    const out = await listEntries(env.DB, A, 999);
    expect(out.entries).toEqual([]);
    expect(out.cursor).toBe(999);
  });
});
