import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';
const dbfile='./v1031_diag.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error+'\n'+(j.trace||'')));});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}
globalThis.fetch=async()=>Response.json({ok:true,result:true});
const mod=await import(new URL('../SuperAgent_V10_3_Reliability_Lock.js?diag='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),SETUP_KEY:'SECRET_SETUP',TELEGRAM_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',TELEGRAM_WEBHOOK_SECRET:'hooksecret',OMNIAI_SERVICE:{fetch:async()=>Response.json({})}};
let pass=0,fail=0;const errors=[];const ok=(n,c,d='')=>{if(c)pass++;else{fail++;errors.push({n,d})}};
async function get(path){return worker.fetch(new Request('https://x.test'+path),env,{waitUntil(){}})}
try{
 await get('/health');
 const now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO runtime_failures(incident_id,chat_id,scope,error_text,context_json,created_at) VALUES (?,?,?,?,?,?)`).bind('SA-TEST-ABCDE','77','telegram_update','Bearer SUPERSECRET123456 and 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',JSON.stringify({update_id:'9',url:'https://x.test/?key=SECRET_SETUP'}),now).run();
 let r=await get('/diagnostics');ok('unauthorized status',r.status===401,String(r.status));
 r=await get('/diagnostics?key=WRONG');ok('wrong key status',r.status===401,String(r.status));
 r=await get('/diagnostics?key=SECRET_SETUP&incident=SA-TEST-ABCDE');const j=await r.json();
 ok('authorized',r.status===200&&j.ok===true,JSON.stringify(j));
 ok('one incident',j.count===1&&j.incidents?.[0]?.incident_id==='SA-TEST-ABCDE',JSON.stringify(j));
 const raw=JSON.stringify(j);ok('bearer redacted',!raw.includes('SUPERSECRET123456'),raw);ok('telegram token redacted',!raw.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi'),raw);ok('setup key redacted',!raw.includes('SECRET_SETUP'),raw);
 ok('scope preserved',j.incidents?.[0]?.scope==='telegram_update',JSON.stringify(j));
 r=await get('/diagnostics?key=SECRET_SETUP&limit=1');const all=await r.json();ok('latest list',all.ok&&all.count===1,JSON.stringify(all));
}catch(e){fail++;errors.push({n:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
