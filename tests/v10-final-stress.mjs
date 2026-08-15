import fs from 'fs';
let src=fs.readFileSync('./SuperAgent_V10_Final_Stability.js','utf8');
src += `\nexport {analyzeActionReferenceShape,buildDeterministicActionReferenceIntent,estimateMinimumItemsSemantic,parseMultiRecurringPrayerAnchors,normalizeV10Dependencies,dependencyGraphHasCycle,splitShoppingItems,parseSimpleRelativeMinutes,quickMenuKeyboard,clarificationKeyboard};\n`;
fs.writeFileSync('./v10_stress_exposed.mjs',src);
const m=await import(new URL('./v10_stress_exposed.mjs?x='+Date.now(), import.meta.url).href);
let passed=0,failed=0;const failures=[];
function a(name,cond,detail=''){if(cond)passed++;else{failed++;if(failures.length<20)failures.push({name,detail})}}
function hh(h,p){let x=h%12;if(p==='PM')x+=12;return String(x).padStart(2,'0')+':00'}
const pAr={AM:'صباح',PM:'مساء'};
for(const connector of ['علشان','عشان','بحيث','لكي','لان'])for(let h1=1;h1<=12;h1++)for(let h2=1;h2<=12;h2++)for(const p1 of ['AM','PM'])for(const p2 of ['AM','PM']){
 const text=`بكرة الساعة ${h1} ${pAr[p1]} فكرني اكلم الممرضة ${connector} تيجي الساعة ${h2} ${pAr[p2]}`;
 const shape=m.analyzeActionReferenceShape(text);a('ref shape',!!shape&&shape.actionClock.hour===h1&&shape.referenceClocks.length===1,text);
 a('ref semantic count',m.estimateMinimumItemsSemantic(text)===1,text);
 const intent=m.buildDeterministicActionReferenceIntent(text,'Africa/Cairo');a('ref intent time',intent?.items?.length===1&&intent.items[0].time===hh(h1,p1),JSON.stringify(intent));
}
const prayers=[['الفجر','Fajr'],['الشروق','Sunrise'],['الظهر','Dhuhr'],['العصر','Asr'],['المغرب','Maghrib'],['العشاء','Isha']];
for(const recur of ['كل يوم','يوميا','بشكل يومي'])for(const off of [5,10,15,20,30,45,60])for(let i=0;i<prayers.length;i++)for(let j=0;j<prayers.length;j++)if(i!==j){
 const [a1,e1]=prayers[i],[a2,e2]=prayers[j];const text=`${recur} قبل ${a1} ب${off} دقيقة فكرني اصلي ${a1} وقبل ${a2} ب${off} دقيقة فكرني اصلي ${a2}`;
 const r=m.parseMultiRecurringPrayerAnchors(text);a('prayer count',r.length===2,JSON.stringify({text,r}));a('prayer anchors',r[0]?.prayer===e1&&r[1]?.prayer===e2,JSON.stringify({text,r}));a('prayer semantic count',m.estimateMinimumItemsSemantic(text)===2,text);
}
for(let n=2;n<=30;n++){
 const dag=[];for(let i=0;i<n-1;i++)dag.push({source_ref:i,target_ref:i+1,relation:'after_start',offset_minutes:i});
 const norm=m.normalizeV10Dependencies(dag);a('dag no cycle',!m.dependencyGraphHasCycle(norm),String(n));
 const cyc=[...dag,{source_ref:n-1,target_ref:0,relation:'after_start',offset_minutes:0}];a('cycle detected',m.dependencyGraphHasCycle(m.normalizeV10Dependencies(cyc)),String(n));
}
for(let i=0;i<500;i++){
 const d=m.normalizeV10Dependencies([{source_ref:0,target_ref:1,relation:'after_start',offset_minutes:i%60},{source_ref:0,target_ref:1,relation:'after_start',offset_minutes:99}]);a('dep dedupe',d.length===1,String(i));
}
const items=['لبن','بيض','جبنة','مياه'];
for(const sep of ['، ', ', ', ' و ', '\n'])for(let i=0;i<500;i++){
 const text=items.join(sep);const r=m.splitShoppingItems(text);a('shopping split 4',r.length===4,JSON.stringify({sep,r}));
}
for(let n=1;n<=180;n++)a('relative minutes',m.parseSimpleRelativeMinutes(`بعد ${n} دقيقة`)===n,String(n));
for(let n=1;n<=12;n++)a('relative hours',m.parseSimpleRelativeMinutes(`بعد ${n} ساعة`)===n*60,String(n));
for(let i=0;i<1000;i++){a('quick keyboard null',m.quickMenuKeyboard()===null);a('clarification null',m.clarificationKeyboard(i%2?'meridiem_single':'meridiem_multi')===null);}
console.log(JSON.stringify({passed,failed,total:passed+failed,failures},null,2));
process.exit(failed?1:0);
