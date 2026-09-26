// Tasting form Task 4: scorecard Palate, CSV columns, the Punch date fix.
// Run: npm run test:ui -- tf4   and   --dark
(() => {
  const r = {};
  const fs = flavorStats(live());
  const fam = (f) => fs.find((x) => x.F.f === f);
  const tag = (f, t) => fam(f)?.tags.find((x) => x.t === t);
  r.spice14 = fam("Spice")?.n === 14;
  r.smooth12 = tag("Feel", "smooth")?.n === 12;
  r.creamVsCreamy = tag("Feel", "creamy")?.n === 1 && !tag("Nut and cream", "cream") && tag("Nut and cream", "nutty")?.n === 1;
  const t23 = [...document.querySelectorAll("#tally .tally")].find((d) => d.querySelector(".y").textContent === "2023");
  r.tally2023 = !!t23 && t23.querySelectorAll("line").length === 17 && t23.querySelector(".c").textContent === "17";
  r.tallyStrikes = !!t23 && t23.querySelectorAll("line.strike").length === 3;
  r.punchFixed = !data.some((e) => e.d === "2021-01-01") && data.some((e) => e.l === "Cigar City Brewing" && e.d === "2022-01-01");
  const t = [{ b: "Punch", l: "Cigar City Brewing", d: "2021-01-01", u: 1 }];
  r.migration = applyFixups(t) === 1 && t[0].d === "2022-01-01" && t[0].u > 1 && applyFixups(t) === 0;
  r.summary = /^51 smokes and 25 brands since October 2021, averaging 4\.\d\d\.$/.test($("#psum").textContent);
  r.verdictPlain = !!document.querySelector("#verdict .line") && !document.querySelector("#verdict em");
  r.buyAgainEmpty = /Mark "yes" under Again/.test($("#buyagain").textContent);
  r.drawBurnHidden = $("#drawburn").innerHTML === "";
  const now = Date.now();
  data = [0, 1, 2].map((i) => ({ id: "db" + i, u: now, deleted: 0, d: localToday(), b: "Test", l: "DB " + i, r: 4,
    dr: i ? "good" : "tight", bu: "even", ag: "yes", fi: [], t: ["cedar"] })).concat(data);
  renderAll();
  r.buyAgainList = document.querySelectorAll("#buyagain .entry").length === 3;
  r.drawBurnShown = /tight 1, just right 2, loose 0 of 3/.test($("#drawburn").textContent) &&
    /even 3, canoed 0, relit 0 of 3/.test($("#drawburn").textContent);
  r.tagCounted = flavorStats(live()).find((x) => x.F.f === "Wood")?.tags.find((x) => x.t === "cedar")?.n === 3;
  const wood = [...document.querySelectorAll("#flavors button.frow")].find((b) => b.dataset.f === "Wood");
  wood.click();
  r.familyExpands = !!document.querySelector("#flavors .frow.sub") &&
    document.querySelector('#flavors button.frow[data-f="Wood"]').getAttribute("aria-expanded") === "true";
  r.tables = /Nicaragua/.test($("#rk-origin").textContent) && document.querySelectorAll("#rk-origin .k").length > 0;
  r.topRated = document.querySelectorAll("#toprated .entry").length === 6;
  r.noOldCards = !document.querySelector("#palate .card") && !document.querySelector("#statstrip");
  let csv = ""; const orig = window.dl; window.dl = (n, text) => { csv = text; };
  $("#exp-csv").click(); window.dl = orig;
  r.csvColumns = csv.split("\n")[0].endsWith(",Flavors,Draw,Burn,Again") && csv.includes('"cedar","tight","even","yes"');
  return r;
})()
