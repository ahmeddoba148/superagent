const fs=require('fs'),vm=require('vm');
const SOURCE=process.argv[2]||'SuperAgent_V9.2_Final_Stability.js';
let src=fs.readFileSync(SOURCE,'utf8').replace('export default{','const __workerDefault={');
src+='\nglobalThis.__t={parseMultiRecurringPrayerAnchors,buildDeterministicActionReferenceIntent,analyzeHardAmbiguity,estimateMinimumItemsSemantic,parseDurationValuePhrase,parseExplicitAdvanceOffsets,parseDeterministicIntervalWindow,intervalsOverlap,generateRuleOccurrences,normalizeUniversalSchedule,egyptianNumberValue,addMinutesLocal,localDateTimeToEpoch,epochToLocalDateTime,validDate,validTime,isoWeekday};';
const ctx={console:{log(){},warn(){},error(){}},Intl,Date,URL,Request,Response,Headers,setTimeout,clearTimeout,fetch:async()=>{throw new Error('network disabled in stress test')}};
vm.createContext(ctx);vm.runInContext(src,ctx,{timeout:10000});
const t=ctx.__t;
let passed=0; const failures=[];
function ok(cond,name,detail=''){ if(cond){passed++;return;} failures.push({name,detail}); }
function eq(a,b,name){ ok(JSON.stringify(a)===JSON.stringify(b),name,`got=${JSON.stringify(a)} expected=${JSON.stringify(b)}`); }
function rng(seed=0xC0FFEE){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
const R=rng(); const pick=a=>a[Math.floor(R()*a.length)];

// Exact regressions from screenshots.
const prayer2='احفظ التذكيرات اليومية التالية : قبل صلاة العصر بربع ساعه نبهني بالظهر وقبل المغرب بربع ساعه نبهني بالعصر وقبل العشا بربع ساعه نبهني بالمغرب مع قراءة فرق التوقيت اليومي للصلاه';
let p=t.parseMultiRecurringPrayerAnchors(prayer2);
eq(p.map(x=>[x.prayer,x.offset,x.title]),[['Asr',-15,'صلي الظهر'],['Maghrib',-15,'صلي العصر'],['Isha',-15,'صلي المغرب']],'regression multi-prayer 3 rules');
const prayer1='عاوزك يوميا قبل كل صلاة تاليه تنبهني بصلاة الصلاة السابقة يعني قبل العصر بربع ساعه ابعتلي تنبيه تاكيدي اني اصلي الظهر وهكذا لكل الصلوات على النحو التالي .. قبل العصر نبهني بالظهر وقبل المغرب نبهني بالعصر وقبل العشا نبهني بالمغرب مع قراءة فرق التوقيت اليومي للصلاه';
p=t.parseMultiRecurringPrayerAnchors(prayer1);
eq(p.map(x=>[x.prayer,x.offset,x.title]),[['Asr',-15,'صلي الظهر'],['Maghrib',-15,'صلي العصر'],['Isha',-15,'صلي المغرب']],'regression multi-prayer duplicate dedupe');
const nurse='الساعة 5 مساء فكرني اكلم الممرضة علشان تيجي تدي الحقنة لمرام الساعة 6';
let a=t.buildDeterministicActionReferenceIntent(nurse,'Africa/Cairo');
ok(a&&a.items.length===1&&a.items[0].time==='17:00','regression action/reference one reminder',JSON.stringify(a));
eq(t.analyzeHardAmbiguity(nurse),null,'regression reference time no clarification');
eq(t.estimateMinimumItemsSemantic(nurse),1,'regression semantic item count one');
const explicitSecond='الساعة 5 مساء فكرني اكلم الممرضة علشان تيجي الساعة 6 وسجل كمان موعد الحقنة الساعة 6 مساء';
eq(t.buildDeterministicActionReferenceIntent(explicitSecond,'Africa/Cairo'),null,'explicit second schedule not swallowed');

// Prayer variants: 4,000 randomized multi-anchor requests.
const prefixes=['يوميا','كل يوم','احفظ التذكيرات اليومية التالية','عاوز تذكيرات يوميه','بشكل يومي'];
const durVariants=[['بربع ساعه',15],['ب15 دقيقة',15],['بنص ساعه',30],['ب20 دقيقة',20],['بساعة الا ربع',45]];
const verbs=[['نبهني ب',''],['فكرني اني اصلي ',''],['ابعتلي تنبيه اني اصلي ','']];
const targetSpell={Dhuhr:['الظهر','الضهر'],Asr:['العصر'],Maghrib:['المغرب']};
const anchorSpell={Asr:['العصر'],Maghrib:['المغرب'],Isha:['العشا','العشاء']};
for(let i=0;i<4000;i++){
 const [dur,mins]=pick(durVariants), pre=pick(prefixes), verb=pick(verbs)[0];
 const s=`${pre} قبل صلاة ${pick(anchorSpell.Asr)} ${dur} ${verb}${pick(targetSpell.Dhuhr)} وقبل ${pick(anchorSpell.Maghrib)} ${dur} ${verb}${pick(targetSpell.Asr)} وقبل ${pick(anchorSpell.Isha)} ${dur} ${verb}${pick(targetSpell.Maghrib)}`;
 const rules=t.parseMultiRecurringPrayerAnchors(s);
 ok(rules.length===3,`prayer variant count ${i}`,JSON.stringify(rules));
 if(rules.length===3){
  eq(rules.map(x=>x.prayer),['Asr','Maghrib','Isha'],`prayer anchors ${i}`);
  eq(rules.map(x=>x.offset),[-mins,-mins,-mins],`prayer offsets ${i}`);
 }
}

// Action-vs-reference variants: 4,000 randomized requests.
const causes=['علشان','عشان','بحيث','لان'];
const rverbs=['فكرني','ذكرني','نبهني'];
const periods=[['مساء','PM'],['بالليل','PM'],['الصبح','AM'],['صباحا','AM']];
for(let i=0;i<4000;i++){
 const h=1+Math.floor(R()*12), ref=1+Math.floor(R()*12), [word,code]=pick(periods), v=pick(rverbs), c=pick(causes);
 const form=R()<0.5?`الساعة ${h} ${word} ${v} اكلم الممرضة ${c} تيجي تدي الحقنة الساعة ${ref}`:`${v} الساعة ${h} ${word} اكلم الممرضة ${c} تيجي تدي الحقنة الساعة ${ref}`;
 const intent=t.buildDeterministicActionReferenceIntent(form,'Africa/Cairo');
 const hh=(h%12)+(code==='PM'?12:0), expected=`${String(hh).padStart(2,'0')}:00`;
 ok(intent&&intent.items.length===1&&intent.items[0].time===expected,`action ref intent ${i}`,JSON.stringify(intent));
 eq(t.analyzeHardAmbiguity(form),null,`action ref ambiguity ${i}`);
 eq(t.estimateMinimumItemsSemantic(form),1,`action ref count ${i}`);
}

// Duration parser: 3,000 randomized exact/composite Egyptian forms.
const fixedDur=[['ساعة ونص',90],['ساعة وربع',75],['ساعة الا ربع',45],['ساعة إلا ربع',45],['ساعة وتلت',80],['ساعة وثلث',80],['ساعتين ونص',150],['ساعتين وربع',135],['خمستاشر دقيقة',15],['تلاتين دقيقة',30],['عشرين دقيقة',20]];
for(let i=0;i<3000;i++){
 let phrase,expect;
 if(R()<0.45){ [phrase,expect]=pick(fixedDur); }
 else { const hrs=1+Math.floor(R()*4), mins=1+Math.floor(R()*58); phrase=`${hrs===1?'1 ساعة':`${hrs} ساعات`} و${mins} دقيقة`; expect=hrs*60+mins; }
 const got=t.parseDurationValuePhrase(phrase);
 ok(got===expect,`duration ${i}`,`${phrase}: ${got} != ${expect}`);
}

// Advance alert composite semantics: 1,500 cases.
for(let i=0;i<1500;i++){
 const h=1+Math.floor(R()*3), m=1+Math.floor(R()*59), m2=1+Math.floor(R()*30);
 const s=`ونبهني قبله ب${h} ساعة و${m} دقيقة وكمان قبله ب${m2} دقيقة`;
 const got=t.parseExplicitAdvanceOffsets(s);
 const exp=[h*60+m,m2].sort((x,y)=>y-x);
 eq(got,exp,`advance alerts ${i}`);
}

// Interval recurrence semantics: 1,500 cases.
for(let i=0;i<1500;i++){
 const every=5+Math.floor(R()*55), win=every*(1+Math.floor(R()*12))+Math.floor(R()*every);
 const s=`فكرني كل ${every} دقيقة اتحرك لمدة ${win} دقيقة`;
 const got=t.parseDeterministicIntervalWindow(s,'Africa/Cairo');
 ok(got&&got.everyMinutes===every&&got.maxOccurrences===Math.floor(win/every)&&got.windowMinutes===win,`interval ${i}`,JSON.stringify(got));
}

// Conflict interval algebra: 1,000 cases.
for(let i=0;i<1000;i++){
 const a0=Math.floor(R()*1000), ad=1+Math.floor(R()*180), b0=Math.floor(R()*1000), bd=1+Math.floor(R()*180);
 const fmt=x=>`2026-08-${String(1+Math.floor(x/1440)).padStart(2,'0')} ${String(Math.floor((x%1440)/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`;
 const expected=a0<a0+ad && a0<b0+bd && b0<a0+ad;
 const got=t.intervalsOverlap(fmt(a0),fmt(a0+ad),fmt(b0),fmt(b0+bd));
 ok(got===expected,`overlap ${i}`,`${a0},${ad},${b0},${bd}`);
}

// Max occurrences generation: 1,000 cases.
for(let i=0;i<1000;i++){
 const max=1+Math.floor(R()*12), every=1+Math.floor(R()*4);
 const item={title:'x',kind:'reminder',duration_minutes:0,advance_alerts:[],schedule:{mode:'calendar',unit:'days',every,times:['09:00'],weekdays:[],monthdays:[],months:[],ordinal_weekdays:[],start_at:'2026-08-01 09:00',end_at:null,max_occurrences:max,exceptions:[]}};
 const occ=t.generateRuleOccurrences(item,'2026-08-01 00:00','2026-12-31 23:59',1000,true);
 ok(occ.length===max,`max occurrences ${i}`,`got ${occ.length} max ${max}`);
}

// Time round-trip in Cairo: 1,000 cases.
for(let i=0;i<1000;i++){
 const day=1+Math.floor(R()*27), h=Math.floor(R()*24), m=Math.floor(R()*60);
 const local=`2026-08-${String(day).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
 const rt=t.epochToLocalDateTime(t.localDateTimeToEpoch(local,'Africa/Cairo'),'Africa/Cairo');
 eq(rt,local,`cairo roundtrip ${i}`);
}

const total=passed+failures.length;
console.log(JSON.stringify({total,passed,failed:failures.length,failures:failures.slice(0,25)},null,2));
if(failures.length)process.exit(1);
