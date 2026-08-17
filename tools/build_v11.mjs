import fs from 'node:fs';

const SOURCE = 'SuperAgent_V10_7_Universal_Agent.js';
const OUT = 'SuperAgent_V11_FULL.js';
let s = fs.readFileSync(SOURCE, 'utf8');

function mustReplace(pattern, replacement, label) {
  const before = s;
  s = s.replace(pattern, replacement);
  if (s === before) throw new Error(`V11 build anchor not found: ${label}`);
}

mustReplace('const V10_VERSION="10.7.1";const V10_NAME="سوبر إيجنت 10.7.1 — الوكيل الدلالي الشامل";','const V10_VERSION="11.0.0";const V10_NAME="سوبر إيجنت V11 — الوكيل الدلالي متعدد النماذج";','version/name');
mustReplace('const TOTAL_AI_BUDGET_MS=32000;','const TOTAL_AI_BUDGET_MS=32000;const V11_ROUTER_BUDGET_MS=2600;const V11_ROUTE_LOCAL_CONFIDENCE=0.90;const V11_MIN_PLAN_CONFIDENCE=0.55;','AI budget constants');

const oldModels=/const REMINDER_MODELS=\[[\s\S]*?\];\n\nexport default\{/;
const modelRegistry=`const FAST_MODELS=[
{short:"G3.5-L",name:"Gemini 3.5 Flash-Lite",id:"gemini::gemini-3.5-flash-lite",timeoutMs:3200,tier:"easy",tags:["chat","shopping","schedule","json"]},
{short:"G3.5-F",name:"Gemini 3.5 Flash",id:"gemini::gemini-3.5-flash",timeoutMs:3800,tier:"easy",tags:["chat","shopping","schedule","analysis","json"]},
{short:"OSS20",name:"GPT OSS 20B — Groq",id:"groq::openai/gpt-oss-20b",timeoutMs:2800,tier:"easy",tags:["chat","shopping","schedule","coding","json"]},
{short:"Qwen3.6",name:"Qwen 3.6 27B — Groq",id:"groq::qwen/qwen3.6-27b",timeoutMs:3200,tier:"easy",tags:["chat","shopping","schedule","coding","vision","json"]},
{short:"Min3",name:"Ministral 3B",id:"mistral::ministral-3b-latest",timeoutMs:2800,tier:"easy",tags:["chat","shopping","json"]},
{short:"Min8",name:"Ministral 8B",id:"mistral::ministral-8b-latest",timeoutMs:3000,tier:"easy",tags:["chat","shopping","schedule","json"]},
{short:"MistralS",name:"Mistral Small 2603",id:"mistral::mistral-small-2603",timeoutMs:3400,tier:"easy",tags:["chat","shopping","schedule","coding","json"]},
{short:"DS-V4F",name:"DeepSeek V4 Flash — NVIDIA",id:"nvidia::deepseek-ai/deepseek-v4-flash",timeoutMs:3300,tier:"easy",tags:["chat","analysis","coding"]},
{short:"Step3.7",name:"Step 3.7 Flash — NVIDIA",id:"nvidia::stepfun-ai/step-3.7-flash",timeoutMs:3300,tier:"easy",tags:["chat","analysis","coding"]},
{short:"NemoNano",name:"Nemotron 3 Nano 30B A3B",id:"nvidia::nvidia/nemotron-3-nano-30b-a3b",timeoutMs:3400,tier:"easy",tags:["chat","analysis","coding"]}
];
const COMPLEX_MODELS=[
{short:"G3.6-F",name:"Gemini 3.6 Flash",id:"gemini::gemini-3.6-flash",timeoutMs:8000,tier:"complex",tags:["analysis","shopping","schedule","coding","vision","research","document","json"]},
{short:"GPro",name:"Gemini Pro Latest",id:"gemini::gemini-pro-latest",timeoutMs:9000,tier:"complex",tags:["analysis","shopping","schedule","coding","vision","research","document","json"]},
{short:"OSS120",name:"GPT OSS 120B — Groq",id:"groq::openai/gpt-oss-120b",timeoutMs:5200,tier:"complex",tags:["analysis","shopping","schedule","coding","json"]},
{short:"M-Large",name:"Mistral Large Latest",id:"mistral::mistral-large-latest",timeoutMs:7200,tier:"complex",tags:["analysis","shopping","schedule","coding","document","json"]},
{short:"M-Med",name:"Mistral Medium Latest",id:"mistral::mistral-medium-latest",timeoutMs:6200,tier:"complex",tags:["analysis","shopping","schedule","coding","document","json"]},
{short:"Mag-Med",name:"Magistral Medium Latest",id:"mistral::magistral-medium-latest",timeoutMs:7000,tier:"complex",tags:["analysis","schedule","coding","document","json"]},
{short:"DS-V4P",name:"DeepSeek V4 Pro — NVIDIA",id:"nvidia::deepseek-ai/deepseek-v4-pro",timeoutMs:7200,tier:"complex",tags:["analysis","coding","research"]},
{short:"Q397",name:"Qwen 3.5 397B A17B — NVIDIA",id:"nvidia::qwen/qwen3.5-397b-a17b",timeoutMs:7600,tier:"complex",tags:["analysis","coding","research","document"]},
{short:"NemoSuper",name:"Nemotron 3 Super 120B A12B",id:"nvidia::nvidia/nemotron-3-super-120b-a12b",timeoutMs:7600,tier:"complex",tags:["analysis","coding","research"]},
{short:"NemoUltra",name:"Nemotron 3 Ultra 550B A55B",id:"nvidia::nvidia/nemotron-3-ultra-550b-a55b",timeoutMs:9000,tier:"complex",tags:["analysis","coding","research","document"]}
];
const ROUTER_MODELS=[
{short:"R-G3.5L",name:"Router Gemini 3.5 Flash-Lite",id:"gemini::gemini-3.5-flash-lite",timeoutMs:750},
{short:"R-OSS20",name:"Router GPT OSS 20B",id:"groq::openai/gpt-oss-20b",timeoutMs:850},
{short:"R-Min8",name:"Router Ministral 8B",id:"mistral::ministral-8b-latest",timeoutMs:950}
];
const ALL_EXECUTION_MODELS=[...FAST_MODELS,...COMPLEX_MODELS];
const REMINDER_MODELS=ALL_EXECUTION_MODELS;

export default{`;
mustReplace(oldModels,modelRegistry,'model registry');
mustReplace('v1071_reference_grounding_guard:true,reliability_lock:true','v1071_reference_grounding_guard:true,v11:true,v11_semantic_router:true,v11_fast_models:FAST_MODELS.length,v11_complex_models:COMPLEX_MODELS.length,v11_router_models:ROUTER_MODELS.length,v11_false_success_guard:true,v11_shopping_entity_preservation:true,reliability_lock:true','root V11 flags');
mustReplace('return json({ok:true,message:"سوبر إيجنت 10.7.1 جاهز للعمل",','return json({ok:true,message:"سوبر إيجنت V11 جاهز للعمل",v11:true,fast_models:FAST_MODELS.length,complex_models:COMPLEX_MODELS.length,router_models:ROUTER_MODELS.length,','setup V11 response');

const identityAnchor='async function handleTelegramUpdate(update,env){';
const identityCode=`function isV11IdentityQuestion(text){
const t=normalizeArabicText(String(text||"")).replace(/[؟?!.,،]/g," ").replace(/\\s+/g," ").trim();
return /^(?:انت\\s+مين|مين\\s+انت|اسمك\\s+(?:اي|ايه)|انت\\s+اسمك\\s+(?:اي|ايه)|مين\\s+حضرتك|عرفني\\s+بنفسك)$/u.test(t);
}
async function handleV11Identity(text,env,chatId){
if(!isV11IdentityQuestion(text))return false;
await sendText(env,chatId,"أنا سوبر إيجنت V11 🤖 — مساعدك الشخصي لتنظيم يومك ومواعيدك ومشترياتك وذاكرتك ومهامك من الكلام الطبيعي.");
return true;
}
${identityAnchor}`;
mustReplace(identityAnchor,identityCode,'identity handler anchor');
mustReplace('await sendChatAction(env,chatId,"typing");\nconst handled=await handleDirectCommands(text,env,chatId);','if(await handleV11Identity(text,env,chatId))return;\nawait sendChatAction(env,chatId,"typing");\nconst handled=await handleDirectCommands(text,env,chatId);','identity insertion');

const routerCode=`
function v11RouteAxes(text){
const raw=String(text||"").trim(),t=normalizeArabicText(raw).toLowerCase();
const lines=raw.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean),words=t.split(/\\s+/).filter(Boolean).length;
const destructive=/(?:امسح|احذف|الغ(?:ي|ى)|صفر|فضي|افرغ|شيل\\s+كل|كلهم|الجميع)/u.test(t);
const contextual=/(?:\\bده\\b|\\bدي\\b|\\bدول\\b|\\bمنه\\b|\\bمنها\\b|\\bاللي\\b|\\bالى\\b|اخر\\s+(?:واحد|حاجه|حاجة|ميعاد|موعد)|نفسه|نفسها|الكبير|الصغير)/u.test(t);
const mutation=/(?:فكرني|ذكرني|نبهني|اعمل|ضيف|زود|اشتري|اشترى|هات|جيب|احذف|امسح|غير|عدل|حرك|أجل|اجل|قدم|اوقف|استكمل|خطي|تخطى|سنووز|snooze)/u.test(t);
const schedule=/(?:ميعاد|موعد|تذكير|فكرني|ذكرني|نبهني|بكره|بكرة|النهارده|النهاردة|الاسبوع|الشهر|الساعة|الساعه|كل يوم|كل اسبوع|كل أسبوع|كل شهر)/u.test(t);
const shopping=/(?:اشتري|اشترى|مشتريات|عاوز اشتري|هاتلي|جيبلي|قائمة الشراء|قائمه الشراء)/u.test(t);
const coding=/(?:كود|برمج|javascript|python|html|css|sql|api|bug|error|stack|cloudflare|worker)/iu.test(raw);
const live=/(?:اخر الاخبار|آخر الأخبار|الجو|الطقس|سعر|حاليا|حالياً|live)/u.test(t);
const multiDomain=(shopping&&schedule)||(coding&&(shopping||schedule))||(live&&mutation),chain=/(?:وبعد(?:ها| كده)|وبعدين|ثم|لو .* اعمل|لما .* اعمل|بعد ما)/u.test(t),listLike=lines.length>=4||(?:shopping&&/[،,;]/.test(raw));
let route="easy",risk=destructive?"high":"low",needs_context=contextual,needs_tools=mutation||live,needs_reasoning=false,confidence=0.64,task="chat",reason="uncertain_local";
if(shopping)task="shopping";else if(schedule)task="schedule";else if(coding)task="coding";else if(live)task="research";else if(mutation)task="state_edit";
if(destructive||(contextual&&mutation)||multiDomain||chain){route="complex";needs_reasoning=true;confidence=destructive?0.96:0.93;reason=destructive?"destructive_or_bulk_state_change":"context_or_dependency_chain";}
else if(shopping&&listLike){route="easy";confidence=0.94;reason="explicit_simple_list_length_ignored";}
else if(task==="chat"&&!mutation&&!live&&!coding){route="easy";confidence=0.95;reason="plain_chat";}
else if((shopping||schedule)&&mutation&&!contextual&&!chain){route="easy";confidence=0.91;reason="single_domain_direct_mutation";}
else if(coding){route="complex";needs_reasoning=true;confidence=0.86;reason="coding_uncertain";}
return{route,task,risk,needs_context,needs_tools,needs_reasoning,confidence,reason,metrics:{words,lines:lines.length,list_like:listLike}};
}
function v11NormalizeRouteObject(o,fallback){const x=o&&typeof o==="object"?o:{};const route=x.route==="complex"?"complex":x.route==="easy"?"easy":fallback.route;const allowed=new Set(["chat","shopping","schedule","state_edit","analysis","coding","vision","research","document","other"]);const task=allowed.has(x.task)?x.task:fallback.task;const risk=["low","medium","high"].includes(x.risk)?x.risk:fallback.risk;const confidence=Math.max(0,Math.min(1,Number(x.confidence??fallback.confidence)||0));return{route,task,risk,needs_context:Boolean(x.needs_context??fallback.needs_context),needs_tools:Boolean(x.needs_tools??fallback.needs_tools),needs_reasoning:Boolean(x.needs_reasoning??fallback.needs_reasoning),confidence,reason:String(x.reason||fallback.reason||"router"),metrics:fallback.metrics};}
async function callV11RouterModel(env,model,text,local){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),model.timeoutMs);try{const prompt=[{role:"system",content:"أنت راوتر فقط لسوبر إيجنت. صنف المعنى لا طول الرسالة. قائمة طويلة بسيطة قد تكون easy. طلب قصير يعتمد على مرجع سابق أو حذف/تعديل حساس قد يكون complex. أعد JSON فقط: route,task,risk,needs_context,needs_tools,needs_reasoning,confidence,reason."},{role:"user",content:JSON.stringify({text:String(text||"").slice(0,12000),local_hint:local})}];const body={model:model.id,messages:prompt,temperature:0,max_tokens:220,stream:false,response_format:{type:"json_object"}},headers={"Content-Type":"application/json"};if(env.OMNIAI_API_KEY)headers.Authorization="Bearer "+env.OMNIAI_API_KEY;let res=await env.OMNIAI_SERVICE.fetch(OMNIAI_INTERNAL_URL,{method:"POST",headers,body:JSON.stringify(body),signal:controller.signal});if(!res.ok&&(res.status===400||res.status===422)){delete body.response_format;res=await env.OMNIAI_SERVICE.fetch(OMNIAI_INTERNAL_URL,{method:"POST",headers,body:JSON.stringify(body),signal:controller.signal});}if(!res.ok)throw new Error("router_http_"+res.status);const data=await res.json(),content=extractModelText(data),parsed=parseModelJson(content);return v11NormalizeRouteObject(parsed,local);}finally{clearTimeout(timer);}}
async function routeRequestV11(env,text){const local=v11RouteAxes(text);if(local.confidence>=V11_ROUTE_LOCAL_CONFIDENCE)return{...local,source:"local"};const started=Date.now();for(const model of ROUTER_MODELS){if(Date.now()-started>=V11_ROUTER_BUDGET_MS)break;try{const routed=await callV11RouterModel(env,model,text,local);if(routed.confidence>=0.55)return{...routed,source:model.id};}catch{}}if(local.needs_context&&local.needs_tools)return{...local,route:"complex",risk:local.risk==="low"?"medium":local.risk,needs_reasoning:true,confidence:0.70,source:"safe_local_fallback",reason:"router_unavailable_contextual_mutation"};return{...local,source:"local_fallback"};}
async function v11RankModels(env,route){const pool=route.route==="complex"?COMPLEX_MODELS:FAST_MODELS;let rows=[];try{rows=await getAllModelStats(env);}catch{}const stats=new Map(rows.map(r=>[r.model_id,r])),task=route.task||"other";return pool.map((m,index)=>{const st=stats.get(m.id),a=Number(st?.attempts||0),ok=Number(st?.successes||0),avg=a?Number(st?.total_latency_ms||0)/a:0,rate=a?ok/a:0.78,tag=(m.tags||[]).includes(task)?12:0,score=(100-index*2)+tag+rate*24-Math.min(16,avg/700);return{m,score};}).sort((a,b)=>b.score-a.score).map(x=>x.m);}
function v11DiverseCandidates(models,limit=6){const out=[],used=new Set();for(const m of models){const p=String(m.id).split("::")[0];if(!used.has(p)){out.push(m);used.add(p);}if(out.length>=limit)return out;}for(const m of models){if(!out.includes(m))out.push(m);if(out.length>=limit)break;}return out;}
`;
const parseAnchor='async function parseIntentWithFallback(env,userText,validationContext){';
mustReplace(parseAnchor,routerCode+'\n'+parseAnchor,'router insertion');
mustReplace(/async function parseIntentWithFallback\(env,userText,validationContext\)\{([\s\S]*?)const failures=\[\];\s*\n\s*for\(\s*let i=0;\s*i<REMINDER_MODELS\.length;\s*i\+\+\s*\)\{\s*const model=\s*REMINDER_MODELS\[i\];/,(match,prefix)=>`async function parseIntentWithFallback(env,userText,validationContext){${prefix}const failures=[];\nconst v11Route=await routeRequestV11(env,userText);\nlet candidates=v11DiverseCandidates(await v11RankModels(env,v11Route),6);\nconst other=v11Route.route==="complex"?FAST_MODELS:COMPLEX_MODELS;\nfor(const m of other)if(!candidates.some(x=>x.id===m.id))candidates.push(m);\nfor(let i=0;i<candidates.length;i++){\nconst model=candidates[i];`,'parse model loop');
mustReplace(/return\s+\{\.\.\.checked,usedModel:model\.short\};/,'return {...checked,usedModel:model.short,_v11_route:v11Route};','route metadata return');
mustReplace('for(\nconst model of REMINDER_MODELS.slice(\n0,\n6\n)\n){','for(\nconst model of FAST_MODELS.slice(\n0,\n6\n)\n){','text helper fast pool');

const shoppingGuard=`
function extractExplicitShoppingUnitsV11(text){const raw=String(text||"").replace(/\\r/g,"").trim(),lines=raw.split("\\n").map(x=>x.trim()).filter(Boolean);if(lines.length<3)return[];const first=normalizeArabicText(lines[0]).toLowerCase();if(!/(?:اشتري|اشترى|مشتريات|قائمة|قائمه|هات|جيب)/u.test(first))return[];const units=[];for(let i=1;i<lines.length;i++){let x=lines[i].replace(/^[\\-–—•*✅☐☑\\d.)\\s]+/u,"").trim();x=x.replace(/^و(?=[\\p{L}])/u,"").trim();if(!x||x.length>160)continue;if(/^(?:وبس|بس|شكرا|شكراً|تمام)$/u.test(normalizeArabicText(x).toLowerCase()))continue;units.push(x);}return units.length>=2?units:[];}
function normShoppingUnitV11(x){return normalizeArabicText(String(x||"")).toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu," ").replace(/\\s+/g," ").trim();}
function shoppingPlanTitlesV11(intent){const plan=intent?.shopping_plan||intent?.shoppingPlan||intent?.plan||{},ops=Array.isArray(plan?.operations)?plan.operations:Array.isArray(plan?.ops)?plan.ops:[];return ops.filter(op=>/add/i.test(String(op?.op||op?.action||op?.type||""))).map(op=>String(op?.title||op?.name||op?.item||op?.args?.title||op?.args?.name||"")).filter(Boolean);}
function assertShoppingEntityPreservationV11(intent,baseText){if(intent?.action!=="shopping")return;const expected=extractExplicitShoppingUnitsV11(baseText);if(expected.length<2)return;const planned=shoppingPlanTitlesV11(intent);if(planned.length<expected.length)throw new Error("V11_SHOPPING_ENTITY_DROP: planned "+planned.length+" of "+expected.length);const plannedNorm=planned.map(normShoppingUnitV11),missing=expected.filter(e=>{const n=normShoppingUnitV11(e);return !plannedNorm.some(p=>p===n||p.includes(n)||n.includes(p));});if(missing.length)throw new Error("V11_SHOPPING_ENTITY_MISMATCH: "+missing.join(" | "));intent._v11_expected_shopping_units=expected;}
`;
const finalSafetyAnchor='function finalSafetyCheck(intent,baseText,validationContext){';
mustReplace(finalSafetyAnchor,shoppingGuard+'\n'+finalSafetyAnchor,'shopping guard insertion');
mustReplace('function finalSafetyCheck(intent,baseText,validationContext){\n','function finalSafetyCheck(intent,baseText,validationContext){\nassertShoppingEntityPreservationV11(intent,baseText);\n','shopping plan precondition');

const selfTestAnchor='async function runSelfTests(env){';
const v11Tests=`function runV11PureSelfTests(){const tests=[],push=(name,ok,detail="")=>tests.push({name,ok:Boolean(ok),detail});const longList="بص عاوز اشتري\\nعيش تورتيلا\\nعيش توست\\nفينو اسود\\nفصوص رومي\\nشيدر طبيعي\\nكاجو\\nفستق\\nكوفي شيك\\nحليب دينا\\nايس كريم دينا\\nوبطاطس طبيعية";const r1=v11RouteAxes(longList);push("v11_long_shopping_is_easy",r1.route==="easy",JSON.stringify(r1));const units=extractExplicitShoppingUnitsV11(longList);push("v11_long_shopping_preserves_11_units",units.length===11,String(units.length));const r2=v11RouteAxes("شيل الكبير وخلي اللي بعده قبل معاده بساعتين");push("v11_short_contextual_chain_is_complex",r2.route==="complex",JSON.stringify(r2));push("v11_fast_pool_10",FAST_MODELS.length===10,String(FAST_MODELS.length));push("v11_complex_pool_10",COMPLEX_MODELS.length===10,String(COMPLEX_MODELS.length));push("v11_router_primary_plus_2_fallbacks",ROUTER_MODELS.length===3,String(ROUTER_MODELS.length));push("v11_identity",isV11IdentityQuestion("انت اسمك اي"));return tests;}
${selfTestAnchor}`;
mustReplace(selfTestAnchor,v11Tests,'self test insertion');
const runIndex=s.indexOf('async function runSelfTests(env){'),testsIndex=s.indexOf('const tests=[];',runIndex);if(runIndex<0||testsIndex<0)throw new Error('selftest array anchor missing');s=s.slice(0,testsIndex)+'const tests=[...runV11PureSelfTests()];'+s.slice(testsIndex+'const tests=[];'.length);

s=`/* SuperAgent V11 FULL — generated from the complete V10.7.1 feature engine.\nV11: 10 fast + 10 complex models, semantic router + 2 fallbacks, adaptive ranking, deterministic identity, shopping entity-preservation safety, existing planner/executor/verifier/rollback and durable Telegram reliability retained. Same Cloudflare bindings. */\n`+s;
fs.writeFileSync(OUT,s);
console.log(JSON.stringify({out:OUT,bytes:Buffer.byteLength(s),lines:s.split(/\\n/).length},null,2));
