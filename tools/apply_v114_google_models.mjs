import fs from 'node:fs';

const file=process.argv[2]||'SuperAgent_V11_4_FULL.js';
let s=fs.readFileSync(file,'utf8');
function one(oldValue,newValue,label){
  if(!s.includes(oldValue))throw new Error(`missing V11.4 anchor: ${label}`);
  s=s.replace(oldValue,newValue);
}
function re(pattern,replacement,label){
  const before=s;
  s=s.replace(pattern,replacement);
  if(s===before)throw new Error(`missing V11.4 regex anchor: ${label}`);
}

s='/* SuperAgent V11.4 FULL — Google-only stable 3-model chain: Gemini 3.5 Flash-Lite primary, Gemini 3.1 Flash-Lite fallback 1, Gemini 3.6 Flash fallback 2. V11.3 reliability hardening retained; AI router remains removed. */\n'+s;

one('const V10_VERSION="11.3.0";const V10_NAME="سوبر إيجنت V11.3 — سلسلة 3 موديلات + طبقة تحقق واعتمادية";',
    'const V10_VERSION="11.4.0";const V10_NAME="سوبر إيجنت V11.4 — سلسلة Gemini ثلاثية مستقرة + طبقة تحقق واعتمادية";',
    'version/name');
one('const TOTAL_AI_BUDGET_MS=9000;const V112_CHAT_TOTAL_BUDGET_MS=4600;const V112_CHAT_TIMEOUT_MS=1700;',
    'const TOTAL_AI_BUDGET_MS=10000;const V112_CHAT_TOTAL_BUDGET_MS=7600;const V112_CHAT_TIMEOUT_MS=2700;',
    'latency budgets');

re(/const MODEL_CHAIN=\[[\s\S]*?\n\];\nconst PRIMARY_MODEL=MODEL_CHAIN\[0\];/,
`const MODEL_CHAIN=[
{short:"G3.5-L",name:"Gemini 3.5 Flash-Lite",id:"gemini::gemini-3.5-flash-lite",timeoutMs:3000,role:"primary",tags:["chat","shopping","schedule","coding","json","arabic"]},
{short:"G3.1-L",name:"Gemini 3.1 Flash-Lite",id:"gemini::gemini-3.1-flash-lite",timeoutMs:3300,role:"fallback_1",tags:["chat","shopping","schedule","json","arabic"]},
{short:"G3.6-F",name:"Gemini 3.6 Flash",id:"gemini::gemini-3.6-flash",timeoutMs:3600,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}
];
const PRIMARY_MODEL=MODEL_CHAIN[0];`,
    'model chain');

one('v11_3:true,v113_hardened:true,',
    'v11_3:true,v11_4:true,v114_google_three_model_chain:true,v113_hardened:true,',
    'root flags');
one('message:"سوبر إيجنت V11.3 جاهز للعمل",v11:true,v11_1:true,v111_fix:true,v11_2:true,models_total:',
    'message:"سوبر إيجنت V11.4 جاهز للعمل",v11:true,v11_1:true,v111_fix:true,v11_2:true,v11_3:true,v11_4:true,models_total:',
    'setup version');
one('new Error("V11.3: الموديل الأساسي والـ2 fallback فشلوا، فمغيّرتش أي بيانات. جاري إعادة المحاولة تلقائيًا عند فشل مؤقت.")',
    'new Error("V11.4: موديلات Gemini الثلاثة لم تُرجع خطة موثوقة، فمغيّرتش أي بيانات. جاري إعادة المحاولة تلقائيًا عند فشل مؤقت.")',
    'model chain failure text');
one("await sendText(env,chatId,'أنا سوبر إيجنت V11.3 🤖 — مساعدك الشخصي لتنظيم يومك ومواعيدك ومشترياتك وذاكرتك ومهامك من الكلام الطبيعي.');",
    "await sendText(env,chatId,'أنا سوبر إيجنت V11.4 🤖 — مساعدك الشخصي لتنظيم يومك ومواعيدك ومشترياتك وذاكرتك ومهامك من الكلام الطبيعي.');",
    'identity');

one('push("v112_primary_is_oss20",PRIMARY_MODEL.id==="groq::openai/gpt-oss-20b",PRIMARY_MODEL.id);',
    'push("v114_primary_is_gemini35_lite",PRIMARY_MODEL.id==="gemini::gemini-3.5-flash-lite",PRIMARY_MODEL.id);',
    'primary selftest');
one('push("v112_fallback1_is_gemini35_lite",FALLBACK_MODELS[0]?.id==="gemini::gemini-3.5-flash-lite",FALLBACK_MODELS[0]?.id||"");',
    'push("v114_fallback1_is_gemini31_lite",FALLBACK_MODELS[0]?.id==="gemini::gemini-3.1-flash-lite",FALLBACK_MODELS[0]?.id||"");',
    'fallback1 selftest');
one('push("v112_fallback2_is_qwen36",FALLBACK_MODELS[1]?.id==="groq::qwen/qwen3.6-27b",FALLBACK_MODELS[1]?.id||"");',
    'push("v114_fallback2_is_gemini36_flash",FALLBACK_MODELS[1]?.id==="gemini::gemini-3.6-flash",FALLBACK_MODELS[1]?.id||"");',
    'fallback2 selftest');

one("const url=new URL(request.url),key=url.searchParams.get('key')||'';if(!env.SETUP_KEY||key!==env.SETUP_KEY)return json({ok:false,error:'غير مصرح'},401);\n  const base={ok:false,version:V10_VERSION,db:false,omniai:false,primary_model:PRIMARY_MODEL.id,probe_model:null,attempts:[]};",
    "const url=new URL(request.url),key=url.searchParams.get('key')||'';if(!env.SETUP_KEY||key!==env.SETUP_KEY)return json({ok:false,error:'غير مصرح'},401);\n  const probeAll=url.searchParams.get('all')==='1';\n  const base={ok:false,version:V10_VERSION,db:false,omniai:false,primary_model:PRIMARY_MODEL.id,probe_model:null,attempts:[]};",
    'ready all flag');
one("        if(r.ok){base.omniai=true;base.probe_model=model.id;break;}",
    "        if(r.ok){base.omniai=true;if(!base.probe_model)base.probe_model=model.id;if(!probeAll)break;}",
    'ready loop');
one("    return json({...base,ok:base.db&&base.omniai,...(!base.omniai?{error:'لم يستجب أي موديل في فحص الجاهزية'}:{})},base.db&&base.omniai?200:503);",
    "    const allModelsOk=probeAll&&base.attempts.length===MODEL_CHAIN.length&&base.attempts.every(x=>x.ok);const readyOk=base.db&&(probeAll?allModelsOk:base.omniai);\n    return json({...base,...(probeAll?{all_models_ok:allModelsOk}:{}),ok:readyOk,...(!readyOk?{error:probeAll?'واحد أو أكثر من موديلات Gemini لم يستجب في فحص الجاهزية':'لم يستجب أي موديل في فحص الجاهزية'}:{})},readyOk?200:503);",
    'ready result');

const v114=`
function runV114PureSelfTests(){
  const tests=[];const add=(name,ok,detail='')=>tests.push({name,ok:!!ok,detail});
  const ids=MODEL_CHAIN.map(x=>x.id);
  add('v114 exactly 3 models',ids.length===3,JSON.stringify(ids));
  add('v114 primary Gemini 3.5 Flash-Lite',ids[0]==='gemini::gemini-3.5-flash-lite',ids[0]||'');
  add('v114 fallback1 Gemini 3.1 Flash-Lite',ids[1]==='gemini::gemini-3.1-flash-lite',ids[1]||'');
  add('v114 fallback2 Gemini 3.6 Flash',ids[2]==='gemini::gemini-3.6-flash',ids[2]||'');
  add('v114 Google-only provider chain',ids.every(x=>x.startsWith('gemini::')),JSON.stringify(ids));
  add('v114 planner has no router call',!parseIntentWithFallback.toString().includes('routeRequestV11('),parseIntentWithFallback.name);
  add('v114 primary role',MODEL_CHAIN[0]?.role==='primary',MODEL_CHAIN[0]?.role||'');
  add('v114 fallback roles',MODEL_CHAIN[1]?.role==='fallback_1'&&MODEL_CHAIN[2]?.role==='fallback_2',MODEL_CHAIN.slice(1).map(x=>x.role).join(','));
  add('v114 total AI budget bounded',TOTAL_AI_BUDGET_MS===10000,String(TOTAL_AI_BUDGET_MS));
  add('v114 chat budget bounded',V112_CHAT_TOTAL_BUDGET_MS===7600&&V112_CHAT_TIMEOUT_MS===2700,String(V112_CHAT_TOTAL_BUDGET_MS)+'/'+String(V112_CHAT_TIMEOUT_MS));
  const passed=tests.filter(x=>x.ok).length;return{ok:passed===tests.length,passed,total:tests.length,tests};
}
`;
one("selfTestEndpoint=async function(request,env){const url=new URL(request.url),key=url.searchParams.get('key')||'';if(!env.SETUP_KEY||key!==env.SETUP_KEY)return json({ok:false,error:'غير مصرح'},401);const old=runV10SelfTests(),v11=runV11PureSelfTests(),v113=runV113PureSelfTests();return json({version:V10_VERSION,ok:old.ok&&v11.every(x=>x.ok)&&v113.ok,v10:old,v11:{ok:v11.every(x=>x.ok),passed:v11.filter(x=>x.ok).length,total:v11.length,tests:v11},v113});};",
    v114+"\nselfTestEndpoint=async function(request,env){const url=new URL(request.url),key=url.searchParams.get('key')||'';if(!env.SETUP_KEY||key!==env.SETUP_KEY)return json({ok:false,error:'غير مصرح'},401);const old=runV10SelfTests(),v11=runV11PureSelfTests(),v113=runV113PureSelfTests(),v114=runV114PureSelfTests();return json({version:V10_VERSION,ok:old.ok&&v11.every(x=>x.ok)&&v113.ok&&v114.ok,v10:old,v11:{ok:v11.every(x=>x.ok),passed:v11.filter(x=>x.ok).length,total:v11.length,tests:v11},v113,v114});};",
    'selftest endpoint');

fs.writeFileSync(file,s);
console.log(JSON.stringify({file,version:'11.4.0',bytes:Buffer.byteLength(s),lines:s.split(/\n/).length,models:['gemini::gemini-3.5-flash-lite','gemini::gemini-3.1-flash-lite','gemini::gemini-3.6-flash']},null,2));
