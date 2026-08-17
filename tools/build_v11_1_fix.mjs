import fs from 'node:fs';

const SOURCE='SuperAgent_V11_1_FULL.js';
const OUT='SuperAgent_V11_1_FIX.js';
let s=fs.readFileSync(SOURCE,'utf8');

function mustReplace(oldValue,newValue,label){
  const before=s;
  s=s.replace(oldValue,newValue);
  if(s===before)throw new Error(`V11.1 FIX anchor missing: ${label}`);
}
function mustReplaceRegex(re,newValue,label){
  const before=s;
  s=s.replace(re,newValue);
  if(s===before)throw new Error(`V11.1 FIX regex anchor missing: ${label}`);
}

// Version + tighter global latency envelope.
mustReplace('const V10_VERSION="11.1.0";const V10_NAME="سوبر إيجنت V11.1 — سريع وسلس ومتعدد النماذج";',
'const V10_VERSION="11.1.1";const V10_NAME="سوبر إيجنت V11.1 FIX — سريع وطبيعي ومتعدد النماذج";', 'version');
mustReplace('const TOTAL_AI_BUDGET_MS=12000;const V11_ROUTER_BUDGET_MS=1100;const V11_ROUTE_LOCAL_CONFIDENCE=0.90;const V11_MIN_ROUTE_CONFIDENCE=0.55;const V111_EASY_PLAN_BUDGET_MS=6000;const V111_COMPLEX_PLAN_BUDGET_MS=11500;const V111_HEDGE_DELAY_MS=120;',
'const TOTAL_AI_BUDGET_MS=10000;const V11_ROUTER_BUDGET_MS=900;const V11_ROUTE_LOCAL_CONFIDENCE=0.90;const V11_MIN_ROUTE_CONFIDENCE=0.55;const V111_EASY_PLAN_BUDGET_MS=5200;const V111_COMPLEX_PLAN_BUDGET_MS=9800;const V111_HEDGE_DELAY_MS=120;const V111FIX_CHAT_TOTAL_BUDGET_MS=4200;const V111FIX_CHAT_TIMEOUT_MS=1800;', 'budgets');

// Expose fix flags in root diagnostics.
mustReplace('v11_1:true,v111_fast_router:true,v111_hedged_planning:true,v111_shopping_todo:true,',
'v11_1:true,v111_fix:true,v111_fast_router:true,v111_three_model_execution:true,v111_direct_chat:true,v111_shopping_todo:true,', 'root flags');
mustReplace('message:"سوبر إيجنت V11.1 جاهز للعمل",v11:true,v11_1:true,',
'message:"سوبر إيجنت V11.1 FIX جاهز للعمل",v11:true,v11_1:true,v111_fix:true,', 'setup flags');

// Make fast model timeouts tighter; preserve all 20 models as selectable library.
s=s.replaceAll('timeoutMs:1800,tier:"easy"','timeoutMs:1600,tier:"easy"');
s=s.replaceAll('timeoutMs:2200,tier:"easy"','timeoutMs:1900,tier:"easy"');
s=s.replaceAll('timeoutMs:1700,tier:"easy"','timeoutMs:1550,tier:"easy"');
s=s.replaceAll('timeoutMs:1900,tier:"easy"','timeoutMs:1750,tier:"easy"');
s=s.replaceAll('timeoutMs:2400,tier:"easy"','timeoutMs:2100,tier:"easy"');

const fastChatCode=`
const V111FIX_CHAT_MODELS=[
  FAST_MODELS.find(m=>m.id==="gemini::gemini-3.5-flash-lite"),
  FAST_MODELS.find(m=>m.id==="groq::openai/gpt-oss-20b"),
  FAST_MODELS.find(m=>m.id==="mistral::ministral-8b-latest")
].filter(Boolean);
function v111FixNormalizeCasual(text){return normalizeArabicLoose(String(text||"")).toLowerCase().replace(/[؟?!.,،؛:]+/g," ").replace(/\\s+/g," ").trim();}
function v111FixDeterministicCasualReply(text){
  const t=v111FixNormalizeCasual(text);
  if(/^(?:عامل اي|عامل ايه|اخبارك اي|اخبارك ايه|ازيك|إزيك|كيفك)$/u.test(t))return"تمام يا معلم 😄 إنت عامل إيه؟";
  if(/^(?:صباح الخير|صباح الفل|صباح النور)$/u.test(t))return"صباح الفل عليك 🌞 عامل إيه؟";
  if(/^(?:مساء الخير|مساء الفل|مساء النور)$/u.test(t))return"مساء الفل عليك 🌙 عامل إيه؟";
  if(/^(?:اهلا|أهلا|هاي|هلا|السلام عليكم|سلام عليكم)$/u.test(t))return /سلام/u.test(t)?"وعليكم السلام ورحمة الله وبركاته ❤️":"أهلاً يا معلم 👋";
  if(/^(?:شكرا|شكراً|تسلم|حبيبي|تمام شكرا|تمام تسلم)$/u.test(t))return"حبيبي يا معلم ❤️";
  if(/^(?:باي|سلام|اشوفك بعدين|أشوفك بعدين)$/u.test(t))return"سلام يا معلم 👋 أشوفك على خير.";
  return null;
}
function v111FixLooksLikeDirectChat(text){
  const r=v11RouteAxes(text);if(r.task!=="chat"||r.needs_tools||r.risk!=="low")return false;
  const t=v111FixNormalizeCasual(text);
  if(!t||t.startsWith("/"))return false;
  if(needsLiveNews(text)||needsPrayerContext(text))return false;
  if(/(?:سعر|الطقس|الجو|اخبار|أخبار|حاليا|حالياً|النهارده|اليوم|مين رئيس|من هو رئيس|امتى|إمتى|متى)/u.test(t))return false;
  return true;
}
async function v111FixCallPlainChat(env,model,text,history=[]){
  const controller=new AbortController();const timeout=Math.min(Number(model?.timeoutMs||V111FIX_CHAT_TIMEOUT_MS),V111FIX_CHAT_TIMEOUT_MS);const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const recent=(Array.isArray(history)?history:[]).slice(-8).map(m=>({role:m.role==="assistant"?"assistant":"user",content:String(m.content||"").slice(0,1200)}));
    const messages=[{role:"system",content:"أنت SuperAgent V11.1 FIX. اتكلم بالمصري الطبيعي وباختصار. لو المستخدم بيسلم أو بيسأل عليك رد كإنسان طبيعي وما تحولش الكلام لمهمة. لو السؤال عادي جاوب مباشرة. ممنوع تدعي إنك نفذت موعد أو مشتريات أو عدلت بيانات في مسار الدردشة. ما تستخدمش JSON."},...recent,{role:"user",content:String(text||"").slice(0,5000)}];
    const req=new Request(OMNIAI_INTERNAL_URL,{method:"POST",headers:{Authorization:`Bearer ${env.OMNIAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:model.id,messages,temperature:0.35,max_tokens:420,stream:false}),signal:controller.signal});
    const res=await env.OMNIAI_SERVICE.fetch(req);if(!res.ok)throw new Error(`chat_http_${res.status}`);const data=await res.json();const out=v11ExtractModelText(data).trim();if(!out)throw new Error("chat_empty");return out;
  }finally{clearTimeout(timer);}
}
async function tryV111FixFastChat(env,chatId,text,history=[]){
  const fixed=v111FixDeterministicCasualReply(text);if(fixed){await sendText(env,chatId,fixed,quickMenuKeyboard());await saveConversationMessage(env,chatId,"assistant",fixed);return true;}
  if(!v111FixLooksLikeDirectChat(text))return false;
  const started=Date.now();const failures=[];
  for(const model of V111FIX_CHAT_MODELS.slice(0,3)){
    if(Date.now()-started>=V111FIX_CHAT_TOTAL_BUDGET_MS)break;
    try{const answer=await v111FixCallPlainChat(env,model,text,history);await recordModelResult(env,model,true,Date.now()-started,null);await sendText(env,chatId,answer,quickMenuKeyboard());await saveConversationMessage(env,chatId,"assistant",answer);return true;}catch(e){failures.push(String(e?.message||e));try{await recordModelResult(env,model,false,Date.now()-started,String(e?.message||e));}catch{}}
  }
  const answer="أنا معاك 😄 قولّي اللي في بالك.";await sendText(env,chatId,answer,quickMenuKeyboard());await saveConversationMessage(env,chatId,"assistant",answer);return true;
}
`;

const processMarker='async function processFreshAgentText(env,chatId,text,history){';
mustReplace(processMarker,fastChatCode+'\n'+processMarker+'\nif(await tryV111FixFastChat(env,chatId,text,history))return;', 'fast direct chat');

// Replace wide hedged planner waves with exactly primary + two fallbacks from the correct tier.
const plannerRe=/const firstPool=route\.route==="complex"\?COMPLEX_MODELS:FAST_MODELS;[\s\S]*?const e=Object\.assign\(new Error\("V11\.1: تعذر الوصول لخطة موثوقة بسرعة، لذلك لم يتم تنفيذ أي تغيير\."\),\{v11_failures:failures\}\);throw e;/;
const plannerReplacement=`const primaryPool=route.route==="complex"?COMPLEX_MODELS:FAST_MODELS;
const ranked=await v11RankModels(env,route,primaryPool);
const selected=v11ProviderDiverse(ranked,3).slice(0,3);
const failures=[];const started=Date.now();const budget=route.route==="complex"?V111_COMPLEX_PLAN_BUDGET_MS:V111_EASY_PLAN_BUDGET_MS;
for(let i=0;i<selected.length;i++){
  if(Date.now()-started>=budget)break;
  const model=selected[i];
  try{
    const intent=await parseIntentWithFallbackLegacy(env,userText,validationContext,[model]);
    assertShoppingEntityPreservationV11(intent,routeText);
    Object.assign(intent,{_v11_route:route,_v11_model:model.id,_v111_fix_chain:true,_v111_attempt:i+1});
    return intent;
  }catch(error){failures.push({model:model.id,error:String(error?.message||error).slice(0,300)});}
}
const e=Object.assign(new Error("V11.1 FIX: تعذر الوصول لخطة موثوقة ضمن ميزانية السرعة، لذلك لم يتم تنفيذ أي تغيير."),{v11_failures:failures});throw e;`;
mustReplaceRegex(plannerRe,plannerReplacement,'3-model planner chain');

// Keep queue durable but reduce wait jitter further; no functional tables removed.
mustReplace('const V106_INBOX_LEASE_MS=30000;\nconst V106_INBOX_MAX_ATTEMPTS=5;\nconst V106_INBOX_BATCH_SIZE=4;\nconst V106_LEASE_RETRY_COUNT=8;\nconst V106_LEASE_RETRY_DELAY_MS=60;\nconst V106_INTER_UPDATE_DELAY_MS=20;',
'const V106_INBOX_LEASE_MS=30000;\nconst V106_INBOX_MAX_ATTEMPTS=5;\nconst V106_INBOX_BATCH_SIZE=4;\nconst V106_LEASE_RETRY_COUNT=6;\nconst V106_LEASE_RETRY_DELAY_MS=35;\nconst V106_INTER_UPDATE_DELAY_MS=5;', 'queue latency');

s=`/* SuperAgent V11.1 FIX — fast natural chat + semantic task router.\n20 models remain available as a routing library; each task uses at most one primary + two fallbacks. Casual chat bypasses the JSON planner. Deterministic/stateful features from V10.7.1/V11.1 are retained. */\n`+s;
fs.writeFileSync(OUT,s);
console.log(JSON.stringify({out:OUT,version:"11.1.1",bytes:Buffer.byteLength(s),lines:s.split(/\n/).length},null,2));
