const fs=require('fs'),vm=require('vm'),assert=require('assert');
let src=fs.readFileSync('SuperAgent_V9.2_Final_Stability.js','utf8').replace('export default{','const __workerDefault={');
const ctx={console,Intl,Date,Math,JSON,RegExp,String,Number,Array,Object,Set,Map,Promise,URL,Request,Response,AbortController,setTimeout,clearTimeout,fetch:async()=>{throw new Error('network disabled in unit test')}};
vm.createContext(ctx); vm.runInContext(src,ctx,{timeout:10000});
const run=e=>vm.runInContext(e,ctx,{timeout:10000});
let passed=0;
function ok(cond,msg){assert.ok(cond,msg);passed++;}
function eq(a,b,msg){assert.strictEqual(JSON.stringify(a),JSON.stringify(b),msg);passed++;}
// Exact reported prayer bug
const prayer=`عاوزك يوميا قبل كل صلاة تاليه تنبهني بصلاة الصلاة السابقة يعني قبل العصر بربع ساعه ابعتلي تنبيه تأكيدي اني اصلي الظهر وهكذا لكل الصلوات علي النحو التالي .. قبل العصر نبهني بالظهر وقبل المغرب نبهني بالعصر وقبل العشا نبهني بالمغرب مع قراءة فرق التوقيت اليومي للصلاه`;
ctx.__txt=prayer; let batch=run('parseRecurringPrayerAnchors(__txt)');
eq(batch.length,3,'must parse three prayer anchors');
eq(batch.map(x=>x.prayer),['Asr','Maghrib','Isha'],'anchor prayers');
eq(batch.map(x=>x.offset),[-15,-15,-15],'quarter-hour inherited');
eq(batch.map(x=>x.title),['صلي الظهر','صلي العصر','صلي المغرب'],'target prayers');
// Alternate phrasing from screenshot
ctx.__txt=`احفظ التذكيرات اليومية التالية: قبل صلاة العصر بربع ساعة نبهني بالظهر وقبل المغرب بربع ساعة نبهني بالعصر وقبل العشا بربع ساعة نبهني بالمغرب`;
batch=run('parseRecurringPrayerAnchors(__txt)'); eq(batch.length,3); eq(batch.map(x=>x.offset),[-15,-15,-15]);
// Reference-time bug exact shape
ctx.__txt='الساعة 5 مساء فكرني اكلم الممرضة علشان تيجي تدي الحقنة لمرام الساعة 6';
let amb=run('findAmbiguous12HourTimesDetailed(__txt).filter(x=>!isReferenceOnlyClock(__txt,x))');
eq(amb.length,0,'6 should not trigger AM/PM question because it is reference time');
let min=run('estimateMinimumItems(__txt)'); eq(min,1,'only one requested reminder');
ctx.__intent={action:'create',items:[{time:'17:00',title:'اكلم الممرضة'},{time:'18:00',title:'حقنة مرام'}],recurring_items:[]};
run('applyReferenceClockSafety(__intent,__txt)'); eq(ctx.__intent.items.length,1); eq(ctx.__intent.items[0].time,'17:00');
// If user explicitly requests both, don't collapse
ctx.__txt='الساعة 5 مساء فكرني اكلم الممرضة وكمان الساعة 6 مساء فكرني بحقنة مرام';
min=run('estimateMinimumItems(__txt)'); eq(min,2); ctx.__intent={action:'create',items:[{time:'17:00'},{time:'18:00'}]}; run('applyReferenceClockSafety(__intent,__txt)'); eq(ctx.__intent.items.length,2);
// Egyptian duration expressions
const durCases=[['ساعة إلا ربع',45],['ساعة وثلث',80],['ساعتين و35 دقيقة',155],['ساعة ونص',90],['خمستاشر دقيقة',15],['تلاتين دقيقة',30],['ربع ساعة',15],['نص ساعة',30]];
for(const [x,v] of durCases){ctx.__txt=x; eq(run('parseDurationValuePhrase(__txt)'),v,x)}
// 5000 generated reference-time variants
const hours=[1,2,3,4,5,6,7,8,9,10,11,12]; const verbs=['تيجي','تجي','تدي','يكون','يعمل']; const causes=['عشان','علشان','بحيث'];
for(let i=0;i<5000;i++){
 const h=hours[i%hours.length],h2=hours[(i*7+3)%hours.length],cause=causes[i%3],verb=verbs[i%5];
 ctx.__txt=`الساعة ${h} مساء فكرني اكلم الممرضة ${cause} ${verb} الحاجة الساعة ${h2}`;
 const c=run('estimateMinimumItems(__txt)'); if(c!==1) throw new Error(`ref variant failed ${ctx.__txt} => ${c}`); passed++;
}
// 3000 prayer variants
const qwords=['ربع ساعة','15 دقيقة','خمستاشر دقيقة'];
for(let i=0;i<3000;i++){
 const q=qwords[i%3]; ctx.__txt=`عاوز التذكيرات اليومية: قبل العصر ب${q} نبهني بالظهر وقبل المغرب ب${q} نبهني بالعصر وقبل العشا ب${q} نبهني بالمغرب`;
 const b=run('parseRecurringPrayerAnchors(__txt)'); if(b.length!==3||b.some(x=>x.offset!==-15)) throw new Error(`prayer variant fail ${i} ${JSON.stringify(b)}`); passed++;
}
// 2000 interval arithmetic cases
for(let i=1;i<=2000;i++){
 const every=(i%59)+1,window=every*((i%12)+1); ctx.__txt=`فكرني كل ${every} دقيقة اتحرك لمدة ${window} دقيقة`;
 const d=run('parseDeterministicIntervalWindow(__txt,"Africa/Cairo")'); const exp=Math.floor(window/every); if(!d||d.everyMinutes!==every||d.maxOccurrences!==exp) throw new Error(`interval fail ${i}`); passed++;
}
console.log(JSON.stringify({ok:true,passed},null,2));
