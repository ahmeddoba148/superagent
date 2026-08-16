from pathlib import Path

src=Path('SuperAgent_V10_4_Zero_Known_Bugs.js')
out=Path('SuperAgent_V10_4_1_Ultra_Hardened.js')
s=src.read_text()
s=s.replace('const V10_VERSION="10.4";const V10_NAME="Super Agent V10.4 — Life OS · Zero Known Bugs";', 'const V10_VERSION="10.4.1";const V10_NAME="Super Agent V10.4.1 — Life OS · Ultra Hardened";',1)
s=s.replace('no_op_update_guard:true,reliability_lock:true','no_op_update_guard:true,ultra_stress_hardened:true,generic_shift_duration_parser:true,timed_purchase_parser_v2:true,reliability_lock:true',1)
s=s.replace('message:"Super Agent V10.4 Zero Known Bugs is ready"','message:"Super Agent V10.4.1 Ultra Hardened is ready"',1)

# Generic end-anchored shift parser. Numeric codes in titles can never become durations.
start=s.find('function parseShiftMinutesV104(raw){')
end=s.find('\nasync function handleV10DirectCommands(',start)
if start<0 or end<0: raise SystemExit('relative parser block missing')
new=r'''function parseShiftTailV1041(raw){
  const n=normalizeArabicLoose(normalizeDigits(String(raw||""))).replace(/\s+/g," ").trim();
  const unitH='(?:ساعه|ساعة|ساعات)';
  const unitM='(?:دقيقه|دقيقة|دقايق|دقائق)';
  const candidates=[
    {re:new RegExp(`ساعتين\\s+و?\\s*نص$`,'u'),minutes:150},
    {re:new RegExp(`ساعتين\\s+و?\\s*ربع$`,'u'),minutes:135},
    {re:new RegExp(`ساعتين\\s+و?\\s*(\\d+)\\s*${unitM}$`,'u'),calc:m=>120+Number(m[1])},
    {re:new RegExp(`ساعتين$`,'u'),minutes:120},
    {re:new RegExp(`${unitH}\\s+و?\\s*نص$`,'u'),minutes:90},
    {re:new RegExp(`${unitH}\\s+و?\\s*ربع$`,'u'),minutes:75},
    {re:new RegExp(`${unitH}\\s+و?\\s*(\\d+)\\s*${unitM}$`,'u'),calc:m=>60+Number(m[1])},
    {re:new RegExp(`(\\d+)\\s*${unitH}\\s+و?\\s*(\\d+)\\s*${unitM}$`,'u'),calc:m=>Number(m[1])*60+Number(m[2])},
    {re:new RegExp(`(\\d+)\\s*${unitH}\\s+و?\\s*نص$`,'u'),calc:m=>Number(m[1])*60+30},
    {re:new RegExp(`(\\d+)\\s*${unitH}\\s+و?\\s*ربع$`,'u'),calc:m=>Number(m[1])*60+15},
    {re:new RegExp(`(\\d+)\\s*${unitH}$`,'u'),calc:m=>Number(m[1])*60},
    {re:new RegExp(`نص\\s*${unitH}$`,'u'),minutes:30},
    {re:new RegExp(`ربع\\s*${unitH}$`,'u'),minutes:15},
    {re:new RegExp(`(\\d+)\\s*${unitM}$`,'u'),calc:m=>Number(m[1])},
    {re:new RegExp(`${unitH}$`,'u'),minutes:60},
  ];
  for(const c of candidates){
    const m=n.match(c.re);if(!m)continue;
    const minutes=c.calc?c.calc(m):c.minutes;
    if(Number.isFinite(minutes)&&minutes>0&&minutes<=10080)return{minutes,start:m.index,text:m[0],normalized:n};
  }
  return null;
}
function parseShiftMinutesV104(raw){return parseShiftTailV1041(raw)?.minutes||0;}

async function tryDirectRelativeRescheduleV104(env,chatId,raw){
  const original=String(raw||"").trim();const n=normalizeArabicLoose(normalizeDigits(original)).replace(/\s+/g," ").trim();
  const a=n.match(/^(اجل|أجل|اخر|أخر|أجّل|قدم|قدّم)\s+(.+)$/u);if(!a)return false;
  const tail=parseShiftTailV1041(n);if(!tail)return false;
  let target=n.slice(a[1].length,tail.start).trim().replace(/^(?:موعد|ميعاد|اجتماع|مكالمة|مكالمه|دكتور|كشف)\s+/u,"").trim();if(!target)return false;
  const rows=(await env.DB.prepare(`SELECT * FROM reminders WHERE chat_id=? AND cancelled=0 AND sent=0 ORDER BY local_date,local_time,id LIMIT 200`).bind(chatId).all())?.results||[];
  const scored=rows.map(r=>{const title=normalizeArabicLoose(r.title||"");const stripped=title.replace(/^(?:موعد|ميعاد|اجتماع|مكالمة|مكالمه|دكتور|كشف)\s+/u,"");let score=0;if(stripped===target||title===target)score=4;else if(stripped.includes(target)||target.includes(stripped))score=3;else{const toks=target.split(/\s+/).filter(x=>x.length>1);if(toks.length&&toks.every(x=>title.includes(x)))score=2;}return{r,score};}).filter(x=>x.score>0).sort((x,y)=>y.score-x.score);
  if(!scored.length){await sendText(env,chatId,`ملقتش موعد حالي مطابق لـ «${target}».`);return true;}
  const best=scored.filter(x=>x.score===scored[0].score);if(best.length>1){await sendText(env,chatId,`لقيت أكتر من موعد مطابق لـ «${target}». اكتب الاسم بشكل أوضح.`);return true;}
  const row=best[0].r,tz=String(row.timezone||TIME_ZONE);const sign=/^(?:قدم|قدّم)/u.test(n)?-1:1;
  const shifted=addMinutesLocal(`${row.local_date} ${row.local_time}`,sign*tail.minutes,tz);const [date,time]=splitLocalDateTime(shifted);
  await updateScheduleItem(env,chatId,{action:"update",target_id:Number(row.id),target_type:"one_time",one_time_update:{date,time},_timezone:tz,_base_text:original,_deterministic_relative_minutes:sign*tail.minutes});
  return true;
}
'''
s=s[:start]+new+s[end:]

# Timed purchase parser v2: tolerate Arabic/Western digits, hh or hh:mm, common AM/PM wording.
tstart=s.find('async function tryDirectTimedPurchaseReminderV1034(env,chatId,raw){')
tend=s.find('\nasync function restoreShoppingListSnapshotV1034(',tstart)
if tstart<0 or tend<0: raise SystemExit('timed purchase block missing')
timed=r'''async function tryDirectTimedPurchaseReminderV1034(env,chatId,raw){
  const original=String(raw||"").replace(/[؟?!،؛;]+/gu," ").replace(/\s+/g," ").trim();
  const normalized=normalizeArabicLoose(normalizeDigits(original)).replace(/\s+/g," ").trim();
  if(!/^(?:فكرني|فكرنى|تفكرني|ذكرني|ذكرنى|نبهني|نبهنى|تنبهني|افتكرني|متنسانيش|ماتنسانيش)(?:\s|$)/u.test(normalized))return false;
  if(!/(?:اشتري|اشترى|اجيب|جيب|هات)/u.test(normalized))return false;
  if(!/(?:النهارده|النهاردة|اليوم|بكره|بكرة|غدا|بعد\s+بكره|بعد\s+بكرة)/u.test(normalized))return false;
  const tm=normalized.match(/(?:الساعه|الساعة)\s*(\d{1,2})(?:\s*[:٫.]\s*(\d{1,2}))?\s*(صباح|صباحا|الصبح|ص|مساء|مساءا|المساء|العصر|بالليل|الليل|م)(?=\s|$)/u);
  if(!tm)return false;
  let hour=Number(tm[1]),minute=Number(tm[2]||0);if(hour<1||hour>12||minute<0||minute>59)return false;
  const period=tm[3];const pm=/^(?:مساء|مساءا|المساء|العصر|بالليل|الليل|م)$/u.test(period);if(pm&&hour<12)hour+=12;if(!pm&&hour===12)hour=0;
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
s=s[:tstart]+timed+s[tend:]
out.write_text(s)
print('built',out,len(out.read_bytes()))
