import fs from 'fs';import {spawn} from 'child_process';import readline from 'readline';
const dbfile='./v1033_chain.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});const rl=readline.createInterface({input:py.stdout});const pending=[];rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error+'\n'+(j.trace||'')));});const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}
const telegram=[];globalThis.fetch=async(url,opts={})=>{const u=String(url);if(u.includes('api.telegram.org/bot')){const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{};telegram.push({method,body});if(method==='sendMessage')return Response.json({ok:true,result:{message_id:telegram.length,chat:{id:body.chat_id},text:body.text}});return Response.json({ok:true,result:true});}throw new Error('Unexpected '+u)};
const mod=await import(new URL('../SuperAgent_V10_3_3_Chain_Final.js?x='+Date.now(),import.meta.url).href);const worker=mod.default;
const db=new DB();let nextIntent=null;const env={DB:db,TELEGRAM_BOT_TOKEN:'TOKEN',TELEGRAM_WEBHOOK_SECRET:'SECRET',OMNIAI_API_KEY:'KEY',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async()=>Response.json({choices:[{message:{content:JSON.stringify(nextIntent)}}]})}};
let pass=0,fail=0;const errors=[];const ok=(n,c,d='')=>{if(c)pass++;else{fail++;errors.push({name:n,d})}};
async function webhook(id,text){const waits=[];await worker.fetch(new Request('https://x.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'SECRET','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:77,type:'private'},text}})}),env,{waitUntil:p=>waits.push(Promise.resolve(p))});await Promise.allSettled(waits);}
try{
 await worker.fetch(new Request('https://x.test/health'),env,{waitUntil(){}});
 // Pre-existing milk proves that "added 1" does not mean milk was lost.
 await webhook(1,'ضيف لبن للمشتريات');
 const hard='مرام عندها الدكتور بكرة الساعة 5 ومدته ساعة، فكرني قبلها بنص ساعة آخد التحاليل، وبعد ما نخلص بساعة فكرني أجيب الدوا، وضيف لبن ومناديل للمشتريات';
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);const tom=d.toISOString().slice(0,10);
 nextIntent={action:'create',needs_clarification:false,items:[
  {title:'دكتور مرام',kind:'appointment',date:tom,time:'17:00',timezone:'Africa/Cairo',duration_minutes:60,advance_alerts:[30,60]},
  {title:'آخد التحاليل',kind:'reminder',date:tom,time:'16:30',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[30]},
  {title:'أجيب الدوا',kind:'reminder',date:tom,time:'19:00',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[60]}
 ],recurring_items:[],dependencies:[
  {source_ref:1,target_ref:0,relation:'after_start',offset_minutes:30},
  {source_ref:0,target_ref:1,relation:'before_start',offset_minutes:30},
  {source_ref:2,target_ref:0,relation:'before_start',offset_minutes:60},
  {source_ref:0,target_ref:2,relation:'after_end',offset_minutes:60}
 ],world_updates:[]};
 await webhook(2,hard);
 let rows=(await db.prepare(`SELECT id,title,local_time,duration_minutes,advance_alerts_json FROM reminders WHERE chat_id='77' AND cancelled=0 ORDER BY local_time`).all()).results;
 let deps=(await db.prepare(`SELECT source_id,target_id,relation,offset_minutes,active FROM event_dependencies WHERE chat_id='77' ORDER BY id`).all()).results;
 const shop=(await db.prepare(`SELECT title,status FROM smart_list_items WHERE chat_id='77' AND status='pending' ORDER BY title`).all()).results;
 const doctor=rows.find(x=>x.title.includes('دكتور')),analysis=rows.find(x=>x.title.includes('تحاليل')),drug=rows.find(x=>x.title.includes('الدوا'));
 ok('three schedule items',rows.length===3,JSON.stringify(rows));
 ok('initial times exact',doctor?.local_time==='17:00'&&analysis?.local_time==='16:30'&&drug?.local_time==='19:00',JSON.stringify(rows));
 ok('exactly two active dependencies',deps.length===2&&deps.every(x=>Number(x.active)===1),JSON.stringify(deps));
 ok('before dependency correct',deps.some(x=>x.source_id===doctor.id&&x.target_id===analysis.id&&x.relation==='before_start'&&Number(x.offset_minutes)===30),JSON.stringify(deps));
 ok('after dependency correct',deps.some(x=>x.source_id===doctor.id&&x.target_id===drug.id&&x.relation==='after_end'&&Number(x.offset_minutes)===60),JSON.stringify(deps));
 ok('relation-derived duplicate alerts removed',[doctor,analysis,drug].every(x=>(JSON.parse(x.advance_alerts_json||'[]')).length===0),JSON.stringify(rows));
 ok('milk and tissues both pending',shop.some(x=>x.title==='لبن')&&shop.some(x=>x.title==='مناديل'),JSON.stringify(shop));
 const sent=telegram.filter(x=>x.method==='sendMessage').map(x=>String(x.body.text||''));
 ok('existing shopping item explained',sent.some(x=>x.includes('موجود بالفعل')&&x.includes('لبن')&&x.includes('مناديل')),JSON.stringify(sent.slice(-4)));
 // Move doctor 17 -> 19. Both linked reminders must move.
 nextIntent={action:'update',needs_clarification:false,target_type:'one_time',target_id:doctor.id,one_time_update:{date:tom,time:'19:00'},world_updates:[]};
 await webhook(3,'الدكتور بقى 7');
 rows=(await db.prepare(`SELECT id,title,local_time FROM reminders WHERE chat_id='77' AND cancelled=0 ORDER BY id`).all()).results;
 ok('move shifts both linked reminders',rows.find(x=>x.id===doctor.id)?.local_time==='19:00'&&rows.find(x=>x.id===analysis.id)?.local_time==='18:30'&&rows.find(x=>x.id===drug.id)?.local_time==='21:00',JSON.stringify(rows));
 ok('move message reports two linked',telegram.filter(x=>x.method==='sendMessage').some(x=>String(x.body.text||'').includes('اتحرك 2 تذكير')),JSON.stringify(telegram.slice(-3)));
 // Natural restore to previous time; both linked reminders must restore too.
 nextIntent={action:'update',needs_clarification:false,target_type:'one_time',target_id:doctor.id,one_time_update:{date:tom,time:'17:00'},world_updates:[]};
 await webhook(4,'رجعه زي ما كان');
 rows=(await db.prepare(`SELECT id,title,local_time FROM reminders WHERE chat_id='77' AND cancelled=0 ORDER BY id`).all()).results;
 ok('restore shifts both linked reminders back',rows.find(x=>x.id===doctor.id)?.local_time==='17:00'&&rows.find(x=>x.id===analysis.id)?.local_time==='16:30'&&rows.find(x=>x.id===drug.id)?.local_time==='19:00',JSON.stringify(rows));
 ok('restore message reports two linked',telegram.filter(x=>x.method==='sendMessage').filter(x=>String(x.body.text||'').includes('اتحرك 2 تذكير')).length>=2,JSON.stringify(telegram.slice(-3)));
}catch(e){fail++;errors.push({name:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),30);
