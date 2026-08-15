import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';

const dbfile='./v1034_natural.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];
rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error+'\n'+(j.trace||'')));});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}

const telegram=[];
globalThis.fetch=async (url,opts={})=>{
 const u=String(url);
 if(u.includes('api.telegram.org/bot')){const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{};telegram.push({method,body});if(method==='sendMessage')return Response.json({ok:true,result:{message_id:telegram.length,chat:{id:body.chat_id},text:body.text}});return Response.json({ok:true,result:true});}
 if(u.includes('api.aladhan.com'))return Response.json({code:200,data:{timings:{Fajr:'04:30',Dhuhr:'12:00',Asr:'15:30',Maghrib:'18:30',Isha:'20:00'}}});
 throw new Error('Unexpected network '+u);
};

const mod=await import(new URL('../SuperAgent_V10_3_4_Atomic_Direct.js?x='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'TOKEN',TELEGRAM_WEBHOOK_SECRET:'SECRET',OMNIAI_API_KEY:'KEY',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async()=>{throw new Error('AI_SHOULD_NOT_BE_CALLED')}}};
let pass=0,fail=0;const errors=[];const ok=(name,c,d='')=>{if(c)pass++;else{fail++;errors.push({name,d})}};
async function webhook(id,text){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://x.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'SECRET','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:77,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits);}
const rows=async()=>((await env.DB.prepare(`SELECT title,status FROM smart_list_items WHERE chat_id='77' ORDER BY id`).all())?.results||[]);
const sent=()=>telegram.filter(x=>x.method==='sendMessage').map(x=>String(x.body.text||''));
try{
 await webhook(2000,'/start');
 const forms=[
   ['فكرني اشتري بيض','بيض'],
   ['نبهنى اجيب لبن','لبن'],
   ['عاوز اشتري خيار','خيار'],
   ['محتاج اجيب جبنة','جبنة'],
   ['هاتلي مناديل','مناديل'],
   ['نفسي اشتري زبادي','زبادي']
 ];
 let id=2001;
 for(const [text,item] of forms){await webhook(id++,text);const r=await rows();ok(`natural shopping: ${text}`,r.some(x=>x.title===item&&x.status==='pending'),JSON.stringify(r));}
 const scheduleCount=await env.DB.prepare(`SELECT COUNT(*) c FROM reminders WHERE chat_id='77'`).first();
 ok('natural shopping makes no fake timed reminder',Number(scheduleCount?.c||0)===0,JSON.stringify(scheduleCount));
 const aiFails=await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='77' AND error_text LIKE '%AI_SHOULD_NOT_BE_CALLED%'`).first();
 ok('natural shopping bypasses AI',Number(aiFails?.c||0)===0,JSON.stringify(aiFails));

 await webhook(id++,'احذف اللبن من المشتريات');
 let r=await rows();ok('delete one shopping item',!r.some(x=>x.title==='لبن')&&r.some(x=>x.title==='بيض'),JSON.stringify(r));
 await webhook(id++,'/undo');
 r=await rows();ok('undo restores deleted item',r.some(x=>x.title==='لبن'),JSON.stringify(r));

 const beforeDelete=r.length;await webhook(id++,'احذف قائمة المشتريات');
 const listCount=await env.DB.prepare(`SELECT COUNT(*) c FROM smart_lists WHERE chat_id='77' AND list_type='shopping'`).first();
 const itemCount=await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id='77'`).first();
 ok('delete whole shopping list',Number(listCount?.c||0)===0&&Number(itemCount?.c||0)===0,JSON.stringify({listCount,itemCount}));
 await webhook(id++,'/undo');
 r=await rows();const restoredList=await env.DB.prepare(`SELECT COUNT(*) c FROM smart_lists WHERE chat_id='77' AND list_type='shopping'`).first();
 ok('undo restores whole shopping list',Number(restoredList?.c||0)===1&&r.length===beforeDelete,JSON.stringify({r,restoredList}));

 // A real clock should remain a timed reminder, not shopping intent.
 // We only assert that natural-shopping direct parser does not swallow it: AI is expected and failure is recorded.
 await webhook(id++,'فكرني الساعة 5 اجيب الدوا');
 const clockAiFail=await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='77' AND error_text LIKE '%AI_SHOULD_NOT_BE_CALLED%'`).first();
 ok('explicit clock is not swallowed as shopping',Number(clockAiFail?.c||0)>=1,JSON.stringify(clockAiFail));
}catch(e){fail++;errors.push({name:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));
py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
