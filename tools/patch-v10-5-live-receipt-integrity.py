from pathlib import Path

p=Path('SuperAgent_V10_5_Reliability_Rewrite.js')
s=p.read_text(encoding='utf-8')

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'anchor missing: {label}')
    s=s.replace(old,new,1)

# A create receipt is only reusable while the entities produced by that create still exist.
anchor='''async function saveOperationReceipt(env,chatId,fingerprint,action,responseText){const now=new Date().toISOString();await env.DB.prepare(`INSERT INTO operation_receipts(chat_id,fingerprint,action,state,response_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(String(chatId),String(fingerprint),String(action),"committed",String(responseText||"").slice(0,12000),now,now).run();}'''
helper=anchor+'''\nasync function createReceiptStateStillExistsV105(env,chatId,intent){
  const items=Array.isArray(intent?.items)?intent.items:[];
  const recurring=Array.isArray(intent?.recurring_items)?intent.recurring_items:[];
  if(!items.length&&!recurring.length)return false;
  for(const item of items){
    const title=String(item?.title||'').trim();const date=String(item?.date||'').trim();const time=String(item?.time||'').trim();
    if(!title||!date||!time)return false;
    const row=await env.DB.prepare(`SELECT id FROM reminders WHERE chat_id=? AND title=? AND local_date=? AND local_time=? AND cancelled=0 LIMIT 1`).bind(String(chatId),title,date,time).first();
    if(!row?.id)return false;
  }
  for(const rule of recurring){
    const title=String(rule?.title||'').trim();if(!title)return false;
    const row=await env.DB.prepare(`SELECT id FROM schedule_rules WHERE chat_id=? AND title=? AND active=1 LIMIT 1`).bind(String(chatId),title).first();
    if(!row?.id)return false;
  }
  return true;
}
async function invalidateOperationReceiptV105(env,id){
  if(!id)return;await env.DB.prepare(`UPDATE operation_receipts SET state='stale',updated_at=? WHERE id=?`).bind(new Date().toISOString(),Number(id)).run();
}'''
rep(anchor,helper,'receipt helper')

old='''const priorReceipt=await getRecentOperationReceipt(env,chatId,receiptFingerprint);
if(priorReceipt?.response_text){await sendText(env,chatId,String(priorReceipt.response_text),quickMenuKeyboard());return;}'''
new='''const priorReceipt=await getRecentOperationReceipt(env,chatId,receiptFingerprint);
if(priorReceipt?.response_text){
  if(await createReceiptStateStillExistsV105(env,chatId,intent)){
    await sendText(env,chatId,String(priorReceipt.response_text),quickMenuKeyboard());return;
  }
  await invalidateOperationReceiptV105(env,priorReceipt.id);
}'''
rep(old,new,'receipt replay validation')

# Keep duplicate recurrence state canonical in rule_json as well as the top-level columns.
old='''const oldStart=String(row.start_at||'');const newStart=oldStart?`${splitLocalDateTime(oldStart)[0]} ${time}`:oldStart;
  const before={...row};await env.DB.prepare(`UPDATE schedule_rules SET rule_json=?,start_at=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(rule),newStart,new Date().toISOString(),Number(row.id),chatId).run();'''
new='''const oldStart=String(row.start_at||'');const newStart=oldStart?`${splitLocalDateTime(oldStart)[0]} ${time}`:oldStart;
  if(newStart)rule.start_at=newStart;
  const before={...row};await env.DB.prepare(`UPDATE schedule_rules SET rule_json=?,start_at=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(rule),newStart,new Date().toISOString(),Number(row.id),chatId).run();'''
rep(old,new,'recurrence canonical start')

# A full user wipe must also invalidate historical create receipts.
old='''    env.DB.prepare(`DELETE FROM pending_requests WHERE chat_id=?`).bind(chatId)
  ]);'''
new='''    env.DB.prepare(`DELETE FROM pending_requests WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM operation_receipts WHERE chat_id=?`).bind(chatId)
  ]);'''
rep(old,new,'clear all receipts')

p.write_text(s,encoding='utf-8')
print('patched',p,len(p.read_bytes()))
