import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proxyFirebaseAuth,firebaseWebConfig} from '../functions/firebase-auth-proxy.js';
const project='karsa-business-80d9d';
test('web authDomain uses the dashboard origin for first-party redirect storage',()=>{
  assert.deepEqual(firebaseWebConfig(new Request('https://dashboard.example/web-config'),project,'public-key'),{apiKey:'public-key',projectId:project,authDomain:'dashboard.example'});
});
test('helper proxy preserves OAuth query/body and excludes browser credentials',async()=>{
  let target='';let sent:RequestInit|undefined;
  const transport=async(input:URL|RequestInfo,init?:RequestInit)=>{target=String(input);sent=init;return new Response('<script nonce="firebase-auth-helper">callback()</script>',{headers:{'Content-Type':'text/html','Content-Encoding':'gzip','Content-Length':'999','Set-Cookie':'upstream=private'}});};
  const response=await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/handler?state=opaque',{method:'POST',headers:{Authorization:'Bearer private-token',Cookie:'private-session=1','Content-Type':'application/x-www-form-urlencoded'},body:'code=opaque-code'}),project,transport as typeof fetch);
  assert.equal(target,`https://${project}.firebaseapp.com/__/auth/handler?state=opaque`);
  assert.equal(sent?.method,'POST');assert.equal(sent?.redirect,'manual');
  const headers=new Headers(sent?.headers);assert.equal(headers.has('Authorization'),false);assert.equal(headers.has('Cookie'),false);
  assert.equal(new TextDecoder().decode(sent?.body as Uint8Array),'code=opaque-code');
  assert.equal(response.headers.get('X-Frame-Options'),'SAMEORIGIN');assert.ok(response.headers.get('Content-Security-Policy')?.includes("'nonce-firebase-auth-helper'"));
  assert.equal(response.headers.has('content-encoding'),false);assert.equal(response.headers.has('set-cookie'),false);
  assert.ok((await response.text()).includes('callback()'));
});
test('proxy cannot be used for arbitrary paths, projects or HTTP methods',async()=>{
  let calls=0;const transport=async()=>{calls++;return new Response('ok');};
  assert.equal((await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/arbitrary'),project,transport as typeof fetch)).status,404);
  assert.equal((await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/handler'),'evil.example/path',transport as typeof fetch)).status,503);
  assert.equal((await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/handler',{method:'DELETE'}),project,transport as typeof fetch)).status,405);
  assert.equal((await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/handler',{method:'POST',body:'x'.repeat(131073)}),project,transport as typeof fetch)).status,413);
  assert.equal(calls,0);
});
test('helper redirects stay on the dashboard while provider redirects are retained',async()=>{
  const local=await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/handler'),project,(async()=>new Response(null,{status:302,headers:{Location:`https://${project}.firebaseapp.com/__/auth/iframe?event=1`}})) as typeof fetch);
  assert.equal(local.headers.get('Location'),'https://dashboard.example/__/auth/iframe?event=1');
  const google=await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/handler'),project,(async()=>new Response(null,{status:302,headers:{Location:'https://accounts.google.com/'}})) as typeof fetch);
  assert.equal(google.headers.get('Location'),'https://accounts.google.com/');
});
test('upstream failures return a recoverable response without credentials',async()=>{
 const response=await proxyFirebaseAuth(new Request('https://dashboard.example/__/auth/iframe'),project,(async()=>{throw new Error('private upstream detail');}) as typeof fetch);
 assert.equal(response.status,503);assert.equal((await response.text()).includes('private'),false);
});
test('Vercel serves same-origin Firebase initialization without relying on Hosting configuration',async()=>{
 const previous={DATABASE_URL:process.env.DATABASE_URL,FIREBASE_PROJECT_ID:process.env.FIREBASE_PROJECT_ID,FIREBASE_WEB_API_KEY:process.env.FIREBASE_WEB_API_KEY};
 try{
  process.env.DATABASE_URL='postgres://unused:unused@127.0.0.1:1/unused';process.env.FIREBASE_PROJECT_ID=project;process.env.FIREBASE_WEB_API_KEY='public-key';
  const {default:entry}=await import('../api/index.js');
  const response=await entry.fetch(new Request('https://dashboard.example/api/index?route=/__/firebase/init.json'));
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await response.json(),{apiKey:'public-key',projectId:project,authDomain:'dashboard.example'});
  assert.equal((await entry.fetch(new Request('https://dashboard.example/__/firebase/init.json',{method:'POST'}))).status,405);
  delete process.env.FIREBASE_WEB_API_KEY;
  assert.equal((await entry.fetch(new Request('https://dashboard.example/__/firebase/init.json'))).status,503);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
