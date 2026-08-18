import {execFileSync} from "node:child_process";
import fs from "node:fs";
const URL=process.env.URL,DB=process.env.DB,CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||""),SECRET=process.env.WEBHOOK_SECRET,CFG=process.env.WRANGLER_CONFIG||"wrangler.sanad12.jsonc";
if(!URL||!DB||!CHAT||!SECRET)throw new Error("missing live env");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replaceAll("'","''");
function q(sql){return JSON.parse(execFileSync("npx",["wrangler","d1","execute",DB,"--remote","--config",CFG,"--command",sql,"--json"],{encoding:"utf8"}))?.[0]?.results||[]}
let seq=3120000000+(Date.now()%1000000),mid=730000;
async function post(text,id=++seq){
  const body={update_id:id,message:{message_id:++mid,date:Math.floor(Date.now()/1000),chat:{id:Number(CHAT),type:"private"},from:{id:Number(CHAT),is_bot:false,first_name:"SanadTest"},text}};
  for(let a=1;a<=10;a++){
    const r=await fetch(URL+"/telegram",{method:"POST",headers:{"content-type":"application/json","X-Telegram-Bot-Api-Secret-Token":SECRET},body:JSON.stringify(body)});
    if(r.ok)return id;
    const t=await r.text();
    if((r.status===401||r.status===404)&&a<10){await sleep(2500);continue}
    throw new Error(`webhook ${r.status} ${t}`);
  }
}
async function wait(id,max=60000){
  const end=Date.now()+max;let row;
  while(Date.now()<end){
    row=q(`SELECT status,attempts,last_error FROM sanad_inbox WHERE update_id='${esc(id)}' LIMIT 1`)[0];
    if(row?.status==="done")return row;
    if(row?.status==="failed")throw new Error(`inbox failed ${id}: ${row.last_error}`);
    await sleep(500);
  }
  throw new Error(`timeout ${id} ${JSON.stringify(row)}`);
}
const passes=[];
function pass(name,cond,detail=""){if(!cond)throw new Error(`FAIL ${name}: ${detail}`);passes.push({name,detail:String(detail)});console.log("PASS",name,detail)}
q(`DELETE FROM sanad_chat_leases WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_inbox WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_updates WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_shopping WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_reminders WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_memories WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_projects WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_waiting WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_audit WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_receipts WHERE chat_id='${esc(CHAT)}';
DELETE FROM sanad_failures WHERE chat_id='${esc(CHAT)}';`);

let id=await post("أنا نازل أجيب لبن كامل الدسم وعيش توست وكيس رز وبطاطس وشيدر، حطهم عندك في المشتريات");
let row=await wait(id,90000);
let shop=q(`SELECT title,status FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' ORDER BY id`);
pass("natural shopping persisted",row.attempts===1&&shop.length>=5,JSON.stringify(shop));

id=await post("/shopping");row=await wait(id);pass("shopping read command",row.attempts===1,"attempts="+row.attempts);

id=await post("فكرني يوم 3 نوفمبر 2026 الساعة 7:23 مساء أكلم دكتور الأسنان");
row=await wait(id,90000);
let rem=q(`SELECT title,local_date,local_time,status FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND status='active' ORDER BY id DESC LIMIT 1`)[0];
pass("natural reminder verified",row.attempts===1&&rem?.local_date==="2026-11-03"&&rem?.local_time==="19:23",JSON.stringify(rem));

id=await post("افتكر إن مقاسي في التيشيرتات Large وبفضل القهوة من غير سكر");
row=await wait(id,90000);
let mem=q(`SELECT content,memory_type FROM sanad_memories WHERE chat_id='${esc(CHAT)}' ORDER BY id`);
pass("memory tools",row.attempts===1&&mem.length>=1,JSON.stringify(mem));

id=await post("ضيف زبادي للمشتريات وكمان فكرني يوم 4 نوفمبر 2026 الساعة 8 مساء أجيب الدوا");
row=await wait(id,90000);
shop=q(`SELECT title FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' AND status='pending' ORDER BY id`);
rem=q(`SELECT title,local_date,local_time FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND local_date='2026-11-04' AND local_time='20:00' AND status='active'`);
pass("multi-tool one message",row.attempts===1&&shop.some(x=>String(x.title).includes("زبادي"))&&rem.length>=1,`shop=${shop.length} rem=${rem.length}`);

const dup=++seq;
await Promise.all([post("ضيف مانجا للمشتريات",dup),post("ضيف مانجا للمشتريات",dup)]);
row=await wait(dup,90000);
const mango=q(`SELECT id FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' AND normalized LIKE '%مانجا%'`);
pass("telegram idempotency",mango.length===1,`rows=${mango.length}`);

const bad=q(`SELECT scope,error_text FROM sanad_failures WHERE chat_id='${esc(CHAT)}'`);
pass("runtime failures zero",bad.length===0,JSON.stringify(bad));

const unverified=q(`SELECT tool,verified,result_json FROM sanad_audit WHERE chat_id='${esc(CHAT)}' AND tool IN ('shopping.add','reminders.create','memory.remember') AND verified=0`);
pass("no unverified success mutations",unverified.length===0,JSON.stringify(unverified));

fs.writeFileSync("SANAD_V12_LIVE_REPORT.json",JSON.stringify({ok:true,version:"12.0.0",scenario_count:passes.length,passes},null,2));
console.log("LIVE PASS",passes.length);
