// Catalog Task 4: private catalog, brand spelling, size row, offline cache.
// Run: npm run test:ui -- cat1   and   --dark
(async () => {
  const r = {};
  for (let i = 0; i < 60 && !CAT.length; i++) await new Promise((s) => setTimeout(s, 50));
  r.noREF = typeof REF === "undefined" && !document.documentElement.outerHTML.includes('const REF = [');
  r.catalogLoaded = CAT.length === 3 && catVersion === "fixture-1";
  r.cached = JSON.parse(localStorage.getItem("ember.catalog") || "{}").version === "fixture-1";
  const inp = $("#f-label");
  const type = (v) => { inp.value = v; inp.dispatchEvent(new Event("input")); };
  const sg = (re) => [...document.querySelectorAll("#sugg .sg")].find((b) => re.test(b.textContent));
  type("prequel");
  const row = sg(/Pledge Prequel/);
  r.catalogRowShowsBrand = !!row && row.querySelector(".sgm").textContent === "E.P. Carrillo";
  row.click();
  r.pickFills = $("#f-label").value === "Pledge Prequel" && $("#f-wrapper").value === "Ecuador Habano" &&
    $("#f-body").value === "Full" && $("#f-origin").value === "Dominican Republic" && $("#f-size").value === "";
  r.canonBrand = $("#f-brand").value === "EP Carrillo";
  r.shapeNotFilled = $("#f-shape").value === "";
  r.sizeRow = !$("#sizes").hidden && document.querySelectorAll("#sizeopts button").length === 2 && $("#moresizes").hidden;
  document.querySelector("#sizeopts button").click();
  r.sizeSets = $("#f-shape").value === "Robusto" && $("#f-size").value === "5½ × 52" &&
    document.querySelector("#sizeopts button").classList.contains("on");
  document.querySelector("#sizeopts button").click();
  r.sizeClears = $("#f-shape").value === "" && $("#f-size").value === "";
  document.querySelector("#sizeopts button").click();
  document.querySelector('.rchip[data-r="4.5"]').click();
  const n0 = data.length; $("#save").click();
  const saved = data[0];
  r.savedSize = data.length === n0 + 1 && saved.sh === "Robusto" && saved.sz === "5½ × 52" && saved.b === "EP Carrillo";
  r.sizeRowHiddenAfterSave = $("#sizes").hidden;
  type("reserva robusto"); sg(/Reserva Robusto Line/).click();
  r.moreSizes = document.querySelectorAll("#sizeopts button").length === 8 && !$("#moresizes").hidden;
  $("#moresizes").click();
  r.allSizes = document.querySelectorAll("#sizeopts button").length === 10 && $("#moresizes").hidden;
  type("something else");
  r.retypeHidesSizes = $("#sizes").hidden && $("#f-size").value === "";
  clearForm();
  openDetail(saved.id); r.detailShowsSize = /Robusto, 5½ × 52/.test($("#sheet").textContent); closeDetail();
  smokeAgain(saved.id);
  r.againCopiesSize = $("#f-shape").value === "Robusto" && $("#f-size").value === "5½ × 52" && $("#sizes").hidden;
  clearForm();
  CAT = []; const realFetch = window.fetch; window.fetch = () => Promise.reject(new Error("offline"));
  loadCatalogCache(); await refreshCatalog(true); window.fetch = realFetch;
  type("prequel"); r.offlineSuggests = !!sg(/Pledge Prequel/); clearForm();
  const realSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); };
  CAT = []; catVersion = null; await refreshCatalog(true); Storage.prototype.setItem = realSet;
  r.quotaSafe = CAT.length === 3;
  // Review fix: an exact blend name only matches a row of the same (or no) brand.
  const mp = [{ b: "Arturo Fuente", l: "Maduro", w: "Broadleaf" }, { b: "La Gloria Cubana", l: "Maduro", w: "Ecuadorian" }, { b: "", l: "Maduro Legacy", w: "Legacy" }];
  r.matchHonorsBrand = findMatch("Maduro", "La Gloria Cubana", mp)?.w === "Ecuadorian" &&
    findMatch("Maduro", "Excalibur", mp.slice(0, 1)) === null && findMatch("Maduro", "", mp)?.w === "Broadleaf";
  // Review fix: a size whose wrapper or body differs from its blend applies them; tapping it off restores the blend's.
  type("reserva robusto"); sg(/Reserva Robusto Line/).click();
  const churchill = [...document.querySelectorAll("#sizeopts button")].find((b) => /Churchill/.test(b.textContent));
  $("#f-binder").value = "Hand";
  churchill.click();
  r.sizeOverridesLeaf = $("#f-wrapper").value === "Connecticut" && $("#f-body").value === "Med" && $("#f-wnote").value === "Maduro" && $("#f-binder").value === "Hand";
  [...document.querySelectorAll("#sizeopts button")].find((b) => /Churchill/.test(b.textContent)).click();
  r.sizeRestoresLeaf = $("#f-wrapper").value === "San Andres" && $("#f-body").value === "Med-Full" && $("#f-shape").value === "";
  clearForm();
  let csv = ""; const realDl = window.dl; window.dl = (n, t) => { csv = t; }; $("#exp-csv").click(); window.dl = realDl;
  r.csvSize = csv.split("\n")[0].endsWith(",Size");
  return r;
})()
