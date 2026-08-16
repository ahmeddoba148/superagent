from pathlib import Path
import re

src=Path('SuperAgent_V10_4_3_Full_Arabic.js')
out=Path('SuperAgent_V10_5_Reliability_Rewrite.js')
s=src.read_text(encoding='utf-8')

def need(old,label):
    if old not in s:
        raise SystemExit(label+' anchor missing')

def rep(old,new,label,count=1):
    global s
    need(old,label)
    s=s.replace(old,new,count)

# Version / capability marker.
s=s.replace('const V10_VERSION="10.4.3";const V10_NAME="سوبر إيجنت 10.4.3 — نظام الحياة · إدارة البيانات · نسخة شديدة التحمل";',
'''const V10_VERSION="10.5";const V10_NAME="سوبر إيجنت 10.5 — إعادة بناء الاعتمادية · صفر أخطاء معروفة";''',1)
s=s.replace('message:"سوبر إيجنت 10.4.3 جاهز للعمل"','message:"سوبر إيجنت 10.5 جاهز للعمل"',1)
s=s.replace('arabic_holiday_labels:true,reliability_lock:true',
'''arabic_holiday_labels:true,v105_reliability_rewrite:true,v105_per_chat_queue:true,v105_intent_guard:true,v105_mixed_message_guard:true,v105_clear_everything:true,reliability_lock:true''',1)

# 1) Serialize updates per chat in this worker instance. This fixes the observed out-of-order fast-message race.
rep('ctx.waitUntil(handleTelegramUpdate(update,env));','ctx.waitUntil(enqueueTelegramUpdateV105(update,env));','telegram enqueue')
queue_code=r'''
const V105_CHAT_QUEUES=new Map();
function telegramChatKeyV105(update){return String(update?.message?.chat?.id??update?.callback_query?.message?.chat?.id??update?.callback_query?.from?.id??'__global__');}
async function enqueueTelegramUpdateV105(update,env){
  const key=telegramChatKeyV105(update);const previous=V105_CHAT_QUEUES.get(key)||Promise.resolve();
  const current=previous.catch(()=>{}).then(()=>handleTelegramUpdate(update,env));
  V105_CHAT_QUEUES.set(key,current);
  try{return await current;}finally{if(V105_CHAT_QUEUES.get(key)===current)V105_CHAT_QUEUES.delete(key);}
}
'''
rep('async function handleTelegramUpdate(update,env){',queue_code+'\nasync function handleTelegramUpdate(update,env){','handle update insertion')

# 2) Natural undo aliases must stay deterministic and never fall to AI.
old='if(["/undo","تراجع","رجع اخر حاجه","رجع اخر حاجة"].includes(t)){'
new='if(["/undo","تراجع","رجع اخر حاجه","رجع اخر حاجة","رجع اخر تعديل","رجع آخر تعديل","ارجع اخر تعديل","ارجع آخر تعديل"].includes(t)){'
rep(old,new,'undo aliases')

# 3) No stale confirm: if no pending conflict exists, never send the phrase to AI.
anchor='''const pendingConflict=await getPendingConflict(env,chatId);
if(pendingConflict){'''
repl='''const pendingConflict=await getPendingConflict(env,chatId);
if(!pendingConflict&&isConflictConfirmReply(text)){
await saveConversationMessage(env,chatId,"user",text);
const answer="ℹ️ مفيش عملية متعارضة معلقة للتنفيذ.";
await sendText(env,chatId,answer);
await saveConversationMessage(env,chatId,"assistant",answer);
return;
}
if(pendingConflict){'''
rep(anchor,repl,'no stale confirm')

# 4) Intent hardening: recurring window != event duration; recover explicit appointment duration;
# remove AI-created fake reminders that are plainly shopping clauses.
hardening=r'''
function explicitDurationMinutesV105(text){
  const n=normalizeArabicLoose(normalizeDigits(String(text||''))).replace(/\s+/g,' ').trim();
  const m=n.match(/(?:مدته|مدتها|مدة الموعد|مدة الاجتماع|مدة التذكير)\s+(.+?)(?=\s*(?:،|,|؛|;|\.|وبعد|وفكرني|وضيف|وزود|وحط|$))/u);
  if(!m)return 0;return parseShiftMinutesV104(String(m[1]||'').trim());
}
function hardenIntentV105(intent){
  if(!intent||typeof intent!=='object')return intent;
  const base=String(intent._base_text||'');
  const hasExplicitDuration=/(?:مدته|مدتها|مدة الموعد|مدة الاجتماع|مدة التذكير)/u.test(normalizeArabicLoose(base));
  if(Array.isArray(intent.recurring_items))for(const r of intent.recurring_items){
    if(!r||typeof r!=='object')continue;
    if(!hasExplicitDuration&&/(?:لمدة|مده)\s+\d+\s*(?:يوم|ايام|أيام|اسبوع|أسبوع|اسابيع|أسابيع|شهر|شهور|سنة|سنين)/u.test(normalizeArabicLoose(normalizeDigits(base))))r.duration_minutes=0;
    if(r.kind!=='appointment'&&!hasExplicitDuration&&Number(r.duration_minutes||0)>=1440)r.duration_minutes=0;
  }
  const explicit=explicitDurationMinutesV105(base);
  if(explicit&&Array.isArray(intent.items))for(const x of intent.items){if(x?.kind==='appointment'&&!Number(x.duration_minutes||0))x.duration_minutes=explicit;}
  if(Array.isArray(intent.items)&&/(?:للمشتريات|قائمة المشتريات|قائمه المشتريات)/u.test(base)){
    intent.items=intent.items.filter(x=>!/\bللمشتريات\b/u.test(String(x?.title||'')));
  }
  return intent;
}
'''
rep('async function executeIntent(env,chatId,intent,options={}){',hardening+'\nasync function executeIntent(env,chatId,intent,options={}){\nintent=hardenIntentV105(intent);','intent hardening')

# 5) Better natural-shopping segmentation for standalone "جيبلي/هاتلي" after waw.
needle="  let marked=original.replace(/[\\r\\n]+/g,' ␞ ');"
insert="  let marked=original.replace(/[\\r\\n]+/g,' ␞ ');\n  marked=marked.replace(/\\s+و(?=(?:جيبلي|جيب|هاتلي|هات|فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|متنسانيش|ماتنسانيش)\\s+)/giu,' ␞ ');"
rep(needle,insert,'shopping waw split')

# 6) Deterministic recurring-time updater and mixed timed-reminder + shopping splitter.
helpers=r'''
function parseClockV105(raw){
  const n=normalizeArabicLoose(normalizeDigits(String(raw||''))).replace(/\s+/g,' ').trim();
  const m=n.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(صباح|مساء|الظهر|ظهر|العصر|بالليل|الليل|ليل)?$/u);if(!m)return null;
  let h=Number(m[1]),mi=Number(m[2]||0);if(h>23||mi>59)return null;const p=m[3]||'';
  if(p){if(/مساء|العصر|بالليل|الليل|ليل/u.test(p)&&h<12)h+=12;else if(/صباح/u.test(p)&&h===12)h=0;else if(/الظهر|ظهر/u.test(p)&&h<12)h+=12;}
  return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
}
async function tryDirectRecurringTimeUpdateV105(env,chatId,raw){
  const n=normalizeArabicLoose(normalizeDigits(String(raw||''))).replace(/\s+/g,' ').trim();
  const m=n.match(/^(?:خلي|خلى|غير|غيّر)\s+(?:تذكير\s+)?(.+?)\s+المتكرر\s+(?:الساعة|الساعه)\s+(.+)$/u);if(!m)return false;
  const query=String(m[1]||'').trim(),time=parseClockV105(String(m[2]||'').trim());if(!time)return false;
  const rows=(await env.DB.prepare(`SELECT * FROM schedule_rules WHERE chat_id=? AND active=1 ORDER BY id DESC LIMIT 200`).bind(chatId).all())?.results||[];
  const q=normalizeArabicLoose(query);const hits=rows.filter(r=>{const t=normalizeArabicLoose(r.title||'');return t===q||t.includes(q)||q.includes(t);});
  if(!hits.length){await sendText(env,chatId,`ملقتش تذكير متكرر مطابق لـ «${query}».`);return true;}
  if(hits.length>1){await sendText(env,chatId,`لقيت أكتر من تذكير متكرر مطابق لـ «${query}». اكتب الاسم بشكل أوضح.`);return true;}
  const row=hits[0],rule=parseJsonObject(row.rule_json);rule.times=[time];
  const oldStart=String(row.start_at||'');const newStart=oldStart?`${splitLocalDateTime(oldStart)[0]} ${time}`:oldStart;
  const before={...row};await env.DB.prepare(`UPDATE schedule_rules SET rule_json=?,start_at=?,updated_at=? WHERE id=? AND chat_id=?`).bind(JSON.stringify(rule),newStart,new Date().toISOString(),Number(row.id),chatId).run();
  await writeAudit(env,chatId,{action:'update',entityType:'schedule_rule',entityId:String(row.id),summary:`تعديل تكرار: ${row.title}`,before,undo:{type:'restore_schedule_rule',row:before}});
  await sendText(env,chatId,`✅ عدلت التكرار: ${row.title} — الساعة ${formatArabicTime(time)}.`);return true;
}
function normalizeMixedShoppingSegmentV105(seg){
  let x=String(seg||'').trim().replace(/^[\s،,؛;]+|[\s،,؛;]+$/g,'').replace(/^و/u,'').trim();
  x=x.replace(/^بص\s+يا\s+معلم\s+/u,'').replace(/^عاوز\s+كمان\s+/u,'عاوز أشتري ');
  return x;
}
function extractMixedTimedShoppingV105(raw){
  const original=String(raw||'').trim();if(!/(?:الساعة|الساعه|\d{1,2}:\d{2})/u.test(normalizeArabicLoose(normalizeDigits(original))))return null;
  const parts=original.split(/[،,؛;]+/u).map(x=>x.trim()).filter(Boolean);if(parts.length<2)return null;
  const timed=parts.find(x=>/(?:الساعة|الساعه|\d{1,2}:\d{2})/u.test(normalizeArabicLoose(normalizeDigits(x))));if(!timed)return null;
  const items=[];
  for(const p0 of parts){if(p0===timed)continue;let p=normalizeMixedShoppingSegmentV105(p0);if(!p)continue;
    let m=p.match(/^(?:خلي\s+بالك\s+)?(.+?)\s+(?:للمشتريات|في\s+المشتريات|فى\s+المشتريات)(?:\s+مش\s+تذكير)?$/u);if(m){items.push(...splitShoppingItems(m[1]));continue;}
    const got=extractNaturalShoppingItemsV1034(p);if(got?.length)items.push(...got);
  }
  const seen=new Set(),clean=[];for(const x0 of items){const x=String(x0||'').trim().replace(/^(?:جيبلي|هاتلي|هات|جيب)\s+/u,'');const k=normalizeArabicLoose(x);if(x&&!seen.has(k)){seen.add(k);clean.push(x);}}
  return clean.length?{timed:normalizeMixedShoppingSegmentV105(timed),items:clean}:null;
}
async function tryDirectMixedTimedShoppingV105(env,chatId,raw){
  const mix=extractMixedTimedShoppingV105(raw);if(!mix)return false;
  const ok=await tryDirectTimedPurchaseReminderV1034(env,chatId,mix.timed);if(!ok)return false;
  const pending=await getPendingConflict(env,chatId);if(pending){const saved=parseJsonObject(pending.intent_json);saved._compound_shopping_items=mix.items;await env.DB.prepare(`UPDATE pending_conflicts SET intent_json=?,updated_at=? WHERE chat_id=?`).bind(JSON.stringify(saved),new Date().toISOString(),chatId).run();return true;}
  const r=await addShoppingItems(env,chatId,mix.items);await sendText(env,chatId,shoppingResultMessageV1034(r));return true;
}
'''
rep('async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){',helpers+'\nasync function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){','direct helpers')
old_direct='''  if(!t)return false;
  if(await tryDirectWorldClearV1042(env,chatId,raw))return true;
  if(await tryDirectRelativeRescheduleV104(env,chatId,raw))return true;'''
new_direct='''  if(!t)return false;
  if(await tryDirectWorldClearV1042(env,chatId,raw))return true;
  if(await tryDirectMixedTimedShoppingV105(env,chatId,raw))return true;
  if(await tryDirectRecurringTimeUpdateV105(env,chatId,raw))return true;
  if(await tryDirectRelativeRescheduleV104(env,chatId,raw))return true;'''
rep(old_direct,new_direct,'direct order')

# 7) New "delete everything" button + second confirmation + scoped implementation.
start=s.find('async function showDangerPanel(')
if start<0:raise SystemExit('showDangerPanel missing')
end=s.find('async function ',start+10)
block=s[start:end if end>start else len(s)]
back='[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]'
if back not in block:raise SystemExit('danger back anchor missing')
block=block.replace(back,'[{text:"🔥 حذف كل شيء",callback_data:"danger:clear_everything"}],'+back,1)
s=s[:start]+block+s[end:]

cb_anchor='''if(data==="danger:clear_context")return editOrSend(env,chatId,messageId,"⚠️ تمسح سياق المحادثة؟ المواعيد ونموذج العالم مش هيتمسحوا.",{inline_keyboard:[[{text:"✅ امسح السياق",callback_data:"do:clear_memory"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});'''
if cb_anchor not in s:
    cb_anchor='''if(data==="danger:clear_context")return editOrSend(env,chatId,messageId,"⚠️ تمسح سياق المحادثة؟ المواعيد والـWorld Model مش هيتمسحوا.",{inline_keyboard:[[{text:"✅ امسح السياق",callback_data:"do:clear_memory"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});'''
need(cb_anchor,'danger context callback')
cb_new=cb_anchor+'''\nif(data==="danger:clear_everything")return editOrSend(env,chatId,messageId,"⚠️ تحذير نهائي: هتمسح كل الموجود في قائمة المسح لهذا الحساب: المواعيد والتكرارات، المشتريات، نموذج العالم والعلاقات، وسياق المحادثة. العملية دي كبيرة.",{inline_keyboard:[[{text:"✅ نعم، احذف كل شيء",callback_data:"do:clear_everything"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});'''
s=s.replace(cb_anchor,cb_new,1)

clear_helpers=r'''
async function clearEverythingV105(env,chatId){
  const before={
    reminders:Number((await env.DB.prepare(`SELECT COUNT(*) c FROM reminders WHERE chat_id=?`).bind(chatId).first())?.c||0),
    rules:Number((await env.DB.prepare(`SELECT COUNT(*) c FROM schedule_rules WHERE chat_id=?`).bind(chatId).first())?.c||0),
    prayer:Number((await env.DB.prepare(`SELECT COUNT(*) c FROM prayer_rules WHERE chat_id=?`).bind(chatId).first())?.c||0)
  };
  const shop=await clearShoppingV1042(env,chatId);const world=await clearWorldModelV1042(env,chatId);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM event_dependencies WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM reminder_fires WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM schedule_fires WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM reminders WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM schedule_rules WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM prayer_rules WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM conversation_messages WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM pending_dialogs WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM pending_conflicts WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM pending_requests WHERE chat_id=?`).bind(chatId)
  ]);
  return{...before,shopping:shop.count,entities:world.entities,edges:world.edges};
}
'''
rep('async function clearWorldModelV1042(env,chatId){',clear_helpers+'\nasync function clearWorldModelV1042(env,chatId){','clear all helper')

exec_anchor='''if(data==="do:clear_world"){
const r=await clearWorldModelV1042(env,chatId);'''
need(exec_anchor,'clear world execute')
exec_new='''if(data==="do:clear_everything"){
const r=await clearEverythingV105(env,chatId);
return editOrSend(env,chatId,messageId,`✅ تم حذف كل شيء الموجود في قائمة المسح لهذا الحساب.\\n📅 ${r.reminders} موعد · 🔁 ${r.rules+r.prayer} تكرار · 🛒 ${r.shopping} مشتريات · 🧠 ${r.entities} كيان · 🔗 ${r.edges} علاقة`,{inline_keyboard:[[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]]});
}

'''+exec_anchor
s=s.replace(exec_anchor,exec_new,1)

# Keep setup string and name consistent.
s=s.replace('سوبر إيجنت 10.4.3','سوبر إيجنت 10.5')

out.write_text(s,encoding='utf-8')
print('built',out,len(out.read_bytes()))
