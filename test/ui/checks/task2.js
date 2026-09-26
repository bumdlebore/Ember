// Task 2 checks: every key must be true. Run: npm run test:ui -- task2
(() => {
  const r = {};
  r.today2030 = localToday(new Date(2026,8,25,20,30)) === "2026-09-25";
  r.today2359 = localToday(new Date(2026,8,25,23,59)) === "2026-09-25";
  r.dateField = document.querySelector("#f-date").value === localToday();
  r.esc = esc(`<b>"&'`) === "&lt;b&gt;&quot;&amp;&#39;";
  const line = document.querySelector("#verdict .line").textContent;
  r.headlineNicaragua = /Nicaragua/.test(line);
  r.headlineSanAndres = /San Andres/.test(line);
  r.noHonduras = !/Honduras/.test(line);
  data = [{id:"x1",u:1,deleted:0,d:"2026-09-01",b:"<i>Evil</i>",
    l:"<img src=x onerror=window.__xss=1>",r:4,n:"a < b & c",fi:[]}, ...data];
  renderAll();
  const nm = document.querySelector('#list .entry[data-id="x1"] .nm');
  r.escapedRow = !window.__xss && !!nm && nm.textContent.includes("<img");
  return r;
})()
