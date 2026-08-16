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
async function say(text,{updateId=null,wait=950}={}){
  const id=updateId??++seq;
  console.log(`\nUSER > ${text}`);
  await postUpdate({update_id:id,message:{message_id:id,from:{id:Number(CHAT),is_bot:false,first_name:'Staging'},chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text}});
  if(wait) await sleep(wait);
  return id;
}
async function callback(data,messageId){
  const id=++seq;
  console.log(`\nCALLBACK > ${data}`);
  await postUpdate({update_id:id,callback_query:{id:`live-${id}`,from:{id:Number(CHAT),is_bot:false,first_name:'Staging'},message:{message_id:messageId,chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text:'لوحة اختبار'},chat_instance:'live',data}});
  await sleep(850);
  await poll(()=>{
    const row=d1(`SELECT status,error_text FROM telegram_updates WHERE update_id='${id}' LIMIT 1`)[0];
    if(row?.status==='failed') throw new Error(`Telegram callback ledger failed ${id}: ${row?.error_text||'unknown'}`);
    return row?.status==='done'?row:null;
  },{tries:24,delay:300,label:`callback ledger ${id}`});
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
DELETE FROM telegram_updates WHERE chat_id='${C}';
`);

// 1) Absolute appointment -> simple relative reschedule -> natural-language undo.
await say('يوم 20 أكتوبر 2026 الساعة 6 مساء عندي اجتماع اسمه برق 404 ومدته ساعة');
let r=await poll(()=>reminders().find(x=>String(x.title).includes('برق 404')),{label:'برق create'});
check('live create appointment',r.local_date==='2026-10-20'&&r.local_time==='18:00'&&Number(r.duration_minutes)===60,JSON.stringify(r));
await say('أجل اجتماع برق 404 ساعة');
r=await poll(()=>{const x=reminders().find(v=>String(v.title).includes('برق 404'));return x?.local_time==='19:00'?x:null},{label:'برق shift'});
check('live relative +1h reschedule',r.local_time==='19:00',JSON.stringify(r));
await say('رجع آخر تعديل');
r=await poll(()=>{const x=reminders().find(v=>String(v.title).includes('برق 404'));return x?.local_time==='18:00'?x:null},{label:'natural undo'});
check('live natural undo deterministic',r.local_time==='18:00',JSON.stringify(r));

// 2) Recurrence window must never become per-occurrence 120h.
await say('كل يوم الساعة 10:20 مساء لمدة 5 أيام ابتداءً من 25 أكتوبر 2026 فكرني أراجع المشروع', {wait:1600});
let rule=await poll(()=>rules().find(x=>String(x.title).includes('أراجع المشروع')),{label:'recurrence create'});
check('live recurrence count=5',Number(rule.max_occurrences)===5,JSON.stringify(rule));
check('live recurrence occurrence duration=0',Number(rule.duration_minutes)===0,JSON.stringify(rule));
await say('خلي تذكير أراجع المشروع المتكرر الساعة 11 مساء');
rule=await poll(()=>{const x=rules().find(v=>String(v.title).includes('أراجع المشروع'));return String(x?.start_at||'').includes('23:00')?x:null},{label:'recurrence time update'});
check('live recurrence time update 23:00',String(rule.start_at).includes('23:00'),JSON.stringify(rule));
const canonicalRule=JSON.parse(rule.rule_json||'{}');
check('live recurrence canonical time list updated',Array.isArray(canonicalRule.times)&&canonicalRule.times.includes('23:00'),JSON.stringify(canonicalRule));
await say('احذف تذكير أراجع المشروع المتكرر');
await poll(()=>!rules().some(v=>String(v.title).includes('أراجع المشروع'))?{deleted:true}:null,{label:'recurrence delete'});
check('live recurring delete removes physical rule row',!rules().some(v=>String(v.title).includes('أراجع المشروع')));
await say('/undo');
rule=await poll(()=>{const x=rules().find(v=>String(v.title).includes('أراجع المشروع'));return x&&Number(x.active)===1?x:null},{label:'recurrence undo'});
check('live recurring delete undo restores rule',Number(rule.active)===1&&String(rule.start_at).includes('23:00'),JSON.stringify(rule));

// 3) Natural shopping cleanup/dedupe.
await say('هات جبنة رومي وجيبلي مية معدنية ومتنسانيش أجيب شاي وعاوز أشتري لبن ولبن ونبهني أجيب بيض');
await poll(()=>shop().length>=5,{label:'natural shopping'});
let s=shop();
const titles=s.map(x=>String(x.title));
check('live shopping verbs cleaned',!titles.some(x=>/^(جيبلي|هاتلي|هات |جيب )/u.test(x)),JSON.stringify(titles));
check('live shopping duplicate milk removed',titles.filter(x=>x==='لبن').length<=1,JSON.stringify(titles));

// 4) Mixed timed medicine + shopping sentence.
await say('بص يا معلم متنسانيش أجيب بكرة الساعة 4:40 العصر الدوا، وهاتلي رز وزيت، وجيبلي مية، وعاوز كمان مناديل ومناديل، وخلي بالك البيض للمشتريات مش تذكير',{wait:1500});
const med=await poll(()=>reminders().find(x=>String(x.title).includes('الدوا')&&x.local_time==='16:40'),{label:'mixed medicine reminder'});
check('live timed purchase title cleaned',String(med.title)==='أجيب الدوا',JSON.stringify(med));
s=shop();
check('live mixed shopping has rice',s.some(x=>String(x.title)==='رز'),JSON.stringify(s.map(x=>x.title)));
check('live mixed shopping has oil',s.some(x=>String(x.title)==='زيت'),JSON.stringify(s.map(x=>x.title)));
check('live mixed shopping has tissues once',s.filter(x=>String(x.title)==='مناديل').length===1,JSON.stringify(s.map(x=>x.title)));
check('live definite-article egg dedupe',s.filter(x=>String(x.normalized_title).replace(/^ال/u,'')==='بيض').length===1,JSON.stringify(s.map(x=>({t:x.title,n:x.normalized_title}))));
check('live shopping did not become timed reminder',!reminders().some(x=>x.local_time==='16:40'&&/(رز|زيت|مناديل|بيض|مية)/u.test(String(x.title))),JSON.stringify(reminders().filter(x=>x.local_time==='16:40')));

// 5) Duplicate Telegram update id must execute once.
const dup=++seq;
await say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dup,wait:0});
await say('فكرني يوم 22 أكتوبر 2026 الساعة 3:17 مساء أراجع اختبار التكرار',{updateId:dup,wait:0});
const dupRows=await poll(()=>{const rows=reminders().filter(x=>String(x.title).includes('أراجع اختبار التكرار'));return rows.length===1?rows:null;},{tries:45,delay:700,label:'duplicate update first completion'});
await sleep(1800);
const dupRowsFinal=reminders().filter(x=>String(x.title).includes('أراجع اختبار التكرار'));
check('live Telegram update idempotency',dupRowsFinal.length===1,JSON.stringify(dupRowsFinal));

// 6) Same-chat rapid update then natural undo, without waiting between webhook requests.
await say('يوم 21 نوفمبر 2026 الساعة 6 مساء عندي اجتماع اسمه سريع 717 ومدته ساعة',{wait:0});
await poll(()=>{const x=reminders().find(v=>String(v.title).includes('سريع 717'));return x?.local_time==='18:00'?x:null;},{tries:45,delay:700,label:'rapid appointment create precondition'});
await Promise.all([
  say('أجل اجتماع سريع 717 ساعة',{wait:0}),
  (async()=>{await sleep(35);return say('رجع آخر تعديل',{wait:0})})()
]);
const rapid=await poll(()=>{const x=reminders().find(v=>String(v.title).includes('سريع 717'));return x?.local_time==='18:00'?x:null;},{tries:45,delay:700,label:'rapid shift+undo settled state'});
check('live rapid shift+undo final state',rapid?.local_time==='18:00',JSON.stringify(rapid));

// 7) No stale conflict-confirm is allowed to resurrect anything.
d1(`DELETE FROM pending_conflicts WHERE chat_id='${C}'`);
const beforeCount=reminders().length;
await say('نفذ رغم التعارض');
await sleep(500);
check('live no-pending conflict confirm makes no write',pending().length===0&&reminders().length===beforeCount,`before=${beforeCount} after=${reminders().length}`);

// 8) World-model race: two real webhook requests immediately one after another.
await Promise.all([
  say('مرام زوجتي وعيد ميلادها 12 أكتوبر، وأحمد أخويا',{wait:0}),
  (async()=>{await sleep(30);return say('امسح كل اللي فاكره عن الأشخاص والعلاقات',{wait:0})})()
]);
await sleep(2300);
const world=d1(`SELECT id,name,entity_type FROM life_entities WHERE chat_id='${C}' ORDER BY id`);
check('live fast world-write then clear final state empty',world.length===0,JSON.stringify(world));

// 9) /menu must never trigger destructive world clear.
await say('مرام زوجتي',{wait:1500});
const worldBeforeMenu=d1(`SELECT id,name FROM life_entities WHERE chat_id='${C}' ORDER BY id`);
await say('/menu',{wait:800});
const worldAfterMenu=d1(`SELECT id,name FROM life_entities WHERE chat_id='${C}' ORDER BY id`);
check('live /menu is non-destructive',worldBeforeMenu.length===worldAfterMenu.length,`before=${JSON.stringify(worldBeforeMenu)} after=${JSON.stringify(worldAfterMenu)}`);

// 10) Real UI callbacks for Delete Everything, using a real Telegram message id.
const fakeOther='987654321987';
d1(`DELETE FROM reminders WHERE chat_id='${fakeOther}'; INSERT INTO reminders(chat_id,title,kind,local_date,local_time,sent,cancelled,created_at,duration_minutes,advance_alerts_json,timezone) VALUES ('${fakeOther}','ممنوع المساس','appointment','2027-01-01','10:00',0,0,datetime('now'),30,'[]','Africa/Cairo')`);
const messageId=await directTelegramMessage('🧪 اختبار زر حذف كل شيء — رسالة آلية من V10.5 Staging');
await callback('panel:danger',messageId);
await callback('danger:clear_everything',messageId);
await callback('do:clear_everything',messageId);
await sleep(900);
const ownRem=d1(`SELECT COUNT(*) c FROM reminders WHERE chat_id='${C}'`)[0]?.c||0;
const ownRules=d1(`SELECT COUNT(*) c FROM schedule_rules WHERE chat_id='${C}'`)[0]?.c||0;
const ownShop=d1(`SELECT COUNT(*) c FROM smart_list_items WHERE chat_id='${C}'`)[0]?.c||0;
const ownWorld=d1(`SELECT COUNT(*) c FROM life_entities WHERE chat_id='${C}'`)[0]?.c||0;
check('live Delete Everything clears current user',Number(ownRem)===0&&Number(ownRules)===0&&Number(ownShop)===0&&Number(ownWorld)===0,JSON.stringify({ownRem,ownRules,ownShop,ownWorld}));
const sentinel=d1(`SELECT title FROM reminders WHERE chat_id='${fakeOther}'`);
check('live Delete Everything isolates other user',sentinel.length===1&&sentinel[0].title==='ممنوع المساس',JSON.stringify(sentinel));
d1(`DELETE FROM reminders WHERE chat_id='${fakeOther}'`);

// 11) Runtime health after all live mutations.
const health=await (await fetch(`${URL}/health`)).json();
check('live health remains OK',health.ok===true&&health.db===true&&health.omniai_service===true,JSON.stringify(health));
const failures=runtimeFailures();
check('live matrix produced no runtime failures',failures.length===0,JSON.stringify(failures));

console.log('\n=== LIVE MATRIX COMPLETE ===');
console.log(JSON.stringify({ok:true,passed:checks.filter(x=>x.ok).length,total:checks.length,checks},null,2));
