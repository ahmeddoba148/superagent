import {execFileSync} from "node:child_process";
import fs from "node:fs";
const URL=process.env.URL,DB=process.env.DB,CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||""),SECRET=process.env.WEBHOOK_SECRET,CFG=process.env.WRANGLER_CONFIG||"wrangler.sanad125.jsonc";
if(!URL||!DB||!CHAT||!SECRET)throw new Error("missing live env");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replaceAll("'","''");
function q(sql){return JSON.parse(execFileSync("npx",["wrangler","d1","execute",DB,"--remote","--config",CFG,"--command",sql,"--json"],{encoding:"utf8"}))?.[0]?.results||[]}
let seq=3250000000+(Date.now()%1000000),mid=850000;
async function postText(text,id=++seq){return postBody({update_id:id,message:{message_id:++mid,date:Math.floor(Date.now()/1000),chat:{id:Number(CHAT),type:"private"},from:{id:Number(CHAT),is_bot:false,first_name:"SanadV125Test"},text}},id)}
async function postLocation(lat,lon,id=++seq){return postBody({update_id:id,message:{message_id:++mid,date:Math.floor(Date.now()/1000),chat:{id:Number(CHAT),type:"private"},from:{id:Number(CHAT),is_bot:false,first_name:"SanadV125Test"},location:{latitude:lat,longitude:lon}}},id)}
async function postBody(body,id){for(let a=1;a<=10;a++){const r=await fetch(URL+"/telegram",{method:"POST",headers:{"content-type":"application/json","X-Telegram-Bot-Api-Secret-Token":SECRET},body:JSON.stringify(body)});if(r.ok)return id;const t=await r.text();if((r.status===401||r.status===404||r.status===503)&&a<10){await sleep(2500);continue}throw new Error(`webhook ${r.status} ${t}`)}}
async function wait(id,max=120000){const end=Date.now()+max;let row;while(Date.now()<end){row=q(`SELECT status,attempts,last_error FROM sanad_inbox WHERE update_id='${esc(id)}' LIMIT 1`)[0];if(row?.status==="done")return row;if(row?.status==="failed")throw new Error(`inbox failed ${id}: ${row.last_error}`);await sleep(600)}throw new Error(`timeout ${id} ${JSON.stringify(row)}`)}
const passes=[];function pass(name,cond,detail=""){if(!cond)throw new Error(`FAIL ${name}: ${detail}`);passes.push({name,detail:String(detail)});console.log("PASS",name,detail)}
const tables=['sanad_chat_leases','sanad_inbox','sanad_updates','sanad_shopping','sanad_shopping_sessions','sanad_reminders','sanad_reminder_fires','sanad_recurrences','sanad_recurrence_fires','sanad_dependencies','sanad_memories','sanad_entities','sanad_edges','sanad_projects','sanad_project_tasks','sanad_waiting','sanad_prayer_rules','sanad_prayer_fires','sanad_live_watches','sanad_audit','sanad_receipts','sanad_failures','sanad_proactive_fires','sanad_pending_actions','sanad_operation_snapshots','sanad_rate_limits'];
for(const t of tables){try{q(`DELETE FROM ${t} WHERE chat_id='${esc(CHAT)}'`)}catch{}}
q(`DELETE FROM sanad_users WHERE chat_id='${esc(CHAT)}'`);

let id=await postText("أنا نازل السوبر ماركت، حطلي لبن كامل الدسم وعيش توست ورز بسمتي وبطاطس وشيدر في المشتريات");let row=await wait(id);let shop=q(`SELECT title,status FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' ORDER BY id`);pass("natural shopping persisted",row.attempts===1&&shop.length>=5,JSON.stringify(shop));

id=await postText("فكرني يوم 3 نوفمبر 2026 الساعة 7:23 بالليل أكلم دكتور الأسنان");row=await wait(id);let rem=q(`SELECT title,local_date,local_time,status FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND status='active' ORDER BY id DESC LIMIT 1`)[0];pass("exact reminder persisted",rem?.local_date==='2026-11-03'&&rem?.local_time==='19:23',JSON.stringify(rem));

id=await postText("من يوم 25 اغسطس 2026 فكرني كل يوم الساعة 8:15 الصبح أخد الدوا");row=await wait(id);let rec=q(`SELECT title,rule_json,start_date,active FROM sanad_recurrences WHERE chat_id='${esc(CHAT)}' AND active=1 ORDER BY id DESC LIMIT 1`)[0];pass("natural recurrence",!!rec&&rec.start_date==='2026-08-25'&&String(rec.rule_json).includes('08:15'),JSON.stringify(rec));

id=await postText("افتكر إن مقاسي في التيشيرتات Large وبحب القهوة من غير سكر");row=await wait(id);let mem=q(`SELECT content,memory_type FROM sanad_memories WHERE chat_id='${esc(CHAT)}' ORDER BY id`);pass("layered memory",mem.length>=1,JSON.stringify(mem));

id=await postText("اعمل مشروع اسمه تجهيز البيت وأولويته عالية، وحط جواه مهمة اسمها مراجعة الكهرباء");row=await wait(id);let project=q(`SELECT id,title,priority FROM sanad_projects WHERE chat_id='${esc(CHAT)}' AND title LIKE '%تجهيز البيت%' ORDER BY id DESC LIMIT 1`)[0];let tasks=project?q(`SELECT title FROM sanad_project_tasks WHERE chat_id='${esc(CHAT)}' AND project_id=${Number(project.id)}`):[];pass("project plus task one message",!!project&&tasks.some(x=>String(x.title).includes('الكهرباء')),JSON.stringify({project,tasks}));

id=await postText("سجل عندك إني مستني رد المهندس على مقاسات المطبخ");row=await wait(id);let waiting=q(`SELECT title,waiting_on,status FROM sanad_waiting WHERE chat_id='${esc(CHAT)}' AND status='waiting'`);pass("waiting list",waiting.length>=1,JSON.stringify(waiting));

id=await postText("كل يوم نبهني قبل الفجر بعشر دقايق");row=await wait(id);let pr=q(`SELECT prayer,offset_minutes,active FROM sanad_prayer_rules WHERE chat_id='${esc(CHAT)}' AND active=1 ORDER BY id DESC LIMIT 1`)[0];pass("prayer relative rule",pr?.prayer==='Fajr'&&Number(pr.offset_minutes)===-10,JSON.stringify(pr));

id=await postText("شغللي الملخص الصباحي كل يوم الساعة 8 الصبح");row=await wait(id);let usr=q(`SELECT morning_brief_enabled,morning_brief_time FROM sanad_users WHERE chat_id='${esc(CHAT)}'`)[0];pass("morning brief settings",Number(usr?.morning_brief_enabled)===1&&usr?.morning_brief_time==='08:00',JSON.stringify(usr));

id=await postLocation(30.0444,31.2357);row=await wait(id);usr=q(`SELECT latitude,longitude FROM sanad_users WHERE chat_id='${esc(CHAT)}'`)[0];pass("location persisted",Math.abs(Number(usr?.latitude)-30.0444)<0.0001&&Math.abs(Number(usr?.longitude)-31.2357)<0.0001,JSON.stringify(usr));

id=await postText("ضيف زبادي للمشتريات، وافتكر إني بفضله يوناني، وكمان فكرني يوم 4 نوفمبر 2026 الساعة 8 مساء أجيب الدوا");row=await wait(id);shop=q(`SELECT title FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' AND status='pending'`);rem=q(`SELECT title FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND local_date='2026-11-04' AND local_time='20:00' AND status='active'`);mem=q(`SELECT content FROM sanad_memories WHERE chat_id='${esc(CHAT)}'`);pass("three-domain one message",shop.some(x=>String(x.title).includes('زبادي'))&&rem.length>=1&&mem.some(x=>String(x.content).includes('يوناني')),`shop=${shop.length} rem=${rem.length} mem=${mem.length}`);

const dup=++seq;await Promise.all([postText("ضيف مانجا للمشتريات",dup),postText("ضيف مانجا للمشتريات",dup)]);row=await wait(dup);let mango=q(`SELECT id FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' AND normalized LIKE '%مانجا%'`);pass("telegram idempotency",mango.length===1,`rows=${mango.length}`);

const burstTexts=['ضيف تفاح للمشتريات','ضيف برتقال للمشتريات','ضيف خيار للمشتريات'];const burstIds=await Promise.all(burstTexts.map(t=>postText(t)));await Promise.all(burstIds.map(i=>wait(i)));shop=q(`SELECT normalized FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' AND status='pending'`);pass("same-chat serialized burst",['تفاح','برتقال','خيار'].every(v=>shop.some(x=>String(x.normalized).includes(v))),JSON.stringify(shop.slice(-8)));

const beforeClear=q(`SELECT COUNT(*) c FROM sanad_shopping WHERE chat_id='${esc(CHAT)}'`)[0]?.c||0;id=await postText("امسح كل قائمة المشتريات");row=await wait(id);let still=q(`SELECT COUNT(*) c FROM sanad_shopping WHERE chat_id='${esc(CHAT)}'`)[0]?.c||0;let pending=q(`SELECT steps_json FROM sanad_pending_actions WHERE chat_id='${esc(CHAT)}'`);pass("risky action waits confirmation",Number(still)===Number(beforeClear)&&pending.length===1,`before=${beforeClear} after=${still}`);id=await postText("ايوه");row=await wait(id);still=q(`SELECT COUNT(*) c FROM sanad_shopping WHERE chat_id='${esc(CHAT)}'`)[0]?.c||0;pass("confirmed clear verified",Number(still)===0,`rows=${still}`);

id=await postText("/undo");row=await wait(id);still=q(`SELECT COUNT(*) c FROM sanad_shopping WHERE chat_id='${esc(CHAT)}'`)[0]?.c||0;pass("undo restores atomic snapshot",Number(still)===Number(beforeClear),`rows=${still}`);

id=await postText("/week");row=await wait(id);pass("week command",row.attempts===1,`attempts=${row.attempts}`);

const failures=q(`SELECT scope,error_text FROM sanad_failures WHERE chat_id='${esc(CHAT)}'`);pass("runtime failures zero",failures.length===0,JSON.stringify(failures));
const unverified=q(`SELECT tool,result_json FROM sanad_audit WHERE chat_id='${esc(CHAT)}' AND tool NOT LIKE 'system.%' AND verified=0 AND tool IN (SELECT tool FROM sanad_audit WHERE chat_id='${esc(CHAT)}')`);const dangerous=unverified.filter(x=>/\"changed\"\s*:\s*[1-9]/.test(String(x.result_json)));pass("no changed mutation left unverified",dangerous.length===0,JSON.stringify(dangerous));
const committed=q(`SELECT COUNT(*) c FROM sanad_operation_snapshots WHERE chat_id='${esc(CHAT)}' AND committed=1`)[0]?.c||0;pass("durable atomic snapshots",Number(committed)>=5,`committed=${committed}`);

fs.writeFileSync("SANAD_V12_5_LIVE_REPORT.json",JSON.stringify({ok:true,version:'12.5.0',scenario_count:passes.length,passes},null,2));console.log('LIVE PASS',passes.length);
