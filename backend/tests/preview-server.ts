/** Disposable browser-test fixture. Not imported or exposed by the production API. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createApi} from '../functions/api-app.js';
import {applyMigrations} from '../scripts/migrate.js';
if(!process.env.TEST_DATABASE_URL)throw new Error('Disposable TEST_DATABASE_URL required');
const schema=`browser_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
await applyMigrations(pool);
const app=createApi(pool,async uid=>({uid,email:`${uid}@students.untidar.ac.id`,name:uid}));
const req=async(path:string,method='GET',body?:unknown)=>{const response=await app.request(path,{method,headers:{Authorization:'Bearer qa-premium','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw new Error(await response.text());return response.json();};
await req('/v2/account');await pool.query("UPDATE app_users SET premium_until=now()+interval '30 days' WHERE firebase_uid='qa-premium'");
const first=(await req('/v2/businesses','POST',{name:'Kopi Sore',type:'Minuman',initialCapital:250000})).business;
const second=(await req('/v2/businesses','POST',{name:'Studio Kecil',type:'Jasa',initialCapital:100000})).business;
const now=new Date();
for(const [b,income,expense]of [[first,95000,75000],[second,240000,90000]] as const){
 const rows=Array.from({length:6},(_,i)=>['INCOME','EXPENSE'].map(type=>{const date=new Date(now.getFullYear(),now.getMonth()-i,6).getTime();return{id:randomUUID(),businessId:b.id,type,amount:type==='INCOME'?income+(i*15000):expense+(i*5000),category:type==='INCOME'?'Penjualan':'Bahan baku',paymentMethod:'Tunai',note:i===0?'Catatan dari aplikasi HP':'',transactionDate:date,createdAt:date,updatedAt:date,deletedAt:null,productId:null,quantity:null};})).flat();
 await req('/v2/sync','POST',{business:b,products:[],transactions:rows});
}
const firebaseStub=`export const browserSessionPersistence={};let listener;let user=null;const auth={get currentUser(){return user;}};export const getAuth=()=>auth;export const setPersistence=async()=>{};export const onAuthStateChanged=(a,fn)=>{listener=fn;fn(user);};async function login(email='qa-premium@students.untidar.ac.id'){user={uid:email.split('@')[0],email,emailVerified:true,displayName:'Wildan',getIdToken:async()=>email.split('@')[0]};await listener(user);return{user};}export const signInWithPopup=()=>{throw new Error('Popup login must not be used');};export const signInWithRedirect=async()=>{sessionStorage.setItem('test-google-pending','1');location.assign('/test-google');return new Promise(()=>{});};export const getRedirectResult=async()=>{if(sessionStorage.getItem('test-google-pending')&&new URLSearchParams(location.search).has('redirect-return')){sessionStorage.removeItem('test-google-pending');return login();}return null;};export const signInWithEmailAndPassword=(a,email)=>login(email);export class GoogleAuthProvider{};export const signOut=async()=>{user=null;await listener(null);};export const sendPasswordResetEmail=async()=>{};`;
const security=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8')).headers.flatMap((entry: {headers: {key:string,value:string}[]})=>entry.headers) as {key:string,value:string}[];
let delayNext = false;
const server=createServer(async(request,response)=>{try{
 for(const {key,value} of security)response.setHeader(key,value);
 const pathname=new URL(request.url||'/', 'http://127.0.0.1').pathname;
 if(pathname==='/test-google'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><title>Google test fixture</title></head><body><a id="continue-google" href="/?redirect-return=1">Continue test login</a></body></html>');return;}
 if(pathname==='/web-config'){response.setHeader('Content-Type','application/json');response.end('{}');return;}
 if(pathname==='/test-firebase-app.mjs'||pathname==='/test-firebase-auth.mjs'){response.setHeader('Content-Type','text/javascript');response.end(pathname.endsWith('app.mjs')?'export const initializeApp=config=>config;':firebaseStub);return;}
 if(pathname==='/test-delay-next'){delayNext=true;response.end('ok');return;}
 if(pathname==='/test-expire'){await pool.query("UPDATE app_users SET premium_until=now()-interval '1 second' WHERE firebase_uid='qa-premium'");response.end('ok');return;}
 if(pathname.startsWith('/v1/')||pathname.startsWith('/v2/')){if(delayNext){delayNext=false;await new Promise(r=>setTimeout(r,700));}const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(chunk);const body=Buffer.concat(chunks);const headers=new Headers();for(const[k,v]of Object.entries(request.headers)){if(v)headers.set(k,Array.isArray(v)?v.join(','):v);}const result=await app.fetch(new Request(`http://127.0.0.1:4178${request.url}`,{method:request.method,headers,...(body.length?{body}: {})}));response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));return;}
 const files:Record<string,string>={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/analytics.mjs':'analytics.mjs'};
 if(!files[pathname]){response.writeHead(404);response.end();return;}
 let source=await readFile(new URL(`../public/${files[pathname]}`,import.meta.url),'utf8');
 if(pathname==='/app.js')source=source.replaceAll('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js','/test-firebase-app.mjs').replaceAll('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js','/test-firebase-auth.mjs');
 response.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')||pathname.endsWith('.mjs')?'text/javascript':'text/html');response.end(source);
 }catch(error){console.error(error);response.writeHead(500);response.end('Test fixture failed');}});
server.listen(4178,'127.0.0.1',()=>console.log('Browser fixture ready on 4178'));
async function cleanup(){server.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();process.exit(0);}
process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);
