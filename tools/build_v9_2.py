from pathlib import Path
src=Path('SuperAgent_V9.1_Final_Fix.js')
out=Path('SuperAgent_V9.2_Final_Stability.js')
s=src.read_text(encoding='utf-8')
def rep(old,new,count=1):
    global s
    if old not in s: raise SystemExit('PATCH_ANCHOR_NOT_FOUND: '+old[:100])
    s=s.replace(old,new,count)
rep('version:"9.1"','version:"9.2"')
rep('version:"9.1",now:cairoNow()','version:"9.2",now:cairoNow()')
rep('message:"Super Agent V9.1 Final Fix is ready"','message:"Super Agent V9.2 Semantic Prayer Stability is ready"')
rep('prayer_awareness:true,hijri_calendar:true','prayer_awareness:true,multi_prayer_anchors:true,reference_clock_safety:true,semantic_role_safety:true,hijri_calendar:true')
rep('prayer_awareness:true,long_term_memory:true','prayer_awareness:true,multi_prayer_anchors:true,reference_clock_safety:true,long_term_memory:true')
rep('''const pr=\nparseRecurringPrayerAnchor(\nraw\n);\n\nif(pr){''','''const prayerBatch=parseRecurringPrayerAnchors(raw);\nif(prayerBatch.length>1){\nconst profile=await getUserProfile(env,chatId);\nconst now=zonedNow(profile.timezone);\nconst ts=new Date().toISOString();\nconst statements=prayerBatch.map(pr=>env.DB.prepare(`\nINSERT INTO prayer_rules(chat_id,title,prayer,offset_minutes,start_date,end_date,weekdays_json,max_occurrences,fired_count,active,paused_until,exceptions_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?,0,1,NULL,'[]',?,?)\n`).bind(chatId,pr.title,pr.prayer,pr.offset,now.date,JSON.stringify(pr.weekdays),pr.max_occurrences,ts,ts));\nawait env.DB.batch(statements);\nconst lines=prayerBatch.map(pr=>`🕌 ${formatPrayerRule({...pr,start_date:now.date,active:1})}${pr.max_occurrences?` · ${pr.max_occurrences} مرات`:""} — ${pr.title}`);\nawait sendText(env,chatId,`✅ تم حفظ ${prayerBatch.length} تذكيرات مرتبطة بمواقيت الصلاة اليومية:\n\n${lines.join("\\n")}`,quickMenuKeyboard());\nreturn true;\n}\n\nconst pr=prayerBatch[0]||parseRecurringPrayerAnchor(raw);\n\nif(pr){''')
needle='''applyDeterministicRelationships(\nintent,\nbase,\ncontext?.timezone||intent._timezone||TIME_ZONE\n);'''
rep(needle,needle+'\n\napplyReferenceClockSafety(intent,base);')
rep('''const ambiguous=\nfindAmbiguous12HourTimesDetailed(\ntext\n);''','''const ambiguous=\nfindAmbiguous12HourTimesDetailed(\ntext\n).filter(x=>!isReferenceOnlyClock(text,x));''')
rep('''const clocks=\nt.match(\n/(?:الساعة|الساعه)\\s*(?:\\d{1,2}(?::\\d{1,2})?)(?:\\s*(?:ونص|و\\s*نص|وربع|و\\s*ربع|إلا\\s*ربع|الا\\s*ربع))?/giu\n)||[];''','''const clocks=\nfindAllClockMentionsDetailed(t).filter(x=>!isReferenceOnlyClock(t,x));''')
helpers=r'''
function findAllClockMentionsDetailed(text){
const t=normalizeTimeWords(normalizeDigits(String(text||"")));
const re=/(?:الساعة|الساعه)\s*(1[0-2]|[1-9])(?:\s*[:٫.]\s*([0-5]?\d)|\s*(ونص|و\s*نص|وربع|و\s*ربع|إلا\s*ربع|الا\s*ربع))?(?:\s*(صباح(?:ًا|ا)?|الصبح|صبح|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|مساء(?:ً|ا)?|المساء|بالليل|ليل|الفجر|am|pm))?/giu;
const out=[];let m;
while((m=re.exec(t))!==null)out.push({index:m.index,end:re.lastIndex,hour:Number(m[1]),minute:m[2]?Number(m[2]):/نص/u.test(m[3]||"")?30:/ربع/u.test(m[3]||"")?15:0,period:String(m[4]||""),label:m[0]});
return out;
}
function isReferenceOnlyClock(text,clock){
const t=normalizeArabicLoose(normalizeDigits(String(text||""))),start=Math.max(0,Number(clock?.index||0)),before=t.slice(0,start),near=t.slice(Math.max(0,start-100),start),after=t.slice(Number(clock?.end||start),Math.min(t.length,Number(clock?.end||start)+90));
const causal=/(?:عشان|علشان|لان|لأن|بحيث|علي شان|على شان)[^.!؟\n]{0,95}$/u.test(near);
const purpose=/(?:عشان|علشان|لان|لأن|بحيث)[^.!؟\n]{0,130}(?:ييجي|تيجي|تجي|ياخد|تاخد|اخد|تدي|يدي|نعمل|اعمل|يعمل|تعمل|يكون|تبقي|تبقى)/u.test(`${near} ${after}`);
const priorAction=/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|عندي|عندى|موعد|ميعاد|معاد)/u.test(before);
return !!(priorAction&&(causal||purpose));
}
function resolveFirstActionClock(text){
const t=normalizeTimeWords(normalizeDigits(String(text||""))),all=findAllClockMentionsDetailed(t);
for(const c of all){if(isReferenceOnlyClock(t,c))continue;const around=t.slice(Math.max(0,c.index-35),Math.min(t.length,c.end+50));if(/(?:فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|عندي|عندى|موعد|ميعاد|معاد)/iu.test(around))return c;}
return all.find(c=>!isReferenceOnlyClock(t,c))||null;
}
function clockTo24(c){
if(!c)return null;let h=Number(c.hour),m=Number(c.minute||0);const p=normalizeArabicLoose(c.period||"");if(/(?:مساء|المساء|ظهر|الظهر|الضهر|عصر|العصر|مغرب|المغرب|بالليل|ليل|pm)/u.test(p)){if(h<12)h+=12;}else if(/(?:صباح|الصبح|صبح|الفجر|am)/u.test(p)){if(h===12)h=0;}else return null;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function applyReferenceClockSafety(intent,base){
if(intent?.action!=="create"||!Array.isArray(intent.items)||intent.items.length<2)return;
const refs=findAllClockMentionsDetailed(base).filter(c=>isReferenceOnlyClock(base,c));if(!refs.length)return;
const primaryTime=clockTo24(resolveFirstActionClock(base));let keep=primaryTime?intent.items.find(x=>String(x.time)===primaryTime):null;if(!keep)keep=intent.items[0];intent.items=[keep];
}
'''
rep('function extractNamedWeekdays(text){',helpers+'\nfunction extractNamedWeekdays(text){')
helpers2=r'''
function parseRecurringPrayerAnchors(text){
const raw=String(text||""),n=normalizeArabicLoose(normalizeDigits(raw));
const daily=/(?:كل\s+يوم|يوميا|يومياً|يوميًا|التذكيرات\s+اليوميه|التذكيرات\s+اليومية|يوميه|يومية)/u.test(n),named=extractNamedWeekdays(n);if(!daily&&!named.length)return[];
let globalDur=null;const gd=n.match(/(?:قبل|بعد)\s+(?:اذان|الاذان|صلاه|صلاة)?\s*(?:الفجر|الشروق|الظهر|الضهر|العصر|المغرب|العشاء|العشا)\s+(?:ب|بـ)?\s*([^،,.؛;\n]{1,28})/u);if(gd)globalDur=parseDurationValuePhrase(gd[1]);
const clauseRe=/(قبل|بعد)\s+(?:اذان|الاذان|أذان|الأذان|صلاه|صلاة)?\s*(الفجر|الشروق|الظهر|الضهر|العصر|المغرب|العشاء|العشا)([^،,.؛;\n]*?)(?=(?:\s+و?قبل|\s+و?بعد|[،,.؛;\n]|$))/giu;
const out=[];let m;
while((m=clauseRe.exec(raw))!==null){const anchor=prayerNameFromArabic(m[2]);if(!anchor)continue;const tail=String(m[3]||"");let d=null;const dm=tail.match(/(?:ب|بـ)\s*((?:ربع|نص|نصف|تلت|ثلث|ساعه|ساعة|ساعتين|\d+|[\p{L}]+)(?:\s+(?:ساعه|ساعة|دقيقه|دقيقة|دقايق|دقائق))?)/u);if(dm)d=parseDurationValuePhrase(dm[1]);if(d==null)d=globalDur||0;const dir=m[1]==="قبل"?-1:1;
let target=null;const tm=tail.match(/(?:اصلي|أصلي|صلي|صلّي|بال|بصلاه|بصلاة|صلاه|صلاة|نبهني\s+ب|فكرني\s+ب|ذكرني\s+ب)\s*(الفجر|الظهر|الضهر|العصر|المغرب|العشاء|العشا)/iu);if(tm)target=prayerNameFromArabic(tm[1]);
if(!target){const after=raw.slice(clauseRe.lastIndex,Math.min(raw.length,clauseRe.lastIndex+65)),tm2=after.match(/(?:نبهني|نبهنى|فكرني|فكرنى|ذكرني|ذكرنى)?\s*(?:ب|بصلاه|بصلاة)?\s*(الفجر|الظهر|الضهر|العصر|المغرب|العشاء|العشا)/iu);if(tm2)target=prayerNameFromArabic(tm2[1]);}
if(!target)continue;const title=`صلي ${arabicPrayerName(target)}`,key=`${anchor}|${dir*d}|${title}`;if(out.some(x=>x._key===key))continue;out.push({_key:key,title,prayer:anchor,offset:dir*d,weekdays:daily?[]:named,max_occurrences:parseExplicitOccurrenceCount(raw)});
}
return out.map(({_key,...x})=>x);
}
'''
rep('function parseRecurringPrayerAnchor(text){',helpers2+'\nfunction parseRecurringPrayerAnchor(text){')
old='9) الصلاة: استخدم أوقات الصلاة الحية في الواقع المرسل. «قبل أذان العشاء بربع ساعة» = Isha-15. لا تسأل عن وقت وجبة العشاء.'
rep(old,old+'\n9.1) لو المستخدم طلب عدة تذكيرات صلاة في جملة واحدة، استخرج كل Anchor مستقل ولا تسقط أي واحد.\n9.2) فرّق بين وقت تنفيذ التذكير ووقت مذكور كسبب أو مرجع: «الساعة 5 مساء فكرني أكلم الممرضة عشان تيجي الساعة 6» = تذكير واحد الساعة 17:00؛ الساعة 6 معلومة داخل معنى التذكير وليست موعدًا مستقلًا إلا لو طلب المستخدم حفظها صراحة.')
out.write_text(s,encoding='utf-8')
print(out.stat().st_size)
