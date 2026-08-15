from pathlib import Path

src=Path('SuperAgent_V10_3_3_Chain_Final.js')
out=Path('SuperAgent_V10_3_4_Atomic_Direct.js')
s=src.read_text()

s=s.replace('const V10_VERSION="10.3.3";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Chain Final";',
            'const V10_VERSION="10.3.4";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Atomic Direct";',1)
s=s.replace('chain_final_guard:true,reliability_lock:true',
            'chain_final_guard:true,atomic_compound_conflicts:true,direct_recurring_delete:true,reliability_lock:true',1)
s=s.replace('message:"Super Agent V10.3.3 Chain Final is ready"',
            'message:"Super Agent V10.3.4 Atomic Direct is ready"',1)

# 1) Replace compound handler: rollback shopping on conflict and carry it into pending intent.
start=s.find('async function handleV102CompoundInput(env,chatId,text,{fromVoice=false}={}){')
end=s.find('\nasync function handleV10DirectCommands(',start)
if start<0 or end<0: raise SystemExit('compound handler not found')
compound=r'''async function handleV102CompoundInput(env,chatId,text,{fromVoice=false}={}){
  const c=extractV102ShoppingAddClause(text);if(!c||!c.remaining)return false;
  const history=await getRecentConversation(env,chatId,CONVERSATION_MEMORY_LIMIT);await saveConversationMessage(env,chatId,"user",String(text||""));
  const snapshot=await snapshotV102ShoppingMutation(env,chatId,c.items);let r=null;
  try{
    r=await addShoppingItems(env,chatId,c.items);
    if(await handleV10DirectCommands(env,chatId,c.remaining,{fromVoice})){}
    else if(await handleLifeDirectCommands(env,chatId,c.remaining)){}
    else await processFreshAgentText(env,chatId,c.remaining,history);

    // If the schedule side paused on a conflict, the compound command must remain atomic:
    // rollback shopping now and carry it with the pending intent for confirmed execution.
    const pending=await getPendingConflict(env,chatId);
    if(pending){
      if(r)await rollbackV102ShoppingMutation(env,chatId,snapshot,r);
      const saved=parseJsonObject(pending.intent_json);
      if(saved?.action){
        saved._compound_shopping_items=[...new Set((c.items||[]).map(x=>String(x||"").trim()).filter(Boolean))].slice(0,30);
        await env.DB.prepare(`UPDATE pending_conflicts SET intent_json=?,updated_at=? WHERE chat_id=?`).bind(JSON.stringify(saved),new Date().toISOString(),chatId).run();
      }
      return true;
    }
  }catch(e){
    if(r)try{await rollbackV102ShoppingMutation(env,chatId,snapshot,r);}catch(rb){console.error("V10.4 compound shopping rollback failed",rb);}
    throw e;
  }
  const msg=r.added.length?`🛒 ضفت ${r.added.length} جديد للمشتريات: ${r.added.join("، ")}${r.existingPending?.length?`\nℹ️ موجود بالفعل: ${r.existingPending.join("، ")}`:""}`:`الأصناف دي موجودة بالفعل في المشتريات${r.existingPending?.length?`: ${r.existingPending.join("، ")}`:"."}`;await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,"assistant",msg);
  return true;
}
'''
s=s[:start]+compound+s[end:]

# 2) Add deterministic recurring deletion before any AI routing.
needle='async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){\n  const raw=String(text||"").trim();const t=normalizeArabicLoose(raw);\n  if(!t)return false;'
if needle not in s: raise SystemExit('direct command anchor not found')
helper=r'''async function tryDirectRecurringDeleteV1034(env,chatId,raw){
  const m=String(raw||"").trim().match(/^(?:احذف|امسح|الغ|الغي|إلغي|شيل)\s+(?:تذكير\s+)?(.+?)\s+(?:المتكرر|المتكرره|المتكررة)(?:\s+(?:ده|دا))?$/iu);
  if(!m)return false;
  let q=normalizeArabicLoose(m[1]||"").replace(/^(?:تذكير|موعد|ميعاد)\s+/u,"").trim();
  if(!q){await sendText(env,chatId,"اكتب اسم التذكير المتكرر اللي عايز تحذفه.");return true;}
  const rows=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 120`).bind(chatId).all())?.results||[];
  const qt=q.split(/\s+/).filter(x=>x.length>1);
  let matches=rows.map(r=>({r,n:normalizeArabicLoose(r.title||"")})).filter(x=>x.n===q||x.n.includes(q)||q.includes(x.n));
  if(!matches.length&&qt.length)matches=rows.map(r=>({r,n:normalizeArabicLoose(r.title||"")})).filter(x=>qt.every(t=>x.n.includes(t)));
  // If a generic noun remains, match its meaningful final tokens against titles like "أراجع المتابعة".
  if(!matches.length&&qt.length===1)matches=rows.map(r=>({r,n:normalizeArabicLoose(r.title||"")})).filter(x=>x.n.split(/\s+/).includes(q)||x.n.includes(q));
  if(matches.length===1){await deleteScheduleRule(env,chatId,Number(matches[0].r.id));return true;}
  if(matches.length>1){
    const names=[...new Set(matches.slice(0,8).map(x=>String(x.r.title||"")))];
    await sendText(env,chatId,`لقيت أكتر من تذكير متكرر مطابق:\n${names.map(x=>`• ${x}`).join("\n")}\nاكتب الاسم بشكل أوضح.`);return true;
  }
  await sendText(env,chatId,`ملقتش تذكير متكرر مطابق لـ «${String(m[1]||"").trim()}».`);return true;
}

async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){
  const raw=String(text||"").trim();const t=normalizeArabicLoose(raw);
  if(!t)return false;
  if(await tryDirectRecurringDeleteV1034(env,chatId,raw))return true;'''
s=s.replace(needle,helper,1)

# 3) Confirming a conflict replays carried shopping atomically with the saved schedule intent.
old='''const confirmOptions=savedIntent.action==="bulk_delete"?{skipConflictCheck:true,confirmed:true}:{skipConflictCheck:true};
await executeIntent(env,chatId,savedIntent,confirmOptions);
return;'''
new='''const confirmOptions=savedIntent.action==="bulk_delete"?{skipConflictCheck:true,confirmed:true}:{skipConflictCheck:true};
const compoundItems=Array.isArray(savedIntent._compound_shopping_items)?savedIntent._compound_shopping_items.map(x=>String(x||"").trim()).filter(Boolean):[];
delete savedIntent._compound_shopping_items;
let compoundSnapshot=null,compoundResult=null;
try{
  if(compoundItems.length){compoundSnapshot=await snapshotV102ShoppingMutation(env,chatId,compoundItems);compoundResult=await addShoppingItems(env,chatId,compoundItems);}
  await executeIntent(env,chatId,savedIntent,confirmOptions);
}catch(e){
  if(compoundResult)try{await rollbackV102ShoppingMutation(env,chatId,compoundSnapshot,compoundResult);}catch(rb){console.error("V10.4 confirmed compound rollback failed",rb);}
  throw e;
}
if(compoundResult){const msg=compoundResult.added.length?`🛒 ضفت ${compoundResult.added.length} جديد للمشتريات: ${compoundResult.added.join("، ")}${compoundResult.existingPending?.length?`\nℹ️ موجود بالفعل: ${compoundResult.existingPending.join("، ")}`:""}`:`الأصناف دي موجودة بالفعل في المشتريات${compoundResult.existingPending?.length?`: ${compoundResult.existingPending.join("، ")}`:"."}`;await sendText(env,chatId,msg);}
return;'''
if old not in s: raise SystemExit('conflict confirm anchor not found')
s=s.replace(old,new,1)

# 4) Stronger alert cleanup on canonical dependency clusters.
# Relation-derived child reminders already encode the relative timing; unless the user explicitly
# asked for a standalone advance alert, no model-generated alert should survive on that cluster.
old2='''  let merged=normalizeV10Dependencies(canonical);
  const extras=original.filter(d=>!(canonicalNodes.has(d.source_ref)&&canonicalNodes.has(d.target_ref)));'''
new2='''  const standaloneAlert=/(?:تنبيه\s+مسبق|تنبيه\s+قبل|نبهني\s+قبل\s+(?:الموعد|الاجتماع|الدكتور))/iu.test(raw);
  if(!standaloneAlert)for(const idx of canonicalNodes){if(intent.items[idx])intent.items[idx].advance_alerts=[];}
  let merged=normalizeV10Dependencies(canonical);
  const extras=original.filter(d=>!(canonicalNodes.has(d.source_ref)&&canonicalNodes.has(d.target_ref)));'''
if old2 not in s: raise SystemExit('canonical alert anchor not found')
s=s.replace(old2,new2,1)

out.write_text(s)
print('built',out,len(out.read_bytes()))
