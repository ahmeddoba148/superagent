from pathlib import Path
p=Path('SuperAgent_V10_3_4_Atomic_Direct.js')
s=p.read_text()
start=s.find('function extractNaturalShoppingItemsV1034(raw){')
end=s.find('\nasync function restoreShoppingListSnapshotV1034(',start)
if start<0 or end<0: raise SystemExit('natural shopping parser not found')
new=r'''function extractNaturalShoppingItemsV1034(raw){
  const original=String(raw||"").replace(/[؟?!.,،؛;]+/gu," ").replace(/\s+/g," ").trim();
  const t=normalizeArabicLoose(original);
  if(!t)return null;
  // Explicit clock/recurrence = a real reminder, never a shopping shortcut.
  if(/(?:\b(?:الساعه|الساعة|صباح|مساء|الظهر|العصر|بالليل|الليل|كل\s+(?:يوم|اسبوع|أسبوع))\b|\d{1,2}:\d{2}|(?:بعد|قبل)\s+\d+\s*(?:دقيقه|دقيقة|دقايق|ساعه|ساعة))/u.test(t))return null;
  if(/(?:معلومه|معلومة|معلومات|خبر|اخبار|أخبار|سعر|اسعار|أسعار|رابط|لينك|صوره|صورة|كود|نتيجه|نتيجة)/u.test(t))return null;
  const m=original.match(/^(?:(?:النهارده|النهاردة|بكره|بكرة|غدا)\s+)?(?:ممكن\s+)?(?:(?:فكرني|فكرنى|تفكرني|ذكرني|ذكرنى|نبهني|نبهنى|تنبهني|افتكرني|متنسانيش|ماتنسانيش|ما\s+تنسانيش)\s+)?(?:(?:انا\s+)?(?:عاوز|عايز|محتاج|لازم|حابب|نفسي|نفسى)\s+)?(?:اني\s+)?(?:اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+(.+)$/iu);
  if(!m)return null;
  let tail=String(m[1]||"").trim();
  tail=tail.replace(/\s+(?:النهارده|النهاردة|بكره|بكرة|غدا)$/iu,"").replace(/\s+(?:من|في|فى)\s+(?:الهايبر|السوبر\s*ماركت|الماركت|كارفور)$/iu,"").trim();
  if(!tail)return null;
  const items=splitShoppingItems(tail).map(x=>String(x||"").trim()).filter(Boolean).slice(0,30);
  return items.length?items:null;
}

async function tryDirectTimedPurchaseReminderV1034(env,chatId,raw){
  const original=String(raw||"").replace(/[؟?!،؛;]+/gu," ").replace(/\s+/g," ").trim();
  const normalized=normalizeArabicLoose(normalizeDigits(original));
  if(!/^(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|افتكرني|متنسانيش|ماتنسانيش)\b/u.test(normalized))return false;
  if(!/(?:اشتري|اشترى|اجيب|جيب|هات)/u.test(normalized))return false;
  if(!/(?:النهارده|النهاردة|اليوم|بكره|بكرة|غدا|غدًا|غداً|بعد\s+بكره|بعد\s+بكرة)/u.test(normalized))return false;
  const tm=normalized.match(/(?:الساعه|الساعة)\s*(\d{1,2})(?::(\d{1,2}))?\s*(صباح|الصبح|مساء|المساء|العصر|بالليل|الليل)\b/u);
  if(!tm)return false;
  let hour=Number(tm[1]),minute=Number(tm[2]||0);if(hour<1||hour>12||minute<0||minute>59)return false;
  const period=tm[3];const pm=/(?:مساء|المساء|العصر|بالليل|الليل)/u.test(period);if(pm&&hour<12)hour+=12;if(!pm&&hour===12)hour=0;
  const hhmm=`${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
  const date=resolveDeterministicReminderDate(original,hhmm,TIME_ZONE);if(!date)return false;
  const taskMatch=original.match(/(?:اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+(.+)$/iu);if(!taskMatch)return false;
  const taskTail=String(taskMatch[1]||"").trim();if(!taskTail)return false;
  const verbMatch=original.match(/(اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+(.+)$/iu);
  const title=verbMatch?`${verbMatch[1]} ${String(verbMatch[2]||"").trim()}`:`أجيب ${taskTail}`;
  const intent={action:"create",needs_clarification:false,question:"",reply:"",needs_live_data:false,items:[{title,kind:"reminder",date,time:hhmm,timezone:TIME_ZONE,duration_minutes:0,advance_alerts:[]}],recurring_items:[],dependencies:[],world_updates:[],_base_text:original};
  await executeIntent(env,chatId,intent);
  return true;
}
'''
s=s[:start]+new+s[end:]
anchor='''  if(await tryDirectRecurringDeleteV1034(env,chatId,raw))return true;\n  if(await tryDirectShoppingDeleteV1034(env,chatId,raw))return true;'''
replacement='''  if(await tryDirectRecurringDeleteV1034(env,chatId,raw))return true;\n  if(await tryDirectTimedPurchaseReminderV1034(env,chatId,raw))return true;\n  if(await tryDirectShoppingDeleteV1034(env,chatId,raw))return true;'''
if anchor not in s: raise SystemExit('direct routing anchor not found')
s=s.replace(anchor,replacement,1)
p.write_text(s)
print('natural shopping/timed purchase hotfix applied',len(p.read_bytes()))
