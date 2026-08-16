from pathlib import Path

src=Path('SuperAgent_V10_5_Reliability_Rewrite.js')
out=Path('SuperAgent_V10_6_Zero_Known_Failures.js')
s=src.read_text(encoding='utf-8')

def rep(old,new,label,count=1):
    global s
    if old not in s:
        raise SystemExit(f'V10.6 anchor missing: {label}')
    s=s.replace(old,new,count)

rep('const V10_VERSION="10.5";const V10_NAME="سوبر إيجنت 10.5 — إعادة بناء الاعتمادية · صفر أخطاء معروفة";',
    'const V10_VERSION="10.6";const V10_NAME="سوبر إيجنت 10.6 — قفل الاعتمادية الحي · صفر أخطاء معروفة";',
    'version header')

# The webhook ACKs only after the update has been durably persisted in D1.
# A protected internal continuation endpoint gives each 4-item queue batch a fresh
# Cloudflare invocation/waitUntil budget instead of relying on the one-minute cron.
old='''if(request.method==="POST"&&url.pathname==="/telegram"){
const secret=request.headers.get("X-Telegram-Bot-Api-Secret-Token")||"";
if(!env.TELEGRAM_WEBHOOK_SECRET||secret!==env.TELEGRAM_WEBHOOK_SECRET)return new Response("غير مصرح",{status:401});
let update;
try{update=await request.json();}catch{return new Response("طلب غير صالح",{status:400});}
ctx.waitUntil(enqueueTelegramUpdateV105(update,env));
return new Response("OK");
}'''
new='''if(request.method==="POST"&&url.pathname==="/internal/drain-v106"){
const internal=request.headers.get("X-SuperAgent-Internal")||"";
if(!env.TELEGRAM_WEBHOOK_SECRET||internal!==env.TELEGRAM_WEBHOOK_SECRET)return new Response("غير مصرح",{status:401});
let body;try{body=await request.json();}catch{return new Response("طلب غير صالح",{status:400});}
const chatId=String(body?.chat_id||"").trim();
if(!chatId||chatId.length>64)return new Response("طلب غير صالح",{status:400});
await ensureSchemaOnce(env);
ctx.waitUntil(drainTelegramInboxV106(env,chatId,url.origin));
return new Response("ACCEPTED",{status:202});
}
if(request.method==="POST"&&url.pathname==="/telegram"){
const secret=request.headers.get("X-Telegram-Bot-Api-Secret-Token")||"";
if(!env.TELEGRAM_WEBHOOK_SECRET||secret!==env.TELEGRAM_WEBHOOK_SECRET)return new Response("غير مصرح",{status:401});
let update;
try{update=await request.json();}catch{return new Response("طلب غير صالح",{status:400});}
await ensureSchemaOnce(env);
await persistTelegramInboxV106(update,env);
ctx.waitUntil(drainTelegramInboxV106(env,telegramChatKeyV105(update),url.origin));
return new Response("OK");
}'''
rep(old,new,'durable webhook ingress + continuation endpoint')

old='''async scheduled(controller,env,ctx){
ctx.waitUntil(Promise.allSettled([deliverDueReminders(env,controller?.scheduledTime),runV10PeriodicIntelligence(env,controller?.scheduledTime),cleanupReliabilityData(env)]).then(async results=>{for(const [i,result] of results.entries()){if(result.status==="rejected")await recordRuntimeFailure(env,{scope:`scheduled_${i}`,error:result.reason});}}));
}'''
new='''async scheduled(controller,env,ctx){
ctx.waitUntil(Promise.allSettled([deliverDueReminders(env,controller?.scheduledTime),runV10PeriodicIntelligence(env,controller?.scheduledTime),cleanupReliabilityData(env),drainPendingTelegramInboxV106(env)]).then(async results=>{for(const [i,result] of results.entries()){if(result.status==="rejected")await recordRuntimeFailure(env,{scope:`scheduled_${i}`,error:result.reason});}}));
}'''
rep(old,new,'scheduled inbox recovery')

schema_anchor='''await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_telegram_updates_started ON telegram_updates(started_at)`).run();'''
schema_add=schema_anchor+'''\n\nawait env.DB.prepare(`CREATE TABLE IF NOT EXISTS telegram_inbox_v106 (
update_id TEXT PRIMARY KEY,
chat_id TEXT NOT NULL,
payload_json TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'pending',
attempts INTEGER NOT NULL DEFAULT 0,
lease_until TEXT,
last_error TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
)`).run();
await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_telegram_inbox_v106_chat ON telegram_inbox_v106(chat_id,status,created_at)`).run();
await env.DB.prepare(`CREATE TABLE IF NOT EXISTS telegram_chat_leases_v106 (
chat_id TEXT PRIMARY KEY,
owner_token TEXT NOT NULL,
lease_until TEXT NOT NULL,
acquired_at TEXT NOT NULL
)`).run();'''
rep(schema_anchor,schema_add,'V10.6 inbox schema')

queue_anchor='''const V105_CHAT_QUEUES=new Map();'''
queue_helpers='''const V106_INBOX_LEASE_MS=90000;
const V106_INBOX_MAX_ATTEMPTS=5;
const V106_INBOX_BATCH_SIZE=4;
const V106_LEASE_RETRY_COUNT=12;
const V106_LEASE_RETRY_DELAY_MS=180;
const V106_INTER_UPDATE_DELAY_MS=90;
const V106_CONTINUATION_MAX_CHAT_LENGTH=64;
const sleepV106=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function newQueueOwnerV106(){return `Q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;}
function isoAfterV106(ms){return new Date(Date.now()+ms).toISOString();}
async function persistTelegramInboxV106(update,env){
  const raw=update?.update_id;
  const updateId=raw==null?`synthetic-${Date.now()}-${Math.random().toString(36).slice(2)}`:String(raw);
  const chatId=telegramChatKeyV105(update);
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO telegram_inbox_v106(update_id,chat_id,payload_json,status,attempts,created_at,updated_at) VALUES (?,?,?,'pending',0,?,?)`)
    .bind(updateId,chatId,JSON.stringify(update),now,now).run();
  return updateId;
}
async function acquireChatLeaseV106(env,chatId,owner){
  const now=new Date().toISOString(),until=isoAfterV106(V106_INBOX_LEASE_MS);
  const row=await env.DB.prepare(`INSERT INTO telegram_chat_leases_v106(chat_id,owner_token,lease_until,acquired_at) VALUES (?,?,?,?)
    ON CONFLICT(chat_id) DO UPDATE SET owner_token=excluded.owner_token,lease_until=excluded.lease_until,acquired_at=excluded.acquired_at
    WHERE telegram_chat_leases_v106.lease_until<=excluded.acquired_at RETURNING owner_token`).bind(String(chatId),owner,until,now).first();
  return String(row?.owner_token||'')===owner;
}
async function renewChatLeaseV106(env,chatId,owner){
  await env.DB.prepare(`UPDATE telegram_chat_leases_v106 SET lease_until=? WHERE chat_id=? AND owner_token=?`).bind(isoAfterV106(V106_INBOX_LEASE_MS),String(chatId),owner).run();
}
async function releaseChatLeaseV106(env,chatId,owner){
  await env.DB.prepare(`DELETE FROM telegram_chat_leases_v106 WHERE chat_id=? AND owner_token=?`).bind(String(chatId),owner).run();
}
async function nextInboxRowV106(env,chatId){
  return env.DB.prepare(`SELECT * FROM telegram_inbox_v106 WHERE chat_id=? AND status IN ('pending','processing') AND (status='pending' OR lease_until IS NULL OR lease_until<=?) ORDER BY CAST(update_id AS INTEGER),created_at LIMIT 1`)
    .bind(String(chatId),new Date().toISOString()).first();
}
async function hasRunnableInboxV106(env,chatId){
  const row=await env.DB.prepare(`SELECT update_id FROM telegram_inbox_v106 WHERE chat_id=? AND (status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?))) LIMIT 1`)
    .bind(String(chatId),new Date().toISOString()).first();
  return !!row;
}
async function triggerDrainContinuationV106(env,chatId,origin){
  if(!origin||!env?.TELEGRAM_WEBHOOK_SECRET)return false;
  const id=String(chatId||'').trim();if(!id||id.length>V106_CONTINUATION_MAX_CHAT_LENGTH)return false;
  try{
    const r=await fetch(`${String(origin).replace(/\\/$/,'')}/internal/drain-v106`,{method:'POST',headers:{'content-type':'application/json','X-SuperAgent-Internal':env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({chat_id:id})});
    if(r.body)try{await r.body.cancel();}catch{}
    if(r.status!==202)throw new Error(`continuation HTTP ${r.status}`);
    return true;
  }catch(e){
    await recordRuntimeFailure(env,{chatId:id,scope:'telegram_inbox_v106_continuation',error:e});
    return false;
  }
}
async function drainTelegramInboxV106(env,chatId,origin=''){
  if(!env?.DB)return;
  const owner=newQueueOwnerV106();
  let acquired=false,processed=0,failed=false;
  for(let retry=0;retry<V106_LEASE_RETRY_COUNT;retry++){
    if(await acquireChatLeaseV106(env,chatId,owner)){acquired=true;break;}
    await sleepV106(V106_LEASE_RETRY_DELAY_MS+Math.floor(Math.random()*50));
  }
  if(!acquired)return;
  try{
    for(let i=0;i<V106_INBOX_BATCH_SIZE;i++){
      const row=await nextInboxRowV106(env,chatId);if(!row)break;
      const now=new Date().toISOString(),until=isoAfterV106(V106_INBOX_LEASE_MS);
      const upd=await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='processing',attempts=attempts+1,lease_until=?,updated_at=? WHERE update_id=? AND chat_id=? AND status IN ('pending','processing') AND (status='pending' OR lease_until IS NULL OR lease_until<=?) RETURNING attempts`)
        .bind(until,now,String(row.update_id),String(chatId),now).first();
      if(!upd)continue;
      const attempts=Number(upd.attempts||1);
      if(attempts>1){
        await env.DB.prepare(`DELETE FROM telegram_updates WHERE update_id=? AND status!='done'`).bind(String(row.update_id)).run();
      }
      let update;try{update=JSON.parse(String(row.payload_json||'{}'));}catch(e){
        await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='failed',last_error=?,lease_until=NULL,updated_at=? WHERE update_id=?`).bind('invalid payload',new Date().toISOString(),String(row.update_id)).run();
        failed=true;break;
      }
      try{
        await renewChatLeaseV106(env,chatId,owner);
        await enqueueTelegramUpdateV105(update,env);
        const ledger=await env.DB.prepare(`SELECT status,error_text FROM telegram_updates WHERE update_id=? LIMIT 1`).bind(String(row.update_id)).first();
        if(String(ledger?.status||'')!=='done')throw new Error(String(ledger?.error_text||'Telegram update did not commit'));
        await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='done',last_error=NULL,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(new Date().toISOString(),String(row.update_id)).run();
        processed++;
        if(i+1<V106_INBOX_BATCH_SIZE)await sleepV106(V106_INTER_UPDATE_DELAY_MS);
      }catch(e){
        const err=safeError(e);const terminal=attempts>=V106_INBOX_MAX_ATTEMPTS;
        await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status=?,last_error=?,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(terminal?'failed':'pending',err,new Date().toISOString(),String(row.update_id)).run();
        await recordRuntimeFailure(env,{chatId,scope:'telegram_inbox_v106',error:e,context:{update_id:String(row.update_id),attempts}});
        failed=true;break;
      }
    }
  }finally{await releaseChatLeaseV106(env,chatId,owner).catch(()=>{});}
  if(!failed&&processed===V106_INBOX_BATCH_SIZE&&origin&&await hasRunnableInboxV106(env,chatId)){
    await triggerDrainContinuationV106(env,chatId,origin);
  }
}
async function drainPendingTelegramInboxV106(env){
  if(!env?.DB)return;
  const rows=(await env.DB.prepare(`SELECT DISTINCT chat_id FROM telegram_inbox_v106 WHERE status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?)) LIMIT 1`).bind(new Date().toISOString()).all())?.results||[];
  for(const row of rows)await drainTelegramInboxV106(env,String(row.chat_id));
}
async function cleanupTelegramInboxV106(env){
  const cutoff=new Date(Date.now()-7*86400000).toISOString();
  await env.DB.prepare(`DELETE FROM telegram_inbox_v106 WHERE status='done' AND updated_at<?`).bind(cutoff).run();
  await env.DB.prepare(`DELETE FROM telegram_chat_leases_v106 WHERE lease_until<?`).bind(new Date(Date.now()-3600000).toISOString()).run();
}

'''+queue_anchor
rep(queue_anchor,queue_helpers,'durable queue helpers')

# Reliability cleanup also prunes the inbox.
old='''async function cleanupReliabilityData(env){try{const cutoff=new Date(Date.now()-RUNTIME_FAILURE_RETENTION_DAYS*86400000).toISOString();const receipts=new Date(Date.now()-86400000).toISOString();await env.DB.batch([env.DB.prepare(`DELETE FROM runtime_failures WHERE created_at<?`).bind(cutoff),env.DB.prepare(`DELETE FROM operation_receipts WHERE created_at<?`).bind(receipts)]);}catch(e){console.warn("Reliability cleanup failed",safeError(e));}}'''
new='''async function cleanupReliabilityData(env){try{const cutoff=new Date(Date.now()-RUNTIME_FAILURE_RETENTION_DAYS*86400000).toISOString();const receipts=new Date(Date.now()-86400000).toISOString();await env.DB.batch([env.DB.prepare(`DELETE FROM runtime_failures WHERE created_at<?`).bind(cutoff),env.DB.prepare(`DELETE FROM operation_receipts WHERE created_at<?`).bind(receipts)]);await cleanupTelegramInboxV106(env);}catch(e){console.warn("Reliability cleanup failed",safeError(e));}}'''
rep(old,new,'inbox cleanup')

# User-facing setup/version labels.
s=s.replace('سوبر إيجنت 10.5 جاهز للعمل','سوبر إيجنت 10.6 جاهز للعمل')
s=s.replace('v105_clear_everything:true','v105_clear_everything:true,v106_durable_telegram_inbox:true,v106_cross_isolate_serialization:true,v106_crash_recovery:true,v106_subrequest_budget_safe:true,v106_ledger_confirmed_delivery:true,v106_self_continuation:true')

# Self-test coverage for the new release invariants.
needle='''  add("incident id format",/^SA-[A-Z0-9]+-[A-Z0-9]{5}$/.test(newIncidentId()));'''
extra=needle+'''\n  add("v106 durable inbox lease",V106_INBOX_LEASE_MS>=TOTAL_AI_BUDGET_MS*2,String(V106_INBOX_LEASE_MS));
  add("v106 inbox retry budget",V106_INBOX_MAX_ATTEMPTS>=3,String(V106_INBOX_MAX_ATTEMPTS));
  add("v106 subrequest batch budget",V106_INBOX_BATCH_SIZE<=4,String(V106_INBOX_BATCH_SIZE));
  add("v106 bounded lease retry",V106_LEASE_RETRY_COUNT<=16,String(V106_LEASE_RETRY_COUNT));
  add("v106 continuation chat bound",V106_CONTINUATION_MAX_CHAT_LENGTH===64,String(V106_CONTINUATION_MAX_CHAT_LENGTH));'''
rep(needle,extra,'V10.6 selftests')

out.write_text(s,encoding='utf-8')
print(f'BUILT {out} bytes={len(out.read_bytes())}')
