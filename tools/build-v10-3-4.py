from pathlib import Path

src=Path('SuperAgent_V10_3_3_Chain_Final.js')
out=Path('SuperAgent_V10_3_4_Atomic_Direct.js')
s=src.read_text()

s=s.replace('const V10_VERSION="10.3.3";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Chain Final";',
            'const V10_VERSION="10.3.4";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Atomic Direct";',1)
s=s.replace('chain_final_guard:true,reliability_lock:true',
            'chain_final_guard:true,atomic_compound_conflicts:true,direct_recurring_delete:true,natural_shopping_language:true,shopping_delete_undo:true,reliability_lock:true',1)
s=s.replace('message:"Super Agent V10.3.3 Chain Final is ready"',
            'message:"Super Agent V10.3.4 Atomic Direct is ready"',1)

# 0) Egyptian relationship dialect: canonicalize both feminine and masculine references.
# V10.3.3 handled "قبلها/بعدها" but a natural "قبله/بعده" could bypass canonical cleanup.
rstart=s.find('function repairV102LinkedEventIntent(intent,base,timeZone=TIME_ZONE){')
rend=s.find('\nfunction applyV102SemanticRepairs(',rstart)
if rstart<0 or rend<0: raise SystemExit('relationship repair block not found')
rblock=s[rstart:rend]
rblock=rblock.replace(r'\s+قبلها\s+',r'\s+(?:قبلها|قبله)\s+',1)
rblock=rblock.replace(r'و?بعدها\s+',r'و?(?:بعدها|بعده)\s+',1)
s=s[:rstart]+rblock+s[rend:]

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
  const msg=shoppingResultMessageV1034(r);await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,"assistant",msg);
  return true;
}
'''
s=s[:start]+compound+s[end:]

# 2) Add deterministic recurring deletion, natural-shopping language, and shopping deletion before AI routing.
needle='async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){\n  const raw=String(text||"").trim();const t=normalizeArabicLoose(raw);\n  if(!t)return false;'
if needle not in s: raise SystemExit('direct command anchor not found')
helper=r'''function shoppingResultMessageV1034(r){
  if(r?.added?.length)return `🛒 ضفت ${r.added.length} جديد للمشتريات: ${r.added.join("، ")}${r.existingPending?.length?`\nℹ️ موجود بالفعل: ${r.existingPending.join("، ")}`:""}`;
  return `الأصناف دي موجودة بالفعل في المشتريات${r?.existingPending?.length?`: ${r.existingPending.join("، ")}`:"."}`;
}

function extractNaturalShoppingItemsV1034(raw){
  let t=normalizeArabicLoose(String(raw||"")).replace(/[؟?!.,،؛;]+/gu," ").replace(/\s+/g," ").trim();
  if(!t)return null;
  // A real clock/recurrence instruction stays a reminder. Date-only wording is still safe as a shopping wish.
  if(/(?:\b(?:الساعه|الساعة|صباح|مساء|الظهر|العصر|بالليل|الليل|كل\s+(?:يوم|اسبوع|أسبوع))\b|\d{1,2}:\d{2}|(?:بعد|قبل)\s+\d+\s*(?:دقيقه|دقيقة|دقايق|ساعه|ساعة))/u.test(t))return null;
  // Avoid stealing information/search requests such as "جيبلي سعر..." from general chat.
  if(/(?:معلومه|معلومة|معلومات|خبر|اخبار|أخبار|سعر|اسعار|أسعار|رابط|لينك|صوره|صورة|كود|نتيجه|نتيجة)/u.test(t))return null;
  const m=t.match(/^(?:(?:النهارده|النهاردة|بكره|بكرة|غدا)\s+)?(?:ممكن\s+)?(?:(?:فكرني|فكرنى|تفكرني|ذكرني|ذكرنى|نبهني|نبهنى|تنبهني|افتكرني|متنسانيش|ماتنسانيش|ما\s+تنسانيش)\s+)?(?:(?:انا\s+)?(?:عاوز|عايز|محتاج|لازم|حابب|نفسي|نفسى)\s+)?(?:اني\s+)?(?:اشتريلي|اشتريلنا|اشتري|اشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+(.+)$/u);
  if(!m)return null;
  let tail=String(m[1]||"").trim();
  tail=tail.replace(/\s+(?:النهارده|النهاردة|بكره|بكرة|غدا)$/u,"").replace(/\s+(?:من|في|فى)\s+(?:الهايبر|السوبر\s*ماركت|الماركت|كارفور)$/u,"").trim();
  if(!tail)return null;
  const items=splitShoppingItems(tail).map(x=>String(x||"").trim()).filter(Boolean).slice(0,30);
  return items.length?items:null;
}

async function restoreShoppingListSnapshotV1034(env,chatId,snapshot){
  const list=snapshot?.list;if(!list?.id)return false;
  const now=new Date().toISOString();
  await env.DB.prepare(`INSERT OR REPLACE INTO smart_lists(id,chat_id,name,normalized_name,list_type,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(Number(list.id),chatId,String(list.name||"مشتريات"),String(list.normalized_name||normalizeArabicLoose(list.name||"مشتريات")),String(list.list_type||"shopping"),Number(list.active??1),String(list.created_at||now),now).run();
  for(const x of (snapshot.items||[])){
    await env.DB.prepare(`INSERT OR REPLACE INTO smart_list_items(id,list_id,chat_id,title,normalized_title,quantity,status,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(Number(x.id),Number(list.id),chatId,String(x.title||""),String(x.normalized_title||normalizeArabicLoose(x.title||"")),x.quantity??null,String(x.status||"pending"),Number(x.position||0),String(x.created_at||now),now).run();
  }
  return true;
}

async function deleteShoppingListV1034(env,chatId){
  const list=await getDefaultShoppingList(env,chatId,false);if(!list)return{deleted:false,count:0};
  const items=await getShoppingItems(env,chatId,list.id);const snapshot={list:{...list},items:items.map(x=>({...x}))};
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shopping_sessions WHERE chat_id=? AND list_id=?`).bind(chatId,Number(list.id)),
    env.DB.prepare(`DELETE FROM smart_list_items WHERE chat_id=? AND list_id=?`).bind(chatId,Number(list.id)),
    env.DB.prepare(`DELETE FROM smart_lists WHERE chat_id=? AND id=?`).bind(chatId,Number(list.id))
  ]);
  try{
    await writeAudit(env,chatId,{action:"delete",entityType:"shopping_list",entityId:String(list.id),summary:`حذف قائمة المشتريات (${items.length} عنصر)`,before:snapshot,undo:{type:"restore_deleted_shopping_list",snapshot},strict:true});
  }catch(e){
    await restoreShoppingListSnapshotV1034(env,chatId,snapshot);
    throw new Error(`Audit commit failed; shopping list restored: ${safeError(e)}`);
  }
  return{deleted:true,count:items.length};
}

async function tryDirectShoppingDeleteV1034(env,chatId,raw){
  const t=normalizeArabicLoose(String(raw||"").trim());
  if(/^(?:احذف|امسح|شيل|فضي|افرغ)\s+(?:(?:كل|قائمه|قايمه|قائمة|قايمة)\s+)?(?:المشتريات|قائمه\s+المشتريات|قايمه\s+المشتريات|قائمة\s+المشتريات|قايمة\s+المشتريات)(?:\s+كلها)?$/u.test(t)){
    const r=await deleteShoppingListV1034(env,chatId);await sendText(env,chatId,r.deleted?`🗑️ مسحت قائمة المشتريات كلها (${r.count} عنصر). تقدر ترجعها بـ /undo.`:"قائمة المشتريات مش موجودة أصلًا.");return true;
  }
  let m=String(raw||"").trim().match(/^(?:امسح|شيل|احذف)\s+(.+?)\s+(?:من\s+)?(?:المشتريات|قائمة\s+المشتريات|قائمه\s+المشتريات|قايمة\s+المشتريات|قايمه\s+المشتريات|القائمة|القايمة)$/iu);
  if(!m){const session=await getActiveShoppingSession(env,chatId);if(session)m=String(raw||"").trim().match(/^(?:امسح|شيل|احذف)\s+(.+)$/iu);}
  if(m){const n=await removeShoppingByText(env,chatId,m[1]);await sendText(env,chatId,n?`🗑️ شلت ${n} من قائمة المشتريات. تقدر ترجع آخر حذف بـ /undo.`:"ملقتش الصنف ده في المشتريات.");return true;}
  return false;
}

async function tryDirectRecurringDeleteV1034(env,chatId,raw){
  const m=String(raw||"").trim().match(/^(?:احذف|امسح|الغ|الغي|إلغي|شيل)\s+(?:تذكير\s+)?(.+?)\s+(?:المتكرر|المتكرره|المتكررة)(?:\s+(?:ده|دا))?$/iu);
  if(!m)return false;
  let q=normalizeArabicLoose(m[1]||"").replace(/^(?:تذكير|موعد|ميعاد)\s+/u,"").trim();
  if(!q){await sendText(env,chatId,"اكتب اسم التذكير المتكرر اللي عايز تحذفه.");return true;}
  const rows=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 120`).bind(chatId).all())?.results||[];
  const qt=q.split(/\s+/).filter(x=>x.length>1);
  let matches=rows.map(r=>({r,n:normalizeArabicLoose(r.title||"")})).filter(x=>x.n===q||x.n.includes(q)||q.includes(x.n));
  if(!matches.length&&qt.length)matches=rows.map(r=>({r,n:normalizeArabicLoose(r.title||"")})).filter(x=>qt.every(t=>x.n.includes(t)));
  if(!matches.length&&qt.length===1)matches=rows.map(r=>({r,n:normalizeArabicLoose(r.title||"")})).filter(x=>x.n.split(/\s+/).includes(q)||x.n.includes(q));
  if(matches.length===1){await deleteScheduleRule(env,chatId,Number(matches[0].r.id));return true;}
  if(matches.length>1){const names=[...new Set(matches.slice(0,8).map(x=>String(x.r.title||"")))];await sendText(env,chatId,`لقيت أكتر من تذكير متكرر مطابق:\n${names.map(x=>`• ${x}`).join("\n")}\nاكتب الاسم بشكل أوضح.`);return true;}
  await sendText(env,chatId,`ملقتش تذكير متكرر مطابق لـ «${String(m[1]||"").trim()}».`);return true;
}

async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){
  const raw=String(text||"").trim();const t=normalizeArabicLoose(raw);
  if(!t)return false;
  if(await tryDirectRecurringDeleteV1034(env,chatId,raw))return true;
  if(await tryDirectShoppingDeleteV1034(env,chatId,raw))return true;
  const naturalShopping=extractNaturalShoppingItemsV1034(raw);
  if(naturalShopping){const r=await addShoppingItems(env,chatId,naturalShopping);await sendText(env,chatId,shoppingResultMessageV1034(r));return true;}'''
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
if(compoundResult)await sendText(env,chatId,shoppingResultMessageV1034(compoundResult));
return;'''
if old not in s: raise SystemExit('conflict confirm anchor not found')
s=s.replace(old,new,1)

# 4) Stronger alert cleanup on canonical dependency clusters.
# Relation-derived child reminders already encode the relative timing; unless the user explicitly
# asked for a standalone alert specifically on the parent, model-generated alerts must not survive.
old2='''  let merged=normalizeV10Dependencies(canonical);
  const extras=original.filter(d=>!(canonicalNodes.has(d.source_ref)&&canonicalNodes.has(d.target_ref)));'''
new2=r'''  const standaloneAlert=/(?:تنبيه\s+مسبق|تنبيه\s+قبل|نبهني\s+قبل\s+(?:الموعد|الاجتماع|الدكتور))/iu.test(raw);
  if(!standaloneAlert)for(const idx of canonicalNodes){if(intent.items[idx])intent.items[idx].advance_alerts=[];}
  let merged=normalizeV10Dependencies(canonical);
  const extras=original.filter(d=>!(canonicalNodes.has(d.source_ref)&&canonicalNodes.has(d.target_ref)));'''
if old2 not in s: raise SystemExit('canonical alert anchor not found')
s=s.replace(old2,new2,1)

# 5) Whole-shopping-list undo.
old3='''    }else if(u.type==="restore_deleted_list_item"){
      const x=u.row||{};
      await env.DB.prepare(`INSERT OR REPLACE INTO smart_list_items(id,list_id,chat_id,title,normalized_title,quantity,status,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(Number(x.id),Number(x.list_id),chatId,x.title,x.normalized_title,x.quantity,x.status,Number(x.position||0),x.created_at||new Date().toISOString(),new Date().toISOString()).run();
    }else{
      return "آخر عملية مسجلة مش قابلة للتراجع تلقائيًا.";'''
new3='''    }else if(u.type==="restore_deleted_list_item"){
      const x=u.row||{};
      await env.DB.prepare(`INSERT OR REPLACE INTO smart_list_items(id,list_id,chat_id,title,normalized_title,quantity,status,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(Number(x.id),Number(x.list_id),chatId,x.title,x.normalized_title,x.quantity,x.status,Number(x.position||0),x.created_at||new Date().toISOString(),new Date().toISOString()).run();
    }else if(u.type==="restore_deleted_shopping_list"){
      await restoreShoppingListSnapshotV1034(env,chatId,u.snapshot||{});
    }else{
      return "آخر عملية مسجلة مش قابلة للتراجع تلقائيًا.";'''
if old3 not in s: raise SystemExit('undo shopping anchor not found')
s=s.replace(old3,new3,1)

out.write_text(s)
print('built',out,len(out.read_bytes()))
