import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import shoppingSections from './corpus-user-shopping-v106.mjs';
import scheduleSections from './corpus-user-schedule-v106.mjs';

const URL=String(process.env.STAGING_URL||'').replace(/\/$/,'');
const SECRET=String(process.env.STAGING_TELEGRAM_WEBHOOK_SECRET||'');
const CHAT=String(process.env.STAGING_ADMIN_CHAT_ID||'').trim();
const CONFIG=process.env.STAGING_CONFIG||'wrangler.v106.staging.jsonc';
const DB=process.env.STAGING_DB||'superagent-v106-staging';
if(!URL||!SECRET||!CHAT)throw new Error('Missing live staging environment');

const q=s=>String(s).replaceAll("'","''");
const C=q(CHAT);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let seq=930000000+Number(String(Date.now()).slice(-7));
const startedAt=new Date().toISOString();
const results=[];

function d1(sql){
  const raw=execFileSync('npx',['wrangler','d1','execute',DB,'--remote','--json','--config',CONFIG,'--command',sql],{encoding:'utf8',env:process.env,maxBuffer:40*1024*1024});
  const j=JSON.parse(raw);const b=Array.isArray(j)?j[0]:j;
  if(b?.success===false)throw new Error(`D1 failed: ${raw}`);
  return b?.results||[];
}
function safeRows(table,where=`chat_id='${C}'`){
  try{return d1(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`)}catch{return []}
}
function stable(v){return JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x)}
function domainState(){
  const shop={lists:safeRows('smart_lists'),items:safeRows('smart_list_items'),sessions:safeRows('shopping_sessions')};
  const schedule={reminders:safeRows('reminders'),rules:safeRows('schedule_rules'),prayer:safeRows('prayer_rules'),deps:safeRows('event_dependencies')};
  const pending={dialogs:safeRows('pending_dialogs'),requests:safeRows('pending_requests'),conflicts:safeRows('pending_conflicts')};
  return {shop,schedule,pending,shopFp:stable(shop),scheduleFp:stable(schedule),counts:{shopItems:shop.items.length,shopLists:shop.lists.length,reminders:schedule.reminders.length,rules:schedule.rules.length,pending:pending.dialogs.length+pending.requests.length+pending.conflicts.length}};
}
function responseTail(){
  try{return d1(`SELECT * FROM conversation_messages WHERE chat_id='${C}' ORDER BY rowid DESC LIMIT 8`)}catch{return []}
}
function runtimeFailuresSince(iso){
  try{return d1(`SELECT id,scope,error_text,created_at FROM runtime_failures WHERE (chat_id='${C}' OR chat_id IS NULL) AND created_at>='${q(iso)}' ORDER BY id`)}catch{return []}
}
function resetAll(){
  const statements=[
    `DELETE FROM event_dependencies WHERE chat_id='${C}'`,
    `DELETE FROM reminder_fires WHERE chat_id='${C}'`,
    `DELETE FROM schedule_fires WHERE chat_id='${C}'`,
    `DELETE FROM reminders WHERE chat_id='${C}'`,
    `DELETE FROM schedule_rules WHERE chat_id='${C}'`,
    `DELETE FROM prayer_rules WHERE chat_id='${C}'`,
    `DELETE FROM shopping_sessions WHERE chat_id='${C}'`,
    `DELETE FROM smart_list_items WHERE chat_id='${C}'`,
    `DELETE FROM smart_lists WHERE chat_id='${C}'`,
    `DELETE FROM life_edges WHERE chat_id='${C}'`,
    `DELETE FROM life_entities WHERE chat_id='${C}'`,
    `DELETE FROM conversation_messages WHERE chat_id='${C}'`,
    `DELETE FROM pending_dialogs WHERE chat_id='${C}'`,
    `DELETE FROM pending_conflicts WHERE chat_id='${C}'`,
    `DELETE FROM pending_requests WHERE chat_id='${C}'`,
    `DELETE FROM action_audit WHERE chat_id='${C}'`,
    `DELETE FROM operation_receipts WHERE chat_id='${C}'`,
    `DELETE FROM telegram_inbox_v106 WHERE chat_id='${C}'`,
    `DELETE FROM telegram_chat_leases_v106 WHERE chat_id='${C}'`,
    `DELETE FROM telegram_updates WHERE chat_id='${C}'`,
    `DELETE FROM runtime_failures WHERE chat_id='${C}' OR chat_id IS NULL`
  ];
  for(const s of statements){try{d1(s)}catch{}}
}
function makeUpdate(id,text){return {update_id:id,message:{message_id:id,from:{id:Number(CHAT),is_bot:false,first_name:'MegaLive'},chat:{id:Number(CHAT),type:'private'},date:Math.floor(Date.now()/1000),text}}}
async function postText(text){
  const id=++seq;
  const r=await fetch(`${URL}/telegram`,{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify(makeUpdate(id,text))});
  const body=await r.text();
  if(r.status!==200||body!=='OK')throw new Error(`Webhook ${r.status}: ${body}`);
  return id;
}
async function waitDone(id,{tries=240,delay=500}={}){
  let last=null;
  for(let i=0;i<tries;i++){
    try{last=d1(`SELECT status,error_text FROM telegram_updates WHERE update_id='${q(id)}' LIMIT 1`)[0]||null}catch{}
    if(last?.status==='done')return last;
    if(last?.status==='failed')throw new Error(last?.error_text||'telegram update failed');
    await sleep(delay);
  }
  throw new Error(`timeout update ${id}: ${stable(last)}`);
}
async function send(text){
  console.log(`USER > ${text}`);
  const id=await postText(text);
  await waitDone(id);
  await sleep(300);
  return id;
}
function normalizedCase(x,section){
  if(typeof x==='string')return {messages:[x],expect:section.expect,name:x};
  return {messages:Array.isArray(x.messages)?x.messages:[String(x.messages||'')],expect:x.expect||section.expect,name:x.name||x.messages?.join(' -> ')||'case',assertTokens:x.assertTokens||[],forbidTokens:x.forbidTokens||[]};
}
function effectiveExpect(section,c){
  if(section.title==='shopping-ambiguous-sizes')return 'clarify';
  if(section.title==='shopping-final-boss-no-hallucination')return 'clarify';
  return c.expect;
}
function evaluate(expect,before,after,caseObj,sectionTitle){
  const reasons=[];
  const shopChanged=before.shopFp!==after.shopFp;
  const scheduleChanged=before.scheduleFp!==after.scheduleFp;
  if(expect==='shop_mutate'){
    if(!shopChanged)reasons.push('shopping state did not change');
    if(scheduleChanged)reasons.push('shopping command unexpectedly changed reminders/rules');
  }else if(expect==='shop_no_write'){
    if(shopChanged)reasons.push('query/no-write shopping case mutated shopping state');
    if(scheduleChanged)reasons.push('shopping query unexpectedly changed reminders/rules');
  }else if(expect==='schedule_mutate'){
    if(!scheduleChanged)reasons.push('schedule state did not change');
    if(shopChanged)reasons.push('schedule command unexpectedly changed shopping state');
  }else if(expect==='schedule_no_write'){
    if(scheduleChanged)reasons.push('ambiguous/query schedule case mutated schedule state');
    if(shopChanged)reasons.push('schedule no-write case mutated shopping state');
  }else if(expect==='mixed_mutate'){
    if(!shopChanged&&!scheduleChanged)reasons.push('expected shopping or schedule mutation but none happened');
  }else if(expect==='clarify'){
    if(shopChanged||scheduleChanged)reasons.push('ambiguous request mutated persistent state instead of clarifying');
    if(after.counts.pending===0)reasons.push('ambiguous request created no pending clarification state');
  }
  const combined=stable({shop:after.shop,schedule:after.schedule,pending:after.pending});
  for(const t of caseObj.assertTokens||[])if(!combined.includes(String(t)))reasons.push(`expected state token missing: ${t}`);
  for(const t of caseObj.forbidTokens||[])if(combined.includes(String(t)))reasons.push(`forbidden state token present: ${t}`);
  if(sectionTitle==='shopping-typos'&&caseObj.messages.some(x=>x.includes('عض'))&&combined.includes('"عض"'))reasons.push('obvious typo token عض was persisted as a product');
  return {ok:reasons.length===0,reasons,shopChanged,scheduleChanged};
}
async function runOne(section,raw,index,total){
  const c=normalizedCase(raw,section);const expect=effectiveExpect(section,c);
  resetAll();
  const seedErrors=[];
  for(const s of section.seed||[]){try{await send(s)}catch(e){seedErrors.push(String(e?.message||e));break}}
  const before=domainState();const caseStarted=new Date().toISOString();
  const execErrors=[];
  for(const m of c.messages){try{await send(m)}catch(e){execErrors.push(String(e?.message||e));break}}
  const after=domainState();
  const failures=runtimeFailuresSince(caseStarted);
  const ev=evaluate(expect,before,after,c,section.title);
  if(seedErrors.length)ev.reasons.push(`seed failed: ${seedErrors.join(' | ')}`);
  if(execErrors.length)ev.reasons.push(`execution failed: ${execErrors.join(' | ')}`);
  if(failures.length)ev.reasons.push(`runtime_failures=${failures.length}: ${failures.map(x=>x.scope+':'+x.error_text).join(' | ')}`);
  ev.ok=ev.reasons.length===0;
  const record={section:section.title,index,name:c.name,messages:c.messages,expect,ok:ev.ok,reasons:ev.reasons,before:before.counts,after:after.counts,shopChanged:ev.shopChanged,scheduleChanged:ev.scheduleChanged,runtimeFailures:failures,responseTail:responseTail(),stateAfter:{shop:after.shop,schedule:after.schedule,pending:after.pending}};
  results.push(record);
  console.log(`${ev.ok?'PASS':'FAIL'} [${index}/${total}] ${section.title} :: ${c.name}${ev.reasons.length?` :: ${ev.reasons.join('; ')}`:''}`);
}

const sections=[...shoppingSections,...scheduleSections];
const total=sections.reduce((n,s)=>n+s.cases.length,0);
console.log(`=== USER MEGA LIVE MATRIX V10.6 === cases=${total} worker=${URL}`);
let idx=0;
for(const section of sections){
  console.log(`\n### SECTION ${section.title} (${section.cases.length})`);
  for(const c of section.cases){idx++;await runOne(section,c,idx,total)}
}

// Final infrastructure integrity checks after corpus.
let finalHealth={};try{const r=await fetch(`${URL}/health`);finalHealth=await r.json()}catch(e){finalHealth={ok:false,error:String(e)}}
let stuck=[];try{stuck=d1(`SELECT status,COUNT(*) c FROM telegram_inbox_v106 WHERE chat_id='${C}' AND status!='done' GROUP BY status`)}catch{}
const passed=results.filter(x=>x.ok).length,failed=results.length-passed;
const summary={ok:failed===0,total:results.length,passed,failed,startedAt,finishedAt:new Date().toISOString(),health:finalHealth,stuck};
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/V10_6_USER_MEGA_LIVE_REPORT.json',JSON.stringify({summary,results},null,2));
let md=`# Super Agent V10.6 — User Mega Live Matrix\n\n- Total: **${summary.total}**\n- Passed: **${passed}**\n- Failed: **${failed}**\n- Worker health: **${finalHealth?.ok?'GREEN':'NOT GREEN'}**\n- Started: ${startedAt}\n- Finished: ${summary.finishedAt}\n\n`;
for(const r of results){md+=`## ${r.ok?'✅':'❌'} ${r.section} — ${r.index}\n\n**Input:** ${r.messages.map(x=>`\`${x.replaceAll('`','')}\``).join(' → ')}\n\n**Expected class:** ${r.expect}\n\n**Result:** ${r.ok?'PASS':`FAIL — ${r.reasons.join('; ')}`}\n\n**State counts:** before ${JSON.stringify(r.before)} → after ${JSON.stringify(r.after)}\n\n`;}
fs.writeFileSync('artifacts/V10_6_USER_MEGA_LIVE_REPORT.md',md);
fs.writeFileSync('artifacts/V10_6_USER_MEGA_LIVE_SUMMARY.json',JSON.stringify(summary,null,2));
console.log('\n=== SUMMARY ===');console.log(JSON.stringify(summary,null,2));
