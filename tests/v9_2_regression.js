const fs=require('fs'),vm=require('vm');
let src=fs.readFileSync('SuperAgent_V9.2_Final_Stability.js','utf8');
src=src.replace('export default{','const __worker_default={');
src+='\n;globalThis.__T={parseRecurringPrayerAnchors,analyzeHardAmbiguity,isReferenceOnlyClock,findAllClockMentionsDetailed,applyReferenceClockSafety,parseDurationValuePhrase,parseIntervalEveryMinutes,parseExplicitAdvanceOffsets,estimateMinimumItems};';
const ctx={console,Intl,Date,URL,Request,Response,AbortController,setTimeout,clearTimeout,fetch:async()=>{throw new Error('no network')}};vm.createContext(ctx);vm.runInContext(src,ctx,{timeout:5000});
const T=ctx.__T;let total=0,fail=[];function ok(cond,name,detail=''){total++;if(!cond)fail.push({name,detail});}
const exact=`عاوزك يوميا قبل كل صلاة تالية تنبهني بصلاة الصلاة السابقة يعني قبل العصر بربع ساعة ابعتلي تنبيه تاكيدي اني اصلي الظهر وهكذا لكل الصلوات على النحو التالي .. قبل العصر نبهني بالظهر وقبل المغرب نبهني بالعصر وقبل العشا نبهني بالمغرب مع مراعاة فرق التوقيت اليومي للصلاه`;
const r=T.parseRecurringPrayerAnchors(exact);console.log('exact prayer',r);ok(r.length===3,'exact prayer count',JSON.stringify(r));
ok(r.some(x=>x.prayer==='Asr'&&x.offset===-15&&/الظهر/.test(x.title)),'asr->dhuhr',JSON.stringify(r));
ok(r.some(x=>x.prayer==='Maghrib'&&x.offset===-15&&/العصر/.test(x.title)),'maghrib->asr',JSON.stringify(r));
ok(r.some(x=>x.prayer==='Isha'&&x.offset===-15&&/المغرب/.test(x.title)),'isha->maghrib',JSON.stringify(r));
const ref=`الساعة 5 مساء فكرني اكلم الممرضه علشان تيجي تدي الحقنه لمرام الساعة 6`;
console.log('ambig ref',T.analyzeHardAmbiguity(ref));ok(T.analyzeHardAmbiguity(ref)===null,'reference no clarification');
let intent={action:'create',items:[{time:'17:00',title:'اكلم الممرضه'},{time:'06:00',title:'حقنة مرام'}],recurring_items:[]};T.applyReferenceClockSafety(intent,ref);ok(intent.items.length===1&&intent.items[0].time==='17:00','reference strip second',JSON.stringify(intent));
const daily=['يوميا','كل يوم','التذكيرات اليومية التالية','عاوزها يوميه'];
const b4=['قبل العصر بربع ساعة نبهني بالظهر وقبل المغرب نبهني بالعصر وقبل العشا نبهني بالمغرب','قبل صلاة العصر بربع ساعة فكرني اصلي الظهر وقبل صلاة المغرب نبهني اصلي العصر وقبل صلاة العشاء نبهني اصلي المغرب'];
for(let i=0;i<4000;i++){const s=`${daily[i%daily.length]} ${b4[i%b4.length]}`;const x=T.parseRecurringPrayerAnchors(s);ok(x.length===3,'rand prayer '+i,JSON.stringify(x));}
const causes=['علشان','عشان','بحيث']; const verbs=['تيجي تدي الحقنة','تجي تدي الحقنه','تيجي تعمل الزيارة'];
for(let i=0;i<4000;i++){let h=1+(i%11),rh=1+((i+3)%11);const s=`الساعة ${h} مساء فكرني اكلم الممرضة ${causes[i%3]} ${verbs[i%3]} الساعة ${rh}`;ok(T.analyzeHardAmbiguity(s)===null,'rand ref ambig '+i,String(T.analyzeHardAmbiguity(s)));let it={action:'create',items:[{time:String(h+12).padStart(2,'0')+':00',title:'اكلم الممرضة'},{time:String(rh).padStart(2,'0')+':00',title:'حدث مرجعي'}],recurring_items:[]};T.applyReferenceClockSafety(it,s);ok(it.items.length===1,'rand ref strip '+i,JSON.stringify(it));}
for(let h=1;h<=12;h++){const s=`بكرة فكرني الساعة ${h} اشرب مية`;ok(T.analyzeHardAmbiguity(s)!=null,'ordinary ambiguity '+h);}
for(let i=0;i<1000;i++){ok(T.parseDurationValuePhrase('ساعه و45 دقيقه')===105,'duration105 '+i);ok(T.parseDurationValuePhrase('ساعتين و35 دقيقه')===155,'duration155 '+i);ok(JSON.stringify(T.parseExplicitAdvanceOffsets('نبهني قبلها بساعة و20 دقيقة وكمان قبلها بـ10 دقايق'))===JSON.stringify([80,10]),'alerts '+i,JSON.stringify(T.parseExplicitAdvanceOffsets('نبهني قبلها بساعة و20 دقيقة وكمان قبلها بـ10 دقايق')));}
console.log(JSON.stringify({total,failed:fail.length,firstFailures:fail.slice(0,20)},null,2));if(fail.length)process.exit(1);
