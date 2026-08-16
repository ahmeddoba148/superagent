from pathlib import Path

p=Path('tools/build-v10-6.py')
s=p.read_text(encoding='utf-8')

def rep(old,new,label,count=1):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s=s.replace(old,new,count)

rep("const V106_INBOX_MAX_ATTEMPTS=5;", """const V106_INBOX_MAX_ATTEMPTS=5;
const V106_INBOX_BATCH_SIZE=4;
const V106_LEASE_RETRY_COUNT=12;
const V106_LEASE_RETRY_DELAY_MS=180;
const V106_INTER_UPDATE_DELAY_MS=90;
const sleepV106=ms=>new Promise(resolve=>setTimeout(resolve,ms));""", 'queue budget constants')

old="""  await env.DB.prepare(`INSERT INTO telegram_chat_leases_v106(chat_id,owner_token,lease_until,acquired_at) VALUES (?,?,?,?)
    ON CONFLICT(chat_id) DO UPDATE SET owner_token=excluded.owner_token,lease_until=excluded.lease_until,acquired_at=excluded.acquired_at
    WHERE telegram_chat_leases_v106.lease_until<=excluded.acquired_at`).bind(String(chatId),owner,until,now).run();
  const row=await env.DB.prepare(`SELECT owner_token FROM telegram_chat_leases_v106 WHERE chat_id=? LIMIT 1`).bind(String(chatId)).first();
  return String(row?.owner_token||'')===owner;"""
new="""  const row=await env.DB.prepare(`INSERT INTO telegram_chat_leases_v106(chat_id,owner_token,lease_until,acquired_at) VALUES (?,?,?,?)
    ON CONFLICT(chat_id) DO UPDATE SET owner_token=excluded.owner_token,lease_until=excluded.lease_until,acquired_at=excluded.acquired_at
    WHERE telegram_chat_leases_v106.lease_until<=excluded.acquired_at RETURNING owner_token`).bind(String(chatId),owner,until,now).first();
  return String(row?.owner_token||'')===owner;"""
rep(old,new,'single-subrequest lease acquisition')

rep("""  const owner=newQueueOwnerV106();
  if(!(await acquireChatLeaseV106(env,chatId,owner)))return;
  try{
    for(let i=0;i<100;i++){""", """  const owner=newQueueOwnerV106();
  let acquired=false;
  for(let retry=0;retry<V106_LEASE_RETRY_COUNT;retry++){
    if(await acquireChatLeaseV106(env,chatId,owner)){acquired=true;break;}
    await sleepV106(V106_LEASE_RETRY_DELAY_MS+Math.floor(Math.random()*50));
  }
  if(!acquired)return;
  try{
    for(let i=0;i<V106_INBOX_BATCH_SIZE;i++){""", 'bounded drain and lease retry')

rep("""        await renewChatLeaseV106(env,chatId,owner);
        await enqueueTelegramUpdateV105(update,env);
        await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='done',last_error=NULL,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(new Date().toISOString(),String(row.update_id)).run();""", """        await renewChatLeaseV106(env,chatId,owner);
        await enqueueTelegramUpdateV105(update,env);
        const ledger=await env.DB.prepare(`SELECT status,error_text FROM telegram_updates WHERE update_id=? LIMIT 1`).bind(String(row.update_id)).first();
        if(String(ledger?.status||'')!=='done')throw new Error(String(ledger?.error_text||'Telegram update did not commit'));
        await env.DB.prepare(`UPDATE telegram_inbox_v106 SET status='done',last_error=NULL,lease_until=NULL,updated_at=? WHERE update_id=?`).bind(new Date().toISOString(),String(row.update_id)).run();
        if(i+1<V106_INBOX_BATCH_SIZE)await sleepV106(V106_INTER_UPDATE_DELAY_MS);""", 'ledger-confirmed inbox completion')

rep("""  const rows=(await env.DB.prepare(`SELECT DISTINCT chat_id FROM telegram_inbox_v106 WHERE status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?)) LIMIT 50`).bind(new Date().toISOString()).all())?.results||[];""", """  const rows=(await env.DB.prepare(`SELECT DISTINCT chat_id FROM telegram_inbox_v106 WHERE status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?)) LIMIT 1`).bind(new Date().toISOString()).all())?.results||[];""", 'scheduled recovery budget')

rep("s=s.replace('v105_clear_everything:true','v105_clear_everything:true,v106_durable_telegram_inbox:true,v106_cross_isolate_serialization:true,v106_crash_recovery:true')", "s=s.replace('v105_clear_everything:true','v105_clear_everything:true,v106_durable_telegram_inbox:true,v106_cross_isolate_serialization:true,v106_crash_recovery:true,v106_subrequest_budget_safe:true,v106_ledger_confirmed_delivery:true')", 'capability flags')

rep("""  add(\"v106 inbox retry budget\",V106_INBOX_MAX_ATTEMPTS>=3,String(V106_INBOX_MAX_ATTEMPTS));'''""", """  add(\"v106 inbox retry budget\",V106_INBOX_MAX_ATTEMPTS>=3,String(V106_INBOX_MAX_ATTEMPTS));
  add(\"v106 subrequest batch budget\",V106_INBOX_BATCH_SIZE<=4,String(V106_INBOX_BATCH_SIZE));
  add(\"v106 lease retry budget\",V106_LEASE_RETRY_COUNT<=16,String(V106_LEASE_RETRY_COUNT));'''""", 'new selftests')

p.write_text(s,encoding='utf-8')
print('patched V10.6 builder for Cloudflare subrequest budget')
