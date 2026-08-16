import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';

const dbfile='./v105_human.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];
rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error+'\n'+(j.trace||'')))});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}

const telegram=[];let aiCalls=0;let nextMsg=1000;
function aiIntentFor(text){
 const t=String(text||'');
 if(t.includes('هيدرا 303')) return {action:'create',needs_clarification:false,items:[
  {title:'اجتماع هيدرا 303',kind:'appointment',date:'2026-09-10',time:'23:40',timezone:'Africa/Cairo',duration_minutes:100,advance_alerts:[]},
  {title:'أراجع العقد',kind:'reminder',date:'2026-09-10',time:'22:45',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]},
  {title:'أبعت التقرير',kind:'reminder',date:'2026-09-11',time:'01:45',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]},
  {title:'أكلم كريم',kind:'reminder',date:'2026-09-11',time:'02:25',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]},
  {title:'أقفل الملف',kind:'reminder',date:'2026-09-11',time:'02:40',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]}
 ],recurring_items:[],dependencies:[
  {source_ref:0,target_ref:1,relation:'before_start',offset_minutes:55},
  {source_ref:0,target_ref:2,relation:'after_end',offset_minutes:25},
  {source_ref:2,target_ref:3,relation:'after_start',offset_minutes:40},
  {source_ref:3,target_ref:4,relation:'after_start',offset_minutes:15}
 ]};
 if(t.includes('كل يوم الساعة 10:20')) return {action:'create',needs_clarification:false,items:[],recurring_items:[{title:'أراجع المشروع',kind:'reminder',duration_minutes:120*60,advance_alerts:[],schedule:{mode:'calendar',unit:'days',every:1,times:['22:20'],weekdays:[],monthdays:[],months:[],ordinal_weekdays:[],start_at:'2026-10-25 22:20',end_at:null,max_occurrences:5,window_minutes:null,exceptions:[]}}],dependencies:[]};
 if(t.includes('ثابت 808')) return {action:'create',needs_clarification:false,items:[{title:'اجتماع ثابت 808',kind:'appointment',date:'2026-10-01',time:'20:00',timezone:'Africa/Cairo',duration_minutes:120,advance_alerts:[]}],recurring_items:[],dependencies:[]};
 if(t.includes('متحرك 909')) return {action:'create',needs_clarification:false,items:[{title:'اجتماع متحرك 909',kind:'appointment',date:'2026-10-01',time:'21:00',timezone:'Africa/Cairo',duration_minutes:60,advance_alerts:[]},{title:'أبعت الملف',kind:'reminder',date:'2026-10-01',time:'22:30',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]}],recurring_items:[],dependencies:[{source_ref:0,target_ref:1,relation:'after_end',offset_minutes:30}]};
 if(t.includes('سنة 2027')) return {action:'create',needs_clarification:false,items:[{title:'اجتماع سنة 2027',kind:'appointment',date:'2026-12-31',time:'23:50',timezone:'Africa/Cairo',duration_minutes:30,advance_alerts:[]},{title:'أجهز',kind:'reminder',date:'2026-12-31',time:'23:30',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]},{title:'أبعت الرسالة',kind:'reminder',date:'2027-01-01',time:'01:00',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]}],recurring_items:[],dependencies:[{source_ref:0,target_ref:1,relation:'before_start',offset_minutes:20},{source_ref:0,target_ref:2,relation:'after_end',offset_minutes:40}]};
 return {action:'chat',needs_clarification:false,reply:'تمام يا باشا'};
}

globalThis.fetch=async(url,opts={})=>{
 const u=String(url);
 if(u.includes('api.telegram.org/bot')){
  const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{}
  telegram.push({method,body});
  if(method==='sendMessage')return Response.json({ok:true,result:{message_id:nextMsg++,chat:{id:body.chat_id},text:body.text}});
  if(method==='editMessageText')return Response.json({ok:true,result:{message_id:body.message_id,chat:{id:body.chat_id},text:body.text}});
  return Response.json({ok:true,result:true});
 }
 if(u.includes('api.aladhan.com'))return Response.json({code:200,data:{timings:{Fajr:'04:30',Dhuhr:'12:00',Asr:'15:30',Maghrib:'18:30',Isha:'20:00'}}});
 throw new Error('Unexpected network '+u);
};

const worker=(await import(new URL('../SuperAgent_V10_5_Reliability_Rewrite.js?human='+Date.now(),import.meta.url).href)).default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'T',TELEGRAM_WEBHOOK_SECRET:'S',OMNIAI_API_KEY:'K',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async req=>{aiCalls++;let payload={};try{payload=await req.json()}catch{};const msgs=payload?.messages||[];const user=msgs.filter(x=>x.role==='user').at(-1)?.content||'';const intent=aiIntentFor(user);return Response.json({choices:[{message:{content:JSON.stringify(intent)}}]})}}};
let uid=1;
async function deliver(update){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://human.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'S','Content-Type':'application/json'},body:JSON.stringify(update)}),env,ctx);await Promise.allSettled(waits)}
async function say(chat,text,{parallel=false}={}){const before=telegram.length;console.log('\nUSER '+chat+' > '+text);const id=uid++;const p=deliver({update_id:id,message:{message_id:id,chat:{id:chat,type:'private'},text}});if(!parallel)await p;return{p,before};}
async function click(chat,data){const before=telegram.length;console.log('\nCLICK '+chat+' > '+data);const id=uid++;await deliver({update_id:id,callback_query:{id:'cb'+id,from:{id:chat},message:{message_id:7000+id,chat:{id:chat,type:'private'}},data}});showSince(before);}
function showSince(before){const rows=telegram.slice(before).filter(x=>['sendMessage','editMessageText'].includes(x.method));for(const x of rows)console.log('BOT > '+String(x.body.text||'').replace(/\n/g,' | '));}
async function talk(chat,text){const {p,before}=await say(chat,text);showSince(before);}
async function snapshot(chat,label){
 const reminders=(await env.DB.prepare(`SELECT title,local_date,local_time,duration_minutes,cancelled FROM reminders WHERE chat_id=? ORDER BY local_date,local_time,id`).bind(String(chat)).all()).results;
 const rules=(await env.DB.prepare(`SELECT title,duration_minutes,start_at,max_occurrences,active,rule_json FROM schedule_rules WHERE chat_id=? ORDER BY id`).bind(String(chat)).all()).results;
 const shop=(await env.DB.prepare(`SELECT title,status FROM smart_list_items WHERE chat_id=? ORDER BY id`).bind(String(chat)).all()).results;
 const deps=(await env.DB.prepare(`SELECT source_id,target_id,relation,offset_minutes,active FROM event_dependencies WHERE chat_id=? ORDER BY id`).bind(String(chat)).all()).results;
 const pendingConflict=await env.DB.prepare(`SELECT intent_json,conflicts_json FROM pending_conflicts WHERE chat_id=?`).bind(String(chat)).first();
 const world=(await env.DB.prepare(`SELECT entity_type,name FROM life_entities WHERE chat_id=? ORDER BY id`).bind(String(chat)).all()).results;
 console.log('\nSTATE '+label+' chat='+chat);console.log(JSON.stringify({reminders,rules,shop,deps,pendingConflict:!!pendingConflict,world},null,2));
}

try{
 const A=9001,B=9002;
 console.log('=== V10.5 HUMAN EXPLORATORY SESSION ===');
 await talk(A,'/start');
 await talk(A,'عندي اجتماع اسمه هيدرا 303 يوم 10 سبتمبر 2026 الساعة 11:40 مساء ومدته ساعة و40 دقيقة، فكرني قبله بـ55 دقيقة أراجع العقد، وبعد ما نخلص بـ25 دقيقة فكرني أبعت التقرير، وبعد ما أبعت التقرير بـ40 دقيقة فكرني أكلم كريم، وبعد ما أكلم كريم بربع ساعة فكرني أقفل الملف');
 await snapshot(A,'بعد إنشاء سلسلة هيدرا');
 await talk(A,'أجل اجتماع هيدرا 303 3 ساعات و15 دقيقة');
 await snapshot(A,'بعد تأجيل هيدرا');
 await talk(A,'رجع آخر تعديل');
 await snapshot(A,'بعد رجع آخر تعديل');

 await talk(A,'كل يوم الساعة 10:20 مساء لمدة 5 أيام ابتداءً من 25 أكتوبر 2026 فكرني أراجع المشروع');
 await snapshot(A,'بعد التكرار');
 await talk(A,'خلي تذكير أراجع المشروع المتكرر الساعة 11 مساء');
 await snapshot(A,'بعد تعديل وقت التكرار');
 await talk(A,'احذف تذكير أراجع المشروع المتكرر');
 await talk(A,'/undo');
 await snapshot(A,'بعد حذف التكرار والتراجع');

 await talk(A,'يوم 1 أكتوبر 2026 الساعة 8 مساء عندي اجتماع اسمه ثابت 808 ومدته ساعتين');
 await talk(A,'عندي اجتماع اسمه متحرك 909 يوم 1 أكتوبر 2026 الساعة 9 مساء ومدته ساعة، وبعده بنص ساعة فكرني أبعت الملف، وضيف قهوة وسكر للمشتريات');
 await snapshot(A,'التعارض قبل القرار');
 await talk(A,'إلغاء');
 await talk(A,'نفذ رغم التعارض');
 await snapshot(A,'بعد الإلغاء ثم محاولة تنفيذ قديمة');
 await talk(A,'عندي اجتماع اسمه متحرك 909 يوم 1 أكتوبر 2026 الساعة 9 مساء ومدته ساعة، وبعده بنص ساعة فكرني أبعت الملف، وضيف قهوة وسكر للمشتريات');
 await talk(A,'نفذ رغم التعارض');
 await snapshot(A,'بعد تنفيذ التعارض عمدًا');

 await talk(A,'هات جبنة رومي وجيبلي مية معدنية ومتنسانيش أجيب شاي وعاوز أشتري لبن ولبن ونبهني أجيب بيض');
 await snapshot(A,'بعد المشتريات الطبيعية');
 await talk(A,'بص يا معلم متنسانيش أجيب بكرة الساعة 4:40 العصر الدوا، وهاتلي رز وزيت، وجيبلي مية، وعاوز كمان مناديل ومناديل، وخلي بالك البيض للمشتريات مش تذكير');
 await snapshot(A,'بعد رسالة تذكير + مشتريات مختلطة');

 await talk(A,'يوم 31 ديسمبر 2026 الساعة 11:50 مساء عندي اجتماع اسمه سنة 2027 ومدته نص ساعة، فكرني قبله بـ20 دقيقة أجهز، وبعد ما نخلص بـ40 دقيقة فكرني أبعت الرسالة');
 await talk(A,'أجل اجتماع سنة 2027 ساعتين ونص');
 await snapshot(A,'بعد عبور رأس السنة والتأجيل');
 await talk(A,'/undo');
 await snapshot(A,'بعد تراجع رأس السنة');

 // Same-chat rapid-fire interaction, without waiting between messages.
 console.log('\n=== RAPID FIRE SAME CHAT ===');
 const now=new Date().toISOString();await env.DB.prepare(`INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES (?,?,?,?,?,0,0,?,?,?,?)`).bind(String(A),'اجتماع برق 404','appointment','2026-11-20','18:00',now,60,'[]','Africa/Cairo').run();
 const r1=await say(A,'أجل اجتماع برق 404 ساعة',{parallel:true});const r2=await say(A,'رجع آخر تعديل',{parallel:true});await Promise.all([r1.p,r2.p]);showSince(Math.min(r1.before,r2.before));await snapshot(A,'بعد رسالتين سريعتين تعديل ثم تراجع');

 // User isolation + destructive controls.
 await talk(B,'/start');await talk(B,'هات بيض ولبن');
 await env.DB.prepare(`INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES (?,?,?,?,?,0,0,?,?,?,?)`).bind(String(B),'موعد المستخدم ب','appointment','2026-12-20','13:00',now,30,'[]','Africa/Cairo').run();
 await snapshot(B,'المستخدم ب قبل مسح المستخدم أ');
 await talk(A,'/menu');await click(A,'panel:danger');await click(A,'danger:clear_everything');await click(A,'do:clear_everything');
 await snapshot(A,'المستخدم أ بعد حذف كل شيء');await snapshot(B,'المستخدم ب بعد حذف كل شيء للمستخدم أ');

 await talk(A,'/menu');await talk(A,'/where');await talk(A,'/live');
 const failures=(await env.DB.prepare(`SELECT chat_id,scope,error_text FROM runtime_failures ORDER BY id`).all()).results;
 console.log('\n=== RUNTIME FAILURES ===');console.log(JSON.stringify(failures,null,2));
 console.log('\n=== SESSION END ===');console.log(JSON.stringify({telegramCalls:telegram.length,aiCalls},null,2));
}catch(e){console.error('HUMAN SESSION CRASH',e.stack||e);process.exitCode=1}
finally{py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(process.exitCode||0),50)}
