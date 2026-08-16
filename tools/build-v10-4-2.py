from pathlib import Path

src=Path('SuperAgent_V10_4_1_Ultra_Hardened.js')
out=Path('SuperAgent_V10_4_2_Data_Controls.js')
s=src.read_text()

s=s.replace('const V10_VERSION="10.4.1";const V10_NAME="Super Agent V10.4.1 — Life OS · Ultra Hardened";',
            'const V10_VERSION="10.4.2";const V10_NAME="Super Agent V10.4.2 — Life OS · Data Controls · Ultra Hardened";',1)
s=s.replace('message:"Super Agent V10.4.1 Ultra Hardened is ready"','message:"Super Agent V10.4.2 Data Controls is ready"',1)
s=s.replace('timed_purchase_parser_v2:true,reliability_lock:true',
            'timed_purchase_parser_v2:true,world_model_clear:true,shopping_clear_button:true,arabic_holiday_labels:true,reliability_lock:true',1)

old='''async function showDangerPanel(env,chatId,messageId=null){return editOrSend(env,chatId,messageId,"🛡️ إدارة البيانات الحساسة\\n\\nعمليات المسح الكبيرة موجودة هنا فقط حتى يفضل الشات العادي نضيف.",{inline_keyboard:[[{text:"🗑️ مسح كل المواعيد",callback_data:"danger:clear_schedule"}],[{text:"🧹 مسح سياق المحادثة",callback_data:"danger:clear_context"}],[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]]});}'''
new='''async function showDangerPanel(env,chatId,messageId=null){return editOrSend(env,chatId,messageId,"🛡️ إدارة البيانات الحساسة\\n\\nعمليات المسح الكبيرة موجودة هنا فقط حتى يفضل الشات العادي نضيف.",{inline_keyboard:[[{text:"🗑️ مسح كل المواعيد",callback_data:"danger:clear_schedule"}],[{text:"🛒 مسح قائمة المشتريات",callback_data:"danger:clear_shopping"}],[{text:"🧠 مسح World Model",callback_data:"danger:clear_world"}],[{text:"🧹 مسح سياق المحادثة",callback_data:"danger:clear_context"}],[{text:"↩️ لوحة التحكم",callback_data:"panel:home"}]]});}'''
if old not in s: raise SystemExit('danger panel anchor missing')
s=s.replace(old,new,1)

anchor='''if(data==="danger:clear_schedule")return editOrSend(env,chatId,messageId,"⚠️ تمسح كل مواعيدك وكل التكرارات؟",{inline_keyboard:[[{text:"✅ امسح الكل",callback_data:"do:clear_all_user_schedule"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});
if(data==="danger:clear_context")return editOrSend(env,chatId,messageId,"⚠️ تمسح سياق المحادثة؟ المواعيد والـWorld Model مش هيتمسحوا.",{inline_keyboard:[[{text:"✅ امسح السياق",callback_data:"do:clear_memory"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});'''
repl='''if(data==="danger:clear_schedule")return editOrSend(env,chatId,messageId,"⚠️ تمسح كل مواعيدك وكل التكرارات؟",{inline_keyboard:[[{text:"✅ امسح الكل",callback_data:"do:clear_all_user_schedule"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});
if(data==="danger:clear_shopping")return editOrSend(env,chatId,messageId,"⚠️ تمسح قائمة المشتريات كلها؟",{inline_keyboard:[[{text:"✅ امسح المشتريات",callback_data:"do:clear_shopping"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});
if(data==="danger:clear_world")return editOrSend(env,chatId,messageId,"⚠️ تمسح كل الـWorld Model؟\\nهيتم مسح الكيانات والعلاقات اللي Super Agent فاكرها عنك.",{inline_keyboard:[[{text:"✅ امسح World Model",callback_data:"do:clear_world"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});
if(data==="danger:clear_context")return editOrSend(env,chatId,messageId,"⚠️ تمسح سياق المحادثة؟ المواعيد والـWorld Model مش هيتمسحوا.",{inline_keyboard:[[{text:"✅ امسح السياق",callback_data:"do:clear_memory"}],[{text:"↩️ إلغاء",callback_data:"panel:danger"}]]});'''
if anchor not in s: raise SystemExit('danger callbacks anchor missing')
s=s.replace(anchor,repl,1)

# Add safe clear helpers before direct command handler.
needle='async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){'
if needle not in s: raise SystemExit('direct handler anchor missing')
helpers=r'''async function clearWorldModelV1042(env,chatId){
  const entities=Number((await env.DB.prepare(`SELECT COUNT(*) AS c FROM life_entities WHERE chat_id=?`).bind(chatId).first())?.c||0);
  const edges=Number((await env.DB.prepare(`SELECT COUNT(*) AS c FROM life_edges WHERE chat_id=?`).bind(chatId).first())?.c||0);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM life_edges WHERE chat_id=?`).bind(chatId),
    env.DB.prepare(`DELETE FROM life_entities WHERE chat_id=?`).bind(chatId)
  ]);
  return{entities,edges};
}

async function clearShoppingV1042(env,chatId){
  const list=await getDefaultShoppingList(env,chatId,false);
  if(!list)return{deleted:false,count:0};
  const items=await getShoppingItems(env,chatId,list.id);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shopping_sessions WHERE chat_id=? AND list_id=?`).bind(chatId,Number(list.id)),
    env.DB.prepare(`DELETE FROM smart_list_items WHERE chat_id=? AND list_id=?`).bind(chatId,Number(list.id)),
    env.DB.prepare(`DELETE FROM smart_lists WHERE chat_id=? AND id=?`).bind(chatId,Number(list.id))
  ]);
  return{deleted:true,count:items.length};
}

function isDirectWorldClearV1042(raw){
  const t=normalizeArabicLoose(String(raw||"").trim()).replace(/world\s*model/giu,"world model");
  return /^(?:امسح|احذف|شيل|انسى|انسي)\s+(?:(?:كل|كله|كلها)\s+)?(?:الـ?\s*)?(?:world model|وورلد موديل)$/iu.test(t)
    || /^(?:امسح|احذف|شيل|انسى|انسي)\s+(?:كل\s+)?(?:اللي|الى)\s+(?:فاكره|فاكرة|فاكرها)\s+عن\s+(?:الاشخاص|الأشخاص|الناس)\s+(?:و|و?الـ?)?العلاقات$/u.test(t);
}

async function tryDirectWorldClearV1042(env,chatId,raw){
  if(!isDirectWorldClearV1042(raw))return false;
  const r=await clearWorldModelV1042(env,chatId);
  await sendText(env,chatId,`🧠 تم مسح الـWorld Model: ${r.entities} كيان و${r.edges} علاقة.`);
  return true;
}

'''
s=s.replace(needle,helpers+needle,1)

old_direct='''  if(!t)return false;
  if(await tryDirectRelativeRescheduleV104(env,chatId,raw))return true;'''
new_direct='''  if(!t)return false;
  if(await tryDirectWorldClearV1042(env,chatId,raw))return true;
  if(await tryDirectRelativeRescheduleV104(env,chatId,raw))return true;'''
if old_direct not in s: raise SystemExit('direct insertion anchor missing')
s=s.replace(old_direct,new_direct,1)

# Add callback execution before existing clear-all branch.
cb='''if(data==="do:clear_all_user_schedule"){'''
cbnew='''if(data==="do:clear_world"){
const r=await clearWorldModelV1042(env,chatId);
return editOrSend(env,chatId,messageId,`✅ تم مسح الـWorld Model بالكامل.\\n🧠 ${r.entities} كيان · 🔗 ${r.edges} علاقة`,{inline_keyboard:[[{text:"↩️ إدارة المسح",callback_data:"panel:danger"}]]});
}

if(data==="do:clear_shopping"){
const r=await clearShoppingV1042(env,chatId);
return editOrSend(env,chatId,messageId,r.deleted?`✅ تم مسح قائمة المشتريات (${r.count} عنصر).`:"✅ قائمة المشتريات فارغة أصلًا.",{inline_keyboard:[[{text:"↩️ إدارة المسح",callback_data:"panel:danger"}]]});
}

if(data==="do:clear_all_user_schedule"){'''
if cb not in s: raise SystemExit('do clear callback anchor missing')
s=s.replace(cb,cbnew,1)

# Arabic labels for common public/Islamic holiday names returned in English.
holiday_anchor='''lines.push(
`المناسبات/العطلات الرسمية القريبة: ${near.length?near.map(x=>`${x.date} ${x.name||x.english}`).join("؛ "):"لا توجد بيانات عطلات قريبة متاحة من المصدر"}`
);'''
holiday_new=r'''const displayHolidayNameV1042=(x)=>{
  const raw=String(x?.name||x?.english||"").trim();const n=raw.toLowerCase();
  if(/prophet\s+muhammad.*birthday|mawlid|milad.*nabi|muhammad.*birthday/.test(n))return "المولد النبوي الشريف ﷺ";
  if(/eid\s*al[- ]?fitr|eid\s*ul[- ]?fitr/.test(n))return "عيد الفطر المبارك";
  if(/eid\s*al[- ]?adha|eid\s*ul[- ]?adha/.test(n))return "عيد الأضحى المبارك";
  if(/islamic\s+new\s+year|hijri\s+new\s+year/.test(n))return "رأس السنة الهجرية";
  return raw||"مناسبة رسمية";
};
lines.push(
`المناسبات/العطلات الرسمية القريبة: ${near.length?near.map(x=>`${x.date} ${displayHolidayNameV1042(x)}`).join("؛ "):"لا توجد بيانات عطلات قريبة متاحة من المصدر"}`
);'''
if holiday_anchor not in s: raise SystemExit('holiday display anchor missing')
s=s.replace(holiday_anchor,holiday_new,1)

out.write_text(s)
print('built',out,len(out.read_bytes()))
