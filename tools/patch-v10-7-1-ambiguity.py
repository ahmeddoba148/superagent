from pathlib import Path

p=Path('SuperAgent_V10_7_Universal_Agent.js')
s=p.read_text()
s=s.replace('const V10_VERSION="10.7";const V10_NAME="سوبر إيجنت 10.7 — الوكيل الدلالي الشامل";', 'const V10_VERSION="10.7.1";const V10_NAME="سوبر إيجنت 10.7.1 — الوكيل الدلالي الشامل";',1)
s=s.replace('v107_transactional_shopping:true,reliability_lock:true', 'v107_transactional_shopping:true,v1071_reference_grounding_guard:true,reliability_lock:true',1)
s=s.replace('message:"سوبر إيجنت 10.7 جاهز للعمل"', 'message:"سوبر إيجنت 10.7.1 جاهز للعمل"',1)

anchor="async function snapshotShoppingV107(env,chatId){const list=await getDefaultShoppingList(env,chatId,false);return list?{list:{...list},items:(await getShoppingItems(env,chatId,list.id)).map(x=>({...x}))}:{list:null,items:[]}}"
insert=r'''
function shoppingReferenceTokensV107(value){
  return normalizeArabicLoose(String(value||''))
    .replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}
function isShoppingPlaceholderOnlyV107(value){
  const tokens=shoppingReferenceTokensV107(value);if(!tokens.length)return false;
  const stop=new Set(['ال','من','في','فى','على','علي','ده','دا','دي','دى','دول','النوع','نوع','الحاجه','الحاجة','الحاجات','واحد','واحده','واحدة','منه','منها','نفسه','نفسها','نفس','اللي','الى','الذي','التي','قولتلك','قلتلك','عليه','عليها','بتاع','بتاعه','بتاعها','كبير','كبيره','كبيرة','الكبير','الكبيره','الكبيرة','صغير','صغيره','صغيرة','الصغير','الصغيره','الصغيرة','وسط','الوسط','متوسط','متوسطه','متوسطة','المتوسط','المتوسطه','المتوسطة','اخر','آخر','الاخير','الأخير','الاول','الأول','التاني','الثاني','التالته','الثالث']);
  return tokens.every(t=>/^\d+(?:[.,]\d+)?$/.test(t)||stop.has(t));
}
function rawShoppingReferenceOnlyV107(text){
  const n=normalizeArabicLoose(normalizeDigits(String(text||''))).replace(/[؟?!.,،؛;]+/gu,' ').replace(/\s+/g,' ').trim();if(!n)return false;
  if(!/(?:هات|هاتلي|جيب|جيبلي|اجيب|أجيب|اشتري|اشترى|عاوز|عايز|محتاج|حط|ضيف|زود)/u.test(n))return false;
  const tail=n.replace(/^(?:(?:بص|طب|طيب)\s+)?(?:(?:انا\s+)?(?:عاوز|عايز|محتاج)\s+)?(?:هاتلي|هات|جيبلي|جيب|اجيب|أجيب|اشتري|اشترى|حط|ضيف|زود)\s+/u,'').trim();
  if(!tail)return false;
  return isShoppingPlaceholderOnlyV107(tail);
}
async function detectShoppingReferenceAmbiguityV107(env,chatId,text,intent=null){
  const make=(label)=>({type:'shopping_reference',question:`تقصد إيه بـ «${String(label||'المرجع ده').trim()}»؟ قولّي اسم الحاجة أو النوع المقصود عشان ما أخمّنش.`,meta:{reference:String(label||'').slice(0,160)}});
  const list=await getDefaultShoppingList(env,chatId,false);const rows=list?(await getShoppingItems(env,chatId,list.id)).filter(x=>['pending','bought','unavailable','skipped'].includes(String(x.status))):[];
  if(!intent&&rawShoppingReferenceOnlyV107(text)&&rows.length===0)return make(String(text||'').trim());
  if(intent?.action!=='shopping')return null;
  const plan=normalizeShoppingPlanV107(intent.shopping);if(plan.mode!=='mutate')return null;
  for(const op of plan.operations){
    if(op.op==='add'&&isShoppingPlaceholderOnlyV107(op.title))return make(op.title);
    if(op.op!=='add'&&op.op!=='reorder'&&op.target&&isShoppingPlaceholderOnlyV107(op.target)){
      const hits=await resolveShopTargetsV107(env,chatId,op.target);if(hits.length!==1)return make(op.target);
    }
  }
  return null;
}
'''
if anchor not in s: raise SystemExit('anchor not found')
s=s.replace(anchor,insert+'\n'+anchor,1)

needle='''const localNeed=analyzeHardAmbiguity(text);\nif(localNeed){\nawait savePendingDialog(env,chatId,{baseText:text,context:[],question:localNeed.question,questionType:localNeed.type,questionMeta:localNeed.meta||{}});\nconst answer=`❓ ${localNeed.question}`;\nawait sendText(env,chatId,answer,clarificationKeyboard(localNeed.type));\nawait saveConversationMessage(env,chatId,"assistant",answer);\nreturn;\n}\nawait enforceAiRateLimit(env,chatId);'''
repl='''const localNeed=analyzeHardAmbiguity(text);\nif(localNeed){\nawait savePendingDialog(env,chatId,{baseText:text,context:[],question:localNeed.question,questionType:localNeed.type,questionMeta:localNeed.meta||{}});\nconst answer=`❓ ${localNeed.question}`;\nawait sendText(env,chatId,answer,clarificationKeyboard(localNeed.type));\nawait saveConversationMessage(env,chatId,"assistant",answer);\nreturn;\n}\nconst rawShoppingNeed=await detectShoppingReferenceAmbiguityV107(env,chatId,text,null);\nif(rawShoppingNeed){\nawait savePendingDialog(env,chatId,{baseText:text,context:[],question:rawShoppingNeed.question,questionType:rawShoppingNeed.type,questionMeta:rawShoppingNeed.meta||{}});\nconst answer=`❓ ${rawShoppingNeed.question}`;\nawait sendText(env,chatId,answer);\nawait saveConversationMessage(env,chatId,"assistant",answer);\nreturn;\n}\nawait enforceAiRateLimit(env,chatId);'''
if needle not in s: raise SystemExit('process needle not found')
s=s.replace(needle,repl,1)

needle2='''applyPrayerGrounding(intent,text,reality);\n\nif(intent.needs_clarification){'''
repl2='''applyPrayerGrounding(intent,text,reality);\n\nconst semanticShoppingNeed=await detectShoppingReferenceAmbiguityV107(env,chatId,text,intent);\nif(semanticShoppingNeed){\nawait savePendingDialog(env,chatId,{baseText:text,context:[],question:semanticShoppingNeed.question,questionType:semanticShoppingNeed.type,questionMeta:semanticShoppingNeed.meta||{}});\nconst answer=`❓ ${semanticShoppingNeed.question}`;\nawait sendText(env,chatId,answer);\nawait saveConversationMessage(env,chatId,"assistant",answer);\nreturn;\n}\n\nif(intent.needs_clarification){'''
if needle2 not in s: raise SystemExit('post ai needle not found')
s=s.replace(needle2,repl2,1)

needle3='''applyPrayerGrounding(intent,pending.base_text,reality);\n\nif(intent.needs_clarification){'''
repl3='''applyPrayerGrounding(intent,pending.base_text,reality);\n\nconst semanticShoppingNeed=await detectShoppingReferenceAmbiguityV107(env,chatId,pending.base_text,intent);\nif(semanticShoppingNeed){\nawait savePendingDialog(env,chatId,{baseText:pending.base_text,context:newContext,question:semanticShoppingNeed.question,questionType:semanticShoppingNeed.type,questionMeta:semanticShoppingNeed.meta||{}});\nconst answer=`❓ ${semanticShoppingNeed.question}`;\nawait sendText(env,chatId,answer);\nawait saveConversationMessage(env,chatId,"assistant",answer);\nreturn;\n}\n\nif(intent.needs_clarification){'''
if needle3 not in s: raise SystemExit('pending needle not found')
s=s.replace(needle3,repl3,1)

prompt='''34) لو الرسالة تحتمل مشتريات وتذكير، وجود وقت تنبيه صريح هو الفاصل: من غير وقت صريح ومعنى الكلام شراء/احتياجات => shopping؛ مع وقت صريح وطلب تذكير => schedule.\n`.trim();'''
prompt_repl='''34) لو الرسالة تحتمل مشتريات وتذكير، وجود وقت تنبيه صريح هو الفاصل: من غير وقت صريح ومعنى الكلام شراء/احتياجات => shopping؛ مع وقت صريح وطلب تذكير => schedule.\n35) ممنوع اعتبار وصف مرجعي وحده اسم منتج. أمثلة «الكبير»، «الصغيرة»، «النوع ده»، «منه»، «اللي قولتلك عليه» ليست أسماء مشتريات. لو لم يوجد عنصر واحد محدد بوضوح في السياق الحقيقي، needs_clarification=true. مثال: «هاتلي 3 من الكبير» والقائمة/السياق لا يحددان المنتج => اسأل عن اسم الحاجة ولا تنشئ عنصرًا اسمه «الكبير».\n`.trim();'''
if prompt not in s: raise SystemExit('prompt needle not found')
s=s.replace(prompt,prompt_repl,1)

needle4='''  add("shopping split Arabic",eq(splitShoppingItems("لبن و بيض، جبنة"),["لبن","بيض","جبنة"]),JSON.stringify(splitShoppingItems("لبن و بيض، جبنة")));'''
repl4=needle4+'''\n  add("v1071 placeholder الكبير",isShoppingPlaceholderOnlyV107("الكبير")===true);\n  add("v1071 placeholder النوع ده",isShoppingPlaceholderOnlyV107("النوع ده")===true);\n  add("v1071 concrete مية صغيرة",isShoppingPlaceholderOnlyV107("مية صغيرة")===false);\n  add("v1071 raw ambiguous",rawShoppingReferenceOnlyV107("هاتلي 3 من الكبير")===true);'''
if needle4 not in s: raise SystemExit('selftest needle not found')
s=s.replace(needle4,repl4,1)
p.write_text(s)
