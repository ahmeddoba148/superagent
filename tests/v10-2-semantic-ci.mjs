import fs from 'fs';
const srcFile=process.argv[2]||'SuperAgent_V10_2_Semantic_Stability.js';
let src=fs.readFileSync(srcFile,'utf8');
src += `\nexport {applyV102SemanticRepairs,extractV102ShoppingAddClause,normalizeV10Dependencies,dependencyGraphHasCycle,buildDeterministicActionReferenceIntent,runV10SelfTests};\n`;
fs.writeFileSync('./.v102_ci_exposed.mjs',src);
const m=await import(new URL('../.v102_ci_exposed.mjs?x='+Date.now(), import.meta.url).href);
let pass=0,fail=0;const errors=[];
const ok=(name,c,d='')=>{if(c)pass++;else{fail++;errors.push({name,d})}};
// Date expectations must be relative to the actual Cairo date. A fixed 2026-08-15
// made this regression fail after midnight even when production behavior was correct.
const cairoParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
const today=`${cairoParts.year}-${cairoParts.month}-${cairoParts.day}`;
const noonUtc=new Date(`${today}T12:00:00Z`);noonUtc.setUTCDate(noonUtc.getUTCDate()+1);
const tom=noonUtc.toISOString().slice(0,10);
let i={action:'create',needs_clarification:false,items:[{title:'دكتور مرام',kind:'appointment',date:tom,time:'17:00',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]},{title:'أجيب الدوا بعد ما نخلص عند الدكتور',kind:'reminder',date:tom,time:'18:00',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]}],recurring_items:[],dependencies:[]};
m.applyV102SemanticRepairs(i,'مرام عندها الدكتور بكرة 5، فكرني قبلها بالتحاليل وبعد ما نخلص أجيب الدوا','Africa/Cairo');
ok('doctor chain restores 3 items',i.items.length===3,JSON.stringify(i));
ok('doctor chain creates 2 deps',i.dependencies.length===2,JSON.stringify(i.dependencies));
const bd=i.dependencies.find(x=>x.relation==='before_start'),ad=i.dependencies.find(x=>x.relation==='after_end');
ok('doctor before link',!!bd&&bd.offset_minutes===60,JSON.stringify(bd));
ok('doctor after link',!!ad&&ad.offset_minutes===60,JSON.stringify(ad));
let v={action:'create',needs_clarification:false,items:[{title:'أكلم أحمد',kind:'reminder',date:'2099-08-19',time:'04:00',timezone:'Africa/Cairo',duration_minutes:0,advance_alerts:[]}],recurring_items:[],dependencies:[]};
m.applyV102SemanticRepairs(v,'فكرني بكرة الساعة 4 العصر أكلم أحمد','Africa/Cairo');
ok('voice tomorrow grounded',v.items[0].date===tom,JSON.stringify({today,tom,item:v.items[0]}));
ok('voice 4pm grounded',v.items[0].time==='16:00',JSON.stringify(v.items[0]));
const mix=m.extractV102ShoppingAddClause('ضيف مناديل ومعجون للمشتريات وفكرني بكرة الساعة 4 العصر أكلم أحمد');
ok('compound shopping count',mix?.items?.length===2,JSON.stringify(mix));
ok('compound reminder preserved',/فكرني.*أحمد/u.test(mix?.remaining||''),JSON.stringify(mix));
const one=m.buildDeterministicActionReferenceIntent('بكرة الساعة 5 مساء فكرني أكلم الممرضة علشان تيجي الساعة 6 مساء','Africa/Cairo');
ok('reference-only time stays one reminder',one?.items?.length===1&&one.items[0].time==='17:00',JSON.stringify(one));
const dag=[];for(let x=0;x<150;x++)dag.push({source_ref:x,target_ref:x+1,relation:'after_start',offset_minutes:1});
const norm=m.normalizeV10Dependencies(dag);ok('150 dependency links preserved',norm.length===150,String(norm.length));
ok('large dag no cycle',!m.dependencyGraphHasCycle(norm));
const cyc=m.normalizeV10Dependencies([...dag,{source_ref:150,target_ref:0,relation:'after_start',offset_minutes:0}]);
ok('large cycle detected',m.dependencyGraphHasCycle(cyc));
for(const text of ['ضيف لبن وبيض للمشتريات ونبهني بكرة 4 العصر أكلم أحمد','زود مناديل في المشتريات وذكرني بكرة 4 العصر أكلم أحمد','حط جبنة فى قائمة المشتريات وفكرني بكرة 4 العصر أكلم أحمد']){
 const x=m.extractV102ShoppingAddClause(text);ok('compound variant',!!x?.items?.length&&/(?:فكرني|ذكرني|نبهني)/u.test(x.remaining||''),JSON.stringify(x));
}
const built=m.runV10SelfTests();ok('built-in self tests',built.ok,JSON.stringify(built.tests?.filter(x=>!x.ok)));
console.log(JSON.stringify({pass,fail,total:pass+fail,errors},null,2));
process.exit(fail?1:0);
