import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';
const dbfile='./v1034_natural_v2.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error))});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}
const telegram=[];globalThis.fetch=async(url,opts={})=>{const u=String(url);if(u.includes('api.telegram.org/bot')){const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{};telegram.push({method,body});if(method==='sendMessage')return Response.json({ok:true,result:{message_id:telegram.length,chat:{id:body.chat_id},text:body.text}});return Response.json({ok:true,result:true})}if(u.includes('api.aladhan.com'))return Response.json({code:200,data:{timings:{Fajr:'04:30',Dhuhr:'12:00',Asr:'15:30',Maghrib:'18:30',Isha:'20:00'}}});throw new Error('Unexpected '+u)};
const mod=await import(new URL('../SuperAgent_V10_3_4_Atomic_Direct.js?x='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'T',TELEGRAM_WEBHOOK_SECRET:'S',OMNIAI_API_KEY:'K',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async()=>{throw new Error('AI_SHOULD_NOT_BE_CALLED')}}};
let pass=0,fail=0;const errors=[];const ok=(n,c,d='')=>{if(c)pass++;else{fail++;errors.push({n,d})}};
async function wh(id,text){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://x/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'S','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:77,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits)}
const items=async()=>((await env.DB.prepare(`SELECT title,status FROM smart_list_items WHERE chat_id='77' ORDER BY id`).all())?.results||[]);
try{
 await wh(1,'/start');
 const forms=[['فكرني اشتري بيض','بيض'],['نبهنى اجيب لبن','لبن'],['عاوز اشتري خيار','خيار'],['محتاج اجيب جبنة','جبنة'],['عاوز اشترى لبن وزبادي','زبادي']];let id=2;
 for(const [text,item] of forms){await wh(id++,text);const r=await items();ok(text,r.some(x=>x.title===item),JSON.stringify(r))}
 const fake=await env.DB.prepare(`SELECT COUNT(*) c FROM reminders WHERE chat_id='77'`).first();ok('no fake reminders from shopping',Number(fake?.c||0)===0,JSON.stringify(fake));
 await wh(id++,'احذف اللبن من المشتريات');let r=await items();ok('delete item',!r.some(x=>x.title==='لبن'),JSON.stringify(r));
 await wh(id++,'/undo');r=await items();ok('undo item',r.some(x=>x.title==='لبن'),JSON.stringify(r));
 const before=r.length;await wh(id++,'احذف قائمة المشتريات');const c1=await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id='77'`).first();ok('delete list',Number(c1?.c||0)===0,JSON.stringify(c1));
 await wh(id++,'/undo');r=await items();ok('undo list',r.length===before,JSON.stringify(r));
 const failuresBefore=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='77'`).first())?.c||0);
 await wh(id++,'فكرني بكرة الساعة 5 مساء اجيب الدوا');
 const shopDrug=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id='77' AND normalized_title LIKE '%دوا%'`).first())?.c||0);
 const timed=await env.DB.prepare(`SELECT title,local_time FROM reminders WHERE chat_id='77' ORDER BY id DESC LIMIT 1`).first();
 const failuresAfter=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='77'`).first())?.c||0);
 ok('explicit timed purchase stays reminder not shopping',shopDrug===0&&!!timed&&timed.local_time==='17:00'&&String(timed.title||'').includes('الدوا'),JSON.stringify({shopDrug,timed}));
 ok('explicit timed purchase bypasses AI',failuresAfter===failuresBefore,JSON.stringify({failuresBefore,failuresAfter}));
}catch(e){fail++;errors.push({n:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
