import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';

const dbfile='./v103_hard.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];
rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error+'\n'+(j.trace||'')));});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}

const telegram=[];
globalThis.fetch=async (url,opts={})=>{
 const u=String(url);
 if(u.includes('api.telegram.org/bot')){
   const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{}
   telegram.push({method,body});
   if(method==='sendMessage')return Response.json({ok:true,result:{message_id:telegram.length,chat:{id:body.chat_id},text:body.text}});
   if(method==='sendChatAction'||method==='answerCallbackQuery'||method==='editMessageText')return Response.json({ok:true,result:true});
   return Response.json({ok:true,result:true});
 }
 throw new Error('Unexpected network '+u);
};

const hard='مرام عندها الدكتور بكرة الساعة 5 ومدته ساعة، فكرني قبلها بنص ساعة آخد التحاليل، وبعد ما نخلص بساعة فكرني أجيب الدوا، وضيف لبن ومناديل للمشتريات';
const modelIntent={
 action:'create',needs_clarification:false,question:'',reply:'',needs_live_data:false,
 items:[
  {title:'دكتور مرام',kind:'appointment',date:'2026-08-16',time:'17:00',duration_minutes:60,advance_alerts:[]},
  {title:'آخد التحاليل',kind:'reminder',date:'2026-08-16',time:'16:30',duration_minutes:0,advance_alerts:[]},
  {title:'أجيب الدوا',kind:'reminder',date:'2026-08-16',time:'19:00',duration_minutes:0,advance_alerts:[]}
 ],recurring_items:[],dependencies:[
  {source_ref:0,target_ref:1,relation:'before_start',offset_minutes:30},
  {source_ref:0,target_ref:2,relation:'after_end',offset_minutes:60}
 ],world_updates:[]
};
const omniaiResponse=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(modelIntent)}}]}),{status:200,headers:{'content-type':'application/json'}});
const mod=await import(new URL('../SuperAgent_V10_3_Reliability_Lock.js?hard='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'TOKEN',TELEGRAM_WEBHOOK_SECRET:'SECRET',OMNIAI_API_KEY:'KEY',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async()=>omniaiResponse()}};
let pass=0,fail=0;const errors=[];const ok=(name,c,d='')=>{if(c)pass++;else{fail++;errors.push({name,d})}};
async function webhook(update){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};const r=await worker.fetch(new Request('https://x.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'SECRET','Content-Type':'application/json'},body:JSON.stringify(update)}),env,ctx);await Promise.allSettled(waits);return r;}
try{
 await webhook({update_id:9001,message:{message_id:1,chat:{id:77,type:'private'},text:hard}});
 const ledger=await env.DB.prepare(`SELECT status,error_text FROM telegram_updates WHERE update_id='9001'`).first();
 const failures=(await env.DB.prepare(`SELECT scope,error_text FROM runtime_failures ORDER BY id`).all()).results;
 const reminders=(await env.DB.prepare(`SELECT title,local_date,local_time,duration_minutes FROM reminders WHERE chat_id='77' ORDER BY local_time`).all()).results;
 const deps=(await env.DB.prepare(`SELECT source_id,target_id,relation,offset_minutes FROM event_dependencies WHERE chat_id='77' ORDER BY id`).all()).results;
 const shop=(await env.DB.prepare(`SELECT title,status FROM smart_list_items WHERE chat_id='77' ORDER BY id`).all()).results;
 const sent=telegram.filter(x=>x.method==='sendMessage').map(x=>String(x.body.text||''));
 ok('telegram update completed',ledger?.status==='done',JSON.stringify({ledger,failures,sent}));
 ok('no runtime failure',failures.length===0,JSON.stringify(failures));
 ok('three linked reminders saved',reminders.length===3,JSON.stringify(reminders));
 ok('doctor 17:00 duration 60',reminders.some(x=>x.title.includes('دكتور')&&x.local_time==='17:00'&&Number(x.duration_minutes)===60),JSON.stringify(reminders));
 ok('analysis 16:30',reminders.some(x=>x.title.includes('تحاليل')&&x.local_time==='16:30'),JSON.stringify(reminders));
 ok('medicine 19:00',reminders.some(x=>x.title.includes('الدوا')&&x.local_time==='19:00'),JSON.stringify(reminders));
 ok('two dependencies persisted',deps.length===2,JSON.stringify(deps));
 ok('shopping persisted 2',shop.length===2&&shop.some(x=>x.title==='لبن')&&shop.some(x=>x.title==='مناديل'),JSON.stringify(shop));
 ok('schedule confirmation sent',sent.some(x=>x.startsWith('✅ تم الحفظ:')),JSON.stringify(sent));
 ok('shopping confirmation sent',sent.some(x=>x.includes('ضفت 2 للمشتريات')),JSON.stringify(sent));
}catch(e){fail++;errors.push({name:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));
py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
