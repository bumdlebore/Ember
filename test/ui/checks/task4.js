// Task 4 checks: every key must be true. Run: npm run test:ui -- task4
(() => {
  const r = {}, now = Date.now();
  data = [
    {id:"u-new",u:now-5000,deleted:0,d:localToday(new Date(now-3*864e5)),b:"EP Carrillo",l:"Encore Black",r:null,s:0,fi:[],n:""},
    {id:"u-old",u:now-5000,deleted:0,d:localToday(new Date(now-30*864e5)),b:"CAO",l:"Old One",r:null,s:0,fi:[],n:""},
    ...data];
  save(); renderAll();
  const strip = [...document.querySelectorAll("#unrated button")];
  r.stripRecentOnly = strip.length===1 && /Encore Black/.test(strip[0].textContent);
  r.seedUnratedHidden = !/Hemingway/.test($("#unrated").textContent);
  strip[0].click();
  r.editMode = editingId==="u-new" && $("#save").textContent==="Save changes" && !$("#cancel").hidden
    && /Editing Encore Black/.test($("#edithd").textContent) && $("#unrated").children.length===0;
  document.querySelector('.rchip[data-r="4.25"]').click(); $("#f-notes").value = "Edited note";
  const n0 = data.length; $("#save").click();
  const e = data.find(x=>x.id==="u-new");
  r.editKeepsId = data.length===n0 && e.r===4.25 && e.n==="Edited note" && e.u>now-5000;
  r.exitEdit = editingId===null && $("#save").textContent==="Save" && $("#cancel").hidden;
  r.stripEmptied = $("#unrated").children.length===0;
  openDetail("u-new"); document.querySelector("#againbtn").click();
  r.againPrefill = $("#f-label").value==="Encore Black" && $("#f-brand").value==="EP Carrillo"
    && rating===null && $("#f-notes").value==="" && editingId===null && !$("#scrim").classList.contains("on");
  const n1 = data.length; $("#save").click();
  r.againNewId = data.length===n1+1 && data[0].id!=="u-new" && data[0].d===localToday();
  openDetail("u-new"); document.querySelector("#editbtn").click();
  r.editFromSheet = editingId==="u-new" && $("#details").open && $("#f-date").value===e.d && rating===4.25;
  $("#cancel").click();
  r.cancelResets = editingId===null && $("#f-label").value==="" && rating===null;
  return r;
})()
