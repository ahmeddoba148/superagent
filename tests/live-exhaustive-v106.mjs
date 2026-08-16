import {execFileSync} from 'node:child_process';

const URL=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const SECRET=String(process.env.STAGING_TELEGRAM_WEBHOOK_SECRET||'');
const CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||'').trim();
const BOT_TOKEN=String(process.env.STAGING_TELEGRAM_BOT_TOKEN||'').trim();
const CONFIG=process.env.STAGING_CONFIG||'wrangler.v106.staging.jsonc';
const DB=process.env.STAGING_DB||'superagent-v106-staging';
if(!URL||!SECRET||!CHAT||!BOT_TOKEN) throw new Error('Missing exhaustive live staging environment');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=s=>String(s).replaceAll("'","''");
const C=q(CHAT);
let seq=820000000+Number(String(Date.now()).slice(-7));
const startedAt=new Date().toISOString();
const report=[];

function pass(name,detail=''){
  report.push({name,ok:true,detail});
  console.log(`PASS ${name}${detail?` :: ${detail}`:''}`);
}
function assert(name,cond,detail=''){
  if(!cond){console.error(`FAIL ${name}${detail?` :: ${detail}`:''}`);throw new Error(`${name}${detail?`: ${detail}`:''}`)}
  pass(name,detail);
}
function d1(sql){
  const raw=execFileSync('npx',['wrangler','d1','execute',DB,'--remote','--json','--config',CONFIG,'--command',sql],{encoding:'utf8',env:process.env,maxBuffer:30*1024*1024});
  const json=JSON.parse(raw);const block=Array.isArray(json)?json[0]:json;
  if(block?.success===false)throw new Error(`D1 failed: ${raw}`);
  return block?.results||[];
}
async function waitFor(fn,label,tries=180,delay=500){
  let last;
  for(let i=0;i<tries;i++){
    try{last=fn();if(last)return last;}catch(e){last=e}
    await sleep(delay);
  }
  throw new Error(`timeout ${label}${last instanceof Error?`: ${last.message}`:''}`);
}
function makeUpdate(id,text){
  return {update_id:id,message:{message_id:id,from:{id:Number(CHAT),is_bot:false,first_name:'Exhaustive'},chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text}};
}
async function post(update,{secret=SECRET,raw=null}={}){
  const r=await fetch(`${URL}/telegram`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:raw??JSON.stringify(update)});
  return {status:r.status,body:await r.text()};
}
async function sendText(text){
  const id=++seq;
  const r=await post(makeUpdate(id,text));
  assert(`webhook ACK ${id}`,r.status===200&&r.body==='OK',`HTTP ${r.status} ${r.body}`);
  return id;
}
function inboxStatus(id){return d1(`SELECT status,attempts,last_error FROM telegram_inbox_v106 WHERE update_id='${q(id)}' LIMIT 1`)[0]||null}
function itemExists(title){return d1(`SELECT id,title FROM smart_list_items WHERE chat_id='${C}' AND title='${q(title)}'`)}
function cairoParts(date=new Date()){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const m=Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,time:`${m.hour}:${m.minute}`};
}

console.log('=== SUPER AGENT V10.6 EXHAUSTIVE REAL-STAGING CERTIFICATION ===');
console.log(`Worker: ${URL}`);
console.log(`Started: ${startedAt}`);

// A) Public endpoints, identity and bindings.
let r=await fetch(`${URL}/`);let root=await r.json();
assert('root HTTP 200',r.status===200,`HTTP ${r.status}`);
assert('root version 10.6',root?.ok===true&&root?.version==='10.6',JSON.stringify(root));
r=await fetch(`${URL}/health`);const health0=await r.json();
assert('health green before chaos',r.status===200&&health0?.ok===true&&health0?.db===true&&health0?.omniai_service===true,JSON.stringify(health0));

// B) Real Telegram credential and outbound API reachability.
r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);const me=await r.json();
assert('Telegram getMe live',r.status===200&&me?.ok===true&&me?.result?.is_bot===true,JSON.stringify({status:r.status,ok:me?.ok,username:me?.result?.username}));

// C) Security boundary: unauthorized and malformed bodies never persist.
let before=Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106`)[0]?.c||0);
let bad=await post(makeUpdate(++seq,'SHOULD_NOT_RUN'),{secret:'INVALID-SECRET'});
assert('invalid webhook secret rejected',bad.status===401,`HTTP ${bad.status}`);
bad=await post(null,{raw:'{ definitely-not-json '});
assert('malformed webhook JSON rejected',bad.status===400,`HTTP ${bad.status}`);
let after=Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106`)[0]?.c||0);
assert('rejected requests not persisted',before===after,`before=${before} after=${after}`);

// D) Same update_id replay after durable ACK must never execute a changed payload.
const idemId=++seq;
let ack=await post(makeUpdate(idemId,'ضيف ثابت-اول-106 للمشتريات'));
assert('idempotency first ACK',ack.status===200&&ack.body==='OK',`HTTP ${ack.status}`);
await waitFor(()=>d1(`SELECT update_id FROM telegram_inbox_v106 WHERE update_id='${idemId}'`)[0],'idempotency durable persist',60,250);
const replay=await Promise.all(Array.from({length:18},(_,i)=>post(makeUpdate(idemId,i%2?'ضيف ثابت-ثاني-106 للمشتريات':'ضيف ثابت-اول-106 للمشتريات'))));
assert('18 replay requests ACK',replay.every(x=>x.status===200&&x.body==='OK'),JSON.stringify(replay.map(x=>x.status)));
await waitFor(()=>inboxStatus(idemId)?.status==='done','idempotent update done',120,500);
assert('idempotent first effect exactly once',itemExists('ثابت-اول-106').length===1,JSON.stringify(itemExists('ثابت-اول-106')));
assert('changed replay payload ignored',itemExists('ثابت-ثاني-106').length===0,JSON.stringify(itemExists('ثابت-ثاني-106')));
assert('single durable inbox row for replay',Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106 WHERE update_id='${idemId}'`)[0]?.c||0)===1);

// E) Three realistic same-chat burst waves. This catches lease handoff, waitUntil pressure and lost writes.
const waveIds=[];
for(let wave=1;wave<=3;wave++){
  const req=[];
  for(let i=1;i<=12;i++){
    const id=++seq;waveIds.push(id);
    req.push(post(makeUpdate(id,`ضيف موجة${wave}-عنصر${String(i).padStart(2,'0')}-106 للمشتريات`)));
  }
  const acks=await Promise.all(req);
  assert(`burst wave ${wave} ACK x12`,acks.every(x=>x.status===200&&x.body==='OK'));
  await sleep(120);
}
await waitFor(()=>Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106 WHERE update_id IN (${waveIds.map(String).join(',')}) AND status='done'`)[0]?.c||0)===waveIds.length,'36 burst updates done',240,500);
const waveItems=Number(d1(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id='${C}' AND title LIKE 'موجة%-عنصر%-106'`)[0]?.c||0);
assert('36 burst effects preserved',waveItems===36,`count=${waveItems}`);
const waveLedger=d1(`SELECT status,COUNT(*) c FROM telegram_updates WHERE update_id IN (${waveIds.map(x=>`'${x}'`).join(',')}) GROUP BY status`);
assert('36 burst ledger all done',waveLedger.length===1&&waveLedger[0]?.status==='done'&&Number(waveLedger[0]?.c)===36,JSON.stringify(waveLedger));

// F) General-chat/AI path on the actual deployed worker. A durable done ledger means the handler completed end-to-end.
const chatId=await sendText('صباح الفل يا سوبر إيجنت، رد عليا بجملة قصيرة فقط');
await waitFor(()=>inboxStatus(chatId)?.status==='done','general chat AI done',160,500);
const chatLedger=d1(`SELECT status,error_text FROM telegram_updates WHERE update_id='${chatId}' LIMIT 1`)[0];
assert('general chat Telegram ledger done',chatLedger?.status==='done',JSON.stringify(chatLedger));

// G) Scheduled crash recovery WITHOUT a new webhook trigger. The cron itself must rescue the pending durable row.
const cronRecoverId=++seq;
const cronTitle='استرجاع-كرون-106';
const payload=JSON.stringify(makeUpdate(cronRecoverId,`ضيف ${cronTitle} للمشتريات`));
const old=new Date(Date.now()-180000).toISOString();
d1(`INSERT OR REPLACE INTO telegram_inbox_v106(update_id,chat_id,payload_json,status,attempts,lease_until,last_error,created_at,updated_at) VALUES ('${cronRecoverId}','${C}','${q(payload)}','pending',1,NULL,'seeded for cron recovery','${old}','${old}'); DELETE FROM telegram_updates WHERE update_id='${cronRecoverId}';`);
await waitFor(()=>inboxStatus(cronRecoverId)?.status==='done','cron-only inbox recovery',220,500);
assert('cron recovery effect exactly once',itemExists(cronTitle).length===1,JSON.stringify(itemExists(cronTitle)));

// H) Actual scheduled reminder delivery through Telegram. One-time main reminders use reminders.sent as their delivery claim/state.
// reminder_fires is intentionally reserved for advance-alert dedupe, so an empty advance-alert list should not create a reminder_fires row.
const due=cairoParts(new Date(Date.now()-60000));
const marker=`اختبار-تسليم-فعلي-106-${String(Date.now()).slice(-6)}`;
d1(`INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES ('${C}','${q(marker)}','reminder','${due.date}','${due.time}',0,0,'${new Date().toISOString()}',0,'[]','Africa/Cairo')`);
const reminderRow=d1(`SELECT id,title,sent FROM reminders WHERE chat_id='${C}' AND title='${q(marker)}' ORDER BY id DESC LIMIT 1`)[0];
assert('due reminder seeded',!!reminderRow?.id,JSON.stringify(reminderRow));
await waitFor(()=>{const x=d1(`SELECT sent,cancelled FROM reminders WHERE id=${Number(reminderRow.id)} LIMIT 1`)[0];return Number(x?.sent)===1?x:null},'real cron reminder delivery',220,500);
await sleep(5000);
const deliveryFinal=d1(`SELECT sent,cancelled FROM reminders WHERE id=${Number(reminderRow.id)} LIMIT 1`)[0];
assert('real cron reminder delivery remains committed',Number(deliveryFinal?.sent)===1&&Number(deliveryFinal?.cancelled)===0,JSON.stringify(deliveryFinal));
const preFireCount=Number(d1(`SELECT COUNT(*) c FROM reminder_fires WHERE reminder_id=${Number(reminderRow.id)} AND fire_key LIKE 'pre:%'`)[0]?.c||0);
assert('no phantom advance-alert fire for empty alert list',preFireCount===0,`pre_fires=${preFireCount}`);

// I) Queue/ledger integrity: no admin staging work may remain stranded or failed.
await waitFor(()=>Number(d1(`SELECT COUNT(*) c FROM telegram_inbox_v106 WHERE chat_id='${C}' AND status IN ('pending','processing')`)[0]?.c||0)===0,'queue fully drained',160,500);
const qstates=d1(`SELECT status,COUNT(*) c FROM telegram_inbox_v106 WHERE chat_id='${C}' GROUP BY status ORDER BY status`);
assert('no terminal failed inbox row',!qstates.some(x=>x.status==='failed'),JSON.stringify(qstates));
const stuckLedger=Number(d1(`SELECT COUNT(*) c FROM telegram_updates WHERE chat_id='${C}' AND status!='done'`)[0]?.c||0);
assert('no non-done Telegram ledger row',stuckLedger===0,`count=${stuckLedger}`);

// J) No runtime failures during this certification window.
const failures=d1(`SELECT id,scope,error_text,created_at FROM runtime_failures WHERE created_at>='${q(startedAt)}' ORDER BY id`);
assert('zero runtime failures during exhaustive certification',failures.length===0,JSON.stringify(failures));

r=await fetch(`${URL}/health`);const health1=await r.json();
assert('health green after exhaustive chaos',r.status===200&&health1?.ok===true&&health1?.db===true&&health1?.omniai_service===true,JSON.stringify(health1));

console.log('\n=== EXHAUSTIVE LIVE CERTIFICATION PASS ===');
console.log(JSON.stringify({ok:true,checks:report.length,burstUpdates:waveIds.length,replayFanout:18,cronRecovery:true,realReminderDelivery:true,generalChatAI:true,startedAt,finishedAt:new Date().toISOString()},null,2));

// certification-trigger: callback-ledger-sync-v1
// certification-trigger: callback-ledger-sync-v2
// certification-trigger: one-time-delivery-contract-v1
