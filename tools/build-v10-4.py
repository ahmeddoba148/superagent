from pathlib import Path

src=Path('SuperAgent_V10_3_4_Atomic_Direct.js')
out=Path('SuperAgent_V10_4_Zero_Known_Bugs.js')
s=src.read_text()

s=s.replace('const V10_VERSION="10.3.4";const V10_NAME="Super Agent V10 — Life OS · Reliability Lock · Atomic Direct";',
            'const V10_VERSION="10.4";const V10_NAME="Super Agent V10.4 — Life OS · Zero Known Bugs";',1)
s=s.replace('shopping_delete_undo:true,reliability_lock:true',
            'shopping_delete_undo:true,relative_reschedule_direct:true,multi_natural_shopping:true,no_op_update_guard:true,reliability_lock:true',1)
s=s.replace('message:"Super Agent V10.3.4 Atomic Direct is ready"',
            'message:"Super Agent V10.4 Zero Known Bugs is ready"',1)

# Replace natural shopping parser with a multi-clause version that preserves original wording.
start=s.find('function extractNaturalShoppingItemsV1034(raw){')
end=s.find('\nasync function tryDirectTimedPurchaseReminderV1034(',start)
if start<0 or end<0: raise SystemExit('natural shopping parser block not found')
new_parser=r'''function parseSingleNaturalShoppingClauseV104(raw){
  const original=String(raw||"").replace(/[؟?!.,،؛;]+/gu," ").replace(/\s+/g," ").trim();
  if(!original)return null;
  const t=normalizeArabicLoose(original);
  const m=original.match(/^(?:(?:النهارده|النهاردة|بكره|بكرة|غدا)\s+)?(?:ممكن\s+)?(?:(?:فكرني|فكرنى|تفكرني|ذكرني|ذكرنى|نبهني|نبهنى|تنبهني|افتكرني|متنسانيش|ماتنسانيش|ما\s+تنسانيش)\s+)?(?:(?:انا\s+)?(?:عاوز|عايز|محتاج|لازم|حابب|نفسي|نفسى)\s+)?(?:اني\s+)?(?:اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+(.+)$/iu);
  if(!m)return null;
  let tail=String(m[1]||"").trim();
  tail=tail.replace(/\s+(?:النهارده|النهاردة|بكره|بكرة|غدا)$/iu,"").replace(/\s+(?:من|في|فى)\s+(?:الهايبر|السوبر\s*ماركت|الماركت|كارفور)$/iu,"").trim();
  if(!tail)return null;
  return splitShoppingItems(tail).map(x=>String(x||"").trim()).filter(Boolean).slice(0,30);
}

function extractNaturalShoppingItemsV1034(raw){
  const original=String(raw||"").trim();if(!original)return null;
  const t=normalizeArabicLoose(normalizeDigits(original));
  // Explicit time/recurrence means reminder semantics, never shopping-shortcut semantics.
  if(/(?:^|\s)(?:الساعه|الساعة|صباح|مساء|الظهر|العصر|بالليل|الليل)(?:\s|$)|\d{1,2}:\d{2}|(?:بعد|قبل)\s+\d+\s*(?:دقيقه|دقيقة|دقايق|ساعه|ساعة)|(?:^|\s)كل\s+(?:يوم|اسبوع|أسبوع)(?:\s|$)/u.test(t))return null;
  if(/(?:معلومه|معلومة|معلومات|خبر|اخبار|أخبار|سعر|اسعار|أسعار|رابط|لينك|صوره|صورة|كود|نتيجه|نتيجة)/u.test(t))return null;
  // Preserve separate natural commands even when pasted in one Telegram message.
  let marked=original.replace(/[\r\n]+/g,' ␞ ');
  marked=marked.replace(/\s+(?=(?:(?:فكرني|فكرنى|تفكرني|ذكرني|ذكرنى|نبهني|نبهنى|تنبهني|افتكرني|متنسانيش|ماتنسانيش)\s+|(?:انا\s+)?(?:عاوز|عايز|محتاج|لازم|حابب|نفسي|نفسى)\s+)(?:(?:اني\s+)?(?:اشتريلي|اشتريلنا|اشتري|اشترى|أشتري|أشترى|اجيب|أجيب|جيبلي|جيب|هاتلي|هات)\s+|(?:عاوز|عايز|محتاج)\s+))/giu,' ␞ ');
  const parts=marked.split('␞').map(x=>x.trim()).filter(Boolean);
  const all=[];
  for(const part of parts){const items=parseSingleNaturalShoppingClauseV104(part);if(!items?.length)return null;all.push(...items);}
  return [...new Map(all.map(x=>[normalizeArabicLoose(x),x])).values()].slice(0,30);
}
'''
s=s[:start]+new_parser+s[end:]

# Add deterministic relative reschedule before AI.
anchor='async function handleV10DirectCommands(env,chatId,text,{fromVoice=false}={}){'
pos=s.find(anchor)
if pos<0: raise SystemExit('direct commands anchor missing')
helper=r'''function parseShiftMinutesV104(raw){
  const n=normalizeArabicLoose(normalizeDigits(String(raw||""))).replace(/\s+/g," ").trim();
  let total=0,matched=false;
  if(/ساعتين/u.test(n)){total+=120;matched=true;}
  else if(/(?:ساعه|ساعة)\s+ونص/u.test(n)){total+=90;matched=true;}
  else if(/(?:ساعه|ساعة)\s+وربع/u.test(n)){total+=75;matched=true;}
  else {
    const h=n.match(/(\d+)\s*(?:ساعه|ساعة|ساعات)/u);if(h){total+=Number(h[1])*60;matched=true;}
    else if(/(?:^|\s)(?:ساعه|ساعة)(?:\s|$|\s+و)/u.test(n)){total+=60;matched=true;}
  }
  const m=n.match(/(\d+)\s*(?:دقيقه|دقيقة|دقايق|دقائق)/u);if(m){total+=Number(m[1]);matched=true;}
  if(!matched&&/(?:نص\s+(?:ساعه|ساعة))/u.test(n)){total=30;matched=true;}
  if(!matched&&/(?:ربع\s+(?:ساعه|ساعة))/u.test(n)){total=15;matched=true;}
  return matched&&total>0&&total<=10080?total:0;
}

async function tryDirectRelativeRescheduleV104(env,chatId,raw){
  const original=String(raw||"").trim();const n=normalizeArabicLoose(normalizeDigits(original)).replace(/\s+/g," ").trim();
  const a=n.match(/^(اجل|أجل|اخر|أخر|أخر|أجّل|قدم|قدّم)\s+(.+)$/u);if(!a)return false;
  const minutes=parseShiftMinutesV104(n);if(!minutes)return false;
  const dm=n.match(/((?:ساعتين|(?:\d+\s*)?(?:ساعه|ساعة|ساعات)(?:\s+و(?:نص|ربع|\s*\d+\s*(?:دقيقه|دقيقة|دقايق|دقائق)))?|(?:نص|ربع)\s*(?:ساعه|ساعة)|\d+\s*(?:دقيقه|دقيقة|دقايق|دقائق)))\s*$/u);
  if(!dm)return false;
  let target=n.slice(a[1].length,dm.index).trim().replace(/^(?:موعد|ميعاد|اجتماع|مكالمة|مكالمه|دكتور|كشف)\s+/u,"").trim();if(!target)return false;
  const rows=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 ORDER BY local_date,local_time,id LIMIT 200`).bind(chatId).all())?.results||[];
  const scored=rows.map(r=>{const title=normalizeArabicLoose(r.title||"");const stripped=title.replace(/^(?:موعد|ميعاد|اجتماع|مكالمة|مكالمه|دكتور|كشف)\s+/u,"");let score=0;if(stripped===target||title===target)score=4;else if(stripped.includes(target)||target.includes(stripped))score=3;else{const toks=target.split(/\s+/).filter(x=>x.length>1);if(toks.length&&toks.every(x=>title.includes(x)))score=2;}return{r,score};}).filter(x=>x.score>0).sort((x,y)=>y.score-x.score);
  if(!scored.length){await sendText(env,chatId,`ملقتش موعد حالي مطابق لـ «${target}».`);return true;}
  const best=scored.filter(x=>x.score===scored[0].score);if(best.length>1){await sendText(env,chatId,`لقيت أكتر من موعد مطابق لـ «${target}». اكتب الاسم بشكل أوضح.`);return true;}
  const row=best[0].r,tz=String(row.timezone||TIME_ZONE);const sign=/^(?:قدم|قدّم)/u.test(n)?-1:1;
  const shifted=addMinutesLocal(`${row.local_date} ${row.local_time}`,sign*minutes,tz);const [date,time]=splitLocalDateTime(shifted);
  await updateScheduleItem(env,chatId,{action:"update",target_id:Number(row.id),target_type:"one_time",one_time_update:{date,time},_timezone:tz,_base_text:original,_deterministic_relative_minutes:sign*minutes});
  return true;
}

'''
s=s[:pos]+helper+s[pos:]

route='''  if(!t)return false;\n  if(await tryDirectRecurringDeleteV1034(env,chatId,raw))return true;'''
route2='''  if(!t)return false;\n  if(await tryDirectRelativeRescheduleV104(env,chatId,raw))return true;\n  if(await tryDirectRecurringDeleteV1034(env,chatId,raw))return true;'''
if route not in s: raise SystemExit('direct route anchor missing')
s=s.replace(route,route2,1)

# Guard against false "updated" responses when an AI update resolves to exactly the current values.
needle='''if(!next.title||isPastLocal(next.date,next.time,String(current.timezone||intent._timezone||TIME_ZONE))){\nthrow new Error("التعديل غير صالح أو هيخلي الموعد في الماضي.");\n}\n\nif(!options.skipConflictCheck){'''
replacement='''if(!next.title||isPastLocal(next.date,next.time,String(current.timezone||intent._timezone||TIME_ZONE))){\nthrow new Error("التعديل غير صالح أو هيخلي الموعد في الماضي.");\n}\nconst currentAlerts=sanitizeAdvanceAlerts(parseJsonArray(current.advance_alerts_json));\nconst sameUpdate=next.title===current.title&&next.kind===current.kind&&next.date===current.local_date&&next.time===current.local_time&&Number(next.duration_minutes||0)===Number(current.duration_minutes||0)&&JSON.stringify(next.advance_alerts)===JSON.stringify(currentAlerts);\nif(sameUpdate){const msg=`ℹ️ الموعد بالفعل بنفس البيانات، مفيش تغيير اتعمل:\n${formatEventWhen(current.local_date,current.local_time,Number(current.duration_minutes||0),String(current.timezone||TIME_ZONE))} — ${current.title}`;await sendText(env,chatId,msg);await saveConversationMessage(env,chatId,"assistant",msg);return;}\n\nif(!options.skipConflictCheck){'''
if needle not in s: raise SystemExit('no-op guard anchor missing')
s=s.replace(needle,replacement,1)

out.write_text(s)
print('built',out,len(out.read_bytes()))
