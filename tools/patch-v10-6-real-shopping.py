from pathlib import Path
import re

TARGET=Path('SuperAgent_V10_6_Zero_Known_Failures.js')
s=TARGET.read_text(encoding='utf-8')

new_extract=r'''function extractNaturalShoppingItemsV1034(raw){
  const original=String(raw||"").trim().replace(/^(?:بص(?:\s+يا\s+معلم)?|طيب|طب)\s+/u,'').trim();if(!original)return null;
  const t=normalizeArabicLoose(normalizeDigits(original));
  if(/(?:^|\s)(?:الساعه|الساعة|صباح|مساء|الظهر|العصر|بالليل|الليل)(?:\s|$)|\d{1,2}:\d{2}|(?:بعد|قبل)\s+\d+\s*(?:دقيقه|دقيقة|دقايق|ساعه|ساعة)|(?:^|\s)كل\s+(?:يوم|اسبوع|أسبوع)(?:\s|$)/u.test(t))return null;
  if(/(?:معلومه|معلومة|معلومات|خبر|اخبار|أخبار|سعر|اسعار|أسعار|رابط|لينك|صوره|صورة|كود|نتيجه|نتيجة)/u.test(t))return null;
  let marked=original.replace(/[\r\n]+/g,' ␞ ');
  marked=marked.replace(/\s+و(?=(?:جيبلي|جيب|هاتلي|هات|فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|متنسانيش|ماتنسانيش)\s+)/giu,' ␞ ');
  marked=marked.replace(/\s+و?(?=(?:(?:فكرني|فكرنى|تفكرني|ذكرني|ذكرنى|نبهني|نبهنى|تنبهني|افتكرني|متنسانيش|ماتنسانيش)\s+|(?:انا\s+)?(?:عاوز|عايز|محتاج|لازم|حابب|نفسي|نفسى)\s+)(?:(?:اني\s+)?(?:اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+|(?:عاوز|عايز|محتاج)\s+))/giu,' ␞ ');
  const parts=marked.split('␞').map(x=>x.trim()).filter(Boolean);
  const all=[];let allowBareContinuation=false;
  for(let i=0;i<parts.length;i++){
    let part=String(parts[i]||'').trim().replace(/^(?:بص(?:\s+يا\s+معلم)?|طيب|طب)\s+/u,'').trim();
    const items=parseSingleNaturalShoppingClauseV104(part);
    if(items?.length){all.push(...items);allowBareContinuation=true;continue;}
    const header=normalizeArabicLoose(normalizeDigits(part));
    if(i===0&&/^(?:(?:انا\s+)?(?:عاوز|عايز|محتاج|حابب|نفسي|نفسى)\s+)?(?:اشتري|اشترى|اشتريلنا|اشتريلي|اجيب|جيب|هات)(?:\s+(?:الحاجات|الحاجات دي|شويه حاجات|شوية حاجات))?$/u.test(header)){allowBareContinuation=true;continue;}
    if(!allowBareContinuation)return null;
    const n=normalizeArabicLoose(normalizeDigits(part));
    if(!part||/(?:^|\s)(?:فكرني|ذكرني|نبهني|متنسانيش|موعد|ميعاد|تذكير|الساعة|الساعه|بكره|بكرة|النهارده|النهاردة|بعد|قبل)(?:\s|$)|\d{1,2}:\d{2}/u.test(n))return null;
    part=part.replace(/^(?:[-•*]|\d+[.)-]?)\s*/u,'').trim();if(!part)return null;
    all.push(...splitShoppingItems(part));
  }
  return [...new Map(all.map(x=>[normalizeArabicLoose(x),x])).values()].slice(0,30);
}'''
pat=r'function extractNaturalShoppingItemsV1034\(raw\)\{.*?\n\}\n\nasync function tryDirectTimedPurchaseReminderV1034'
s2,n=re.subn(pat,lambda _m:new_extract+'\n\nasync function tryDirectTimedPurchaseReminderV1034',s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'extractNaturalShoppingItemsV1034 patch count={n}')
s=s2

helper=r'''
async function recentShoppingItemsFromConversationV106(env,chatId){
  const rows=(await env.DB.prepare(`SELECT content FROM conversation_messages WHERE chat_id=? AND role='user' ORDER BY id DESC LIMIT 8`).bind(chatId).all())?.results||[];
  for(const row of rows){const items=extractNaturalShoppingItemsV1034(String(row?.content||''));if(items?.length)return items;}
  return null;
}
'''
anchor='async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){'
if helper.strip() not in s:
    if anchor not in s: raise SystemExit('handle anchor missing')
    s=s.replace(anchor,helper+'\n'+anchor,1)

old=r'''  if(await tryDirectShoppingDeleteV1034(env,chatId,raw))return true;
  const naturalShopping=extractNaturalShoppingItemsV1034(raw);
  if(naturalShopping){const r=await addShoppingItems(env,chatId,naturalShopping);await sendText(env,chatId,shoppingResultMessageV1034(r));return true;}
'''
new=r'''  if(await tryDirectShoppingDeleteV1034(env,chatId,raw))return true;
  if(/^(?:لا\s+)?(?:ضيفهم|ضفهم|حطهم|سجلهم|زودهم)\s+(?:في|فى|ل)?\s*(?:قائمة|قائمه|قايمة|قايمه)?\s*المشتريات$/u.test(t)){
    const items=await recentShoppingItemsFromConversationV106(env,chatId);
    if(items?.length){const r=await addShoppingItems(env,chatId,items);const msg=shoppingResultMessageV1034(r);await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,'user',raw);await saveConversationMessage(env,chatId,'assistant',msg);return true;}
    const msg='مش لاقي قائمة أصناف واضحة في رسائلك الأخيرة. ابعتها تاني وأنا هضيفها للمشتريات فقط.';await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,'user',raw);await saveConversationMessage(env,chatId,'assistant',msg);return true;
  }
  const naturalShopping=extractNaturalShoppingItemsV1034(raw);
  if(naturalShopping){const r=await addShoppingItems(env,chatId,naturalShopping);const msg=shoppingResultMessageV1034(r);await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,'user',raw);await saveConversationMessage(env,chatId,'assistant',msg);return true;}
'''
if old not in s: raise SystemExit('naturalShopping handler anchor missing')
s=s.replace(old,new,1)

old2=r'''  if(/^(?:افتح\s+)?(?:قائمة|قائمه)\s+المشتريات$/u.test(t)){await showShoppingList(env,chatId,null,{startSession:false});return true;}

  m=raw.match(/^(?:حط|سجل|ضيف)'''
new2=r'''  if(/^(?:افتح\s+)?(?:قائمة|قائمه)\s+المشتريات$/u.test(t)){await showShoppingList(env,chatId,null,{startSession:false});return true;}
  if(/^(?:لا\s+)?مش\s+عاوز\s+(?:اي\s+)?تذكير(?:ات)?(?:\s+دول\s+مشتريات)?$/u.test(t)){
    const items=await recentShoppingItemsFromConversationV106(env,chatId);
    if(items?.length){const r=await addShoppingItems(env,chatId,items);const msg=`✅ تمام، اعتبرتهم مشتريات فقط. ${shoppingResultMessageV1034(r)}`;await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,'user',raw);await saveConversationMessage(env,chatId,'assistant',msg);return true;}
    const msg='تمام، مش هاعتبر الطلب ده تذكير. ابعت الأصناف أو قول «ضفهم لقائمة المشتريات».';await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,'user',raw);await saveConversationMessage(env,chatId,'assistant',msg);return true;
  }

  m=raw.match(/^(?:حط|سجل|ضيف)'''
if old2 not in s: raise SystemExit('shopping open anchor missing')
s=s.replace(old2,new2,1)

TARGET.write_text(s,encoding='utf-8')
print(f'PATCHED {TARGET} bytes={len(s.encode("utf-8"))}')
