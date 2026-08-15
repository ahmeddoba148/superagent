import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';

const dbfile='./v1034_atomic.sqlite';try{fs.unlinkSync(dbfile)}catch{}
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
   return Response.json({ok:true,result:true});
 }
 if(u.includes('api.aladhan.com'))return Response.json({code:200,data:{timings:{Fajr:'04:30',Dhuhr:'12:00',Asr:'15:30',Maghrib:'18:30',Isha:'20:00'}}});
 throw new Error('Unexpected network '+u);
};

const mod=await import(new URL('../SuperAgent_V10_3_4_Atomic_Direct.js?x='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'TOKEN',TELEGRAM_WEBHOOK_SECRET:'SECRET',OMNIAI_API_KEY:'KEY',SETUP_KEY:'SETUP',PUBLIC_BOT:'true'};
let aiMode='conflict';
function cairoTomorrow(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));const d=new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
const tom=cairoTomorrow();
const conflictIntent={action:'create',needs_clarification:false,question:'',reply:'',needs_live_data:false,items:[{title:'اجتماع أوميغا الذري',kind:'appointment',date:tom,time:'18:00',timezone:'Africa/Cairo',duration_minutes:60,advance_alerts:[]}],recurring_items:[],dependencies:[],world_updates:[]};
const chainIntent={action:'create',needs_clarification:false,question:'',reply:'',needs_live_data:false,items:[
 {title:'اجتماع سيجما الذري',kind:'appointment',date:tom,time:'21:00',timezone:'Africa/Cairo',duration_minutes:45,advance_alerts:[15,30]},
 {title:'أجهز العرض',kind:'reminder',date:tom,time:'20:45',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[15]},
 {title:'أبعت الملخص',kind:'reminder',date:tom,time:'22:15',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[30]}
],recurring_items:[],dependencies:[{source_ref:0,target_ref:1,relation:'before_start',offset_minutes:15},{source_ref:0,target_ref:2,relation:'after_end',offset_minutes:30}],world_updates:[]};
env.OMNIAI_SERVICE={fetch:async()=>{if(aiMode==='down')throw new Error('SIMULATED_ALL_AI_DOWN');const intent=aiMode==='chain'?chainIntent:conflictIntent;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(intent)}}]}),{status:200,headers:{'content-type':'application/json'}})}};

let pass=0,fail=0;const errors=[];const ok=(name,c,d='')=>{if(c)pass++;else{fail++;errors.push({name,d})}};
async function webhook(id,text){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};const r=await worker.fetch(new Request('https://x.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'SECRET','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:77,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits);return r;}
const sent=()=>telegram.filter(x=>x.method==='sendMessage').map(x=>String(x.body.text||''));
try{
 await webhook(1000,'/start');
 await env.DB.prepare(`INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES (?,?,?,?,?,0,0,?,?,?,?)`)
   .bind('77','تعارض موجود','appointment',tom,'18:00',new Date().toISOString(),60,'[]','Africa/Cairo').run();

 const compound='عندي اجتماع أوميغا الذري بكرة الساعة 6 مساء ومدته ساعة، وضيف عصير مانجو وأكياس قمامة للمشتريات';
 aiMode='conflict';
 const beforeMsg=sent().length;await webhook(1001,compound);
 const pendingConflict=await env.DB.prepare(`SELECT intent_json FROM pending_conflicts WHERE chat_id='77'`).first();
 const shopBefore=(await env.DB.prepare(`SELECT title FROM smart_list_items WHERE chat_id='77' AND title IN ('عصير مانجو','أكياس قمامة')`).all()).results;
 ok('conflict keeps shopping atomic (zero half-save)',shopBefore.length===0,JSON.stringify(shopBefore));
 const saved=pendingConflict?JSON.parse(pendingConflict.intent_json):null;
 ok('pending conflict carries compound shopping',Array.isArray(saved?._compound_shopping_items)&&saved._compound_shopping_items.length===2,JSON.stringify(saved));
 ok('no shopping success before conflict confirmation',!sent().slice(beforeMsg).some(x=>x.includes('ضفت')&&x.includes('المشتريات')),JSON.stringify(sent().slice(beforeMsg)));

 await webhook(1002,'نفذ رغم التعارض');
 const shopAfter=(await env.DB.prepare(`SELECT title,status FROM smart_list_items WHERE chat_id='77' AND title IN ('عصير مانجو','أكياس قمامة') ORDER BY title`).all()).results;
 const omega=await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id='77' AND title='اجتماع أوميغا الذري' LIMIT 1`).first();
 ok('confirmed conflict saves schedule',!!omega,JSON.stringify(omega));
 ok('confirmed conflict saves both shopping items',shopAfter.length===2&&shopAfter.every(x=>x.status==='pending'),JSON.stringify(shopAfter));

 const now=new Date().toISOString();
 async function insertRule(title){return env.DB.prepare(`INSERT INTO schedule_rules(chat_id,title,kind,rule_json,duration_minutes,start_at,end_at,max_occurrences,fired_count,active,paused_until,exceptions_json,advance_alerts_json,legacy_rule_id,created_at,updated_at,timezone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('77',title,'reminder',JSON.stringify({mode:'calendar',every:1,unit:'days',times:['23:00']}),0,`${tom} 23:00`,null,3,0,1,null,'[]','[]',null,now,now,'Africa/Cairo').run()}
 await insertRule('أراجع المتابعة');
 aiMode='down';
 await webhook(1003,'احذف تذكير المتابعة المتكرر');
 const targetLeft=await env.DB.prepare(`SELECT COUNT(*) c FROM schedule_rules WHERE chat_id='77' AND title='أراجع المتابعة'`).first();
 ok('direct recurring delete works with all AI down',Number(targetLeft?.c||0)===0,JSON.stringify(targetLeft));
 const aiFailure=(await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='77' AND error_text LIKE '%SIMULATED_ALL_AI_DOWN%'`).first())?.c||0;
 ok('direct recurring delete never invokes AI',Number(aiFailure)===0,String(aiFailure));

 await insertRule('أراجع المتابعة اليومية');await insertRule('أراجع المتابعة الأسبوعية');
 const ambStart=sent().length;await webhook(1004,'احذف تذكير المتابعة المتكرر');
 const ambRows=(await env.DB.prepare(`SELECT title FROM schedule_rules WHERE chat_id='77' AND active=1 AND title LIKE '%المتابعة%' ORDER BY id`).all()).results;
 ok('ambiguous recurring delete preserves all matches',ambRows.length===2,JSON.stringify(ambRows));
 ok('ambiguous recurring delete asks for specificity',sent().slice(ambStart).some(x=>x.includes('أكتر من تذكير متكرر')),JSON.stringify(sent().slice(ambStart)));

 aiMode='chain';
 const chain='بكرة عندي اجتماع اسمه سيجما الذري الساعة 9 مساء ومدته 45 دقيقة، فكرني قبله بربع ساعة أجهز العرض، وبعده بنص ساعة فكرني أبعت الملخص';
 await webhook(1005,chain);
 const chainRows=(await env.DB.prepare(`SELECT title,local_time,advance_alerts_json FROM reminders WHERE chat_id='77' AND title IN ('اجتماع سيجما الذري','أجهز العرض','أبعت الملخص') ORDER BY local_time`).all()).results;
 ok('canonical chain creates all three events',chainRows.length===3,JSON.stringify(chainRows));
 ok('relation-derived duplicate alerts fully removed',chainRows.length===3&&chainRows.every(x=>JSON.parse(x.advance_alerts_json||'[]').length===0),JSON.stringify(chainRows));

 const runtime=(await env.DB.prepare(`SELECT scope,error_text FROM runtime_failures WHERE chat_id='77'`).all()).results;
 ok('no unexpected runtime failures',runtime.length===0,JSON.stringify(runtime));
}catch(e){fail++;errors.push({name:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));
py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
