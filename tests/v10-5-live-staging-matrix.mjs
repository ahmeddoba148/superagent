import {execFileSync} from 'node:child_process';

const URL=process.env.STAGING_URL;
const SECRET=process.env.STAGING_TELEGRAM_WEBHOOK_SECRET;
const CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||'').trim();
const BOT_TOKEN=process.env.STAGING_TELEGRAM_BOT_TOKEN;
const CONFIG='wrangler.staging.jsonc';
const DB='superagent-v105-staging';
if(!URL||!SECRET||!CHAT||!BOT_TOKEN) throw new Error('Missing live staging environment');

let seq=Number(String(Date.now()).slice(-9));
const checks=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sqlq=s=>String(s).replaceAll("'","''");
function check(name,ok,detail=''){
  checks.push({name,ok:!!ok,detail});
  console.log(`${ok?'PASS':'FAIL'} ${name}${detail?` :: ${detail}`:''}`);
  if(!ok) throw new Error(`LIVE CHECK FAILED: ${name}${detail?` :: ${detail}`:''}`);
}
function d1(sql){
  const raw=execFileSync('npx',['wrangler','d1','execute',DB,'--remote','--json','--config',CONFIG,'--command',sql],{encoding:'utf8',env:process.env,maxBuffer:10*1024*1024});
  const j=JSON.parse(raw); const block=Array.isArray(j)?j[0]:j;
  if(block?.success===false) throw new Error(`D1 failed: ${raw}`);
  return block?.results||[];
}
async function postUpdate(update){
  const r=await fetch(`${URL}/telegram`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify(update)});
  const body=await r.text(); if(r.status!==200||body!=='OK') throw new Error(`Webhook ${r.status}: ${body}`);
}
async function waitLedger(id,label=`telegram ledger ${id}`,{tries=90,delay=350}={}){
  return poll(()=>{
    const row=d1(`SELECT status,error_text FROM telegram_updates WHERE update_id='${id}' LIMIT 1`)[0];
    if(row?.status==='failed') throw new Error(`${label} failed: ${row?.error_text||'unknown'}`);
    return row?.status==='done'?row:null;
  },{tries,delay,label});
}
async function say(text,{updateId=null,wait=950}={}){
  const id=updateId??++seq;
  console.log(`\nUSER > ${text}`);
  await postUpdate({update_id:id,message:{message_id:id,from:{id:Number(CHAT),is_bot:false,first_name:'Staging'},chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text}});
  if(wait){
    if(wait>0) await sleep(Math.min(wait,250));
    await waitLedger(id);
  }
  return id;
}
async function callback(data,messageId){
  const id=++seq;
  console.log(`\nCALLBACK > ${data}`);
  await postUpdate({update_id:id,callback_query:{id:`live-${id}`,from:{id:Number(CHAT),is_bot:false,first_name:'Staging'},message:{message_id:messageId,chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text:'لوحة اختبار'},chat_instance:'live',data}});
  await sleep(250);
  await waitLedger(id,`callback ledger ${id}`,{tries:90,delay:350});
}
async function poll(fn,{tries=16,delay=650,label='condition'}={}){
  let v; for(let i=0;i<tries;i++){v=fn();if(v) return v;await sleep(delay);}throw new Error(`Timeout waiting for ${label}`);
}
function reminders(){return d1(`SELECT id,title,kind,local_date,local_time,duration_minutes,cancelled,sent FROM reminders WHERE chat_id='${sqlq(CHAT)}' ORDER BY id`)}
function rules(){return d1(`SELECT id,title,kind,duration_minutes,start_at,end_at,max_occurrences,active,rule_json FROM schedule_rules WHERE chat_id='${sqlq(CHAT)}' ORDER BY id`)}
function shop(){return d1(`SELECT id,title,normalized_title,status FROM smart_list_items WHERE chat_id='${sqlq(CHAT)}' ORDER BY id`)}
function pending(){return d1(`SELECT chat_id,intent_json,conflicts_json FROM pending_conflicts WHERE chat_id='${sqlq(CHAT)}'`)}
function runtimeFailures(){return d1(`SELECT id,scope,error_text,created_at FROM runtime_failures WHERE created_at >= datetime('now','-30 minutes') ORDER BY id`)}

async function directTelegramMessage(text){
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:CHAT,text})});
  const j=await r.json();if(!j.ok)throw new Error(`Telegram sendMessage failed: ${JSON.stringify(j)}`);return j.result.message_id;
}

console.log('=== SUPER AGENT V10.5 REAL STAGING HUMAN MATRIX ===');
console.log(`Worker: ${URL}`);

// Completely isolate every live run from artifacts left by an earlier live run.
const C=sqlq(CHAT);
d1(`
DELETE FROM event_dependencies WHERE chat_id='${C}';
DELETE FROM reminder_fires WHERE chat_id='${C}';
DELETE FROM schedule_fires WHERE chat_id='${C}';
DELETE FROM reminders WHERE chat_id='${C}';
DELETE FROM schedule_rules WHERE chat_id='${C}';
DELETE FROM smart_list_items WHERE chat_id='${C}';
DELETE FROM life_edges WHERE chat_id='${C}';
DELETE FROM life_entities WHERE chat_id='${C}';
DELETE FROM conversation_messages WHERE chat_id='${C}';
DELETE FROM pending_dialogs WHERE chat_id='${C}';
DELETE FROM pending_conflicts WHERE chat_id='${C}';
DELETE FROM pending_requests WHERE chat_id='${C}';
DELETE FROM action_audit WHERE chat_id='${C}';
DELETE FROM operation_receipts WHERE chat_id='${C}';
DELETE FROM telegram_updates WHERE chat_id='${C}';
DELETE FROM runtime_failures WHERE chat_id='${C}' OR chat_id IS NULL;
`);

// 1) Deterministic appointment create/update/undo through the real Cloudflare Worker.
await say('يوم 20 أكتوبر 2026 الساعة 6 مساء عندي اجتماع اسمه برق 404 ومدته ساعة');
let row=await poll(()=>reminders().find(x=>String(x.title).includes('برق 404')),{tries:20,delay:700,label:'appointment create'});
check('live create appointment',row?.local_date==='2026-10-20'&&row?.local_time==='18:00'&&Number(row?.duration_minutes)===60,JSON.stringify(row));

await say('أجل اجتماع برق 404 ساعة');
row=await poll(()=>{const x=reminders().find(v=>String(v.title).includes('برق 404'));return x?.local_time==='19:00'?x:null;},{tries:20,delay:700,label:'appointment +1h'});
check('live relative +1h reschedule',row?.local_time==='19:00',JSON.stringify(row));

await say('رجع آخر تعديل');
row=await poll(()=>{const x=reminders().find(v=>String(v.title).includes('برق 404'));return x?.local_time==='18:00'?x:null;},{tries:20,delay:700,label:'appointment undo'});
check('live natural undo deterministic',row?.local_time==='18:00',JSON.stringify(row));

// 2) Recurrence count, occurrence duration, deterministic update/delete/undo.
await say('كل يوم الساعة 10:20 مساء لمدة 5 أيام ابتداءً من 25 أكتوبر 2026 فكرني أراجع المشروع');
let rule=await poll(()=>rules().find(x=>String(x.title).includes('أراجع المشروع')),{tries:24,delay:700,label:'recurrence create'});
check('live recurrence count=5',Number(rule?.max_occurrences)===5,JSON.stringify(rule));
check('live recurrence occurrence duration=0',Number(rule?.duration_minutes)===0,JSON.stringify(rule));

await say('خلي تذكير أراجع المشروع المتكرر الساعة 11 مساء');
rule=await poll(()=>{const x=rules().find(v=>String(v.title).includes('أراجع المشروع'));return x?.start_at?.includes('23:00')?x:null;},{tries:24,delay:700,label:'recurrence time update'});
check('live recurrence time update 23:00',rule?.start_at?.includes('23:00'),JSON.stringify(rule));
const parsedRule=JSON.parse(rule.rule_json||'{}');
check('live recurrence canonical time list updated',Array.isArray(parsedRule.times)&&parsedRule.times.includes('23:00'),JSON.stringify(parsedRule));

await say('احذف تذكير أراجع المشروع المتكرر');
await poll(()=>!rules().some(x=>String(x.title).includes('أراجع المشروع'))?true:null,{tries:20,delay:700,label:'recurrence delete'});
check('live recurring delete removes physical rule row',!rules().some(x=>String(x.title).includes('أراجع المشروع')));

await say('/undo');
rule=await poll(()=>rules().find(x=>String(x.title).includes('أراجع المشروع')),{tries:20,delay:700,label:'recurrence delete undo'});
check('live recurring delete undo restores rule',!!rule,JSON.stringify(rule));

// 3) Natural shopping parsing and semantic dedupe.
await say('هات جبنة رومي وجيبلي مية معدنية ومتنسانيش أجيب شاي وعاوز أشتري لبن ولبن ونبهني أجيب بيض');
let shopRows=shop();
const titles=shopRows.map(x=>x.title);
check('live shopping verbs cleaned',titles.includes('جبنة رومي')&&titles.includes('مية معدنية')&&titles.includes('شاي')&&titles.includes('لبن')&&titles.includes('بيض'),JSON.stringify(titles));
check('live shopping duplicate milk removed',titles.filter(x=>x==='لبن').length===1,JSON.stringify(titles));

// 4) Mixed timed purchase + multiple shopping clauses.
await say('بص يا معلم متنسانيش أجيب بكرة الساعة 4:40 العصر الدوا، وهاتلي رز وزيت، وجيبلي مية، وعاوز كمان مناديل ومناديل، وخلي بالك البيض للمشتريات مش تذكير');
row=await poll(()=>reminders().find(x=>String(x.title).includes('أجيب الدوا')),{tries:24,delay:700,label:'timed purchase reminder'});
check('live timed purchase title cleaned',row?.local_time==='16:40'&&String(row.title).trim()==='أجيب الدوا',JSON.stringify(row));
shopRows=shop();
const normalized=shopRows.map(x=>({t:x.title,n:x.normalized_title}));
check('live mixed shopping has rice',shopRows.some(x=>x.title==='رز'),JSON.stringify(shopRows.map(x=>x.title)));
check('live mixed shopping has oil',shopRows.some(x=>x.title==='زيت'),JSON.stringify(shopRows.map(x=>x.title)));
check('live mixed shopping has tissues once',shopRows.filter(x=>x.title==='مناديل').length===1,JSON.stringify(shopRows.map(x=>x.title)));
check('live definite-article egg dedupe',normalized.filter(x=>x.n==='بيض').length===1,JSON.stringify(normalized));
const timedOnly=reminders().filter(x=>String(x.local_time)==='16:40');
check('live shopping did not become timed reminder',timedOnly.length===1&&String(timedOnly[0].title).trim()==='أجيب الدوا',JSON.stringify(timedOnly));

// 5) Exact same Telegram update id must be applied once.
const dupId=++seq;
await say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dupId,wait:0});
await say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dupId,wait:0});
await waitLedger(dupId,'duplicate update ledger');
const dupRows=await poll(()=>{const x=reminders().filter(v=>String(v.title).includes('أراجع اختبار التكرار'));return x.length===1?x:null;},{tries:20,delay:700,label:'Telegram idempotency'});
check('live Telegram update idempotency',dupRows.length===1,JSON.stringify(dupRows));

// 6) Same-chat rapid update then natural undo, without waiting between webhook requests.
const rapidCreateId=await say('يوم 21 نوفمبر 2026 الساعة 6 مساء عندي اجتماع اسمه سريع 717 ومدته ساعة',{wait:0});
await waitLedger(rapidCreateId,'rapid appointment create ledger');
await poll(()=>{const x=reminders().find(v=>String(v.title).includes('سريع 717'));return x?.local_time==='18:00'?x:null;},{tries:45,delay:700,label:'rapid appointment create precondition'});
let rapidIds=[];
await Promise.all([
  say('أجل اجتماع سريع 717 ساعة',{wait:0}).then(id=>rapidIds.push(id)),
  (async()=>{await sleep(35);const id=await say('رجع آخر تعديل',{wait:0});rapidIds.push(id)})()
]);
await Promise.all(rapidIds.map(id=>waitLedger(id,`rapid mutation ledger ${id}`)));
const rapid=await poll(()=>{const x=reminders().find(v=>String(v.title).includes('سريع 717'));return x?.local_time==='18:00'?x:null;},{tries:45,delay:700,label:'rapid shift+undo settled state'});
check('live rapid shift+undo final state',rapid?.local_time==='18:00',JSON.stringify(rapid));

// 7) No stale conflict-confirm is allowed to resurrect anything.
d1(`DELETE FROM pending_conflicts WHERE chat_id='${C}'`);
const beforeCount=reminders().length;
await say('نفذ رغم التعارض');
check('live no-pending conflict confirm makes no write',pending().length===0&&reminders().length===beforeCount,`before=${beforeCount} after=${reminders().length}`);

// 8) World-model race: two real webhook requests immediately one after another.
const worldIds=[];
await Promise.all([
  say('مرام زوجتي وعيد ميلادها 12 أكتوبر، وأحمد أخويا',{wait:0}).then(id=>worldIds.push(id)),
  (async()=>{await sleep(30);const id=await say('امسح كل اللي فاكره عن الأشخاص والعلاقات',{wait:0});worldIds.push(id)})()
]);
await Promise.all(worldIds.map(id=>waitLedger(id,`world race ledger ${id}`,{tries:120,delay:350})));
const world=d1(`SELECT id,name,entity_type FROM life_entities WHERE chat_id='${C}' ORDER BY id`);
check('live fast world-write then clear final state empty',world.length===0,JSON.stringify(world));

// 9) /menu must never trigger destructive or delayed world mutation.
await say('مرام زوجتي',{wait:1500});
const worldBeforeMenu=d1(`SELECT id,name FROM life_entities WHERE chat_id='${C}' ORDER BY id`);
await say('/menu',{wait:800});
const worldAfterMenu=d1(`SELECT id,name FROM life_entities WHERE chat_id='${C}' ORDER BY id`);
check('live /menu is non-destructive',JSON.stringify(worldBeforeMenu)===JSON.stringify(worldAfterMenu),`before=${JSON.stringify(worldBeforeMenu)} after=${JSON.stringify(worldAfterMenu)}`);

// 10) Real UI callbacks for Delete Everything, using a real Telegram message id.
const fakeOther='987654321987';
d1(`DELETE FROM reminders WHERE chat_id='${fakeOther}'; INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES ('${fakeOther}','ممنوع المساس','appointment','2027-01-01','10:00',0,0,datetime('now'),30,'[]','Africa/Cairo')`);
const messageId=await directTelegramMessage('🧪 اختبار زر حذف كل شيء — رسالة آلية من V10.5 Staging');
await callback('panel:danger',messageId);
await callback('danger:clear_everything',messageId);
await callback('do:clear_everything',messageId);
const ownRem=d1(`SELECT COUNT(*) c FROM reminders WHERE chat_id='${C}'`)[0]?.c||0;
const ownRules=d1(`SELECT COUNT(*) c FROM schedule_rules WHERE chat_id='${C}'`)[0]?.c||0;
const ownShop=d1(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id='${C}'`)[0]?.c||0;
const ownWorld=d1(`SELECT COUNT(*) c FROM life_entities WHERE chat_id='${C}'`)[0]?.c||0;
check('live Delete Everything clears current user',Number(ownRem)===0&&Number(ownRules)===0&&Number(ownShop)===0&&Number(ownWorld)===0,JSON.stringify({ownRem,ownRules,ownShop,ownWorld}));
const sentinel=d1(`SELECT title FROM reminders WHERE chat_id='${fakeOther}'`);
check('live Delete Everything isolates other user',sentinel.length===1&&sentinel[0].title==='ممنوع المساس',JSON.stringify(sentinel));
d1(`DELETE FROM reminders WHERE chat_id='${fakeOther}'`);

// 11) Runtime health after all live mutations.
const failures=runtimeFailures();
check('live runtime failures = 0',failures.length===0,JSON.stringify(failures));
const health=await (await fetch(`${URL}/health`)).json();
check('live health green',health?.ok===true&&health?.db===true&&health?.omniai_service===true,JSON.stringify(health));

console.log(JSON.stringify({ok:true,checks:checks.length,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length},null,2));
