import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';
const dbfile='./v104_killer.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error))});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}
const telegram=[];globalThis.fetch=async(url,opts={})=>{const u=String(url);if(u.includes('api.telegram.org/bot')){const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{};telegram.push({method,body});if(method==='sendMessage')return Response.json({ok:true,result:{message_id:telegram.length,chat:{id:body.chat_id},text:body.text}});return Response.json({ok:true,result:true})}if(u.includes('api.aladhan.com'))return Response.json({code:200,data:{timings:{Fajr:'04:30',Dhuhr:'12:00',Asr:'15:30',Maghrib:'18:30',Isha:'20:00'}}});throw new Error('Unexpected '+u)};
const mod=await import(new URL('../SuperAgent_V10_4_Zero_Known_Bugs.js?x='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'T',TELEGRAM_WEBHOOK_SECRET:'S',OMNIAI_API_KEY:'K',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async()=>{throw new Error('AI_SHOULD_NOT_BE_CALLED')}}};
let pass=0,fail=0;const errors=[];const ok=(n,c,d='')=>{if(c)pass++;else{fail++;errors.push({n,d})}};
async function wh(id,text){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://x/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'S','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:77,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits)}
try{
 await wh(1,'/start');
 const now=new Date().toISOString(),date='2099-08-17';
 const ins=async(title,time,dur=0)=>env.DB.prepare(`INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES (?,?,?,?,?,0,0,?,?,?,?)`).bind('77',title,dur?'appointment':'reminder',date,time,now,dur,'[]','Africa/Cairo').run();
 const a=await ins('اجتماع نوفا 731','20:00',80),b=await ins('أجهز العقد','19:25',0),c=await ins('أبعت النسخة','21:45',0);
 const ids=(await env.DB.prepare(`SELECT id,title FROM reminders WHERE chat_id='77' ORDER BY id`).all()).results;const id=x=>ids.find(r=>r.title===x).id;
 await env.DB.prepare(`INSERT INTO event_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,active,created_at,updated_at) VALUES (?,'reminder',?,'reminder',?,'before_start',35,1,?,?)`).bind('77',id('اجتماع نوفا 731'),id('أجهز العقد'),now,now).run();
 await env.DB.prepare(`INSERT INTO event_dependencies(chat_id,source_type,source_id,target_type,target_id,relation,offset_minutes,active,created_at,updated_at) VALUES (?,'reminder',?,'reminder',?,'after_end',25,1,?,?)`).bind('77',id('اجتماع نوفا 731'),id('أبعت النسخة'),now,now).run();
 const failuresBefore=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='77'`).first())?.c||0);
 await wh(2,'أجل اجتماع نوفا 731 ساعة و40 دقيقة');
 const rows=(await env.DB.prepare(`SELECT title,local_time FROM reminders WHERE chat_id='77' AND title IN ('اجتماع نوفا 731','أجهز العقد','أبعت النسخة') ORDER BY id`).all()).results;
 const get=t=>rows.find(x=>x.title===t)?.local_time;
 ok('relative reschedule parent 20:00 -> 21:40',get('اجتماع نوفا 731')==='21:40',JSON.stringify(rows));
 ok('before dependency moves to 21:05',get('أجهز العقد')==='21:05',JSON.stringify(rows));
 ok('after dependency moves to 23:25',get('أبعت النسخة')==='23:25',JSON.stringify(rows));
 const sent=telegram.filter(x=>x.method==='sendMessage').map(x=>String(x.body.text||''));ok('reports two dependency moves',sent.some(x=>x.includes('اتحرك 2 تذكير مرتبط')),JSON.stringify(sent.slice(-3)));
 const failuresAfter=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM runtime_failures WHERE chat_id='77'`).first())?.c||0);ok('relative reschedule bypasses AI',failuresAfter===failuresBefore,`${failuresBefore}->${failuresAfter}`);
 await wh(3,'/undo');const back=(await env.DB.prepare(`SELECT title,local_time FROM reminders WHERE chat_id='77' AND title IN ('اجتماع نوفا 731','أجهز العقد','أبعت النسخة') ORDER BY id`).all()).results;const gb=t=>back.find(x=>x.title===t)?.local_time;ok('undo restores full chain',gb('اجتماع نوفا 731')==='20:00'&&gb('أجهز العقد')==='19:25'&&gb('أبعت النسخة')==='21:45',JSON.stringify(back));

 const multi='فكرني أشتري بيض\n\nنبهنى أجيب لبن\n\nعاوز أشتري خيار وطماطم';await wh(4,multi);
 const shop=(await env.DB.prepare(`SELECT title FROM smart_list_items WHERE chat_id='77' ORDER BY id`).all()).results.map(x=>x.title);
 ok('multi natural shopping yields exactly four',shop.length===4,JSON.stringify(shop));
 ok('multi natural shopping items separated',['بيض','لبن','خيار','طماطم'].every(x=>shop.includes(x)),JSON.stringify(shop));
 ok('no malformed merged shopping item',!shop.some(x=>/نبهنى|عاوز|فكرني/u.test(x)),JSON.stringify(shop));
 const fake=Number((await env.DB.prepare(`SELECT COUNT(*) c FROM reminders WHERE chat_id='77' AND id>${Math.max(...ids.map(x=>x.id))}`).first())?.c||0);ok('shopping creates no fake reminder',fake===0,String(fake));
 const runtime=(await env.DB.prepare(`SELECT scope,error_text FROM runtime_failures WHERE chat_id='77'`).all()).results;ok('no runtime failures',runtime.length===0,JSON.stringify(runtime));
}catch(e){fail++;errors.push({n:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
