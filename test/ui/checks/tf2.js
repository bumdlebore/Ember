// Tasting form Task 2: log form cells, score circle, option rows, pinned Save bar.
// Run: npm run test:ui -- tf2   and   npm run test:ui -- tf2 --dark
(() => {
  const r = {};
  r.headerNo = $("#hdcount").textContent === "No. " + (live().length + 1);
  r.ringOnChip = !!document.querySelector('.rchip[data-r="4.75"] .ring');
  const c425 = document.querySelector('.rchip[data-r="4.25"]'); c425.click();
  r.chipPressed = c425.getAttribute("aria-pressed") === "true" && rating === 4.25; c425.click();
  const q = (k, v) => document.querySelector(`#optrows button[data-k="${k}"][data-v="${v}"]`);
  q("dr", "tight").click(); r.optSet = opt.dr === "tight" && q("dr", "tight").classList.contains("on");
  q("dr", "tight").click(); r.optClears = opt.dr === "";
  q("dr", "good").click(); q("bu", "canoe").click(); q("ag", "yes").click();
  document.querySelector(".againchip").click(); document.querySelector('.rchip[data-r="4.5"]').click();
  r.cellsShowPick = $("#c-brand").textContent.length > 0;
  const n0 = data.length; $("#save").click();
  r.optsSaved = data.length === n0 + 1 && data[0].dr === "good" && data[0].bu === "canoe" && data[0].ag === "yes";
  r.optsResetAfterSave = !opt.dr && !opt.bu && !opt.ag && !document.querySelector("#optrows button.on");
  startEdit(data[0].id);
  r.optsLoadOnEdit = opt.dr === "good" && opt.bu === "canoe" && opt.ag === "yes" && $("#save").textContent === "Save changes";
  $("#cancel").click();
  r.saveLabel = $("#save").textContent === "Save to log";
  smokeAgain(data[0].id);
  r.againClearsOpts = !opt.dr && !opt.bu && !opt.ag && $("#f-label").value !== "";
  clearForm();
  const bar = () => document.querySelector(".tabbar").getBoundingClientRect();
  const inView = () => { const s = $("#save").getBoundingClientRect(); return s.top >= 0 && s.bottom <= bar().top + 1; };
  window.scrollTo(0, 0); r.saveInViewTop = inView();
  $("#details").open = true; window.scrollTo(0, document.documentElement.scrollHeight);
  r.saveInViewBottom = inView();
  r.lastFieldClear = $("#f-filler").getBoundingClientRect().bottom <= $("#savebar").getBoundingClientRect().top;
  $("#details").open = false; window.scrollTo(0, 0);
  switchTab("journal"); r.saveBarHiddenOffLog = $("#savebar").hidden; switchTab("log");
  r.saveBarShownOnLog = !$("#savebar").hidden;
  return r;
})()
