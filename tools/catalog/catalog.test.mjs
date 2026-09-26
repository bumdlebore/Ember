import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePage, fmtLen, stripPrefix, splitFiller, BODY } from "./parse.mjs";
import { buildCatalog, norm } from "./build.mjs";
import { catalogSql } from "./sql.mjs";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

describe("parsePage", () => {
  it("extracts only the spec fields from a size page", () => {
    expect(parsePage(fx("cigar.html"))).toEqual({
      brand: "Testbrand", blend: "Testbrand Reserva",
      size: { n: "Robusto", shape: "Robusto", len: "5½", rg: 50 },
      w: "San Andres", bn: "Nicaragua", fi: ["Nicaragua", "Dominican Republic", "Honduras"],
      o: "Nicaragua", mk: "Test Cigar Co.", color: "Maduro", strength: "Medium-Full",
    });
  });
  it("stores no description prose", () => {
    expect(JSON.stringify(parsePage(fx("cigar.html")))).not.toMatch(/prose/i);
  });
  it("returns null for a sampler with no wrapper, binder, or filler", () => {
    expect(parsePage(fx("sampler.html"))).toBeNull();
  });
  it("returns null without a breadcrumb", () => {
    expect(parsePage("<h1>Something</h1><div>Specifications</div>")).toBeNull();
  });
});

describe("helpers", () => {
  it("formats lengths", () => {
    expect(fmtLen('6"1/2')).toBe("6½");
    expect(fmtLen('4"3/4')).toBe("4¾");
    expect(fmtLen('5"1/4')).toBe("5¼");
    expect(fmtLen('5"5/8')).toBe("5 5/8");
    expect(fmtLen('7"')).toBe("7");
    expect(fmtLen("")).toBe("");
  });
  it("strips a leading brand only", () => {
    expect(stripPrefix("Oliva Serie V Melanio", "Oliva")).toBe("Serie V Melanio");
    expect(stripPrefix("Serie V", "Oliva")).toBe("Serie V");
    expect(stripPrefix("Olivares Blend", "Oliva")).toBe("Olivares Blend");
  });
  it("splits fillers on commas and 'and'", () => {
    expect(splitFiller("Nicaragua, Dominican Republic and Honduras")).toEqual(["Nicaragua", "Dominican Republic", "Honduras"]);
    expect(splitFiller("")).toEqual([]);
  });
  it("maps strength to body", () => {
    expect(BODY["mild"]).toBe("Light");
    expect(BODY["mild to medium"]).toBe("Med-Light");
    expect(BODY["medium"]).toBe("Med");
    expect(BODY["medium-full"]).toBe("Med-Full");
    expect(BODY["full"]).toBe("Full");
  });
  it("normalizes names for matching", () => {
    expect(norm("E.P. Carrillo")).toBe("epcarrillo");
  });
});

describe("buildCatalog", () => {
  const page = (size, extra = {}) => ({ brand: "Oliva", blend: "Oliva Serie V Melanio", size,
    w: "Ecuadorian Sumatra-Seed", bn: "Nicaragua", fi: ["Jalapa"], o: "Nicaragua", mk: "Oliva Cigar Co.",
    color: "Natural", strength: "Medium", ...extra });
  it("groups sizes under one blend, deduped and sorted by length then ring", () => {
    const { blends } = buildCatalog([
      page({ n: "Churchill", shape: "Churchill", len: "7", rg: 50 }),
      page({ n: "Robusto", shape: "Robusto", len: "5", rg: 50 }),
      page({ n: "Robusto", shape: "Robusto", len: "5", rg: 50 }),
      page({ n: "Torpedo", shape: "Torpedo", len: "6½", rg: 52 }),
    ], []);
    expect(blends).toHaveLength(1);
    expect(blends[0]).toMatchObject({ k: "oliva|serie v melanio", b: "Oliva", l: "Serie V Melanio", bd: "Med", wn: "", src: "np" });
    expect(blends[0].sizes.map((s) => s.n)).toEqual(["Robusto", "Torpedo", "Churchill"]);
  });
  it("keeps Maduro, Oscuro, Claro, and Colorado as the wrapper note", () => {
    expect(buildCatalog([page({ n: "T", shape: "T", len: "6", rg: 52 }, { color: "Maduro" })], []).blends[0].wn).toBe("Maduro");
  });
  it("adds legacy rows only when Neptune lacks the blend", () => {
    const { blends, stats } = buildCatalog([page({ n: "T", shape: "T", len: "6", rg: 52 })],
      [{ l: "Oliva Serie V Melanio", w: "x" }, { l: "Padron 1964 Anniversary", w: "Maduro", o: "Nicaragua", bn: "Nicaraguan", fi: ["Nicaraguan"] }]);
    expect(blends.map((b) => b.l)).toEqual(["Serie V Melanio", "Padron 1964 Anniversary"]);
    expect(blends[1]).toMatchObject({ b: "", src: "ci", sizes: [] });
    expect(stats).toMatchObject({ neptune: 1, legacy: 1 });
  });
  it("skips null pages and reports unmapped strengths", () => {
    const { blends, stats } = buildCatalog([null, page({ n: "T", shape: "T", len: "6", rg: 52 }, { strength: "Spicy" })], []);
    expect(blends).toHaveLength(1);
    expect(blends[0].bd).toBe("");
    expect(stats.unmapped).toEqual(["Spicy"]);
  });
});

describe("catalogSql", () => {
  it("replaces the table, escapes quotes, and sets the version last", () => {
    const sql = catalogSql("v1", [{ k: "b|it's", l: "It's" }]);
    const lines = sql.split("\n");
    expect(lines[0]).toBe("DELETE FROM catalog;");
    expect(sql).toContain("('b|it''s', '{\"k\":\"b|it''s\",\"l\":\"It''s\"}')");
    expect(lines.at(-1)).toBe("INSERT INTO catalog_meta (key, value) VALUES ('version', 'v1') ON CONFLICT(key) DO UPDATE SET value = excluded.value;");
  });
  it("splits inserts so no statement reaches D1's 100 KB limit", () => {
    const big = Array.from({ length: 60 }, (_, i) => ({ k: "b|" + i, l: "x".repeat(5000) }));
    const inserts = catalogSql("v1", big).split("\n").filter((l) => l.startsWith("INSERT INTO catalog ("));
    expect(inserts.length).toBeGreaterThan(3);
    expect(inserts.every((l) => l.length < 100000)).toBe(true);
    expect(inserts.join("").match(/\('b\|/g).length).toBe(60);
  });
});
