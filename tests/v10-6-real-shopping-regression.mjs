import fs from 'fs';
import {spawn} from 'child_process';
import readline from 'readline';

const dbfile='./v106_real_shopping.sqlite';try{fs.unlinkSync(dbfile)}catch{}
const py=spawn('python',['tests/sqlite_server.py',dbfile],{stdio:['pipe','pipe','inherit']});
const rl=readline.createInterface({input:py.stdout});const pending=[];
rl.on('line',line=>{const p=pending.shift();if(!p)return;const j=JSON.parse(line);j.ok?p.resolve(j.value):p.reject(new Error(j.error))});
const bridge=req=>new Promise((resolve,reject)=>{pending.push({resolve,reject});py.stdin.write(JSON.stringify(req)+'\n')});
class Stmt{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}run(){return bridge({mode:'run',sql:this.sql,args:this.args})}all(){return bridge({mode:'all',sql:this.sql,args:this.args})}first(){return bridge({mode:'first',sql:this.sql,args:this.args})}}
class DB{prepare(sql){return new Stmt(sql)}batch(stmts){return bridge({mode:'batch',items:stmts.map(x=>({sql:x.sql,args:x.args}))})}}

const telegram=[];let aiCalls=0;
globalThis.fetch=async(url,opts={})=>{
  const u=String(url);
  if(u.includes('api.telegram.org/bot')){const method=u.split('/').pop();let body={};try{body=JSON.parse(opts.body||'{}')}catch{};telegram.push({method,body});if(method==='sendMessage')return Response.json({ok:true,result:{message_id:telegram.length,chat:{id:body.chat_id},text:body.text}});return Response.json({ok:true,result:true})}
  if(u.includes('api.aladhan.com'))return Response.json({code:200,data:{timings:{Fajr:'04:30',Dhuhr:'12:00',Asr:'15:30',Maghrib:'18:30',Isha:'20:00'}}});
  throw new Error('Unexpected '+u);
};

const mod=await import(new URL('../SuperAgent_V10_6_Zero_Known_Failures.js?x='+Date.now(),import.meta.url).href);const worker=mod.default;
const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'T',TELEGRAM_WEBHOOK_SECRET:'S',OMNIAI_API_KEY:'K',SETUP_KEY:'SETUP',PUBLIC_BOT:'true',OMNIAI_SERVICE:{fetch:async()=>{aiCalls++;throw new Error('AI_SHOULD_NOT_BE_CALLED')}}};
let pass=0,fail=0;const errors=[];const ok=(n,c,d='')=>{if(c){pass++;console.log('PASS',n)}else{fail++;errors.push({n,d});console.log('FAIL',n,d)}};
async function wh(id,text){const waits=[];const ctx={waitUntil:p=>waits.push(Promise.resolve(p))};await worker.fetch(new Request('https://x/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'S','Content-Type':'application/json'},body:JSON.stringify({update_id:id,message:{message_id:id,chat:{id:77,type:'private'},text}})}),env,ctx);await Promise.allSettled(waits)}
const items=async()=>((await env.DB.prepare(`SELECT title,status FROM smart_list_items WHERE chat_id='77' ORDER BY id`).all())?.results||[]);
const reminderCount=async()=>Number((await env.DB.prepare(`SELECT COUNT(*) c FROM reminders WHERE chat_id='77'`).first())?.c||0);

try{
  await wh(1,'/start');
  const screenshotText=`بص عاوز اشتري\nعيش تورتيلا\nعيش توست\nفينو اسود\nفصوص رومي\nشيدر طبيعي\nكاجو\nفسدق\nكوفي شيك\nحليب دينا\nايس كريم دينا`;
  await wh(2,screenshotText);
  let r=await items();
  const expected=['عيش تورتيلا','عيش توست','فينو اسود','فصوص رومي','شيدر طبيعي','كاجو','فسدق','كوفي شيك','حليب دينا','ايس كريم دينا'];
  ok('exact screenshot multiline list -> 10 shopping items',expected.every(x=>r.some(y=>y.title===x))&&r.length===10,JSON.stringify(r));
  ok('exact screenshot multiline list -> zero reminders',(await reminderCount())===0,String(await reminderCount()));
  ok('exact screenshot multiline list bypasses AI',aiCalls===0,String(aiCalls));

  await wh(3,'لا ضفهم لقائمه المشتريات');
  r=await items();ok('pronoun correction dedupes instead of hallucinating',r.length===10,JSON.stringify(r));
  ok('pronoun correction creates no reminder',(await reminderCount())===0,String(await reminderCount()));

  await wh(4,'مش عاوز تذكير');
  r=await items();ok('no-reminder correction keeps shopping state',r.length===10,JSON.stringify(r));
  ok('no-reminder correction bypasses AI',aiCalls===0,String(aiCalls));

  await wh(5,'عاوز اشتري خيار');
  r=await items();ok('single-line natural shopping still works',r.some(x=>x.title==='خيار'),JSON.stringify(r));

  const beforeShop=r.length;
  await wh(6,'فكرني بكرة الساعة 5 مساء اجيب الدوا');
  const timed=await env.DB.prepare(`SELECT title,local_time FROM reminders WHERE chat_id='77' ORDER BY id DESC LIMIT 1`).first();
  r=await items();
  ok('explicit timed purchase remains reminder',!!timed&&timed.local_time==='17:00'&&String(timed.title||'').includes('الدوا'),JSON.stringify(timed));
  ok('timed reminder does not pollute shopping',r.length===beforeShop&&!r.some(x=>String(x.title).includes('دوا')),JSON.stringify(r));
}catch(e){fail++;errors.push({n:'unexpected',d:String(e.stack||e)})}
console.log(JSON.stringify({pass,fail,total:pass+fail,aiCalls,errors},null,2));
py.stdin.write(JSON.stringify({mode:'close'})+'\n');setTimeout(()=>process.exit(fail?1:0),50);
