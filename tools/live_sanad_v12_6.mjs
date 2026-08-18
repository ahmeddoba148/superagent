import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const URL=process.env.URL,DB=process.env.DB,CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||''),SECRET=process.env.WEBHOOK_SECRET,SETUP=process.env.SETUP_KEY,CFG=process.env.WRANGLER_CONFIG||'wrangler.sanad126.jsonc';
if(!URL||!DB||!CHAT||!SECRET||!SETUP)throw new Error('missing live env');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replaceAll("'","''");
function q(sql){return JSON.parse(execFileSync('npx',['wrangler','d1','execute',DB,'--remote','--config',CFG,'--command',sql,'--json'],{encoding:'utf8'}))?.[0]?.results||[]}
let seq=4260000000+(Date.now()%1000000),mid=1260000;
async function postBody(body,id){for(let a=1;a<=10;a++){const r=await fetch(URL+'/telegram',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify(body)});if(r.ok)return id;const t=await r.text();if([401,404,503].includes(r.status)&&a<10){await sleep(2500);continue}throw new Error(`webhook ${r.status} ${t}`)}}
async function postText(text,id=++seq){return postBody({update_id:id,message:{message_id:++mid,date:Math.floor(Date.now()/1000),chat:{id:Number(CHAT),type:'private'},from:{id:Number(CHAT),is_bot:false,first_name:'SanadV126Test'},text}},id)}
async function postCallback(data,id=++seq){return postBody({update_id:id,callback_query:{id:`cb-${id}`,from:{id:Number(CHAT),is_bot:false,first_name:'SanadV126Test'},message:{message_id:++mid,date:Math.floor(Date.now()/1000),chat:{id:Number(CHAT),type:'private'}},data}},id)}
async function wait(id,max=120000){const end=Date.now()+max;let row;while(Date.now()<end){row=q(`SELECT status,attempts,last_error FROM sanad_inbox WHERE update_id='${esc(id)}' LIMIT 1`)[0];if(row?.status==='done')return row;if(row?.status==='failed')throw new Error(`inbox failed ${id}: ${row.last_error}`);await sleep(650)}throw new Error(`timeout ${id} ${JSON.stringify(row)}`)}
const passes=[];function pass(name,cond,detail=''){if(!cond)throw new Error(`FAIL ${name}: ${detail}`);passes.push({name,detail:String(detail)});console.log('PASS',name,detail)}

const tables=['sanad_chat_leases','sanad_inbox','sanad_updates','sanad_shopping','sanad_shopping_sessions','sanad_reminders','sanad_reminder_fires','sanad_recurrences','sanad_recurrence_fires','sanad_dependencies','sanad_memories','sanad_entities','sanad_edges','sanad_projects','sanad_project_tasks','sanad_waiting','sanad_prayer_rules','sanad_prayer_fires','sanad_live_watches','sanad_life_inbox','sanad_audit','sanad_receipts','sanad_failures','sanad_proactive_fires','sanad_pending_actions','sanad_pending_conflicts','sanad_operation_snapshots','sanad_rate_limits','sanad_daily_brief_fires','sanad_legacy_id_map'];
for(const t of tables){try{q(`DELETE FROM ${t} WHERE chat_id='${esc(CHAT)}'`)}catch{}}
q(`DELETE FROM sanad_users WHERE chat_id='${esc(CHAT)}'`);
q(`INSERT INTO sanad_meta(key,value,updated_at) VALUES('ci_silent_telegram','1',datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=datetime('now')`);

let id=await postText('أنا نازل السوبر ماركت، حطلي لبن كامل الدسم وعيش توست ورز بسمتي وبطاطس وشيدر في المشتريات');let row=await wait(id);let shop=q(`SELECT id,title,status FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' ORDER BY id`);pass('natural shopping persisted',shop.length>=5,JSON.stringify(shop));

const milk=shop.find(x=>String(x.title).includes('لبن'));pass('shopping target exists',!!milk,JSON.stringify(milk));
id=await postText('اللبن مش موجود، علمه غير متاح');row=await wait(id);let s=q(`SELECT status FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' AND id=${Number(milk.id)}`)[0];pass('shopping unavailable state',s?.status==='unavailable',JSON.stringify(s));
id=await postText('سيب العيش مش هجيبه');row=await wait(id);s=q(`SELECT status FROM sanad_shopping WHERE chat_id='${esc(CHAT)}' AND title LIKE '%عيش%' ORDER BY id DESC LIMIT 1`)[0];pass('shopping skipped state',s?.status==='skipped',JSON.stringify(s));

id=await postText('حط في الانبوكس أكلم شركة الصيانة بخصوص التكييف');row=await wait(id);let inbox=q(`SELECT id,text,status FROM sanad_life_inbox WHERE chat_id='${esc(CHAT)}' AND status='open' ORDER BY id DESC LIMIT 1`)[0];pass('life inbox natural capture',String(inbox?.text||'').includes('الصيانة'),JSON.stringify(inbox));

id=await postText('فكرني يوم 10 ديسمبر 2026 الساعة 6 مساء اجتماع الفريق لمدة ساعة');row=await wait(id);let a=q(`SELECT * FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND local_date='2026-12-10' AND local_time='18:00' ORDER BY id DESC LIMIT 1`)[0];pass('source appointment created',!!a&&Number(a.duration_minutes)>=60,JSON.stringify(a));
id=await postText('فكرني يوم 10 ديسمبر 2026 الساعة 8 مساء أبعت التقرير');row=await wait(id);let b=q(`SELECT * FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND local_date='2026-12-10' AND local_time='20:00' ORDER BY id DESC LIMIT 1`)[0];pass('target reminder created',!!b,JSON.stringify(b));
id=await postText('خلي أبعت التقرير بعد نهاية اجتماع الفريق بنص ساعة');row=await wait(id);let dep=q(`SELECT * FROM sanad_dependencies WHERE chat_id='${esc(CHAT)}' AND active=1 ORDER BY id DESC LIMIT 1`)[0];pass('after-end dependency stored',dep?.relation==='after_end'&&Number(dep.offset_minutes)===30&&Number(dep.source_id)===Number(a.id)&&Number(dep.target_id)===Number(b.id),JSON.stringify({dep,expected_source:a?.id,expected_target:b?.id}));
if(dep){q(`UPDATE sanad_reminders SET local_time='19:00',updated_at=datetime('now') WHERE id=${Number(a.id)} AND chat_id='${esc(CHAT)}'`);q(`UPDATE sanad_reminders SET local_time='20:30',updated_at=datetime('now') WHERE id=${Number(b.id)} AND chat_id='${esc(CHAT)}'`);}
id=await postText('حرّك اجتماع الفريق نص ساعة لقدام');row=await wait(id);b=q(`SELECT local_time FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND id=${Number(b.id)}`)[0];pass('after-end dependency propagation',b?.local_time==='21:00',JSON.stringify(b));

id=await postText('من يوم 1 سبتمبر 2026 فكرني كل يوم الساعة 8 الصبح أخد الدوا');row=await wait(id);let rec=q(`SELECT id,rule_json,start_date,active,paused_until FROM sanad_recurrences WHERE chat_id='${esc(CHAT)}' AND title LIKE '%الدوا%' ORDER BY id DESC LIMIT 1`)[0];pass('recurrence exists',!!rec&&String(rec.rule_json).includes('08:00'),JSON.stringify(rec));
id=await postText('وقف تذكير الدوا مؤقتا لحد يوم 5 سبتمبر 2026');row=await wait(id);rec=q(`SELECT active,paused_until FROM sanad_recurrences WHERE chat_id='${esc(CHAT)}' AND id=${Number(rec.id)}`)[0];pass('temporary pause until',Number(rec?.active)===1&&!!rec?.paused_until,JSON.stringify(rec));
id=await postText('شغل تذكير الدوا تاني');row=await wait(id);rec=q(`SELECT active,paused_until FROM sanad_recurrences WHERE chat_id='${esc(CHAT)}' AND id=${Number(rec.id)}`)[0];pass('recurrence resume clears pause',Number(rec?.active)===1&&!rec?.paused_until,JSON.stringify(rec));

id=await postText('فكرني يوم 11 ديسمبر 2026 الساعة 9 مساء أراجع الخطة');row=await wait(id);let callbackRem=q(`SELECT id FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND local_date='2026-12-11' AND local_time='21:00' ORDER BY id DESC LIMIT 1`)[0];pass('callback reminder exists',!!callbackRem,JSON.stringify(callbackRem));
id=await postCallback(`s126:rem:snooze:${callbackRem.id}:10`);row=await wait(id);let cb=q(`SELECT local_time FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND id=${Number(callbackRem.id)}`)[0];pass('reminder callback snooze',cb?.local_time==='21:10',JSON.stringify(cb));
id=await postCallback(`s126:rem:done:${callbackRem.id}`);row=await wait(id);cb=q(`SELECT status FROM sanad_reminders WHERE chat_id='${esc(CHAT)}' AND id=${Number(callbackRem.id)}`)[0];pass('reminder callback done',cb?.status==='done',JSON.stringify(cb));

id=await postText('/tomorrow');row=await wait(id);pass('/tomorrow alias',row.attempts===1,JSON.stringify(row));
id=await postText('/list');row=await wait(id);pass('/list alias',row.attempts===1,JSON.stringify(row));
id=await postText('/live');row=await wait(id,160000);pass('/live composite reality',row.status==='done',JSON.stringify(row));

const diag=await fetch(URL+'/diagnostics',{headers:{'X-Sanad-Key':SETUP}});const dx=await diag.json();pass('protected diagnostics',diag.ok&&dx.ok&&dx.version==='12.6.0'&&Number(dx.tools)>=70,JSON.stringify({status:diag.status,version:dx.version,tools:dx.tools,snapshot_tables:dx.snapshot_tables}));

const failures=q(`SELECT scope,error_text FROM sanad_failures WHERE chat_id='${esc(CHAT)}'`);pass('runtime failures zero',failures.length===0,JSON.stringify(failures));
const dangerous=q(`SELECT tool,result_json FROM sanad_audit WHERE chat_id='${esc(CHAT)}' AND verified=0`).filter(x=>/\"changed\"\s*:\s*[1-9]/.test(String(x.result_json)));pass('no changed mutation left unverified',dangerous.length===0,JSON.stringify(dangerous));

q(`UPDATE sanad_meta SET value='0',updated_at=datetime('now') WHERE key='ci_silent_telegram'`);
fs.writeFileSync('SANAD_V12_6_LIVE_REPORT.json',JSON.stringify({ok:true,version:'12.6.0',scenario_count:passes.length,passes},null,2));
console.log('LIVE PASS',passes.length);
