/** Run against preview-server.ts and an existing Chrome; never contacts production. */
import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile,readdir} from 'node:fs/promises';
const target=await (await fetch('http://127.0.0.1:9337/json/new?about:blank',{method:'PUT'})).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);});
function call(method,params={}){return new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});ws.send(JSON.stringify({id:current,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function waitFor(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`);}
async function screenshot(path,full=false){const layout=full?await call('Page.getLayoutMetrics'):null;const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,...(full?{clip:{x:0,y:0,width:layout.cssContentSize.width,height:layout.cssContentSize.height,scale:1}}:{})});await writeFile(path,Buffer.from(result.data,'base64'));}
async function click(expression){await evaluate(`${expression}.click()`);}
try{
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:4178/'});await waitFor('document.getElementById("google-login") && !document.getElementById("google-login").disabled');
 await screenshot('build/verification/dashboard-login.png');
 const initialTargets=(await (await fetch('http://127.0.0.1:9337/json/list')).json()).filter(t=>t.type==='page').length;
 await click('document.getElementById("google-login")');await waitFor('location.pathname === "/test-google"');
 assert.equal((await (await fetch('http://127.0.0.1:9337/json/list')).json()).filter(t=>t.type==='page').length,initialTargets);
 await click('document.getElementById("continue-google")');await waitFor('document.getElementById("dashboard") && !document.getElementById("dashboard").hidden');
 assert.equal(await evaluate('document.querySelectorAll(".business-card").length'),2);
 await evaluate('document.getElementById("business-select").selectedIndex=1;document.getElementById("business-select").dispatchEvent(new Event("change"))');
 assert.ok((await evaluate('document.getElementById("page-content").innerText')).includes('Rp 95.000'));
 await screenshot('build/verification/monthly-overview.png');
 await click('document.querySelector(".report-hero .report-link")');
 assert.equal(await evaluate('document.getElementById("page-title").textContent'),'Laporan bulanan');
 assert.ok((await evaluate('document.querySelector(".report-hero").innerText')).includes('Laba turun Rp 10.000'));
 assert.ok((await evaluate('document.querySelector(".driver-grid").innerText')).includes('Bahan baku'));
 assert.ok((await evaluate('document.querySelector(".driver-grid").innerText')).includes('Turun Rp 5.000'));
 const selectedMonth=await evaluate('document.getElementById("month").value');
 const downloadPath=`${process.cwd()}/build/verification/monthly-downloads-${Date.now()}`;
 await mkdir(downloadPath,{recursive:true});await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});
 await click('document.querySelector(".report-actions .report-link")');
 let files=[];for(let i=0;i<80;i++){files=await readdir(downloadPath);if(files.some(f=>f.endsWith('.csv')))break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(files.includes(`Karsa-Laporan-Bulanan-${selectedMonth}.csv`));
 const exported=await readFile(`${downloadPath}/Karsa-Laporan-Bulanan-${selectedMonth}.csv`,'utf8');
 assert.ok(exported.includes('Kopi Sore'));assert.ok(exported.includes('Periode pembanding'));assert.ok(!exported.includes('Studio Kecil'));
 const reportText=await evaluate('document.querySelector(".monthly-report").innerText');
 await call('Emulation.setEmulatedMedia',{media:'print'});
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".report-actions")).display'),'none');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar")).display'),'none');
 const pdf=await call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});
 await writeFile('build/verification/monthly-report.pdf',Buffer.from(pdf.data,'base64'));
 assert.ok(Buffer.from(pdf.data,'base64').subarray(0,5).toString().startsWith('%PDF-'));
 await call('Emulation.setEmulatedMedia',{media:''});
 await screenshot('build/verification/monthly-report-desktop.png');await screenshot('build/verification/monthly-report-full.png',true);
 await evaluate('document.getElementById("business-select").selectedIndex=0;document.getElementById("business-select").dispatchEvent(new Event("change"))');
 assert.ok((await evaluate('document.querySelector(".monthly-report").innerText')).includes('Kopi Sore'));
 assert.ok((await evaluate('document.querySelector(".monthly-report").innerText')).includes('Studio Kecil'));
 assert.ok((await evaluate('document.querySelector(".monthly-report").innerText')).includes('Rp 335.000'));
 await evaluate('document.getElementById("business-select").selectedIndex=1;document.getElementById("business-select").dispatchEvent(new Event("change"))');
 const previousMonth=await evaluate('(()=>{const [y,m]=document.getElementById("month").value.split("-").map(Number);const d=new Date(y,m-2,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;})()');
 await evaluate(`document.getElementById("month").value=${JSON.stringify(previousMonth)};document.getElementById("month").dispatchEvent(new Event("change"))`);
 assert.ok((await evaluate('document.querySelector(".monthly-report").innerText')).includes('Rp 110.000'));
 await evaluate('document.getElementById("month").value="2099-01";document.getElementById("month").dispatchEvent(new Event("change"))');
 assert.ok((await evaluate('document.querySelector(".report-hero").innerText')).includes('Periode belum dimulai'));
 assert.ok(!(await evaluate('document.querySelector(".report-hero").innerText')).includes('Laba turun'));
 await evaluate(`document.getElementById("month").value=${JSON.stringify(selectedMonth)};document.getElementById("month").dispatchEvent(new Event("change"))`);
 assert.equal(await evaluate('document.querySelector(".monthly-report").innerText'),reportText);
 await evaluate('[...document.querySelectorAll(".driver-item button")].find(e=>e.textContent.includes("Bahan baku")).click()');
 assert.ok((await evaluate('document.querySelector(".category-filter").innerText')).includes('Bahan baku'));
 assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),1);
 assert.ok((await evaluate('document.querySelector("tbody").innerText')).includes('Rp 75.000'));
 await click('document.querySelector(".category-filter button:last-child")');
 assert.equal(await evaluate('document.getElementById("page-title").textContent'),'Laporan bulanan');
 await click('document.querySelector("[data-tab=products]")');await click('document.querySelector(".table-toolbar .primary")');
 await evaluate('document.getElementById("editor-form").elements.name.value="Produk uji browser";document.getElementById("editor-form").elements.price.value="1000";document.getElementById("editor-form").elements.stock.value="10";document.getElementById("editor-form").requestSubmit()');
 await waitFor('!document.getElementById("editor").open');assert.ok((await evaluate('document.getElementById("page-content").innerText')).includes('Produk uji browser'));
 await click('document.querySelector("[data-tab=transactions]")');await click('document.querySelector(".table-toolbar .primary")');
 await evaluate('const f=document.getElementById("editor-form");f.elements.productId.selectedIndex=1;f.elements.productId.dispatchEvent(new Event("change"));f.elements.quantity.value="2";f.elements.quantity.dispatchEvent(new Event("input"));f.requestSubmit()');
 await waitFor('!document.getElementById("editor").open');
 await click('document.querySelector("[data-tab=products]")');assert.equal(await evaluate('document.querySelector("tbody tr").children[3].firstChild.textContent'),'8');
 await click('document.querySelector("tbody tr .row-actions button")');await evaluate('document.getElementById("editor-form").elements.name.value="Produk diperbarui";document.getElementById("editor-form").requestSubmit()');await waitFor('!document.getElementById("editor").open');
 assert.ok((await evaluate('document.getElementById("page-content").innerText')).includes('Produk diperbarui'));
 await click('document.querySelector("[data-tab=transactions]")');await evaluate('[...document.querySelectorAll("tbody tr")].find(r=>r.innerText.includes("Rp 2.000")).querySelectorAll(".row-actions button")[1].click()');
 await click('document.getElementById("save-editor")');await waitFor('!document.getElementById("editor").open');
 await click('document.querySelector("[data-tab=products]")');assert.equal(await evaluate('document.querySelector("tbody tr").children[3].firstChild.textContent'),'10');
 await click('document.querySelector("tbody tr .row-actions button:last-child")');await click('document.getElementById("save-editor")');await waitFor('!document.getElementById("editor").open');assert.ok((await evaluate('document.getElementById("page-content").innerText')).includes('Produk pertama'));
 await click('document.getElementById("new-business")');await evaluate('document.getElementById("editor-form").elements.name.value="Bisnis ketiga";document.getElementById("editor-form").requestSubmit()');await waitFor('!document.getElementById("editor").open');
 assert.equal(await evaluate('document.getElementById("business-select").options.length'),4);
 await click('document.querySelector("[data-tab=analytics]")');assert.equal(await evaluate('document.querySelectorAll("svg.chart").length'),1);
 await evaluate('document.getElementById("business-select").selectedIndex=1;document.getElementById("business-select").dispatchEvent(new Event("change"));document.getElementById("notice").hidden=true');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screenshot('build/verification/monthly-report-mobile.png');assert.ok(await evaluate('document.documentElement.scrollWidth<=390'));
 await evaluate('fetch("/test-delay-next")');await click('document.getElementById("refresh")');
 await click('document.getElementById("logout")');await waitFor('!document.getElementById("login").hidden');
 await new Promise(r=>setTimeout(r,900));assert.equal(await evaluate('document.getElementById("login").hidden'),false);
 await click('document.getElementById("google-login")');await waitFor('location.pathname === "/test-google"');
 await click('document.getElementById("continue-google")');await waitFor('document.getElementById("dashboard") && !document.getElementById("dashboard").hidden');
 await evaluate('fetch("/test-expire")');await click('document.getElementById("refresh")');await waitFor('!document.getElementById("gate").hidden');assert.equal(await evaluate('document.getElementById("page-content").children.length'),0);
 await click('document.getElementById("gate-logout")');await evaluate('document.getElementById("login-form").elements.email.value="qa-free@students.untidar.ac.id";document.getElementById("login-form").elements.password.value="testing123";document.getElementById("login-form").requestSubmit()');await waitFor('!document.getElementById("gate").hidden');
 assert.equal(await evaluate('document.getElementById("dashboard").hidden'),true);assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('Browser smoke passed: full-page Google redirect and callback without extra windows, login, business isolation, product CRUD, linked sale, stock refund, business creation, monthly comparisons, category attribution, scoped CSV download, PDF printing, period changes, future periods, mobile layout, late response after logout, Premium expiry, free-account gate.');
}finally{ws.close();}
