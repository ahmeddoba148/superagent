import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';

const dbfile='./v1041_ultra_direct.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];
rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error+'\n'+(j.trace||'')))});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}

const telegram=[];let aiCalls=0;
globalThis.fetch=async(url,opts={})=>{const u=String(url);if(u.includes('api.telegram.org/bot')){const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{};telegram.push({method,body});if(method==='sendMessage')return Response.json({ok:true,result:{message_id:telegram.length,chat:{id:body.chat_id},text:body.text}});return Response.json({ok:true,result:true})}if(u.includes('api.aladhan.com'))return Response.json({code:200,data:{timings:{Fajr:'04:30',Dhuhr:'12:00',Asr:'15:30',Maghrib:'18:30',Isha:'20:00'}}});throw new Error('Unexpected '+u)};
const mod=await import(new URL('../SuperAgent_V10_4_Zero_Known_Bugs.js?stress='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'T',TELEGRAM_WEBHOOK_SECRET:'S',OMNIAI_API_KEY:'K',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async()=>{aiCalls++;throw new Error('AI_MUST_NOT_BE_USED_IN_DIRECT_STRESS')}}};

let pass=0,fail=0;const errors=[];const ok=(name,c,d='')=>{if(c)pass++;else{fail++;if(errors.length<100)errors.push({name,d})}};
let uid=100000;
async function wh(chat,text,forcedId=null){const id=forcedId??uid++;const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://stress.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'S','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits);return id}
const date='2099-08-17',now=new Date().toISOString();
function addHHMM(hhmm,delta){let [h,m]=hhmm.split(':').map(Number);let n=h*60+m+delta;n=((n%1440)+1440)%1440;return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
async function insReminder(chat,title,time,dur=0){await env.DB.prepare(`INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES (?,?,?,?,?,0,0,?,?,?,?)`).bind(String(chat),title,dur?'appointment':'reminder',date,time,now,dur,'[]','Africa/Cairo').run();return (await env.DB.prepare(`SELECT id FROM reminders WHERE chat_id=? AND title=? ORDER BY id DESC LIMIT 1`).bind(String(chat),title).first()).id}
async function addDep(chat,sid,tid,rel,off){await env.DB.prepare(`INSERT INTO event_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,active,created_at,updated_at) VALUES (?,'reminder',?,'reminder',?,?,?,?,1,?,?)`).bind(String(chat),sid,tid,rel,off,now,now).run()}

try{
 await wh(1,'/start');
 const ai0=aiCalls;

 // PHASE A — relative reschedule grammar + numeric titles + dependency propagation.
 const shifts=[
  ['40 دقيقة',40],['٤٥ دقيقة',45],['ساعة',60],['ساعة ونص',90],['ساعة وربع',75],['ساعة و40 دقيقة',100],['ساعة و 20 دقيقة',80],
  ['ساعتين',120],['ساعتين ونص',150],['ساعتين وربع',135],['ساعتين و20 دقيقة',140],['ساعتين و ٣٠ دقيقة',150],['3 ساعات',180],['3 ساعات و15 دقيقة',195],['نص ساعة',30],['ربع ساعة',15]
 ];
 const delayVerbs=['أجل','اجل','أخر','اخر'];
 let caseNo=0;
 for(let round=0;round<12;round++)for(const [phrase,mins] of shifts){
   const chat=10000+caseNo,code=700000+caseNo,title=`اجتماع ضغط ${code}`,before=`قبل ضغط ${code}`,after=`بعد ضغط ${code}`;caseNo++;
   const sid=await insReminder(chat,title,'12:00',60),bid=await insReminder(chat,before,'11:30',0),aid=await insReminder(chat,after,'13:20',0);await addDep(chat,sid,bid,'before_start',30);await addDep(chat,sid,aid,'after_end',20);
   const aib=aiCalls;await wh(chat,`${delayVerbs[round%delayVerbs.length]} اجتماع ضغط ${code} ${phrase}`);
   const rows=(await env.DB.prepare(`SELECT title,local_time FROM reminders WHERE chat_id=? ORDER BY id`).bind(String(chat)).all()).results;const get=t=>rows.find(x=>x.title===t)?.local_time;
   ok(`shift parent ${phrase} #${round}`,get(title)===addHHMM('12:00',mins),JSON.stringify(rows));
   ok(`shift before dep ${phrase} #${round}`,get(before)===addHHMM('12:00',mins-30),JSON.stringify(rows));
   ok(`shift after dep ${phrase} #${round}`,get(after)===addHHMM('12:00',mins+60+20),JSON.stringify(rows));
   ok(`shift direct no AI ${phrase} #${round}`,aiCalls===aib,`${aib}->${aiCalls}`);
   await wh(chat,'/undo');const back=(await env.DB.prepare(`SELECT title,local_time FROM reminders WHERE chat_id=? ORDER BY id`).bind(String(chat)).all()).results;const gb=t=>back.find(x=>x.title===t)?.local_time;
   ok(`shift undo parent ${phrase} #${round}`,gb(title)==='12:00',JSON.stringify(back));
   ok(`shift undo deps ${phrase} #${round}`,gb(before)==='11:30'&&gb(after)==='13:20',JSON.stringify(back));
 }
 // Earlier shifts tested without linked children to isolate direction parsing.
 const early=[['ساعة',60],['نص ساعة',30],['ربع ساعة',15],['ساعتين',120],['45 دقيقة',45],['ساعة ونص',90]];
 for(let round=0;round<20;round++)for(const [phrase,mins] of early){const chat=13000+round*20+mins,code=880000+round*100+mins,title=`موعد تقديم ${code}`;await insReminder(chat,title,'15:00',30);const aib=aiCalls;await wh(chat,`قدم موعد تقديم ${code} ${phrase}`);const r=await env.DB.prepare(`SELECT local_time FROM reminders WHERE chat_id=? AND title=?`).bind(String(chat),title).first();ok(`advance ${phrase} #${round}`,r?.local_time===addHHMM('15:00',-mins),JSON.stringify(r));ok(`advance no AI ${phrase} #${round}`,aiCalls===aib)}

 // PHASE B — hundreds of natural shopping phrasings, direct and multi-command.
 const singleTemplates=[x=>`فكرني اشتري ${x}`,x=>`فكرني أشتري ${x}`,x=>`نبهنى اجيب ${x}`,x=>`نبهني أجيب ${x}`,x=>`عاوز اشتري ${x}`,x=>`عايز أجيب ${x}`,x=>`محتاج اجيب ${x}`,x=>`هات ${x}`,x=>`جيبلي ${x}`,x=>`متنسانيش أجيب ${x}`];
 for(let i=0;i<500;i++){const chat=20000+i,item=`صنفضغط${i}`,text=singleTemplates[i%singleTemplates.length](item),aib=aiCalls;await wh(chat,text);const rows=(await env.DB.prepare(`SELECT title FROM smart_list_items WHERE chat_id=?`).bind(String(chat)).all()).results;const rc=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM reminders WHERE chat_id=?`).bind(String(chat)).first())?.c||0);ok(`shopping single ${i}`,rows.length===1&&rows[0].title===item,JSON.stringify({text,rows}));ok(`shopping single no reminder ${i}`,rc===0,String(rc));ok(`shopping single no AI ${i}`,aiCalls===aib,`${aib}->${aiCalls}`)}
 const separators=['\n\n','، ','؛ ',' و'];
 for(let i=0;i<160;i++){const chat=21000+i,a=`بيضضغط${i}`,b=`لبنضغط${i}`,c=`خيارضغط${i}`,d=`طماطمضغط${i}`,sep=separators[i%separators.length];const text=`فكرني أشتري ${a}${sep}نبهنى أجيب ${b}${sep}عاوز أشتري ${c} و${d}`;const aib=aiCalls;await wh(chat,text);const rows=(await env.DB.prepare(`SELECT title FROM smart_list_items WHERE chat_id=? ORDER BY id`).bind(String(chat)).all()).results.map(x=>x.title);ok(`shopping multi count ${i}`,rows.length===4,JSON.stringify({text,rows}));ok(`shopping multi split ${i}`,[a,b,c,d].every(x=>rows.includes(x)),JSON.stringify({text,rows}));ok(`shopping multi clean ${i}`,!rows.some(x=>/فكرني|نبهنى|عاوز/u.test(x)),JSON.stringify(rows));ok(`shopping multi no AI ${i}`,aiCalls===aib,`${aib}->${aiCalls}`)}

 // PHASE C — explicit-clock purchases MUST become timed reminders and never shopping, without AI.
 const timedPrefixes=['فكرني','نبهني','نبهنى','ذكرني'];
 for(let i=0;i<160;i++){const chat=23000+i,item=`دواءضغط${i}`,h=1+(i%11),min=[0,5,15,30,45][i%5],period=i%2?'مساء':'صباح',hh24=(period==='مساء'?(h===12?12:h+12):(h===12?0:h)),expected=`${String(hh24).padStart(2,'0')}:${String(min).padStart(2,'0')}`,digits=i%3===0?String(h).replace(/[0-9]/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)]):String(h);const text=`${timedPrefixes[i%timedPrefixes.length]} بكرة الساعة ${digits}:${String(min).padStart(2,'0')} ${period} أجيب ${item}`,aib=aiCalls;await wh(chat,text);const r=await env.DB.prepare(`SELECT title,local_time FROM reminders WHERE chat_id=? ORDER BY id DESC LIMIT 1`).bind(String(chat)).first();const shop=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id=? AND title LIKE ?`).bind(String(chat),`%${item}%`).first())?.c||0);ok(`timed purchase reminder ${i}`,!!r&&r.local_time===expected,JSON.stringify({text,r,expected}));ok(`timed purchase not shopping ${i}`,shop===0,String(shop));ok(`timed purchase no AI ${i}`,aiCalls===aib,`${aib}->${aiCalls}`)}

 // PHASE D — Telegram idempotency and shopping de-duplication.
 for(let i=0;i<150;i++){const chat=25000+i,item=`تكرارضغط${i}`,id=900000+i,text=`عاوز اشتري ${item}`;await wh(chat,text,id);await wh(chat,text,id);await wh(chat,text,id+1000000);const count=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id=? AND title=?`).bind(String(chat),item).first())?.c||0);ok(`idempotency ${i}`,count===1,String(count))}

 // PHASE E — strict multi-user isolation + delete/undo.
 for(let i=0;i<80;i++){const a=27000+i*2,b=a+1,item=`مشتركضغط${i}`;await wh(a,`هات ${item}`);await wh(b,`هات ${item}`);await wh(a,`احذف ${item} من المشتريات`);let ca=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id=? AND title=?`).bind(String(a),item).first())?.c||0),cb=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id=? AND title=?`).bind(String(b),item).first())?.c||0);ok(`isolation delete ${i}`,ca===0&&cb===1,`${ca}/${cb}`);await wh(a,'/undo');ca=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id=? AND title=?`).bind(String(a),item).first())?.c||0);cb=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id=? AND title=?`).bind(String(b),item).first())?.c||0);ok(`isolation undo ${i}`,ca===1&&cb===1,`${ca}/${cb}`)}

 // PHASE F — recurring delete works with AI hard-down; ambiguous delete never guesses.
 async function insRule(chat,title){await env.DB.prepare(`INSERT INTO schedule_rules(chat_id,title,kind,rule_json,duration_minutes,start_at,end_at,max_occurrences,fired_count,active,paused_until,exceptions_json,advance_alerts_json,legacy_rule_id,created_at,updated_at,timezone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(String(chat),title,'reminder',JSON.stringify({mode:'calendar',every:1,unit:'days',times:['23:00']}),0,`${date} 23:00`,null,10,0,1,null,'[]','[]',null,now,now,'Africa/Cairo').run()}
 for(let i=0;i<120;i++){const chat=30000+i,title=`مراجعة ضغط ${i}`;await insRule(chat,title);const aib=aiCalls;await wh(chat,`احذف تذكير ${title} المتكرر`);const c=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM schedule_rules WHERE chat_id=? AND title=?`).bind(String(chat),title).first())?.c||0);ok(`recurring direct delete ${i}`,c===0,String(c));ok(`recurring delete no AI ${i}`,aiCalls===aib,`${aib}->${aiCalls}`)}
 for(let i=0;i<40;i++){const chat=31000+i;await insRule(chat,`متابعة ضغط ${i} يومية`);await insRule(chat,`متابعة ضغط ${i} أسبوعية`);const aib=aiCalls;await wh(chat,`احذف تذكير متابعة ضغط ${i} المتكرر`);const c=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM schedule_rules WHERE chat_id=? AND active=1`).bind(String(chat)).first())?.c||0);ok(`recurring ambiguity preserves ${i}`,c===2,String(c));ok(`recurring ambiguity no AI ${i}`,aiCalls===aib,`${aib}->${aiCalls}`)}

 ok('all deterministic stress bypassed AI',aiCalls===ai0,`${ai0}->${aiCalls}`);
 const runtime=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures`).first())?.c||0);ok('no runtime failures in deterministic stress',runtime===0,String(runtime));
}catch(e){fail++;errors.push({name:'unexpected',d:String(e.stack||e)})}

console.log(JSON.stringify({suite:'V10.4.1 ultra direct stress',pass,fail,total:pass+fail,aiCalls,errors},null,2));
py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),50);
