import fs from 'node:fs';

const SOURCE='SuperAgent_V11_1_FIX.js';
const OUT='SuperAgent_V11_2_FULL.js';
let s=fs.readFileSync(SOURCE,'utf8');

function mustReplace(oldValue,newValue,label){
  const before=s;
  s=s.replace(oldValue,newValue);
  if(s===before)throw new Error('V11.2 anchor missing: '+label);
}
function replaceBetween(startMarker,endMarker,replacement,label){
  const a=s.indexOf(startMarker);
  if(a<0)throw new Error('V11.2 start anchor missing: '+label);
  const b=s.indexOf(endMarker,a+startMarker.length);
  if(b<0)throw new Error('V11.2 end anchor missing: '+label);
  s=s.slice(0,a)+replacement+s.slice(b);
}

mustReplace('const V10_VERSION="11.1.1";const V10_NAME="سوبر إيجنت V11.1 FIX — سريع وطبيعي ومتعدد النماذج";',
  'const V10_VERSION="11.2.0";const V10_NAME="سوبر إيجنت V11.2 — سلسلة 3 موديلات سريعة وبسيطة";',
  'version');

mustReplace('const TOTAL_AI_BUDGET_MS=10000;const V11_ROUTER_BUDGET_MS=900;const V11_ROUTE_LOCAL_CONFIDENCE=0.90;const V11_MIN_ROUTE_CONFIDENCE=0.55;const V111_EASY_PLAN_BUDGET_MS=5200;const V111_COMPLEX_PLAN_BUDGET_MS=9800;const V111_HEDGE_DELAY_MS=120;const V111FIX_CHAT_TOTAL_BUDGET_MS=4200;const V111FIX_CHAT_TIMEOUT_MS=1800;',
  'const TOTAL_AI_BUDGET_MS=6200;const V112_CHAT_TOTAL_BUDGET_MS=4600;const V112_CHAT_TIMEOUT_MS=1700;',
  'latency budgets');

const modelRegistry=`const MODEL_CHAIN=[
{short:"OSS20",name:"GPT OSS 20B — Groq",id:"groq::openai/gpt-oss-20b",timeoutMs:1600,role:"primary",tags:["chat","shopping","schedule","coding","json","arabic"]},
{short:"G3.5-L",name:"Gemini 3.5 Flash-Lite",id:"gemini::gemini-3.5-flash-lite",timeoutMs:1900,role:"fallback_1",tags:["chat","shopping","schedule","json","arabic"]},
{short:"Qwen3.6",name:"Qwen 3.6 27B — Groq",id:"groq::qwen/qwen3.6-27b",timeoutMs:2300,role:"fallback_2",tags:["chat","shopping","schedule","coding","json","arabic"]}
];
const PRIMARY_MODEL=MODEL_CHAIN[0];
const FALLBACK_MODELS=MODEL_CHAIN.slice(1);
const REMINDER_MODELS=MODEL_CHAIN;
`;
replaceBetween('const FAST_MODELS=[','export default{',modelRegistry+'\nexport default{','model registry');

mustReplace('v11:true,v11_1:true,v111_fix:true,v111_fast_router:true,v111_three_model_execution:true,v111_direct_chat:true,v111_shopping_todo:true,v11_semantic_router:true,v11_fast_models:FAST_MODELS.length,v11_complex_models:COMPLEX_MODELS.length,v11_router_models:ROUTER_MODELS.length,',
  'v11:true,v11_1:true,v111_fix:true,v11_2:true,v112_router_removed:true,v112_simple_three_model_chain:true,v112_direct_chat:true,v111_shopping_todo:true,v11_semantic_router:false,v112_models_total:MODEL_CHAIN.length,v112_primary_model:PRIMARY_MODEL.id,v112_fallback_models:FALLBACK_MODELS.map(x=>x.id),',
  'root model flags');
s=s.replaceAll('fallback_models:REMINDER_MODELS.length','fallback_models:FALLBACK_MODELS.length');
s=s.replaceAll('message:"سوبر إيجنت V11.1 FIX جاهز للعمل",v11:true,v11_1:true,v111_fix:true,fast_models:FAST_MODELS.length,complex_models:COMPLEX_MODELS.length,router_models:ROUTER_MODELS.length,',
  'message:"سوبر إيجنت V11.2 جاهز للعمل",v11:true,v11_1:true,v111_fix:true,v11_2:true,models_total:MODEL_CHAIN.length,primary_model:PRIMARY_MODEL.id,fallback_models:FALLBACK_MODELS.map(x=>x.id),router:false,');
s=s.replaceAll('message:"سوبر إيجنت V11.1 FIX جاهز للعمل",v11:true,v11_1:true,v111_fix:true,',
  'message:"سوبر إيجنت V11.2 جاهز للعمل",v11:true,v11_1:true,v111_fix:true,v11_2:true,models_total:MODEL_CHAIN.length,primary_model:PRIMARY_MODEL.id,fallback_models:FALLBACK_MODELS.map(x=>x.id),router:false,');

const simpleExtract=`function v11ExtractModelText(data){
const c=data?.choices?.[0]?.message?.content??data?.choices?.[0]?.text??data?.output_text??data?.response??"";
if(Array.isArray(c))return c.map(x=>typeof x==="string"?x:(x?.text||x?.content||"")).join("");
return String(c||"");
}
`;
replaceBetween('function v11RouteAxes(text){','function extractExplicitShoppingUnitsV11(text){',simpleExtract+'\nfunction extractExplicitShoppingUnitsV11(text){','remove router engine');

const selfTest=`function runV11PureSelfTests(){
const tests=[];const push=(name,ok,detail="")=>tests.push({name,ok:Boolean(ok),detail});
const longList="بص عاوز اشتري\\nعيش تورتيلا\\nعيش توست\\nفينو اسود\\nفصوص رومي\\nشيدر طبيعي\\nكاجو\\nفستق\\nكوفي شيك\\nحليب دينا\\nايس كريم دينا\\nوبطاطس طبيعية";
push("v112_chain_has_3_models",MODEL_CHAIN.length===3,String(MODEL_CHAIN.length));
push("v112_primary_is_oss20",PRIMARY_MODEL.id==="groq::openai/gpt-oss-20b",PRIMARY_MODEL.id);
push("v112_fallback1_is_gemini35_lite",FALLBACK_MODELS[0]?.id==="gemini::gemini-3.5-flash-lite",FALLBACK_MODELS[0]?.id||"");
push("v112_fallback2_is_qwen36",FALLBACK_MODELS[1]?.id==="groq::qwen/qwen3.6-27b",FALLBACK_MODELS[1]?.id||"");
push("v112_long_shopping_preserves_11_units",extractExplicitShoppingUnitsV11(longList).length===11,String(extractExplicitShoppingUnitsV11(longList).length));
push("v112_casual_egyptian_reply",v112DeterministicCasualReply("عامل اي")?.includes("عامل إيه"),v112DeterministicCasualReply("عامل اي")||"");
push("v112_chat_detector_accepts_casual",v112LooksLikeDirectChat("عامل اي")===true,String(v112LooksLikeDirectChat("عامل اي")));
push("v112_chat_detector_rejects_reminder",v112LooksLikeDirectChat("فكرني بكرة الساعة 6 اكلم احمد")===false,String(v112LooksLikeDirectChat("فكرني بكرة الساعة 6 اكلم احمد")));
push("v112_chat_detector_rejects_shopping",v112LooksLikeDirectChat("ضيف لبن للمشتريات")===false,String(v112LooksLikeDirectChat("ضيف لبن للمشتريات")));
return tests;
}
`;
replaceBetween('function runV11PureSelfTests(){','async function parseIntentWithFallback(env,userText,validationContext){',selfTest+'\nasync function parseIntentWithFallback(env,userText,validationContext){','self tests');

const simplePlanner=`async function parseIntentWithFallback(env,userText,validationContext){
const baseText=String(validationContext?.baseText||userText||"");
const explicitShoppingUnits=extractExplicitShoppingUnitsV11(baseText);
if(explicitShoppingUnits.length>=2){
  const seed={action:"shopping",needs_clarification:false,question:"",reply:"",shopping:{mode:"mutate",query:"all",query_value:"",operations:explicitShoppingUnits.map(title=>({op:"add",target:"",title,replacement:"",quantity_value:null,quantity_unit:"",quantity_text:"",quantity_exact:false,factor:null,meta:{}}))}};
  const safetyContext={...(validationContext||{}),baseText};
  const intent=validateAndNormalizeIntent(seed,safetyContext);
  applySafetyFixes(intent,safetyContext);
  finalSafetyCheck(intent,safetyContext);
  assertShoppingEntityPreservationV11(intent,baseText);
  Object.assign(intent,{_model:"deterministic:explicit-shopping-list",_model_name:"Deterministic shopping fast path",_latency_ms:0,_v112_fast_path:true});
  return intent;
}
const failures=[];
const started=Date.now();
for(let i=0;i<MODEL_CHAIN.length;i++){
  const elapsed=Date.now()-started;
  const remaining=TOTAL_AI_BUDGET_MS-elapsed;
  if(remaining<450)break;
  const model=MODEL_CHAIN[i];
  const effective={...model,timeoutMs:Math.max(450,Math.min(model.timeoutMs,remaining-180))};
  try{
    const intent=await parseIntentWithFallbackLegacy(env,userText,validationContext,[effective]);
    assertShoppingEntityPreservationV11(intent,baseText);
    Object.assign(intent,{_v112_chain_index:i,_v112_chain_role:model.role,_v112_model:model.id});
    return intent;
  }catch(error){
    failures.push({model:model.id,role:model.role,error:String(error?.message||error).slice(0,300)});
  }
}
throw Object.assign(new Error("V11.2: الموديل الأساسي والـ2 fallback فشلوا، فمغيّرتش أي بيانات. جرّب تاني بعد لحظات."),{v112_failures:failures});
}
`;
replaceBetween('async function parseIntentWithFallback(env,userText,validationContext){','async function parseIntentWithFallbackLegacy(env,userText,validationContext,V11_MODEL_POOL){',simplePlanner+'\nasync function parseIntentWithFallbackLegacy(env,userText,validationContext,V11_MODEL_POOL){','simple 3-model planner');

const directChat=`const V112_CHAT_MODELS=MODEL_CHAIN;
function v112NormalizeCasual(text){return normalizeArabicLoose(String(text||"")).toLowerCase().replace(/[؟?!.,،؛:]+/g," ").replace(/\\s+/g," ").trim();}
function v112DeterministicCasualReply(text){
  const t=v112NormalizeCasual(text);
  if(/^(?:عامل اي|عامل ايه|اخبارك اي|اخبارك ايه|ازيك|إزيك|كيفك)$/u.test(t))return "تمام يا معلم 😄 إنت عامل إيه؟";
  if(/^(?:صباح الخير|صباح الفل|صباح النور)$/u.test(t))return "صباح الفل عليك 🌞 عامل إيه؟";
  if(/^(?:مساء الخير|مساء الفل|مساء النور)$/u.test(t))return "مساء الفل عليك 🌙 عامل إيه؟";
  if(/^(?:اهلا|أهلا|هاي|هلا)$/u.test(t))return "أهلاً يا معلم 👋";
  if(/^(?:السلام عليكم|سلام عليكم)$/u.test(t))return "وعليكم السلام ورحمة الله وبركاته ❤️";
  if(/^(?:شكرا|شكراً|تسلم|حبيبي|تمام شكرا|تمام تسلم)$/u.test(t))return "حبيبي يا معلم ❤️";
  if(/^(?:باي|سلام|اشوفك بعدين|أشوفك بعدين)$/u.test(t))return "سلام يا معلم 👋 أشوفك على خير.";
  return null;
}
function v112LooksLikeToolOrStateRequest(text){
  const raw=String(text||"").trim();
  const t=v112NormalizeCasual(raw);
  if(!t)return false;
  if(raw.startsWith("/"))return true;
  if(needsLiveNews(raw)||needsPrayerContext(raw))return true;
  if(looksLikeCreateRequest(raw))return true;
  return /(?:مشتريات|قائمه الشراء|قائمة الشراء|اشتري|اشترى|هاتلي|جيبلي|ضيف|زود|شيل|احذف|امسح|عدل|غير|حرك|أجل|اجل|قدم|فكرني|فكرنى|ذكرني|ذكرنى|نبهني|نبهنى|تذكير|ميعاد|موعد|سنووز|snooze|افتكر ان|افتكر إن|انسى|امسح من ذاكرتك|تابعلي|راقبلي|وقف متابعه|وقف متابعة|الوقت عندي|انا فين)/u.test(t);
}
function v112LooksLikeDirectChat(text){
  const raw=String(text||"").trim();
  if(!raw)return false;
  return !v112LooksLikeToolOrStateRequest(raw);
}
async function v112CallPlainChat(env,model,text,history=[]){
  const controller=new AbortController();
  const timeout=Math.min(Number(model?.timeoutMs||V112_CHAT_TIMEOUT_MS),V112_CHAT_TIMEOUT_MS);
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const recent=(Array.isArray(history)?history:[]).slice(-8).map(m=>({role:m.role==="assistant"?"assistant":"user",content:String(m.content||"").slice(0,1200)}));
    const messages=[{role:"system",content:"أنت SuperAgent V11.2. اتكلم بالمصري الطبيعي جدًا وباختصار ووضوح. افهم العامية المصرية والإملاء غير الرسمي. لو المستخدم بيسلم أو بيسأل عليك رد طبيعي. لو بيسأل سؤال عادي جاوب مباشرة. ممنوع تقول إنك نفذت موعد أو مشتريات أو غيرت بيانات في مسار الدردشة. ما ترجعش JSON."},...recent,{role:"user",content:String(text||"").slice(0,7000)}];
    const req=new Request(OMNIAI_INTERNAL_URL,{method:"POST",headers:{Authorization:"Bearer "+env.OMNIAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:model.id,messages,temperature:0.35,max_tokens:900,stream:false}),signal:controller.signal});
    const res=await env.OMNIAI_SERVICE.fetch(req);
    if(!res.ok)throw new Error("chat_http_"+res.status);
    const data=await res.json();
    const out=v11ExtractModelText(data).trim();
    if(!out)throw new Error("chat_empty");
    return out;
  }finally{clearTimeout(timer);}
}
async function tryV112FastChat(env,chatId,text,history=[]){
  const fixed=v112DeterministicCasualReply(text);
  if(fixed){await sendText(env,chatId,fixed,quickMenuKeyboard());await saveConversationMessage(env,chatId,"assistant",fixed);return true;}
  if(!v112LooksLikeDirectChat(text))return false;
  const started=Date.now();
  for(let i=0;i<V112_CHAT_MODELS.length;i++){
    if(Date.now()-started>=V112_CHAT_TOTAL_BUDGET_MS)break;
    const model=V112_CHAT_MODELS[i];
    const attemptStart=Date.now();
    try{
      const answer=await v112CallPlainChat(env,model,text,history);
      try{await recordModelResult(env,model,true,Date.now()-attemptStart,null);}catch{}
      await sendText(env,chatId,answer,quickMenuKeyboard());
      await saveConversationMessage(env,chatId,"assistant",answer);
      return true;
    }catch(e){
      try{await recordModelResult(env,model,false,Date.now()-attemptStart,String(e?.message||e));}catch{}
    }
  }
  const answer="أنا معاك 😄 جرّب تبعتلي تاني.";
  await sendText(env,chatId,answer,quickMenuKeyboard());
  await saveConversationMessage(env,chatId,"assistant",answer);
  return true;
}

async function processFreshAgentText(env,chatId,text,history){
if(await tryV112FastChat(env,chatId,text,history))return;
`;
replaceBetween('const V111FIX_CHAT_MODELS=[','const profile=await getUserProfile(env,chatId);',directChat+'const profile=await getUserProfile(env,chatId);','direct chat chain');

// Clean legacy V11 router/hedging labels that are no longer true in 11.2 comments/diagnostics.
s=s.replaceAll('V11 semantic router + V11.1 latency/UX hardening','V11.2 simple three-model failover + latency/UX hardening');
s=s.replaceAll('hedged semantic routing/planning','simple sequential primary/fallback execution');
s=s.replaceAll('semantic router, 10 fast + 10 complex execution models, router primary + 2 fallbacks, ','');

s='/* SuperAgent V11.2 FULL — router removed. Exactly 3 AI models: GPT OSS 20B primary, Gemini 3.5 Flash-Lite fallback 1, Qwen 3.6 27B fallback 2. Existing deterministic engines, verifier/rollback guards, shopping To-Do, durable Telegram inbox, reminders, recurrence, voice, memory, Life OS and V10.7.1 feature engine are retained. */\n'+s;
fs.writeFileSync(OUT,s);
console.log(JSON.stringify({out:OUT,version:'11.2.0',bytes:Buffer.byteLength(s),lines:s.split(/\n/).length,models:3,router:false},null,2));
