// Task 3 checks: every key must be true. Run: npm run test:ui -- task3
(() => {
  const r = {}, inp = $("#f-label");
  r.opensOnLog = document.querySelector("#log").classList.contains("on");
  r.lowCollapsed = getComputedStyle($("#ratechips-low")).display === "none";
  r.tabOrder = [...document.querySelectorAll(".tabbar button")].map(b=>b.dataset.tab).join() === "log,journal,palate";
  const vals = [3.5,3.75,4,4.25,4.5,4.75,5,2,2.25,2.5,2.75,3,3.25];
  r.chipsRoundTrip = vals.every(v=>{const b=document.querySelector(`.rchip[data-r="${v}"]`);
    if(!b)return false;b.click();const ok=rating===v;b.click();return ok&&rating===null;});
  $("#ratechips-low").hidden = true;
  r.saveAboveFold = (()=>{const s=$("#save").getBoundingClientRect();return s.top>=0 && s.bottom <= document.querySelector(".tabbar").getBoundingClientRect().top + 1;})();
  r.noZoom = [...document.querySelectorAll("#log input:not([type=checkbox]):not([type=date]),#log select,#log textarea")]
    .every(el=>parseFloat(getComputedStyle(el).fontSize)>=16);
  r.dateLabel = /^Today, /.test($("#datelabel").textContent);
  inp.value = "melanio"; inp.dispatchEvent(new Event("input"));
  const first = document.querySelector("#sugg .sg");
  r.historyFirst = !!first && /Melanio/.test(first.textContent) && /Oliva/.test(first.textContent);
  const md = new MouseEvent("mousedown",{bubbles:true,cancelable:true}); first.dispatchEvent(md);
  r.keepsFocus = md.defaultPrevented;
  first.click();
  r.historyFill = $("#f-brand").value==="Oliva" && $("#f-wrapper").value==="San Andres"
    && $("#f-body").value==="Med-Full" && $("#f-filler").value==="Nicaraguan";
  r.summary = $("#c-brand").textContent==="Oliva" && $("#c-wrapper").textContent==="San Andres Maduro";
  inp.value = "Padron 1964"; inp.dispatchEvent(new Event("input"));
  r.retypeClears = $("#f-brand").value==="" && $("#f-wrapper").value==="" && $("#c-brand").textContent==="" && $("#c-wrapper").textContent==="";
  inp.value = "serie g maduro"; inp.dispatchEvent(new Event("input"));
  const cat = [...document.querySelectorAll("#sugg .sg")].find(b=>/catalog/.test(b.textContent));
  cat && cat.click();
  r.catalogSplit = $("#f-brand").value==="Oliva" && $("#f-label").value==="Serie G Maduro";
  clearForm();
  r.againChips = [...document.querySelectorAll(".againchip")].map(b=>b.textContent).slice(0,3).join("|")
    === "Encore|M81|Serie V Melanio Maduro";
  document.querySelector(".againchip").click();
  document.querySelector('.rchip[data-r="4.75"]').click();
  const before = data.length; $("#save").click();
  r.saved = data.length===before+1 && data[0].r===4.75 && data[0].l==="Encore" && data[0].d===localToday();
  r.staysOnLog = document.querySelector("#log").classList.contains("on");
  r.formCleared = $("#f-label").value==="" && rating===null;
  $("#f-date").value = "2020-01-01"; formDay = "2020-01-01";
  document.dispatchEvent(new Event("visibilitychange"));
  r.dayRolls = $("#f-date").value===localToday();
  // review fixes: Enter keeps an exact typed name; a half-filled form keeps its date
  data = [{id:"eb1",u:Date.now(),deleted:0,d:localToday(),b:"EP Carrillo",l:"Encore Black",r:4,fi:[]}, ...data];
  clearForm(); inp.value = "Encore"; inp.dispatchEvent(new Event("input"));
  r.exactFirst = document.querySelector("#sugg .sg span").textContent === "Encore";
  inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
  r.enterExact = inp.value==="Encore";
  clearForm(); inp.value = "Padron 1964"; inp.dispatchEvent(new Event("input"));
  inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
  r.enterKeepsTyped = inp.value==="Padron 1964";
  $("#f-date").value = "2020-01-01"; formDay = "2020-01-01";
  document.dispatchEvent(new Event("visibilitychange"));
  r.halfFilledKeepsDay = $("#f-date").value==="2020-01-01";
  clearForm();
  return r;
})()
