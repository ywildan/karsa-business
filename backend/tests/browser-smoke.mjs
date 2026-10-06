/** Run against preview-server.ts and an existing Chrome; never contacts production. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const target=await (await fetch('http://127.0.0.1:9337/json/new?about:blank',{method:'PUT'})).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);});
function call(method,params={}){return new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});ws.send(JSON.stringify({id:current,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function waitFor(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`);}
async function screenshot(path){const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path,Buffer.from(result.data,'base64'));}
async function click(expression){await evaluate(`${expression}.click()`);}
try{
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:4178/'});await waitFor('document.getElementById("google-login") && !document.getElementById("google-login").disabled');
 await screenshot('build/verification/dashboard-login.png');
 await click('document.getElementById("google-login")');await waitFor('!document.getElementById("dashboard").hidden');
 assert.equal(await evaluate('document.querySelectorAll(".business-card").length'),2);
 await evaluate('document.getElementById("business-select").selectedIndex=1;document.getElementById("business-select").dispatchEvent(new Event("change"))');
 assert.ok((await evaluate('document.getElementById("page-content").innerText')).includes('Rp 95.000'));
 await screenshot('docs/dashboard-premium.png');
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
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screenshot('build/verification/dashboard-mobile.png');assert.ok(await evaluate('document.documentElement.scrollWidth<=390'));
 await evaluate('fetch("/test-expire")');await click('document.getElementById("refresh")');await waitFor('!document.getElementById("gate").hidden');assert.equal(await evaluate('document.getElementById("page-content").children.length'),0);
 await click('document.getElementById("gate-logout")');await evaluate('document.getElementById("login-form").elements.email.value="qa-free@students.untidar.ac.id";document.getElementById("login-form").elements.password.value="testing123";document.getElementById("login-form").requestSubmit()');await waitFor('!document.getElementById("gate").hidden');
 assert.equal(await evaluate('document.getElementById("dashboard").hidden'),true);assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('Browser smoke passed: login, business isolation, product CRUD, linked sale, stock refund, business creation, analytics, mobile layout, Premium expiry, free-account gate.');
}finally{ws.close();}
