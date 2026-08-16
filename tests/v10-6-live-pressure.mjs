import {execFileSync} from 'node:child_process';

const URL=process.env.STAGING_URL;
const SECRET=process.env.STAGING_TELEGRAM_WEBHOOK_SECRET;
const CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||'').trim();
const CONFIG='wrangler.v106.staging.jsonc';
const DB='superagent-v106-staging';
if(!URL||!SECRET||!CHAT)throw new Error('Missing V10.6 staging environment');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=s=>String(s).replaceAll("'","''");
const C=q(CHAT);
let seq=700000000+Number(String(Date.now()).slice(-7));
function d1(sql){const raw=execFileSync('npx',['wrangler','d1','execute',DB,'--remote','--json','--config',CONFIG,'--command',sql],{encoding:'utf8',env:process.env,maxBuffer:20*1024*1024});const j=JSON.parse(raw),b=Array.isArray(j)?j[0]:j;if(b?.success===false)throw new Error(raw);return b?.results||[];}
function assert(name,cond,detail=''){console.log(`${cond?'PASS':'FAIL'} ${name}${detail?` :: ${detail}`:''}`);if(!cond)throw new Error(`${name}: ${detail}`)}
async function post(update){const r=await fetch(`${URL}/telegram`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify(update)});const t=await r.text();if(r.status!==200||t!=='OK')throw new Error(`Webhook ${r.status} ${t}`);}
function update(id,text,chat=CHAT){return{update_id:id,message:{message_id:id,from:{id:Number(chat),is_bot:false,first_name:'Stress'},chat:{id:Number(chat),type:'private'},date:Math.floor(Date.now()/1000),text}}}
async function waitFor(fn,label,tries=80,delay=500){let last='';for(let i=0;i<tries;i++){const v=fn();if(v)return v;if(i%20===19)console.log(`WAIT ${label} ${(i+1)*delay}ms${last?` :: ${last}`:''}`);await sleep(delay)}throw new Error(`timeout ${label}`)}

console.log('=== V10.6 REAL CLOUDFLARE PRESSURE ===');
// isolate admin test state, including durable queue ledgers
for(const table of ['event_dependencies','reminder_fires','schedule_fires','reminders','schedule_rules','smart_list_items','life_edges','life_entities','conversation_messages','pending_dialogs','pending_conflicts','pending_requests','action_audit','operation_receipts','telegram_updates','telegram_inbox_v106','telegram_chat_leases_v106']){
  try{d1(`DELETE FROM ${table} WHERE chat_id='${C}'`)}catch(e){if(!/no such column/i.test(String(e)))throw e}
}

// 1) 25 concurrent copies of one exact update id: one durable inbox row and one action.
const duplicateId=++seq;
await Promise.all(Array.from({length:25},()=>post(update(duplicateId,'ضيف عنصر-دوبليكيت-106 للمشتريات'))));
await waitFor(()=>d1(`SELECT status FROM telegram_inbox_v106 WHERE update_id='${duplicateId}'`)[0]?.status==='done','duplicate done');
let rows=d1(`SELECT update_id,status,attempts FROM telegram_inbox_v106 WHERE update_id='${duplicateId}'`);
assert('25-way duplicate durable dedupe',rows.length===1&&rows[0].status==='done',JSON.stringify(rows));
let items=d1(`SELECT title FROM smart_list_items WHERE chat_id='${C}' AND title='عنصر-دوبليكيت-106'`);
assert('25-way duplicate executes once',items.length===1,JSON.stringify(items));

// 2) 40 distinct updates fired simultaneously at the same chat.
// Every command produces a real Telegram reply. Under one-chat flood control the delivery path can be
// deliberately slow, so this is an eventual-durability torture test, not an 80-second latency test.
// Semantics stay strict: all 40 must commit once, all 40 effects must exist, all 40 ledgers must be done,
// no terminal failure is allowed, and the complete burst must still settle inside the bounded 7-minute SLA.
const ids=[];const req=[];
for(let i=1;i<=40;i++){const id=++seq;ids.push(id);req.push(post(update(id,`ضيف ضغط106-${String(i).padStart(2,'0')} للمشتريات`)))}
const burstStarted=Date.now();
await Promise.all(req);
await waitFor(()=>{
  const states=d1(`SELECT status,COUNT(*) c FROM telegram_inbox_v106 WHERE update_id IN (${ids.map(String).join(',')}) GROUP BY status`);
  const failed=states.find(x=>x.status==='failed');
  if(failed)throw new Error(`40-way terminal failure: ${JSON.stringify(states)}`);
  const done=states.find(x=>x.status==='done');
  return Number(done?.c)===40;
},'40 same-chat inbox done',900,500);
const burstElapsed=Date.now()-burstStarted;
assert('40-way same-chat completes inside 7-minute reliability SLA',burstElapsed<420000,`elapsed_ms=${burstElapsed}`);
rows=d1(`SELECT status,COUNT(*) c FROM telegram_inbox_v106 WHERE update_id IN (${ids.map(String).join(',')}) GROUP BY status`);
assert('40-way same-chat burst all done',rows.length===1&&rows[0].status==='done'&&Number(rows[0].c)===40,JSON.stringify(rows));
items=d1(`SELECT title FROM smart_list_items WHERE chat_id='${C}' AND title LIKE 'ضغط106-%' ORDER BY title`);
assert('40-way same-chat burst no lost writes',items.length===40,`count=${items.length}`);
const ledger=d1(`SELECT status,COUNT(*) c FROM telegram_updates WHERE update_id IN (${ids.map(x=>`'${x}'`).join(',')}) GROUP BY status`);
assert('40-way Telegram ledger all done',ledger.length===1&&ledger[0].status==='done'&&Number(ledger[0].c)===40,JSON.stringify(ledger));

// 3) Crash/lease recovery: seed an expired processing inbox + processing telegram ledger, then trigger a later update.
const recoverId=++seq;
const triggerId=++seq;
const payload=JSON.stringify(update(recoverId,'ضيف استرجاع-بعد-تعطل-106 للمشتريات'));
const old=new Date(Date.now()-180000).toISOString();
d1(`INSERT OR REPLACE INTO telegram_inbox_v106(update_id,chat_id,payload_json,status,attempts,lease_until,last_error,created_at,updated_at) VALUES ('${recoverId}','${C}','${q(payload)}','processing',1,'${old}','simulated crash','${old}','${old}'); INSERT OR REPLACE INTO telegram_updates(update_id,chat_id,update_type,status,started_at,finished_at,error_text) VALUES ('${recoverId}','${C}','message','processing','${old}',NULL,NULL);`);
await post(update(triggerId,'ضيف مشغل-الاسترجاع-106 للمشتريات'));
await waitFor(()=>d1(`SELECT status FROM telegram_inbox_v106 WHERE update_id='${recoverId}'`)[0]?.status==='done','expired lease recovered',100,500);
rows=d1(`SELECT status,attempts,last_error FROM telegram_inbox_v106 WHERE update_id='${recoverId}'`);
assert('expired processing update recovered',rows[0]?.status==='done'&&Number(rows[0]?.attempts)>=2,JSON.stringify(rows));
items=d1(`SELECT title FROM smart_list_items WHERE chat_id='${C}' AND title='استرجاع-بعد-تعطل-106'`);
assert('recovered update effect exists exactly once',items.length===1,JSON.stringify(items));

// 4) Ordering stress with dependent commands: create precondition, then +1h and undo separated by 5ms.
const createId=++seq;await post(update(createId,'يوم 20 ديسمبر 2026 الساعة 6 مساء عندي اجتماع اسمه ضغط ترتيب 106 ومدته ساعة'));
await waitFor(()=>d1(`SELECT local_time FROM reminders WHERE chat_id='${C}' AND title LIKE '%ضغط ترتيب 106%' AND cancelled=0`)[0]?.local_time==='18:00','ordered create',100,600);
const shiftId=++seq,undoId=++seq;
await Promise.all([post(update(shiftId,'أجل اجتماع ضغط ترتيب 106 ساعة')),(async()=>{await sleep(5);return post(update(undoId,'رجع آخر تعديل'))})()]);
await waitFor(()=>{const a=d1(`SELECT status FROM telegram_inbox_v106 WHERE update_id IN ('${shiftId}','${undoId}')`);return a.length===2&&a.every(x=>x.status==='done')},'shift undo queue done',100,500);
const ordered=d1(`SELECT local_time FROM reminders WHERE chat_id='${C}' AND title LIKE '%ضغط ترتيب 106%' AND cancelled=0`)[0];
assert('cross-request shift then undo preserves final state',ordered?.local_time==='18:00',JSON.stringify(ordered));

// 5) Unauthorized secret and malformed JSON never enter durable inbox.
const before=Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106`)[0]?.c||0);
let r=await fetch(`${URL}/telegram`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':'WRONG'},body:JSON.stringify(update(++seq,'لا ينفذ'))});assert('wrong webhook secret rejected',r.status===401,`HTTP ${r.status}`);
r=await fetch(`${URL}/telegram`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:'{not-json'});assert('malformed JSON rejected',r.status===400,`HTTP ${r.status}`);
const after=Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106`)[0]?.c||0);assert('rejected requests never persisted',after===before,`before=${before} after=${after}`);

// 6) No stranded or terminal failed inbox rows for this user; health remains green.
await waitFor(()=>Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106 WHERE chat_id='${C}' AND status IN ('pending','processing')`)[0]?.c||0)===0,'no stranded inbox',100,500);
rows=d1(`SELECT status,COUNT(*) c FROM telegram_inbox_v106 WHERE chat_id='${C}' GROUP BY status`);
assert('no terminal failed inbox rows',!rows.some(x=>x.status==='failed'),JSON.stringify(rows));
const health=await (await fetch(`${URL}/health`)).json();assert('health after real pressure',health.ok===true&&health.db===true&&health.omniai_service===true,JSON.stringify(health));
console.log(JSON.stringify({ok:true,duplicateFanout:25,sameChatBurst:40,sameChatBurstElapsedMs:burstElapsed,sameChatBurstSlaMs:420000,crashRecovery:true,orderedMutation:true,health:true},null,2));
